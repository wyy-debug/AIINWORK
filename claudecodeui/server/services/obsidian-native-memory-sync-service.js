import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appConfigDb } from '../database/db.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import { readObsidianBridgeConfig as defaultReadObsidianBridgeConfig } from './obsidian-bridge-service.js';

const defaultIngestKnowledgeSourceToWiki = async (...args) => {
  const module = await import('./obsidian-wiki-service.js');
  return module.ingestKnowledgeSourceToWiki(...args);
};

const STATE_KEY = 'obsidian_native_memory_sync_state';
const SOURCE = 'native-auto-memory';
const ALLOWED_MEMORY_TYPES = new Set(['user', 'feedback', 'project', 'reference']);

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const hashText = (value = '') => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex');

export const projectMemoryKey = ({ projectPath = '', projectName = '' } = {}) => {
  const source = readString(projectPath) || readString(projectName) || 'General';
  return source.replace(/[^a-zA-Z0-9]/g, '-') || 'General';
};

const memoryHome = (env = process.env) => (
  env.MTL_CODE_HOME
  || env.MTL_CODE_CONFIG_DIR
  || env.CLAUDE_CONFIG_DIR
  || path.join(os.homedir(), '.mtl-code')
);

export const resolveNativeMemoryStagingDir = ({
  projectPath = '',
  projectName = '',
  env = process.env,
} = {}) => path.join(
  memoryHome(env),
  'projects',
  projectMemoryKey({ projectPath, projectName }),
  'memory',
);

const readState = (store) => {
  try {
    const raw = store?.get?.(STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeState = (store, state = {}) => {
  store?.set?.(STATE_KEY, JSON.stringify(state));
};

const isSyncEnabledForConfig = (config = {}) => (
  config.enabled === true
  && config.aiMemoryReadbackEnabled !== false
  && config.nativeAutoMemorySyncEnabled !== false
);

const nativeMemoryDestinationProject = (type = '', projectName = '', projectPath = '') => {
  if (type === 'user') return 'User';
  if (type === 'feedback') return 'Feedback';
  return readString(projectName) || path.basename(readString(projectPath)) || 'General';
};

const nativeMemoryScope = (type = '') => (
  type === 'user' || type === 'feedback' ? 'global' : 'project'
);

const normalizeRelativePath = (relativePath = '') => (
  readString(relativePath).replace(/\\/g, '/')
);

const logInfo = (logger, event, payload = {}) => {
  logger?.log?.(`[Obsidian Native Memory] ${event}`, JSON.stringify(payload));
};

const logWarn = (logger, event, payload = {}) => {
  logger?.warn?.(`[Obsidian Native Memory] ${event}`, JSON.stringify(payload));
};

const readMemoryTopic = async ({ filePath = '', relativePath = '' } = {}) => {
  const filename = path.basename(filePath);
  if (!/\.md$/i.test(filename)) {
    return { skipped: true, reason: 'not_markdown' };
  }
  if (/^MEMORY\.md$/i.test(filename) || filename.startsWith('.')) {
    return { skipped: true, reason: 'reserved_memory_file' };
  }

  const raw = await fs.readFile(filePath, 'utf8');
  if (!readString(raw)) {
    return { skipped: true, reason: 'empty_memory_file' };
  }

  const parsed = parseFrontmatter(raw);
  const type = readString(parsed.data?.type || parsed.data?.memoryType).toLowerCase();
  const body = readString(parsed.content);
  if (!ALLOWED_MEMORY_TYPES.has(type) || !body) {
    return { skipped: true, reason: 'invalid_native_memory_frontmatter' };
  }

  return {
    skipped: false,
    type,
    title: readString(parsed.data?.name || parsed.data?.title || parsed.data?.description)
      || path.basename(relativePath, path.extname(relativePath)),
    content: body,
    raw,
    metadata: parsed.data || {},
  };
};

export const createObsidianNativeMemorySyncService = ({
  ingestKnowledgeSourceToWiki = defaultIngestKnowledgeSourceToWiki,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  stateStore = appConfigDb,
  logger = console,
} = {}) => {
  const isNativeAutoMemorySyncEnabled = () => {
    try {
      return isSyncEnabledForConfig(readObsidianBridgeConfig({ includeToken: false }));
    } catch {
      return false;
    }
  };

  const syncNativeMemoryFiles = async ({
    memoryDir = '',
    projectPath = '',
    projectName = '',
    sessionId = '',
    provider = '',
    trigger = 'turn_complete_scan',
  } = {}) => {
    let config = {};
    try {
      config = readObsidianBridgeConfig({ includeToken: false });
    } catch (error) {
      return {
        success: true,
        enabled: false,
        captured: false,
        reason: 'config_unavailable',
        error: error?.message || String(error || 'Obsidian config unavailable.'),
        results: [],
      };
    }
    if (!isSyncEnabledForConfig(config)) {
      return {
        success: true,
        enabled: false,
        captured: false,
        reason: 'disabled',
        results: [],
      };
    }

    const cleanProjectName = readString(projectName) || path.basename(readString(projectPath)) || 'General';
    const cleanMemoryDir = readString(memoryDir) || resolveNativeMemoryStagingDir({ projectPath, projectName: cleanProjectName });
    const projectKey = projectMemoryKey({ projectPath, projectName: cleanProjectName });
    logInfo(logger, 'sync_start', {
      memoryDir: cleanMemoryDir,
      projectPath: readString(projectPath),
      projectName: cleanProjectName,
      sessionId: readString(sessionId),
      provider: readString(provider),
      trigger,
    });

    let dirents = [];
    try {
      dirents = await fs.readdir(cleanMemoryDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        logInfo(logger, 'skipped', { reason: 'missing_memory_dir', memoryDir: cleanMemoryDir, trigger });
        return {
          success: true,
          enabled: true,
          captured: false,
          reason: 'missing_memory_dir',
          syncedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          results: [],
        };
      }
      throw error;
    }

    const state = readState(stateStore);
    const results = [];
    const failures = [];
    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const dirent of dirents) {
      if (!dirent.isFile()) {
        continue;
      }
      const relativePath = normalizeRelativePath(dirent.name);
      const filePath = path.join(cleanMemoryDir, dirent.name);
      let topic;
      try {
        topic = await readMemoryTopic({ filePath, relativePath });
      } catch (error) {
        skippedCount += 1;
        logWarn(logger, 'skipped', {
          reason: 'read_failed',
          relativePath,
          error: error?.message || String(error),
          trigger,
        });
        continue;
      }
      if (topic.skipped) {
        skippedCount += 1;
        logInfo(logger, 'skipped', {
          reason: topic.reason,
          relativePath,
          trigger,
        });
        continue;
      }

      const contentHash = hashText(topic.raw);
      const stateKey = `${projectKey}:${relativePath}`;
      const previous = state[stateKey] || {};
      if (previous.status === 'synced' && previous.contentHash === contentHash) {
        skippedCount += 1;
        logInfo(logger, 'skipped', {
          reason: 'unchanged_native_memory_file',
          relativePath,
          contentHash,
          trigger,
        });
        continue;
      }

      const sourceId = `${SOURCE}:${projectKey}:${relativePath}`;
      const memoryProjectName = nativeMemoryDestinationProject(topic.type, cleanProjectName, projectPath);
      const payload = {
        source: SOURCE,
        sourceId,
        title: topic.title,
        content: topic.content,
        mode: 'ai-memory',
        modes: ['ai-memory'],
        projectName: memoryProjectName,
        sessionId: readString(sessionId),
        kind: topic.type,
        metadata: {
          ...topic.metadata,
          source: SOURCE,
          sourceId,
          memoryStableKey: sourceId,
          memoryType: topic.type,
          memoryScope: nativeMemoryScope(topic.type),
          nativeMemoryRelativePath: relativePath,
          nativeMemoryPath: filePath,
          nativeMemoryContentHash: contentHash,
          projectName: cleanProjectName,
          projectPath: readString(projectPath),
          provider: readString(provider),
          confidence: 1,
          obsidianMode: 'ai-memory',
          obsidianModes: ['ai-memory'],
        },
      };

      try {
        const result = await ingestKnowledgeSourceToWiki(payload);
        const obsidianPath = readString(result?.wikiPath || result?.path || result?.obsidianPath);
        state[stateKey] = {
          contentHash,
          obsidianPath,
          status: 'synced',
          sourceId,
          relativePath,
          projectKey,
          lastSyncedAt: new Date().toISOString(),
        };
        syncedCount += 1;
        results.push({
          relativePath,
          filePath,
          contentHash,
          obsidianPath,
          result,
        });
        logInfo(logger, 'synced', {
          relativePath,
          obsidianPath,
          contentHash,
          trigger,
        });
      } catch (error) {
        const message = error?.message || String(error || 'Obsidian native memory sync failed.');
        state[stateKey] = {
          ...previous,
          contentHash,
          status: 'pending',
          sourceId,
          relativePath,
          projectKey,
          lastError: message,
          lastAttemptAt: new Date().toISOString(),
        };
        failedCount += 1;
        failures.push({ relativePath, filePath, contentHash, error: message });
        logWarn(logger, 'failed', {
          relativePath,
          contentHash,
          error: message,
          trigger,
        });
      }
    }

    writeState(stateStore, state);
    return {
      success: failedCount === 0,
      enabled: true,
      captured: syncedCount > 0,
      status: failedCount > 0 ? 'pending' : syncedCount > 0 ? 'synced' : 'skipped',
      reason: failedCount > 0
        ? 'native_auto_memory_pending'
        : syncedCount > 0
          ? 'native_auto_memory_synced'
          : 'native_auto_memory_unchanged',
      memoryDir: cleanMemoryDir,
      projectKey,
      syncedCount,
      skippedCount,
      failedCount,
      results,
      failures,
    };
  };

  return {
    isNativeAutoMemorySyncEnabled,
    syncNativeMemoryFiles,
  };
};

export const obsidianNativeMemorySyncService = createObsidianNativeMemorySyncService();
export const isNativeAutoMemorySyncEnabled = (...args) => (
  obsidianNativeMemorySyncService.isNativeAutoMemorySyncEnabled(...args)
);
export const syncNativeMemoryFiles = (...args) => (
  obsidianNativeMemorySyncService.syncNativeMemoryFiles(...args)
);
