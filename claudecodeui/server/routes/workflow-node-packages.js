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

router.post('/install', async (req, res) => {
  try {
    const nodePackage = await defaultWorkflowStudioStore.installNodePackage(req.body?.package || req.body || {});
    res.status(201).json({ success: true, package: nodePackage });
  } catch (error) {
    sendNodePackageError(res, error, 400, 'Failed to install workflow node package');
  }
});

export default router;
