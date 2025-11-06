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

export async function createApp(
  prompt: string,
  existingFiles?: GeneratedFile[],
  uploadedFiles?: Array<{ name: string; type: string; data: string; url?: string }>
): Promise<AppGenerationResult> {
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
    : `You are an expert web developer creating professional, production-ready web applications.

DESIGN GUIDELINES:
- Create clean, professional, modern designs suitable for business and professional use
- Use neutral, professional color schemes: whites, grays, subtle blues/greens
- Avoid playful, toy-like, or overly colorful aesthetics
- Focus on usability, accessibility, and readability
- Use professional typography (System fonts like -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto)
- Base font size should be at least 16px for optimal readability
- Implement proper spacing and visual hierarchy (use 8px grid system)
- Add subtle shadows (0 1px 3px rgba(0,0,0,0.1)) and borders (#e5e7eb) for depth
- Ensure responsive design that works on all screen sizes
- Use subtle animations only (hover effects with 0.2s transitions)

RECOMMENDED COLOR PALETTE:
- Primary Action: #2563eb (professional blue) or #059669 (professional green)
- Background: #ffffff (white), #f9fafb (light gray), #f3f4f6 (gray)
- Text: #111827 (dark), #6b7280 (medium gray), #9ca3af (light gray)
- Borders: #e5e7eb (light), #d1d5db (medium)
- Success: #059669, Warning: #d97706, Error: #dc2626
- Use accent colors sparingly and only where needed

COMPONENT STYLING:
- Buttons: solid backgrounds, 6-8px border-radius, padding 0.75rem 1.5rem, clear hover states
- Inputs: 2px border, 6px radius, proper labels above, focus states with subtle ring
- Cards: white background, 8px radius, subtle shadow, padding 1.5-2rem
- Typography: clear hierarchy with h1 (2rem), h2 (1.5rem), body (1rem)
- Spacing: consistent margins and padding using multiples of 8px (0.5rem, 1rem, 1.5rem, 2rem)

TECHNICAL REQUIREMENTS:
- Generate a complete, self-contained web application
- Always create at least an index.html file
- Include all necessary CSS and JavaScript inline in the HTML for simplicity
- Use modern web standards (HTML5, CSS3, ES6+)
- Make sure the app is fully functional and ready to use
- Use the write_file tool to create each file needed
- Ensure proper semantic HTML structure

Create a fully functional, professional-grade application that looks like it was designed by a professional UX/UI designer.`;

  try {
    let userMessage = prompt;

    // If updating, include current files in the prompt
    if (isUpdate && existingFiles) {
      const filesContext = existingFiles.map(file =>
        `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``
      ).join('\n\n');

      userMessage = `Here are the current files of the app:\n\n${filesContext}\n\nUser's modification request: ${prompt}`;
    }

    // Build content array with text and uploaded files
    let messageContent: any[] = [{ type: 'text', text: userMessage }];

    // Add uploaded files to the message
    if (uploadedFiles && uploadedFiles.length > 0) {
      const imageUrls: string[] = [];

      for (const file of uploadedFiles) {
        if (file.type.startsWith('image/')) {
          // If URL is provided (from Cloudinary), use it
          if (file.url) {
            imageUrls.push(file.url);
            // Still add base64 image for Vision API to see
            const base64Data = file.data.split(',')[1];
            let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
            if (file.type.includes('png')) mediaType = 'image/png';
            else if (file.type.includes('gif')) mediaType = 'image/gif';
            else if (file.type.includes('webp')) mediaType = 'image/webp';

            messageContent.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            });
          } else {
            // Fallback to base64 if no URL (old behavior)
            const base64Data = file.data.split(',')[1];
            let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
            if (file.type.includes('png')) mediaType = 'image/png';
            else if (file.type.includes('gif')) mediaType = 'image/gif';
            else if (file.type.includes('webp')) mediaType = 'image/webp';

            messageContent.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            });
          }
        } else {
          // For non-image files, include them as text context
          messageContent[0].text += `\n\n[User provided file: ${file.name}]`;
        }
      }

      // Add instruction about images with URLs
      if (imageUrls.length > 0) {
        messageContent[0].text += `\n\n🚨 CRITICAL - ${imageUrls.length} IMAGE(S) PROVIDED 🚨

You can see ${imageUrls.length} image(s) above in the message content.

YOU MUST embed these images directly in your HTML using these exact URLs:

${imageUrls.map((url, i) => `Image ${i + 1}: ${url}`).join('\n')}

Use <img> tags like this:
<img src="${imageUrls[0]}" alt="User provided image" style="max-width: 100%; height: auto;">

DO NOT use base64 data URIs - use the URLs provided above!`;
      }
    }

    // Process the message content to handle oversized images
    const processedContent = await processMessageContent(messageContent);

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
        max_tokens: 16000,
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
