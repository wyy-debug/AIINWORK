import express from 'express';

import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();

function sendRunError(res, error, fallbackStatus = 500, fallbackMessage = 'Workflow run request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

router.get('/', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({
      success: true,
      runs: defaultWorkflowStudioStore.listRuns({
        workflowId: req.query.workflowId || '',
        status: req.query.status || '',
        sessionId: req.query.sessionId || '',
        projectPath: req.query.projectPath || '',
        limit: req.query.limit || 50,
      }),
    });
  } catch (error) {
    sendRunError(res, error, 500, 'Failed to list workflow runs');
  }
});

router.get('/:runId', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const run = defaultWorkflowStudioStore.getRun(req.params.runId);
    if (!run) return res.status(404).json({ success: false, error: 'Workflow run not found' });
    return res.json({ success: true, run });
  } catch (error) {
    return sendRunError(res, error, 500, 'Failed to read workflow run');
  }
});

router.post('/:runId/control', async (req, res) => {
  try {
    const run = await defaultWorkflowStudioStore.controlRun(req.params.runId, req.body || {});
    if (!run) return res.status(404).json({ success: false, error: 'Workflow run not found' });
    return res.json({ success: true, run });
  } catch (error) {
    return sendRunError(res, error, 400, 'Failed to control workflow run');
  }
});

router.post('/:runId/nodes/:nodeId/control', async (req, res) => {
  try {
    const run = await defaultWorkflowStudioStore.controlNode(req.params.runId, req.params.nodeId, req.body || {});
    if (!run) return res.status(404).json({ success: false, error: 'Workflow run or node not found' });
    return res.json({ success: true, run });
  } catch (error) {
    return sendRunError(res, error, 400, 'Failed to control workflow node');
  }
});

export default router;
