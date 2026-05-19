import express from 'express';

import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();

function sendApprovalError(res, error, fallbackStatus = 500, fallbackMessage = 'Workflow approval request failed') {
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
      approvals: defaultWorkflowStudioStore.listApprovalRequests({ status: req.query.status || 'pending' }),
    });
  } catch (error) {
    sendApprovalError(res, error, 500, 'Failed to list workflow approvals');
  }
});

router.get('/audit/export', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({
      success: true,
      audit: defaultWorkflowStudioStore.exportApprovalAudit({
        workflowId: req.query.workflowId || '',
        runId: req.query.runId || '',
      }),
    });
  } catch (error) {
    sendApprovalError(res, error, 500, 'Failed to export workflow approval audit');
  }
});

router.post('/:approvalId/decision', async (req, res) => {
  try {
    const run = await defaultWorkflowStudioStore.decideApproval(req.params.approvalId, req.body || {});
    if (!run) return res.status(404).json({ success: false, error: 'Workflow approval not found' });
    return res.json({ success: true, run });
  } catch (error) {
    return sendApprovalError(res, error, 400, 'Failed to decide workflow approval');
  }
});

export default router;
