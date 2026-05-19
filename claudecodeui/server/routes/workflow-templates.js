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

router.get('/:templateId/detail', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const detail = defaultWorkflowStudioStore.getTemplateDetail(req.params.templateId);
    if (!detail) return res.status(404).json({ success: false, error: 'Workflow template not found' });
    return res.json({ success: true, detail });
  } catch (error) {
    return sendTemplateError(res, error, 500, 'Failed to load workflow template detail');
  }
});

router.get('/:templateId/dependencies', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const report = defaultWorkflowStudioStore.checkTemplateDependencies(req.params.templateId);
    if (!report) return res.status(404).json({ success: false, error: 'Workflow template not found' });
    return res.json({ success: true, report });
  } catch (error) {
    return sendTemplateError(res, error, 500, 'Failed to check workflow template dependencies');
  }
});

router.post('/:templateId/fork', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.forkTemplate(req.params.templateId, req.body || {});
    return res.status(201).json({ success: true, workflow });
  } catch (error) {
    return sendTemplateError(res, error, error?.statusCode || 400, 'Failed to fork workflow template');
  }
});

export default router;
