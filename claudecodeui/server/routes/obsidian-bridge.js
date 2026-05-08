import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import express from 'express';

import { extractProjectDirectory, getProjects } from '../projects.js';
import {
  appendObsidianPeriodicNote,
  buildObsidianContext,
  getActiveObsidianNote,
  getObsidianGraph,
  archiveObsidianDuplicates,
  ObsidianBridgeError,
  patchObsidianNote,
  queryObsidianNotes,
  readObsidianBridgeConfig,
  saveObsidianBridgeConfig,
  scanObsidianDuplicates,
  searchObsidianBridge,
  testObsidianBridgeConnection,
} from '../services/obsidian-bridge-service.js';
import {
  DEFAULT_OBSIDIAN_BRIDGE_ENDPOINT,
  installObsidianBridgePlugin,
  listObsidianVaults,
} from '../services/obsidian-bridge-installer-service.js';
import { createKnowledgeDocument } from '../services/knowledge-document-service.js';
import {
  commitMemoryCandidates,
  createMemoryCandidates,
  listMemoryCandidates,
} from '../services/obsidian-memory-service.js';
import {
  assessChatKnowledgeCapture,
  autoCaptureChatKnowledge,
} from '../services/chat-knowledge-capture-service.js';
import {
  getObsidianAutoCaptureBackfillStatus,
  runObsidianAutoCaptureBackfill,
} from '../services/obsidian-auto-capture-backfill-service.js';
import {
  compileWikiImport,
  getWikiImportBatch,
  ingestUploadedFilesToObsidian,
  lintWiki,
} from '../services/obsidian-wiki-service.js';

const router = express.Router();

const resolveProjectRoot = async (projectName = '') => {
  if (!projectName) {
    return '';
  }
  try {
    return await extractProjectDirectory(projectName);
  } catch {
    return '';
  }
};

const sendBridgeError = (res, error, fallbackMessage) => {
  if (error instanceof ObsidianBridgeError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({
    success: false,
    error: fallbackMessage,
  });
};

router.post('/documents', async (req, res) => {
  try {
    const projectRoot = await resolveProjectRoot(req.body?.projectName || '');
    const result = await createKnowledgeDocument(req.body || {}, {
      projectRoot,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to write document to Obsidian bridge');
  }
});

router.post('/auto-capture-chat', async (req, res) => {
  try {
    const result = await autoCaptureChatKnowledge(req.body || {});
    res.json(result);
  } catch (error) {
    sendBridgeError(res, error, 'Failed to auto-capture chat knowledge');
  }
});

router.post('/routing/preview', async (req, res) => {
  try {
    const config = readObsidianBridgeConfig();
    const assessment = assessChatKnowledgeCapture({
      content: req.body?.content || req.body?.text || '',
      userPrompt: req.body?.userPrompt || req.body?.prompt || '',
      defaultMode: req.body?.defaultMode || config.defaultMode || 'project-knowledge',
      timestamp: req.body?.timestamp || new Date().toISOString(),
      routingRules: config.routingRules || {},
    });
    res.json({
      success: true,
      ...assessment,
      wouldWrite: Boolean(assessment.shouldCapture && assessment.memoryCapturePolicy !== 'candidate'),
      memoryAction: assessment.mode === 'ai-memory'
        ? assessment.memoryCapturePolicy === 'direct'
          ? 'direct-write'
          : assessment.memoryCapturePolicy === 'candidate'
            ? 'candidate'
            : 'skip'
        : 'not-memory',
    });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to preview Obsidian routing');
  }
});

router.post('/auto-capture/backfill', async (req, res) => {
  try {
    const limitSessions = Number.parseInt(String(req.body?.limitSessions || '0'), 10) || 0;
    const result = await runObsidianAutoCaptureBackfill({
      getProjects,
      limitSessions,
    });
    res.json(result);
  } catch (error) {
    sendBridgeError(res, error, 'Failed to run Obsidian auto-capture backfill');
  }
});

router.get('/auto-capture/status', async (_req, res) => {
  try {
    res.json(getObsidianAutoCaptureBackfillStatus());
  } catch (error) {
    sendBridgeError(res, error, 'Failed to read Obsidian auto-capture status');
  }
});

const sanitizeUploadName = (value = 'uploaded-file') => (
  path.basename(String(value || 'uploaded-file'))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+$/, 'uploaded-file')
    .trim() || 'uploaded-file'
);

const copyUploadFilesToProject = async ({ req, projectName, batchId }) => {
  const projectRoot = await resolveProjectRoot(projectName);
  if (!projectRoot) {
    throw new ObsidianBridgeError('Project root is required for Obsidian wiki uploads.', {
      code: 'OBSIDIAN_WIKI_PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }
  const targetDir = path.resolve(projectRoot, '.tmp', 'obsidian-imports', batchId);
  const relative = path.relative(projectRoot, targetDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ObsidianBridgeError('Unsafe Obsidian wiki import path.', {
      code: 'OBSIDIAN_WIKI_BAD_UPLOAD_PATH',
      statusCode: 403,
    });
  }
  await fs.mkdir(targetDir, { recursive: true });
  const files = [];
  for (const file of req.files || []) {
    const safeName = sanitizeUploadName(file.originalname);
    const destination = path.resolve(targetDir, safeName);
    const destinationRelative = path.relative(projectRoot, destination);
    if (!destinationRelative || destinationRelative.startsWith('..') || path.isAbsolute(destinationRelative)) {
      await fs.unlink(file.path).catch(() => undefined);
      continue;
    }
    await fs.copyFile(file.path, destination);
    await fs.unlink(file.path).catch(() => undefined);
    files.push({
      name: safeName,
      path: destination,
      size: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
    });
  }
  return files;
};

const handleWikiUpload = async (req, res) => {
  const multer = (await import('multer')).default;
  const uploadTempRoot = path.join(os.tmpdir(), 'argus-obsidian-wiki-uploads', String(req.user?.id || 'user'));
  await fs.mkdir(uploadTempRoot, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, cb) => cb(null, uploadTempRoot),
      filename: (_request, _file, cb) => cb(null, `wiki-upload-${Date.now()}-${Math.round(Math.random() * 1E9)}`),
    }),
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 20,
    },
  });

  upload.array('files', 20)(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ success: false, error: error.message || 'Failed to upload wiki files' });
    }
    try {
      if (!Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({ success: false, error: 'No files provided' });
      }
      const projectName = String(req.body?.projectName || req.params?.projectName || '').trim();
      const batchId = String(req.body?.batchId || `upload-${Date.now()}-${Math.round(Math.random() * 1E9)}`).trim();
      const files = await copyUploadFilesToProject({ req, projectName, batchId });
      const result = await ingestUploadedFilesToObsidian({
        files,
        projectName,
        sessionId: String(req.body?.sessionId || ''),
        batchId,
      });
      return res.json({ success: true, ...result, files });
    } catch (innerError) {
      await Promise.all((req.files || []).map((file) => fs.unlink(file.path).catch(() => undefined)));
      return sendBridgeError(res, innerError, 'Failed to ingest uploaded files into Obsidian wiki');
    }
  });
};

router.post('/wiki/upload', (req, res) => {
  void handleWikiUpload(req, res);
});

router.post('/wiki/ingest', async (req, res) => {
  try {
    const result = await ingestUploadedFilesToObsidian(req.body || {});
    res.json(result);
  } catch (error) {
    sendBridgeError(res, error, 'Failed to ingest Obsidian wiki source');
  }
});

router.post('/wiki/compile', async (req, res) => {
  try {
    const result = await compileWikiImport(req.body || {});
    res.json(result);
  } catch (error) {
    sendBridgeError(res, error, 'Failed to compile Obsidian wiki note');
  }
});

router.post('/wiki/lint', async (req, res) => {
  try {
    const result = await lintWiki(req.body || {});
    res.json(result);
  } catch (error) {
    sendBridgeError(res, error, 'Failed to lint Obsidian wiki');
  }
});

router.get('/wiki/imports/:id', async (req, res) => {
  try {
    res.json(getWikiImportBatch(req.params.id));
  } catch (error) {
    sendBridgeError(res, error, 'Failed to read Obsidian wiki import batch');
  }
});

router.post('/test-connection', async (_req, res) => {
  try {
    const result = await testObsidianBridgeConnection();
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to connect to Obsidian bridge');
  }
});

router.get('/vaults', async (_req, res) => {
  try {
    const vaults = await listObsidianVaults();
    res.json({ success: true, vaults });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to discover Obsidian vaults');
  }
});

router.post('/install-plugin', async (req, res) => {
  try {
    const currentConfig = readObsidianBridgeConfig({ includeToken: true });
    const usedPorts = (currentConfig.vaults || []).filter((vault) => vault.token).map((vault) => {
      try {
        return Number.parseInt(new URL(vault.endpoint).port, 10);
      } catch {
        return 0;
      }
    }).filter(Boolean);
    const install = await installObsidianBridgePlugin({
      vaultPath: req.body?.vaultPath,
      port: req.body?.port,
      usedPorts,
      enablePlugin: req.body?.enablePlugin !== false,
    });
    const vaultId = String(req.body?.vaultId || install.vaultName || 'default')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'default';
    const nextVault = {
      vaultId,
      name: install.vaultName,
      endpoint: install.endpoint || DEFAULT_OBSIDIAN_BRIDGE_ENDPOINT,
      token: install.token,
      readableFolders: currentConfig.readableVaultFolders,
      writeBaseFolder: 'Argus',
      pluginVersion: install.manifestVersion,
    };
    const vaults = [
      ...(currentConfig.vaults || []).filter((vault) => vault.vaultId !== vaultId),
      nextVault,
    ];
    const config = saveObsidianBridgeConfig({
      enabled: true,
      activeVaultId: vaultId,
      vaults,
      lastError: '',
    });
    const { token: _token, ...publicInstall } = install;
    res.json({ success: true, install: publicInstall, config });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to install Obsidian bridge plugin');
  }
});

router.post('/search', async (req, res) => {
  try {
    const result = await searchObsidianBridge(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to search Obsidian bridge');
  }
});

router.get('/active', async (req, res) => {
  try {
    const result = await getActiveObsidianNote({
      vaultId: req.query?.vaultId,
      includeContent: req.query?.includeContent !== 'false',
      includeSelection: req.query?.includeSelection !== 'false',
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to read active Obsidian note');
  }
});

router.post('/active', async (req, res) => {
  try {
    const result = await getActiveObsidianNote(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to read active Obsidian note');
  }
});

router.post('/patch', async (req, res) => {
  try {
    const result = await patchObsidianNote(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to patch Obsidian note');
  }
});

router.post('/query', async (req, res) => {
  try {
    const result = await queryObsidianNotes(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to query Obsidian notes');
  }
});

router.post('/periodic/append', async (req, res) => {
  try {
    const result = await appendObsidianPeriodicNote(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to append Obsidian periodic note');
  }
});

router.post('/graph', async (req, res) => {
  try {
    const result = await getObsidianGraph(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to build Obsidian graph');
  }
});

router.post('/context', async (req, res) => {
  try {
    const result = await buildObsidianContext(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to build Obsidian context');
  }
});

router.post('/duplicates/scan', async (req, res) => {
  try {
    const result = await scanObsidianDuplicates(req.body || {});
    res.json({ success: true, ...result, duplicateGroups: result.duplicateGroups || result.groups || [] });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to scan Obsidian duplicates');
  }
});

router.post('/duplicates/archive', async (req, res) => {
  try {
    const result = await archiveObsidianDuplicates(req.body || {});
    res.json({ success: true, ...result, duplicateGroups: result.duplicateGroups || result.groups || [] });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to archive Obsidian duplicates');
  }
});

router.get('/memory/candidates', async (_req, res) => {
  try {
    res.json(listMemoryCandidates());
  } catch (error) {
    sendBridgeError(res, error, 'Failed to list Obsidian memory candidates');
  }
});

router.post('/memory/candidates', async (req, res) => {
  try {
    res.json(createMemoryCandidates(req.body || {}));
  } catch (error) {
    sendBridgeError(res, error, 'Failed to create Obsidian memory candidates');
  }
});

router.post('/memory/commit', async (req, res) => {
  try {
    res.json(await commitMemoryCandidates(req.body || {}));
  } catch (error) {
    sendBridgeError(res, error, 'Failed to commit Obsidian memory candidates');
  }
});

router.post('/mcp/install', async (_req, res) => {
  try {
    res.json({
      success: true,
      command: 'node scripts/obsidian-bridge-mcp.mjs',
      env: {
        ARGUS_BASE_URL: 'http://127.0.0.1:3001',
        ARGUS_API_TOKEN: '<optional Argus API token>',
      },
    });
  } catch (error) {
    sendBridgeError(res, error, 'Failed to prepare Obsidian MCP install details');
  }
});

export default router;
