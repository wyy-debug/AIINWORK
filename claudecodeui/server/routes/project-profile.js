import express from 'express';

import { extractProjectDirectory } from '../projects.js';
import {
  analyzeProjectProfile,
  commitProjectProfileDraft,
  createProjectProfileDraft,
  renderMtlProjectProfile,
  writeMtlProjectProfile,
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

function sendProjectProfileError(res, error, fallbackStatus = 500, fallbackMessage = 'Project profile request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

router.post('/preview', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    const profile = await analyzeProjectProfile({ projectPath });
    res.json({ success: true, profile, markdown: renderMtlProjectProfile(profile) });
  } catch (error) {
    sendProjectProfileError(res, error, 400, 'Failed to preview project profile');
  }
});

router.post('/write', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    const result = await writeMtlProjectProfile({ projectPath });
    res.json({
      success: true,
      filePath: result.filePath,
      profile: result.profile,
      markdown: renderMtlProjectProfile(result.profile),
    });
  } catch (error) {
    sendProjectProfileError(res, error, 400, 'Failed to write project profile');
  }
});

router.post('/draft', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    const draft = await createProjectProfileDraft({ projectPath });
    res.json({ success: true, draft });
  } catch (error) {
    sendProjectProfileError(res, error, 500, 'Failed to create project profile draft');
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
    sendProjectProfileError(res, error, 500, 'Failed to write MTL.md');
  }
});

export default router;
