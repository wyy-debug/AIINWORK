import express from 'express';

import { defaultSubagentRunStore } from '../services/subagent-run-service.js';

export function createSubagentRunsRouter({ store = defaultSubagentRunStore } = {}) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      await store.ready?.();
      const runs = store.listRuns({
        status: req.query.status || '',
        agentId: req.query.agentId || '',
        limit: req.query.limit || 50,
      });
      res.json({ success: true, runs });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Failed to list subagent runs' });
    }
  });

  router.get('/:runId', async (req, res) => {
    try {
      await store.ready?.();
      const run = store.getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: 'Subagent run not found' });
      return res.json({ success: true, run });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Failed to read subagent run' });
    }
  });

  router.post('/:runId/control', async (req, res) => {
    try {
      const run = await store.controlRun(req.params.runId, req.body || {});
      if (!run) return res.status(404).json({ error: 'Subagent run not found' });
      return res.json({ success: true, run });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Failed to control subagent run' });
    }
  });

  return router;
}

export default createSubagentRunsRouter();
