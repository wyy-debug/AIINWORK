import express from 'express';

import {
  brainQualityBaselineService,
  formatBrainQualityReport,
} from '../services/brain-quality-baseline-service.js';
import { brainPostTurnExtractionService } from '../services/brain-post-turn-extraction-service.js';
import { brainSymbolicCanvasService } from '../services/brain-symbolic-canvas-service.js';
import { brainStore } from '../services/brain-store-service.js';
import { readResolvedBrainRuntimeConfig } from '../services/mtl-code-model-service.js';

export function createBrainRouter({
  store = brainStore,
  qualityBaselineService = brainQualityBaselineService,
  postTurnExtractionService = brainPostTurnExtractionService,
  symbolicCanvasService = brainSymbolicCanvasService,
  readConfig = readResolvedBrainRuntimeConfig,
} = {}) {
  const router = express.Router();

  router.get('/quality-baseline', async (_req, res) => {
    try {
      const report = await qualityBaselineService.runBaseline();
      res.json({ success: true, report });
    } catch (error) {
      console.error('Brain quality baseline error:', error);
      res.status(500).json({ error: error.message || 'Failed to run Brain quality baseline' });
    }
  });

  router.get('/quality-baseline/report', async (_req, res) => {
    try {
      const report = await qualityBaselineService.runBaseline();
      res.type('text/markdown').send(formatBrainQualityReport(report));
    } catch (error) {
      console.error('Brain quality report error:', error);
      res.status(500).json({ error: error.message || 'Failed to render Brain quality report' });
    }
  });

  router.get('/session/:sessionId/canvas', async (req, res) => {
    try {
      const config = await readConfig();
      if (config.enabled === false) {
        res.json({
          success: true,
          canvas: {
            enabled: false,
            status: 'disabled',
          },
        });
        return;
      }
      const canvas = symbolicCanvasService.buildCanvas({
        sessionId: req.params.sessionId,
        provider: String(req.query.provider || 'claude'),
        projectName: String(req.query.projectName || ''),
      });
      res.json({ success: true, canvas });
    } catch (error) {
      console.error('Brain symbolic canvas error:', error);
      res.status(500).json({ error: error.message || 'Failed to load Brain symbolic canvas' });
    }
  });

  router.get('/session/:sessionId/node/:nodeId', async (req, res) => {
    try {
      const config = await readConfig();
      if (config.enabled === false) {
        res.json({
          success: true,
          detail: {
            enabled: false,
            status: 'disabled',
          },
        });
        return;
      }
      const detail = symbolicCanvasService.getNodeEvidence({
        sessionId: req.params.sessionId,
        nodeId: req.params.nodeId,
        provider: String(req.query.provider || 'claude'),
      });
      if (!detail) {
        res.status(404).json({ error: 'Brain node not found' });
        return;
      }
      res.json({ success: true, detail });
    } catch (error) {
      console.error('Brain node evidence error:', error);
      res.status(500).json({ error: error.message || 'Failed to load Brain node evidence' });
    }
  });

  router.post('/atom/:atomId/control', async (req, res) => {
    try {
      const config = await readConfig();
      if (config.enabled === false) {
        res.json({
          success: true,
          atom: {
            enabled: false,
            status: 'disabled',
          },
        });
        return;
      }
      const atom = postTurnExtractionService.controlAtom({
        atomId: req.params.atomId,
        action: String(req.body?.action || ''),
        targetAtomId: String(req.body?.targetAtomId || ''),
      });
      if (!atom) {
        res.status(404).json({ error: 'Brain atom control target not found' });
        return;
      }
      res.json({ success: true, atom });
    } catch (error) {
      console.error('Brain atom control error:', error);
      res.status(500).json({ error: error.message || 'Failed to update Brain atom' });
    }
  });

  router.get('/session/:sessionId', async (req, res) => {
    try {
      const config = await readConfig();
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
      const brain = store.getDiagnostics({
        sessionId: req.params.sessionId,
        provider: String(req.query.provider || 'claude'),
        projectName: String(req.query.projectName || ''),
      });
      const symbolicCanvas = symbolicCanvasService.buildCanvas({
        sessionId: req.params.sessionId,
        provider: String(req.query.provider || 'claude'),
        projectName: String(req.query.projectName || ''),
      });
      res.json({ success: true, brain: { ...brain, symbolicCanvas, config } });
    } catch (error) {
      console.error('Brain diagnostics error:', error);
      res.status(500).json({ error: error.message || 'Failed to load Brain diagnostics' });
    }
  });

  router.delete('/session/:sessionId', (req, res) => {
    try {
      const result = store.clearSession({
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
      const result = store.clearProject({
        projectName: req.params.projectName,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Brain project cleanup error:', error);
      res.status(500).json({ error: error.message || 'Failed to clear Brain project' });
    }
  });

  return router;
}

export default createBrainRouter();
