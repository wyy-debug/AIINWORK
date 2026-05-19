import express from 'express';

import {
  brainQualityBaselineService,
  formatBrainQualityReport,
} from '../services/brain-quality-baseline-service.js';
import { brainInspectorService } from '../services/brain-inspector-service.js';
import { brainLegacyKnowledgeMigrationService } from '../services/brain-legacy-knowledge-migration-service.js';
import { brainMaintenanceService } from '../services/brain-maintenance-service.js';
import { brainPostTurnExtractionService } from '../services/brain-post-turn-extraction-service.js';
import { brainSymbolicCanvasService } from '../services/brain-symbolic-canvas-service.js';
import { brainStore } from '../services/brain-store-service.js';
import { readResolvedBrainRuntimeConfig } from '../services/mtl-code-model-service.js';

export function createBrainRouter({
  store = brainStore,
  brainInspectorService: inspectorService = brainInspectorService,
  brainMaintenanceService: maintenanceService = brainMaintenanceService,
  brainLegacyKnowledgeMigrationService: legacyKnowledgeMigrationService = brainLegacyKnowledgeMigrationService,
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

  router.post('/import', async (req, res) => {
    try {
      const result = maintenanceService.importPackage({
        packageData: req.body?.packageData,
        overwrite: req.body?.overwrite === true,
      });
      if (!result.imported) {
        res.status(400).json({ success: false, result });
        return;
      }
      res.json({ success: true, result });
    } catch (error) {
      console.error('Brain import error:', error);
      res.status(500).json({ error: error.message || 'Failed to import Brain package' });
    }
  });

  router.get('/legacy-knowledge/preview', async (req, res) => {
    try {
      const preview = await legacyKnowledgeMigrationService.preview({
        projectName: String(req.query.projectName || ''),
        provider: String(req.query.provider || 'claude'),
        sessionId: String(req.query.sessionId || 'legacy-knowledge'),
      });
      res.json({ success: true, preview });
    } catch (error) {
      console.error('Brain legacy knowledge preview error:', error);
      res.status(500).json({ error: error.message || 'Failed to preview legacy knowledge migration' });
    }
  });

  router.post('/legacy-knowledge/import', async (req, res) => {
    try {
      const result = await legacyKnowledgeMigrationService.importKnowledge({
        projectName: String(req.query.projectName || req.body?.projectName || ''),
        provider: String(req.query.provider || req.body?.provider || 'claude'),
        sessionId: String(req.query.sessionId || req.body?.sessionId || 'legacy-knowledge'),
      });
      res.json({ success: true, result });
    } catch (error) {
      console.error('Brain legacy knowledge import error:', error);
      res.status(500).json({ error: error.message || 'Failed to import legacy knowledge into Brain' });
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

  router.get('/session/:sessionId/inspector', async (req, res) => {
    try {
      const config = await readConfig();
      if (config.enabled === false) {
        res.json({ success: true, inspector: inspectorService.buildDisabledInspector() });
        return;
      }
      const inspector = inspectorService.buildInspector({
        sessionId: req.params.sessionId,
        provider: String(req.query.provider || 'claude'),
        projectName: String(req.query.projectName || ''),
      });
      res.json({ success: true, inspector });
    } catch (error) {
      console.error('Brain inspector error:', error);
      res.status(500).json({ error: error.message || 'Failed to load Brain inspector' });
    }
  });

  router.get('/session/:sessionId/inspector/report', async (req, res) => {
    try {
      const config = await readConfig();
      const inspector = config.enabled === false
        ? inspectorService.buildDisabledInspector()
        : inspectorService.buildInspector({
          sessionId: req.params.sessionId,
          provider: String(req.query.provider || 'claude'),
          projectName: String(req.query.projectName || ''),
        });
      res.type('text/markdown').send(inspectorService.exportReport(inspector));
    } catch (error) {
      console.error('Brain inspector report error:', error);
      res.status(500).json({ error: error.message || 'Failed to export Brain inspector report' });
    }
  });

  router.get('/session/:sessionId/export', async (req, res) => {
    try {
      const packageData = maintenanceService.exportPackage({
        sessionId: req.params.sessionId,
        provider: String(req.query.provider || 'claude'),
        projectName: String(req.query.projectName || ''),
      });
      res.json({ success: true, packageData });
    } catch (error) {
      console.error('Brain export error:', error);
      res.status(500).json({ error: error.message || 'Failed to export Brain package' });
    }
  });

  router.get('/session/:sessionId/retention-preview', async (req, res) => {
    try {
      const preview = maintenanceService.previewLayerRetention({
        sessionId: req.params.sessionId,
        provider: String(req.query.provider || 'claude'),
        projectName: String(req.query.projectName || ''),
        perSessionMaxEvents: Number(req.query.perSessionMaxEvents || 1000),
        rawRefsMaxSizeBytes: Number(req.query.rawRefsMaxSizeBytes || 5_000_000),
        maxAtoms: Number(req.query.maxAtoms || 1000),
        maxScenarios: Number(req.query.maxScenarios || 200),
        maxCompactions: Number(req.query.maxCompactions || 80),
      });
      res.json({ success: true, preview });
    } catch (error) {
      console.error('Brain retention preview error:', error);
      res.status(500).json({ error: error.message || 'Failed to preview Brain retention' });
    }
  });

  router.post('/session/:sessionId/repair', async (req, res) => {
    try {
      const report = maintenanceService.repairAndReport({
        sessionId: req.params.sessionId,
        provider: String(req.query.provider || req.body?.provider || 'claude'),
        projectName: String(req.query.projectName || req.body?.projectName || ''),
      });
      res.json({ success: true, report });
    } catch (error) {
      console.error('Brain repair error:', error);
      res.status(500).json({ error: error.message || 'Failed to repair Brain session' });
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
