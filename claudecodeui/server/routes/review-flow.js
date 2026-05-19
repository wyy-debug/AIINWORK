import express from 'express';

import { extractProjectDirectory } from '../projects.js';
import { createReviewFlowArtifact } from '../services/review-flow-service.js';

const router = express.Router();

async function resolveProjectPath(projectName, explicitPath = '') {
  if (explicitPath) return explicitPath;
  if (!projectName) return '';
  return extractProjectDirectory(projectName);
}

router.post('/', async (req, res) => {
  try {
    const projectName = String(req.body?.projectName || req.body?.project || '');
    const projectPath = await resolveProjectPath(projectName, String(req.body?.projectPath || ''));
    if (!projectPath) {
      return res.status(400).json({ error: 'projectName or projectPath is required' });
    }
    const result = await createReviewFlowArtifact({
      projectName,
      projectPath,
      sessionId: String(req.body?.sessionId || ''),
      provider: String(req.body?.provider || 'claude'),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Review flow error:', error);
    return res.status(500).json({ error: error.message || 'Failed to create review artifact' });
  }
});

export default router;
