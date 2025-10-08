import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createApp } from './agent/createApp.js';
import { authMiddleware, generateToken, type AuthRequest } from './auth/authMiddleware.js';
import { userStorage } from './auth/userStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

const PROJECTS_DIR = path.join(__dirname, '../projects');

// Ensure projects directory exists
await fs.mkdir(PROJECTS_DIR, { recursive: true });

interface Project {
  id: string;
  name: string;
  prompt: string;
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
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const user = await userStorage.createUser(email, password, name);
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
        profilePicture: user.profilePicture
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
        profilePicture: user.profilePicture
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
    profilePicture: user.profilePicture
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
        profilePicture: updatedUser.profilePicture
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

// Create new project
app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, projectId } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('Generating app from prompt:', prompt);

    const result = await createApp(prompt);

    // Create or update project
    const authReq = req as AuthRequest;
    const userId = authReq.userId;

    const id = projectId || `project_${Date.now()}`;
    const name = prompt.slice(0, 50); // First 50 chars as name

    const project: Project = {
      id,
      name,
      prompt,
      files: result.files,
      createdAt: new Date().toISOString(),
      userId
    };

    projects.set(id, project);

    // Save to disk
    await fs.writeFile(
      path.join(PROJECTS_DIR, `${id}.json`),
      JSON.stringify(project, null, 2)
    );

    res.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        files: project.files
      },
      message: 'App generated successfully'
    });
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
    const { prompt } = req.body;
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

    // Pass existing files to createApp for context-aware updates
    const result = await createApp(prompt, existingProject.files);

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
