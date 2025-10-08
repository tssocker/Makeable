import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

interface GeneratedFile {
  path: string;
  content: string;
}

interface AppGenerationResult {
  files: GeneratedFile[];
}

// Helper function to compress and validate images
async function compressImage(imageBuffer: Buffer, maxSizeMB: number = 5): Promise<Buffer> {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  
  try {
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    
    // Calculate new dimensions to reduce file size
    let { width, height } = metadata;
    const maxDimension = 1024; // Max width or height
    
    if (width && height) {
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
    }
    
    // Try different quality levels until we get under the size limit
    let quality = 80;
    let compressedBuffer = await sharp(imageBuffer)
      .resize(width, height)
      .jpeg({ quality })
      .toBuffer();
    
    // If still too large, reduce quality further
    while (compressedBuffer.length > maxSizeBytes && quality > 10) {
      quality -= 10;
      compressedBuffer = await sharp(imageBuffer)
        .resize(width, height)
        .jpeg({ quality })
        .toBuffer();
    }
    
    if (compressedBuffer.length > maxSizeBytes) {
      throw new Error(`Image could not be compressed below ${maxSizeMB}MB limit`);
    }
    
    return compressedBuffer;
  } catch (error) {
    console.error('Image compression error:', error);
    throw new Error('Failed to compress image');
  }
}

// Helper function to validate image size
function validateImageSize(buffer: Buffer, maxSizeMB: number = 5): boolean {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return buffer.length <= maxSizeBytes;
}

const tools: Anthropic.Tool[] = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Use this to generate HTML, CSS, JavaScript, or any other files needed for the app.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the app root (e.g., "index.html", "styles.css", "app.js")'
        },
        content: {
          type: 'string',
          description: 'The complete content of the file'
        }
      },
      required: ['path', 'content']
    }
  }
];

// Helper function to process message content and handle oversized images
async function processMessageContent(content: any): Promise<any> {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    const processedContent = [];
    for (const item of content) {
      if (item.type === 'image' && item.source?.type === 'base64') {
        try {
          // Convert base64 to buffer
          const imageBuffer = Buffer.from(item.source.data, 'base64');
          
          // Check if image is too large
          if (!validateImageSize(imageBuffer)) {
            console.log(`Image size ${imageBuffer.length} bytes exceeds limit, compressing...`);
            const compressedBuffer = await compressImage(imageBuffer);
            const compressedBase64 = compressedBuffer.toString('base64');
            
            processedContent.push({
              ...item,
              source: {
                ...item.source,
                data: compressedBase64
              }
            });
          } else {
            processedContent.push(item);
          }
        } catch (error) {
          console.error('Error processing image:', error);
          // Skip the image if compression fails
          continue;
        }
      } else {
        processedContent.push(item);
      }
    }
    return processedContent;
  }
  
  return content;
}

export async function createApp(prompt: string, existingFiles?: GeneratedFile[]): Promise<AppGenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const client = new Anthropic({ apiKey });
  const generatedFiles: Map<string, string> = new Map();

  // If updating existing project, pre-populate with existing files
  if (existingFiles && existingFiles.length > 0) {
    existingFiles.forEach(file => {
      generatedFiles.set(file.path, file.content);
    });
  }

  const isUpdate = existingFiles && existingFiles.length > 0;

  const systemPrompt = isUpdate
    ? `You are an expert web developer. You are updating an existing web application based on the user's modification request.

IMPORTANT INSTRUCTIONS FOR UPDATES:
- The user has an EXISTING app and wants to make SPECIFIC CHANGES to it
- You will be provided with the current files of the app
- ONLY modify the parts that need to change based on the user's request
- Keep all other functionality and styling exactly as they are
- Use the write_file tool to write the UPDATED versions of files
- Only write files that actually need to be changed
- Make minimal, targeted changes - don't rewrite the entire app unless necessary

The user wants to make specific changes to their existing app. Be surgical and precise.`
    : `You are an expert web developer. Your task is to create a complete, working web application based on the user's description.

IMPORTANT INSTRUCTIONS:
- Generate a complete, self-contained web application
- Always create at least an index.html file
- Include all necessary CSS and JavaScript inline in the HTML for simplicity
- Make the app visually appealing and functional with modern design
- Use modern web standards (HTML5, CSS3, ES6+)
- Use the write_file tool to create each file needed
- Make sure the app is fully functional and ready to use

Create a fully functional app that matches the user's request.`;

  try {
    let userMessage = prompt;

    // If updating, include current files in the prompt
    if (isUpdate && existingFiles) {
      const filesContext = existingFiles.map(file =>
        `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``
      ).join('\n\n');

      userMessage = `Here are the current files of the app:\n\n${filesContext}\n\nUser's modification request: ${prompt}`;
    }

    // Process the user message content to handle any images
    const processedContent = await processMessageContent(userMessage);
    
    let messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: processedContent
      }
    ];

    // Agentic loop - allow Claude to use tools multiple times
    for (let i = 0; i < 10; i++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: systemPrompt,
        tools,
        messages
      });

      console.log('Response:', response.stop_reason);

      // Check for tool uses in the response
      const hasToolUse = response.content.some(block => block.type === 'tool_use');

      // Add assistant response to messages
      messages.push({
        role: 'assistant',
        content: response.content
      });

      // If there are tool uses, process them
      if (hasToolUse) {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log('Tool use:', block.name, block.input);

            if (block.name === 'write_file') {
              const input = block.input as { path?: string; content?: string };

              if (input.path && input.content) {
                generatedFiles.set(input.path, input.content);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `File ${input.path} created successfully with ${input.content.length} characters`
                });
              } else {
                // Handle incomplete tool call (e.g., max_tokens reached)
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: 'Error: Incomplete file data. Please try again with a simpler request.',
                  is_error: true
                });
              }
            }
          }
        }

        // Add tool results to conversation
        if (toolResults.length > 0) {
          messages.push({
            role: 'user',
            content: toolResults
          });
        }
      } else {
        // No more tool uses, we're done
        break;
      }
    }

    console.log('Agent completed. Generated files:', Array.from(generatedFiles.keys()));

    const files: GeneratedFile[] = Array.from(generatedFiles.entries()).map(([path, content]) => ({
      path,
      content
    }));

    if (files.length === 0) {
      throw new Error('No files were generated. Please try again with a more specific prompt.');
    }

    return { files };

  } catch (error) {
    console.error('Agent error:', error);
    throw error;
  }
}
