import express from 'express';

import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();

function sendWorkflowError(res, error, fallbackStatus = 500, fallbackMessage = 'Workflow request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
    validation: error?.validation || null,
  });
}

router.get('/', async (_req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, workflows: defaultWorkflowStudioStore.listWorkflows() });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to list workflows');
  }
});

router.post('/validate', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const result = defaultWorkflowStudioStore.validateWorkflowDefinition(req.body?.workflow || req.body || {});
    res.status(result.validation.valid ? 200 : 400).json({ success: result.validation.valid, ...result });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to validate workflow');
  }
});

router.post('/import', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.importWorkflow(req.body?.content || req.body?.workflow || req.body || {});
    res.status(201).json({ success: true, workflow });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to import workflow');
  }
});

router.post('/package/export', async (req, res) => {
  try {
    const workflowIds = Array.isArray(req.body?.workflowIds) ? req.body.workflowIds : [];
    const pkg = await defaultWorkflowStudioStore.exportWorkflowPackage(workflowIds);
    res.json({ success: true, package: pkg });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to export workflow package');
  }
});

router.post('/package/import', async (req, res) => {
  try {
    const result = await defaultWorkflowStudioStore.importWorkflowPackage(req.body?.package || req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to import workflow package');
  }
});

router.get('/:id', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const workflow = defaultWorkflowStudioStore.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, workflow });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to load workflow');
  }
});

router.post('/', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.upsertWorkflow(req.body?.workflow || req.body || {});
    res.status(201).json({ success: true, workflow });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to create workflow');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.upsertWorkflow({
      ...(req.body?.workflow || req.body || {}),
      id: req.params.id,
    });
    res.json({ success: true, workflow });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to update workflow');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.deleteWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, workflow });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to delete workflow');
  }
});

router.get('/:id/export', async (req, res) => {
  try {
    const content = await defaultWorkflowStudioStore.exportWorkflow(req.params.id, req.query.format || 'json');
    if (!content) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, format: req.query.format || 'json', content });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to export workflow');
  }
});

router.post('/:id/runs', async (req, res) => {
  try {
    const run = await defaultWorkflowStudioStore.createRun(req.params.id, req.body || {});
    res.status(201).json({ success: true, run });
  } catch (error) {
    sendWorkflowError(res, error, error?.statusCode || 400, 'Failed to run workflow');
  }
});

export default router;
