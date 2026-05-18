import express from 'express';

import {
  getSessionCheckpoint,
  listSessionCheckpoints,
  rollbackSessionCheckpoint,
} from '../services/session-checkpoint-service.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const checkpoints = listSessionCheckpoints({
      sessionId: String(req.query.sessionId || ''),
      provider: String(req.query.provider || 'claude'),
      projectName: String(req.query.projectName || req.query.project || ''),
      limit: req.query.limit,
    });
    res.json({ success: true, checkpoints });
  } catch (error) {
    console.error('Checkpoint list error:', error);
    res.status(500).json({ error: error.message || 'Failed to list checkpoints' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const checkpoint = getSessionCheckpoint(req.params.id);
    if (!checkpoint) {
      return res.status(404).json({ error: 'Checkpoint not found' });
    }
    return res.json({ success: true, checkpoint });
  } catch (error) {
    console.error('Checkpoint get error:', error);
    return res.status(500).json({ error: error.message || 'Failed to load checkpoint' });
  }
});

router.post('/:id/rollback', async (req, res) => {
  try {
    const checkpoint = await rollbackSessionCheckpoint(req.params.id);
    res.json({ success: true, checkpoint });
  } catch (error) {
    console.error('Checkpoint rollback error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to roll back checkpoint',
      details: error.details || null,
    });
  }
});

export default router;
