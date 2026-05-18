import express from 'express';

import { extractProjectDirectory } from '../projects.js';
import {
  commitProjectProfileDraft,
  createProjectProfileDraft,
} from '../services/project-profile-service.js';

const router = express.Router();

async function resolveProjectPath(req) {
  const explicitPath = typeof req.body?.projectPath === 'string' && req.body.projectPath.trim()
    ? req.body.projectPath.trim()
    : typeof req.query.projectPath === 'string' && req.query.projectPath.trim()
      ? req.query.projectPath.trim()
      : '';
  if (explicitPath) return explicitPath;
  const projectName = req.body?.projectName || req.body?.project || req.query.projectName || req.query.project;
  if (!projectName) {
    const error = new Error('projectName or projectPath is required');
    error.statusCode = 400;
    throw error;
  }
  return extractProjectDirectory(String(projectName));
}

router.post('/draft', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    const draft = await createProjectProfileDraft({ projectPath });
    res.json({ success: true, draft });
  } catch (error) {
    console.error('Project profile draft error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create project profile draft' });
  }
});

router.post('/commit', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    const result = await commitProjectProfileDraft({
      projectPath,
      content: req.body?.content,
    });
    res.json(result);
  } catch (error) {
    console.error('Project profile commit error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to write MTL.md' });
  }
});

export default router;
