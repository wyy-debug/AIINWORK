import express from 'express';

import {
  brainQualityBaselineService,
  formatBrainQualityReport,
} from '../services/brain-quality-baseline-service.js';
import { brainStore } from '../services/brain-store-service.js';
import { readResolvedBrainRuntimeConfig } from '../services/mtl-code-model-service.js';

const router = express.Router();

router.get('/quality-baseline', async (_req, res) => {
  try {
    const report = await brainQualityBaselineService.runBaseline();
    res.json({ success: true, report });
  } catch (error) {
    console.error('Brain quality baseline error:', error);
    res.status(500).json({ error: error.message || 'Failed to run Brain quality baseline' });
  }
});

router.get('/quality-baseline/report', async (_req, res) => {
  try {
    const report = await brainQualityBaselineService.runBaseline();
    res.type('text/markdown').send(formatBrainQualityReport(report));
  } catch (error) {
    console.error('Brain quality report error:', error);
    res.status(500).json({ error: error.message || 'Failed to render Brain quality report' });
  }
});

router.get('/session/:sessionId', async (req, res) => {
  try {
    const config = await readResolvedBrainRuntimeConfig();
    if (config.enabled === false) {
      res.json({
        success: true,
        brain: {
          enabled: false,
          status: 'disabled',
        },
      });
      return;
    }
    const brain = brainStore.getDiagnostics({
      sessionId: req.params.sessionId,
      provider: String(req.query.provider || 'claude'),
      projectName: String(req.query.projectName || ''),
    });
    res.json({ success: true, brain: { ...brain, config } });
  } catch (error) {
    console.error('Brain diagnostics error:', error);
    res.status(500).json({ error: error.message || 'Failed to load Brain diagnostics' });
  }
});

router.delete('/session/:sessionId', (req, res) => {
  try {
    const result = brainStore.clearSession({
      sessionId: req.params.sessionId,
      provider: String(req.query.provider || req.body?.provider || 'claude'),
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Brain session cleanup error:', error);
    res.status(500).json({ error: error.message || 'Failed to clear Brain session' });
  }
});

router.delete('/project/:projectName', (req, res) => {
  try {
    const result = brainStore.clearProject({
      projectName: req.params.projectName,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Brain project cleanup error:', error);
    res.status(500).json({ error: error.message || 'Failed to clear Brain project' });
  }
});

export default router;

