import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { createApp } from './agent/createApp.js';
import { authMiddleware, generateToken, type AuthRequest } from './auth/authMiddleware.js';
import { userStorage } from './auth/userStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'demo',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ credentials: true, origin: true }));
// Increase payload limit for file uploads (images can be large when base64 encoded)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

const PROJECTS_DIR = path.join(__dirname, '../projects');

// Ensure projects directory exists
await fs.mkdir(PROJECTS_DIR, { recursive: true });

interface Project {
  id: string;
  name: string;
  prompt: string;
  promptHistory?: Array<{ prompt: string; timestamp: string }>; // History of all prompts
  files: Array<{ path: string; content: string }>;
  createdAt: string;
  userId: string;
}

// In-memory project storage (could be replaced with database)
const projects = new Map<string, Project>();

// Load existing projects on startup
try {
  const projectFiles = await fs.readdir(PROJECTS_DIR);
  for (const file of projectFiles) {
    if (file.endsWith('.json')) {
      const data = await fs.readFile(path.join(PROJECTS_DIR, file), 'utf-8');
      const project = JSON.parse(data) as Project;
      projects.set(project.id, project);
    }
  }
  console.log(`Loaded ${projects.size} existing projects`);
} catch (error) {
  console.log('No existing projects found');
}

// Auth endpoints
// Special setup endpoint - creates admin users (allows multiple admin creations)
app.post('/api/auth/setup-admin', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Create admin user (no restriction on number of admins)
    const user = await userStorage.createUser(email, password, name, 'admin');
    const token = generateToken(user.id);

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax'
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      token
    });
  } catch (error) {
    console.error('Admin setup error:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Admin setup failed'
    });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, role, course } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Validate course is required for students
    if (role === 'student' && !course) {
      return res.status(400).json({ error: 'Course selection is required for students' });
    }

    const user = await userStorage.createUser(email, password, name, role || 'student', course);
    const token = generateToken(user.id);

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax'
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
        role: user.role,
        course: user.course
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Registration failed'
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await userStorage.verifyPassword(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user.id);

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax'
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
        role: user.role
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, async (req: AuthRequest, res) => {
  const user = userStorage.findById(req.userId!);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    profilePicture: user.profilePicture,
    role: user.role
  });
});

app.patch('/api/auth/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, profilePicture } = req.body;
    const updates: any = {};

    if (name) updates.name = name;
    if (profilePicture !== undefined) updates.profilePicture = profilePicture;

    const updatedUser = await userStorage.updateUser(req.userId!, updates);
    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        profilePicture: updatedUser.profilePicture,
        role: updatedUser.role
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.patch('/api/auth/password', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    const success = await userStorage.updatePassword(req.userId!, newPassword);
    if (!success) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// AI Suggestions endpoint - generates contextual improvement suggestions
app.post('/api/ai-suggestions', authMiddleware, async (req, res) => {
  try {
    const { prompt, projectFiles } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
      // Fallback if no API key
      return res.json({
        suggestions: {
          message: `Ich habe deine Anfrage "${prompt}" analysiert.

## 💡 Allgemeine Verbesserungsvorschläge

**Funktionalität:**
- Füge interaktive Elemente hinzu
- Implementiere Benutzer-Feedback
- Erweitere die Kernfunktionen

**Design & UX:**
- Optimiere für mobile Geräte
- Verbessere die Ladezeiten
- Füge visuelle Indikatoren hinzu

Welche dieser Ideen möchtest du umsetzen?`,
          chips: [
            'Interaktive Elemente hinzufügen',
            'Mobile Optimierung',
            'Performance verbessern',
            'Benutzer-Feedback einbauen'
          ]
        }
      });
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    // Create a context-aware prompt for suggestions with actual file contents
    let contextPrompt = `Der Benutzer hat folgende App erstellt: "${prompt}"`;

    if (projectFiles && projectFiles.length > 0) {
      contextPrompt += `\n\nDie App besteht aus ${projectFiles.length} Datei(en):\n\n`;

      // Include actual file contents for better context
      projectFiles.forEach((file: any) => {
        // Limit content length to avoid token limits
        const maxContentLength = 3000;
        const content = file.content.length > maxContentLength
          ? file.content.substring(0, maxContentLength) + '\n... (gekürzt)'
          : file.content;

        contextPrompt += `### Datei: ${file.path}\n\`\`\`\n${content}\n\`\`\`\n\n`;
      });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `${contextPrompt}

Analysiere diese SPEZIFISCHE App und ihren CODE im Detail. Schaue dir genau an:
- Welche Features und Funktionen bereits implementiert sind
- Welchen Zweck die App erfüllt und für welche Zielgruppe sie ist
- Welches Design und welche UX-Patterns verwendet werden
- Welche technischen Implementierungen vorhanden sind

Erstelle dann projektspezifische, auf DIESE KONKRETE APP zugeschnittene Verbesserungsvorschläge im folgenden Format:

## [Kategorie 1 mit passendem Emoji]

**Unterkategorie:**
- Konkreter Vorschlag 1 (basierend auf dem vorhandenen Code)
- Konkreter Vorschlag 2 (basierend auf dem vorhandenen Code)

## [Kategorie 2 mit passendem Emoji]

**Unterkategorie:**
- Konkreter Vorschlag 3 (basierend auf dem vorhandenen Code)
- Konkreter Vorschlag 4 (basierend auf dem vorhandenen Code)

WICHTIG:
- Analysiere den TATSÄCHLICHEN Code und die Features dieser spezifischen App
- Gib NUR Vorschläge, die auf die vorhandene Implementierung aufbauen
- Sei konkret und spezifisch - keine generischen Tipps!
- Wenn es z.B. eine Studierenden-App ist, erwähne studierende-spezifische Features
- Wenn bestimmte Features fehlen, die für diese Zielgruppe wichtig sind, schlage sie vor
- Nutze Markdown-Formatierung (##, **, -)
- Gib 3-4 gut strukturierte Kategorien
- Am Ende: Stelle eine Frage zur nächsten Priorität basierend auf dem vorhandenen Code
- Erstelle auch 4 kurze, umsetzbare Vorschläge als "Action Items" (max 4-5 Wörter pro Item)

ANTWORT-FORMAT:
{
  "message": "[Dein formatierter Markdown-Text hier mit projektspezifischen Vorschlägen]",
  "chips": ["Action Item 1", "Action Item 2", "Action Item 3", "Action Item 4"]
}`
      }]
    });

    // Parse the AI response
    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from AI');
    }

    // Try to parse JSON from the response
    let suggestions;
    try {
      // Extract JSON from code blocks if present
      const jsonMatch = textContent.text.match(/```json\s*([\s\S]*?)\s*```/) ||
                       textContent.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        suggestions = JSON.parse(textContent.text);
      }
    } catch (parseError) {
      // If JSON parsing fails, use the raw text
      suggestions = {
        message: textContent.text,
        chips: [
          'Funktion erweitern',
          'Design verbessern',
          'Performance optimieren',
          'Features hinzufügen'
        ]
      };
    }

    res.json({ suggestions });
  } catch (error) {
    console.error('AI suggestions error:', error);
    res.status(500).json({
      error: 'Failed to generate suggestions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Image upload endpoint - uploads images to Cloudinary and returns URLs
app.post('/api/upload-image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Check if Cloudinary is configured
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret || cloudName === 'demo') {
      // Fallback: return base64 data URL if Cloudinary not configured
      const base64 = req.file.buffer.toString('base64');
      const dataUrl = `data:${req.file.mimetype};base64,${base64}`;
      return res.json({
        success: true,
        url: dataUrl,
        fallback: true,
        message: 'Cloudinary not configured, using base64 fallback'
      });
    }

    // Upload to Cloudinary
    const uploadPromise = new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'makeable-uploads',
          resource_type: 'auto'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file!.buffer);
    });

    const result = await uploadPromise;

    res.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      error: 'Failed to upload image',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Admin middleware
const adminMiddleware = async (req: AuthRequest, res: any, next: any) => {
  const user = userStorage.findById(req.userId!);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Make user admin (temporary endpoint - remove after first use!)
app.post('/api/make-admin', async (req, res) => {
  const { email, secret } = req.body;

  if (secret !== 'make-me-admin-2024') {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  const user = userStorage.findByEmail(email);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  await userStorage.updateUser(user.id, { role: 'admin' });

  res.json({ success: true, message: `${email} is now an admin!` });
});

// Admin endpoints
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const users = userStorage.getAllUsers().map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    profilePicture: u.profilePicture
  }));
  res.json({ users });
});

app.get('/api/admin/projects', authMiddleware, adminMiddleware, async (req, res) => {
  const allProjects = Array.from(projects.values()).map(p => {
    const user = userStorage.findById(p.userId);
    return {
      id: p.id,
      name: p.name,
      prompt: p.prompt,
      createdAt: p.createdAt,
      userId: p.userId,
      userName: user?.name || 'Unknown',
      userEmail: user?.email || 'Unknown'
    };
  });
  res.json({ projects: allProjects });
});

app.get('/api/admin/projects/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const user = userStorage.findById(project.userId);
  res.json({
    ...project,
    userName: user?.name || 'Unknown',
    userEmail: user?.email || 'Unknown'
  });
});

app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  const allUsers = userStorage.getAllUsers();
  const allProjects = Array.from(projects.values());

  const stats = {
    totalUsers: allUsers.length,
    totalStudents: allUsers.filter(u => u.role === 'student').length,
    totalAdmins: allUsers.filter(u => u.role === 'admin').length,
    totalProjects: allProjects.length,
    projectsPerUser: {} as Record<string, number>
  };

  allProjects.forEach(p => {
    stats.projectsPerUser[p.userId] = (stats.projectsPerUser[p.userId] || 0) + 1;
  });

  res.json(stats);
});

// Get all projects
app.get('/api/projects', authMiddleware, async (req, res) => {
  const authReq = req as AuthRequest;
  const userId = authReq.userId;

  const projectList = Array.from(projects.values())
    .filter(p => p.userId === userId)
    .map(p => ({
      id: p.id,
      name: p.name,
      prompt: p.prompt,
      createdAt: p.createdAt
    }));
  res.json({ projects: projectList });
});

// Get specific project
app.get('/api/projects/:id', authMiddleware, async (req, res) => {
  const authReq = req as AuthRequest;
  const userId = authReq.userId;

  const project = projects.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Security: Only allow access to own projects
  if (project.userId !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(project);
});

// Delete project
app.delete('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthRequest;
    const userId = authReq.userId;

    const project = projects.get(id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Security: Only allow deleting own projects (or admin can delete any)
    const user = userStorage.findById(userId!);
    if (project.userId !== userId && user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete from memory
    projects.delete(id);

    // Delete from disk
    const projectPath = path.join(PROJECTS_DIR, `${id}.json`);
    await fs.unlink(projectPath).catch(err => console.error('Error deleting project file:', err));

    res.json({ success: true, message: 'Project deleted' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Create new project
app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, projectId, files } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Get user info first
    const authReq = req as AuthRequest;
    const userId = authReq.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Create project IMMEDIATELY with empty files
    const id = projectId || `project_${Date.now()}`;

    // Generate a smart project name from the prompt
    function generateProjectName(prompt: string): string {
      // Remove common prefixes
      let cleaned = prompt
        .replace(/^(ich (möchte|würde|will|hätte) gerne|bau mir|create|build|make|erstelle)\s+/i, '')
        .replace(/^(eine?|an?)\s+/i, '');

      // Extract key words (nouns, adjectives)
      const words = cleaned.split(/\s+/).filter(w => w.length > 2);

      // Take first 3-4 meaningful words
      let name = words.slice(0, 4).join(' ');

      // Capitalize first letter
      name = name.charAt(0).toUpperCase() + name.slice(1);

      // Limit length
      if (name.length > 40) {
        name = name.slice(0, 40).trim() + '...';
      }

      return name || 'New App';
    }

    const name = generateProjectName(prompt);

    const placeholderProject: Project = {
      id,
      name,
      prompt,
      promptHistory: [{ prompt, timestamp: new Date().toISOString() }],
      files: [],
      createdAt: new Date().toISOString(),
      userId
    };

    projects.set(id, placeholderProject);

    // Save placeholder to disk immediately
    await fs.writeFile(
      path.join(PROJECTS_DIR, `${id}.json`),
      JSON.stringify(placeholderProject, null, 2)
    );

    // Send immediate response with project ID
    res.json({
      success: true,
      project: {
        id: placeholderProject.id,
        name: placeholderProject.name,
        files: []
      },
      message: 'Project created, generating app...'
    });

    // Now generate the app in the background
    console.log('Generating app from prompt:', prompt);
    console.log('Files received:', files ? files.length : 0, 'files');

    try {
      // Check if API key is valid
      const apiKey = process.env.ANTHROPIC_API_KEY;
      let result;

      if (!apiKey || apiKey === 'your_api_key_here' || apiKey.trim().length < 20) {
        console.log('⚠️  No valid API key found, using mock data');
        // Use mock data if no API key
        result = {
          files: [{
            path: 'index.html',
            content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f9fafb;
            color: #111827;
            line-height: 1.6;
            padding: 2rem;
            min-height: 100vh;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            padding: 2rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        h1 {
            color: #111827;
            font-size: 2rem;
            font-weight: 600;
            margin-bottom: 1rem;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 0.75rem;
        }
        p {
            color: #6b7280;
            margin-bottom: 1rem;
            font-size: 1rem;
        }
        .info-box {
            background: #f3f4f6;
            border-left: 3px solid #2563eb;
            padding: 1rem;
            border-radius: 4px;
            margin: 1.5rem 0;
        }
        .info-box strong {
            color: #111827;
            display: block;
            margin-bottom: 0.5rem;
        }
        .note {
            background: #fef3c7;
            border-left: 3px solid #f59e0b;
            padding: 1rem;
            border-radius: 4px;
            margin: 1.5rem 0;
            color: #92400e;
        }
        button {
            background: #2563eb;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
            margin-top: 1rem;
        }
        button:hover {
            background: #1d4ed8;
        }
        .footer {
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid #e5e7eb;
            color: #9ca3af;
            font-size: 0.875rem;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Professional App Template</h1>
        <p>This application preview was generated based on your requirements:</p>
        <div class="info-box">
            <strong>Your Request:</strong>
            <p style="margin: 0; color: #374151;">"${prompt}"</p>
        </div>
        <div class="note">
            <strong>⚠️ Configuration Required</strong>
            <p style="margin: 0;">This is a preview template. To generate fully functional, production-ready applications with AI, please configure your Anthropic API key in the environment settings.</p>
        </div>
        <button onclick="alert('Feature activated! In production, this would trigger your app\\'s main functionality.')">Get Started</button>
        <div class="footer">
            Generated by Makeable • Professional App Builder
        </div>
    </div>
</body>
</html>`
          }]
        };
      } else {
        result = await createApp(prompt, undefined, files);
      }

      // Update project with generated files
      const updatedProject: Project = {
        id,
        name,
        prompt,
        promptHistory: placeholderProject.promptHistory,
        files: result.files,
        createdAt: placeholderProject.createdAt,
        userId
      };

      projects.set(id, updatedProject);

      // Update on disk
      await fs.writeFile(
        path.join(PROJECTS_DIR, `${id}.json`),
        JSON.stringify(updatedProject, null, 2)
      );

      console.log('App generation completed for project:', id);
    } catch (error) {
      console.error('Error generating app:', error);
      // If generation fails, create a simple error page
      const errorProject: Project = {
        id,
        name,
        prompt,
        files: [{
          path: 'index.html',
          content: `<!DOCTYPE html>
<html><head><title>Error</title><style>body{font-family:sans-serif;padding:2rem;background:#f5f5f5;}</style></head>
<body><h1>⚠️ Generation Failed</h1><p>Please check your API key and try again.</p></body></html>`
        }],
        createdAt: placeholderProject.createdAt,
        userId
      };
      projects.set(id, errorProject);
      await fs.writeFile(
        path.join(PROJECTS_DIR, `${id}.json`),
        JSON.stringify(errorProject, null, 2)
      );
    }
  } catch (error) {
    console.error('Error generating app:', error);
    
    // Handle specific image size errors
    if (error instanceof Error && error.message.includes('image exceeds')) {
      res.status(400).json({
        error: 'Image too large',
        details: 'The image you provided is too large. Please use an image smaller than 5MB or try a different image.',
        suggestion: 'You can compress your image using online tools or take a screenshot with lower quality.'
      });
      return;
    }
    
    // Handle image compression errors
    if (error instanceof Error && error.message.includes('Failed to compress image')) {
      res.status(400).json({
        error: 'Image processing failed',
        details: 'Unable to process the provided image. Please try with a different image format (JPEG, PNG, WebP).',
        suggestion: 'Try using a simpler image or a different format.'
      });
      return;
    }
    
    res.status(500).json({
      error: 'Failed to generate app',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Rename project
app.patch('/api/projects/:id/rename', authMiddleware, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.userId;
    const { name } = req.body;
    const projectId = req.params.id;

    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Security: Only allow renaming own projects
    if (project.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    project.name = name;

    // Save to disk
    await fs.writeFile(
      path.join(PROJECTS_DIR, `${projectId}.json`),
      JSON.stringify(project, null, 2)
    );

    res.json({ success: true, project: { id: project.id, name: project.name } });
  } catch (error) {
    console.error('Error renaming project:', error);
    res.status(500).json({
      error: 'Failed to rename project',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update existing project (iterate on it)
app.post('/api/projects/:id/iterate', authMiddleware, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.userId;
    const { prompt, files } = req.body;
    const projectId = req.params.id;

    const existingProject = projects.get(projectId);
    if (!existingProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Security: Only allow updating own projects
    if (existingProject.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log('Iterating on project:', projectId, 'with prompt:', prompt);

    // Pass existing files and uploaded files to createApp for context-aware updates
    const result = await createApp(prompt, existingProject.files, files);

    // Update project
    existingProject.files = result.files;
    existingProject.prompt = `${existingProject.prompt}\n\nIteration: ${prompt}`;

    // Save to disk
    await fs.writeFile(
      path.join(PROJECTS_DIR, `${projectId}.json`),
      JSON.stringify(existingProject, null, 2)
    );

    res.json({
      success: true,
      project: {
        id: existingProject.id,
        name: existingProject.name,
        files: existingProject.files
      },
      message: 'Project updated successfully'
    });
  } catch (error) {
    console.error('Error iterating project:', error);
    
    // Handle specific image size errors
    if (error instanceof Error && error.message.includes('image exceeds')) {
      res.status(400).json({
        error: 'Image too large',
        details: 'The image you provided is too large. Please use an image smaller than 5MB or try a different image.',
        suggestion: 'You can compress your image using online tools or take a screenshot with lower quality.'
      });
      return;
    }
    
    // Handle image compression errors
    if (error instanceof Error && error.message.includes('Failed to compress image')) {
      res.status(400).json({
        error: 'Image processing failed',
        details: 'Unable to process the provided image. Please try with a different image format (JPEG, PNG, WebP).',
        suggestion: 'Try using a simpler image or a different format.'
      });
      return;
    }
    
    res.status(500).json({
      error: 'Failed to update project',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Makeable server running on http://localhost:${PORT}`);
});
