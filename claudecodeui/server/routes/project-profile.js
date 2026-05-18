import express from 'express';

import {
  analyzeProjectProfile,
  renderMtlProjectProfile,
  writeMtlProjectProfile,
} from '../services/project-profile-service.js';

const router = express.Router();

function sendProjectProfileError(res, error) {
  res.status(400).json({
    success: false,
    error: error?.message || 'Project profile request failed',
  });
}

router.post('/preview', async (req, res) => {
  try {
    const profile = await analyzeProjectProfile({ projectPath: req.body?.projectPath });
    res.json({ success: true, profile, markdown: renderMtlProjectProfile(profile) });
  } catch (error) {
    sendProjectProfileError(res, error);
  }
});

router.post('/write', async (req, res) => {
  try {
    const result = await writeMtlProjectProfile({ projectPath: req.body?.projectPath });
    res.json({
      success: true,
      filePath: result.filePath,
      profile: result.profile,
      markdown: renderMtlProjectProfile(result.profile),
    });
  } catch (error) {
    sendProjectProfileError(res, error);
  }
});

export default router;
