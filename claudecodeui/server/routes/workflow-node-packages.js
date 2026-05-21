import express from 'express';

import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();

function sendNodePackageError(res, error, fallbackStatus = 500, fallbackMessage = 'Workflow node package request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

router.get('/', async (_req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, packages: defaultWorkflowStudioStore.listNodePackages() });
  } catch (error) {
    sendNodePackageError(res, error, 500, 'Failed to list workflow node packages');
  }
});

router.post('/generate-draft', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const draft = defaultWorkflowStudioStore.generatePythonNodeDraft(req.body || {});
    res.status(201).json({ success: true, draft });
  } catch (error) {
    sendNodePackageError(res, error, 400, 'Failed to generate workflow node package draft');
  }
});

router.post('/validate-draft', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const validation = defaultWorkflowStudioStore.validateNodePackageDraft(req.body?.manifest || req.body || {});
    res.status(validation.valid ? 200 : 400).json({ success: validation.valid, validation });
  } catch (error) {
    sendNodePackageError(res, error, 400, 'Failed to validate workflow node package draft');
  }
});

router.post('/test-draft', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const result = await defaultWorkflowStudioStore.testNodePackageDraft(req.body?.manifest || req.body || {}, req.body || {});
    res.status(result.ok ? 200 : 400).json({ success: result.ok, result });
  } catch (error) {
    sendNodePackageError(res, error, 400, 'Failed to test workflow node package draft');
  }
});

router.post('/install', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const nodePackage = await defaultWorkflowStudioStore.installNodePackage(req.body?.package || req.body || {});
    res.status(201).json({ success: true, package: nodePackage });
  } catch (error) {
    sendNodePackageError(res, error, 400, 'Failed to install workflow node package');
  }
});

export default router;
