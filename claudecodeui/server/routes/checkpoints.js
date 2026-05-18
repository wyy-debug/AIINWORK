import express from 'express';

import { db } from '../database/db.js';
import { createCheckpointStore } from '../services/checkpoint-service.js';

const router = express.Router();
const checkpointStore = createCheckpointStore(db);

function sendError(res, error, fallbackStatus = 500) {
  const message = error?.message || 'Checkpoint request failed';
  const status = message.includes('Invalid') || message.includes('required') ? 400 : fallbackStatus;
  res.status(status).json({ success: false, error: message });
}

router.get('/', (req, res) => {
  try {
    const checkpoints = checkpointStore.listCheckpoints({
      sessionId: req.query.sessionId,
      projectPath: req.query.projectPath,
      provider: req.query.provider,
      limit: req.query.limit,
    });
    res.json({ success: true, checkpoints });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id', (req, res) => {
  try {
    const checkpoint = checkpointStore.getCheckpoint(req.params.id);
    if (!checkpoint) {
      res.status(404).json({ success: false, error: 'Checkpoint not found' });
      return;
    }
    res.json({ success: true, checkpoint });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id/diff', (req, res) => {
  try {
    const checkpoint = checkpointStore.getCheckpoint(req.params.id);
    if (!checkpoint) {
      res.status(404).json({ success: false, error: 'Checkpoint not found' });
      return;
    }
    res.json({
      success: true,
      checkpointId: checkpoint.id,
      phase: checkpoint.phase,
      diff: checkpoint.diff,
      status: checkpoint.status,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    const checkpoint = await checkpointStore.createCheckpoint(req.body || {});
    res.status(201).json({ success: true, checkpoint });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/rollback', async (req, res) => {
  try {
    const result = await checkpointStore.rollbackCheckpoint(req.params.id);
    const status = result.success ? 200 : result.reason === 'not_found' ? 404 : 409;
    res.status(status).json({ success: result.success, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', (req, res) => {
  try {
    const deleted = checkpointStore.deleteCheckpoint(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Checkpoint not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
