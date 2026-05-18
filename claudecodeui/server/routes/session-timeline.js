import express from 'express';

import { buildSessionTimeline } from '../services/session-timeline-service.js';

const router = express.Router();

router.get('/:sessionId', (req, res) => {
  try {
    const timeline = buildSessionTimeline({
      sessionId: req.params.sessionId,
      provider: String(req.query.provider || 'claude'),
      projectName: String(req.query.projectName || req.query.project || ''),
    });
    res.json({ success: true, timeline });
  } catch (error) {
    console.error('Session timeline error:', error);
    res.status(500).json({ error: error.message || 'Failed to build session timeline' });
  }
});

export default router;
