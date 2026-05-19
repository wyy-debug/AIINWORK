import express from 'express';

import { extractProjectDirectory } from '../projects.js';
import {
  buildImpactSummary,
  codeGraphService,
  exportCodeGraphSummariesToObsidian,
  getCodeGraphProjectStoragePath,
  initializeCodeGraphProject,
  logCodeGraphDebugEvent,
  readCodeGraphMcpConfigStatus,
  resolveCodeGraphStorageRoot,
  scanCodeGraphGhostNotes,
} from '../services/codegraph-service.js';
import { readObsidianBridgeConfig } from '../services/obsidian-bridge-service.js';

const router = express.Router();

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const resolveProjectRoot = async (input = {}) => {
  const direct = readString(input.projectRoot || input.projectPath || input.cwd);
  if (direct) return direct;
  const projectName = readString(input.projectName || input.project);
  if (!projectName) {
    throw new Error('projectName or projectRoot is required.');
  }
  return extractProjectDirectory(projectName);
};

const sendError = (res, error, fallback = 'CodeGraph request failed') => {
  res.status(500).json({
    success: false,
    error: error?.message || fallback,
  });
};

router.get('/status', async (req, res) => {
  try {
    const projectRoot = await resolveProjectRoot(req.query);
    const projectName = readString(req.query.projectName || req.query.project) || projectRoot.split(/[\\/]/).pop() || '';
    logCodeGraphDebugEvent(console, 'api_status_request', {
      projectName,
      projectRoot,
    });
    const config = readObsidianBridgeConfig();
    const status = codeGraphService.getStatus(projectRoot);
    const mcpStatus = await readCodeGraphMcpConfigStatus(projectRoot);
    const codegraphStorageRoot = resolveCodeGraphStorageRoot(config);
    logCodeGraphDebugEvent(console, 'api_status_response', {
      projectName,
      projectRoot,
      state: status.state,
      progress: status.progress || null,
      mcpConfigured: mcpStatus.mcpConfigured,
      mcpUsesBundledCli: mcpStatus.mcpUsesBundledCli,
    });
    res.json({
      success: true,
      config: {
        enabled: config.codegraphEnabled,
        backgroundSyncEnabled: config.codegraphBackgroundSyncEnabled,
        writeObsidianSummaries: config.codegraphWriteObsidianSummaries,
        lazyLlmSummaries: config.codegraphLazyLlmSummaries,
        maxSymbolNotes: config.codegraphMaxSymbolNotes,
        impactMaxDepth: config.codegraphImpactMaxDepth,
        impactLimit: config.codegraphImpactLimit,
        ghostPolicy: config.codegraphGhostPolicy,
        storageRoot: codegraphStorageRoot,
        configuredStorageRoot: config.codegraphStorageRoot || '',
        exportLevel: config.codegraphExportLevel,
        maxEmbeddedSymbols: config.codegraphMaxEmbeddedSymbols,
      },
      status: {
        ...status,
        ...mcpStatus,
        codegraphStorageRoot,
        configuredCodegraphStorageRoot: config.codegraphStorageRoot || '',
        codegraphStoragePath: getCodeGraphProjectStoragePath(projectRoot, config),
      },
    });
  } catch (error) {
    sendError(res, error, 'Failed to read CodeGraph status');
  }
});

router.post('/init', async (req, res) => {
  try {
    const projectRoot = await resolveProjectRoot(req.body || {});
    const projectName = readString(req.body?.projectName || req.body?.project) || projectRoot.split(/[\\/]/).pop() || '';
    logCodeGraphDebugEvent(console, 'api_init_request', {
      projectName,
      projectRoot,
      index: req.body?.index !== false,
      installMcp: req.body?.installMcp !== false,
    });
    const result = await initializeCodeGraphProject({
      projectRoot,
      index: req.body?.index !== false,
      installMcp: req.body?.installMcp !== false,
    });
    logCodeGraphDebugEvent(console, 'api_init_response', {
      projectName,
      projectRoot,
      result,
    });
    res.json({ success: true, projectRoot, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to initialize CodeGraph');
  }
});

router.post('/sync/background', async (req, res) => {
  try {
    const body = req.body || {};
    const projectRoot = await resolveProjectRoot(body);
    const projectName = readString(body.projectName || body.project) || projectRoot.split(/[\\/]/).pop() || '';
    logCodeGraphDebugEvent(console, 'api_sync_background_request', {
      projectName,
      projectRoot,
      exportToObsidian: body.exportToObsidian === true,
      scopeCount: Array.isArray(body.scopePaths) ? body.scopePaths.length : 0,
    });
    const result = codeGraphService.enqueueBackgroundSync({
      projectName,
      projectRoot,
      scopePaths: Array.isArray(body.scopePaths) ? body.scopePaths : [],
      exportToObsidian: body.exportToObsidian === true,
    });
    logCodeGraphDebugEvent(console, 'api_sync_background_response', {
      projectName,
      projectRoot,
      result,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to queue CodeGraph sync');
  }
});

router.post('/build-obsidian', async (req, res) => {
  try {
    const body = req.body || {};
    const projectRoot = await resolveProjectRoot(body);
    const projectName = readString(body.projectName || body.project) || projectRoot.split(/[\\/]/).pop() || '';
    logCodeGraphDebugEvent(console, 'api_build_obsidian_request', {
      projectName,
      projectRoot,
      scopeCount: Array.isArray(body.scopePaths) ? body.scopePaths.length : 0,
    });
    const result = codeGraphService.enqueueObsidianBuild({
      projectName,
      projectRoot,
      scopePaths: Array.isArray(body.scopePaths) ? body.scopePaths : [],
    });
    logCodeGraphDebugEvent(console, 'api_build_obsidian_response', {
      projectName,
      projectRoot,
      result,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to queue CodeGraph Obsidian build');
  }
});

router.post('/cancel', async (req, res) => {
  try {
    const body = req.body || {};
    const projectRoot = await resolveProjectRoot(body);
    const projectName = readString(body.projectName || body.project) || projectRoot.split(/[\\/]/).pop() || '';
    logCodeGraphDebugEvent(console, 'api_cancel_request', {
      projectName,
      projectRoot,
    });
    const result = codeGraphService.cancel(projectRoot);
    logCodeGraphDebugEvent(console, 'api_cancel_response', {
      projectName,
      projectRoot,
      result,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to cancel CodeGraph job');
  }
});

router.post('/export-obsidian', async (req, res) => {
  try {
    const body = req.body || {};
    const projectRoot = await resolveProjectRoot(body);
    const projectName = readString(body.projectName || body.project) || projectRoot.split(/[\\/]/).pop() || 'General';
    const config = readObsidianBridgeConfig();
    logCodeGraphDebugEvent(console, 'api_export_obsidian_request', {
      projectName,
      projectRoot,
      maxSymbolNotes: body.maxSymbolNotes || config.codegraphMaxSymbolNotes,
      exportLevel: body.exportLevel || config.codegraphExportLevel,
      maxEmbeddedSymbols: body.maxEmbeddedSymbols || config.codegraphMaxEmbeddedSymbols,
      scopeCount: Array.isArray(body.scopePaths) ? body.scopePaths.length : 0,
    });
    const result = await exportCodeGraphSummariesToObsidian({
      projectName,
      projectRoot,
      maxSymbolNotes: body.maxSymbolNotes || config.codegraphMaxSymbolNotes,
      exportLevel: body.exportLevel || config.codegraphExportLevel,
      maxEmbeddedSymbols: body.maxEmbeddedSymbols || config.codegraphMaxEmbeddedSymbols,
      scopePaths: Array.isArray(body.scopePaths) ? body.scopePaths : [],
    });
    logCodeGraphDebugEvent(console, 'api_export_obsidian_response', {
      projectName,
      projectRoot,
      documents: result.documents,
      written: result.written,
      skippedUnchanged: result.skippedUnchanged,
      deprecated: result.deprecated,
    });
    res.json({ success: true, projectRoot, projectName, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to export CodeGraph summaries to Obsidian');
  }
});

router.post('/summary/lazy', async (req, res) => {
  try {
    const body = req.body || {};
    const projectRoot = await resolveProjectRoot(body);
    const config = readObsidianBridgeConfig();
    if (config.codegraphLazyLlmSummaries !== true && body.force !== true) {
      res.json({
        success: true,
        skipped: true,
        reason: 'codegraphLazyLlmSummaries disabled',
      });
      return;
    }
    const result = await codeGraphService.requestLazyLlmSummary({
      ...body,
      projectRoot,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to generate lazy CodeGraph summary');
  }
});

router.post('/impact-summary', async (req, res) => {
  try {
    const body = req.body || {};
    const projectRoot = await resolveProjectRoot(body);
    const config = readObsidianBridgeConfig();
    const result = await buildImpactSummary({
      projectRoot,
      symbol: body.symbol,
      depth: body.depth || config.codegraphImpactMaxDepth,
      limit: body.limit || config.codegraphImpactLimit,
    });
    res.json({ success: true, projectRoot, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to build CodeGraph impact summary');
  }
});

router.post('/ghosts/scan', async (req, res) => {
  try {
    const body = req.body || {};
    const projectName = readString(body.projectName || body.project) || 'General';
    const result = await scanCodeGraphGhostNotes({
      projectName,
      activePaths: Array.isArray(body.activePaths) ? body.activePaths : [],
    });
    res.json({ success: true, projectName, ...result });
  } catch (error) {
    sendError(res, error, 'Failed to scan CodeGraph ghost notes');
  }
});

export default router;
