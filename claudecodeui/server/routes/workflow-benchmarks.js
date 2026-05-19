import express from 'express';

import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();

function sendBenchmarkError(res, error, fallbackStatus = 500, fallbackMessage = 'Workflow benchmark request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

router.get('/', async (_req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, readiness: defaultWorkflowStudioStore.getReleaseReadiness() });
  } catch (error) {
    sendBenchmarkError(res, error, 500, 'Failed to read workflow benchmark readiness');
  }
});

router.get('/trend', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, trend: defaultWorkflowStudioStore.getBenchmarkTrend({ limit: req.query.limit || 20 }) });
  } catch (error) {
    sendBenchmarkError(res, error, 500, 'Failed to read workflow benchmark trend');
  }
});

router.get('/coverage-map', async (_req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, coverageMap: defaultWorkflowStudioStore.getTestCoverageMap() });
  } catch (error) {
    sendBenchmarkError(res, error, 500, 'Failed to read workflow test coverage map');
  }
});

router.post('/runs', async (req, res) => {
  try {
    const benchmarks = await defaultWorkflowStudioStore.runBenchmarks(req.body || {});
    res.json({ success: benchmarks.failed === 0, benchmarks });
  } catch (error) {
    sendBenchmarkError(res, error, 400, 'Failed to run workflow benchmarks');
  }
});

export default router;
