import express from 'express';

import { db } from '../database/db.js';
import {
  getSessionCheckpoint,
  listSessionCheckpoints,
  rollbackSessionCheckpoint,
} from '../services/session-checkpoint-service.js';

const router = express.Router();

function sendCheckpointError(res, error, fallbackStatus = 500, fallbackMessage = 'Checkpoint request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
    details: error?.details || null,
  });
}

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
    sendCheckpointError(res, error, 500, 'Failed to list checkpoints');
  }
});

router.get('/:id', (req, res) => {
  try {
    const checkpoint = getSessionCheckpoint(req.params.id);
    if (!checkpoint) {
      return res.status(404).json({ success: false, error: 'Checkpoint not found' });
    }
    return res.json({ success: true, checkpoint });
  } catch (error) {
    return sendCheckpointError(res, error, 500, 'Failed to load checkpoint');
  }
});

router.get('/:id/diff', (req, res) => {
  try {
    const checkpoint = getSessionCheckpoint(req.params.id);
    if (!checkpoint) {
      return res.status(404).json({ success: false, error: 'Checkpoint not found' });
    }
    return res.json({
      success: true,
      checkpointId: checkpoint.id,
      diff: checkpoint.patch || '',
      status: checkpoint.rollbackStatus || '',
      checkpoint,
    });
  } catch (error) {
    return sendCheckpointError(res, error, 500, 'Failed to load checkpoint diff');
  }
});

router.post('/:id/rollback', async (req, res) => {
  try {
    const checkpoint = await rollbackSessionCheckpoint(req.params.id);
    res.json({ success: true, checkpoint });
  } catch (error) {
    sendCheckpointError(res, error, 500, 'Failed to roll back checkpoint');
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM session_checkpoints WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Checkpoint not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    return sendCheckpointError(res, error, 500, 'Failed to delete checkpoint');
  }
});

export default router;
