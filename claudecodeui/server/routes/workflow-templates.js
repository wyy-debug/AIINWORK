import express from 'express';

import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();

function sendTemplateError(res, error, fallbackStatus = 500, fallbackMessage = 'Workflow template request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

router.post('/:templateId/smoke', async (req, res) => {
  try {
    const smoke = await defaultWorkflowStudioStore.smokeTemplate(req.params.templateId, req.body || {});
    res.json({ success: smoke.status === 'passed', smoke });
  } catch (error) {
    sendTemplateError(res, error, error?.statusCode || 400, 'Failed to smoke workflow template');
  }
});

export default router;
