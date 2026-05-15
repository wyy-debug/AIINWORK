import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { readObsidianBridgeConfig as defaultReadObsidianBridgeConfig } from './obsidian-bridge-service.js';

const defaultIngestKnowledgeSourceToWiki = async (...args) => {
  const module = await import('./obsidian-wiki-service.js');
  return module.ingestKnowledgeSourceToWiki(...args);
};

const INSTRUCTION_SOURCE = 'project-instructions';
const PROJECT_INSTRUCTION_FILE = 'MTL.md';
const PROJECT_INSTRUCTION_CANDIDATES = [
  PROJECT_INSTRUCTION_FILE,
  `.mtl-code/${PROJECT_INSTRUCTION_FILE}`,
];
const MAX_INSTRUCTION_CONTENT_CHARS = 120000;

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const hashText = (value = '') => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex')
  .slice(0, 16);

const normalizeSlashes = (value = '') => readString(value).replace(/\\/g, '/');

const resolveProjectName = ({ projectName = '', projectPath = '' } = {}) => (
  readString(projectName)
  || (readString(projectPath) ? path.basename(readString(projectPath)) : '')
  || 'General'
);

const resolveFilePath = ({ filePath = '', projectPath = '' } = {}) => {
  const cleanFilePath = readString(filePath);
  if (!cleanFilePath) return '';
  if (path.isAbsolute(cleanFilePath)) return path.normalize(cleanFilePath);
  const cleanProjectPath = readString(projectPath);
  return path.resolve(cleanProjectPath || process.cwd(), cleanFilePath);
};

const relativeInstructionPath = ({ absoluteFilePath = '', projectPath = '' } = {}) => {
  const cleanProjectPath = readString(projectPath);
  if (!cleanProjectPath) return path.basename(absoluteFilePath);
  const relativePath = path.relative(path.resolve(cleanProjectPath), absoluteFilePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return '';
  }
  return normalizeSlashes(relativePath);
};

const isSupportedProjectInstructionPath = (relativePath = '') => {
  const normalized = normalizeSlashes(relativePath);
  return normalized === PROJECT_INSTRUCTION_FILE
    || normalized === `.mtl-code/${PROJECT_INSTRUCTION_FILE}`;
};

const summarizeObsidianResult = (result = {}) => {
  const bridge = result.obsidianBridge && typeof result.obsidianBridge === 'object'
    ? result.obsidianBridge
    : null;
  const pathValue = readString(
    result.wikiPath
    || result.path
    || bridge?.wikiPath
    || bridge?.path,
  );
  return bridge || {
    destination: result.destination || (pathValue ? 'obsidian' : 'unknown'),
    path: pathValue,
  };
};

export const createObsidianInstructionSyncService = ({
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  ingestKnowledgeSourceToWiki = defaultIngestKnowledgeSourceToWiki,
  logger = console,
} = {}) => {
  const syncedInstructionHashes = new Map();

  const logInfo = (event, details = {}) => {
    logger?.info?.(`[Obsidian Wiki] ${event} ${JSON.stringify(details)}`);
  };

  const logWarn = (event, details = {}) => {
    logger?.warn?.(`[Obsidian Wiki] ${event} ${JSON.stringify(details)}`);
  };

  const syncInstructionFile = async ({
    filePath = '',
    projectPath = '',
    projectName = '',
    sessionId = '',
    provider = '',
    toolName = '',
    trigger = '',
    skipIfUnchanged = false,
  } = {}) => {
    const config = readObsidianBridgeConfig({ includeToken: false });
    if (!config.enabled) {
      logInfo('instruction_sync_skipped', { reason: 'disabled', filePath, projectPath, trigger });
      return { success: true, captured: false, reason: 'disabled' };
    }

    const absoluteFilePath = resolveFilePath({ filePath, projectPath });
    if (!absoluteFilePath) {
      logInfo('instruction_sync_skipped', { reason: 'missing_file_path', projectPath, trigger });
      return { success: true, captured: false, reason: 'missing_file_path' };
    }

    const relativePath = relativeInstructionPath({ absoluteFilePath, projectPath });
    if (!isSupportedProjectInstructionPath(relativePath)) {
      logInfo('instruction_sync_skipped', {
        reason: 'unsupported_instruction_path',
        filePath: absoluteFilePath,
        relativePath,
        projectPath,
        trigger,
      });
      return { success: true, captured: false, reason: 'unsupported_instruction_path' };
    }

    const content = await fs.readFile(absoluteFilePath, 'utf8');
    const cleanContent = content.slice(0, MAX_INSTRUCTION_CONTENT_CHARS);
    if (!readString(cleanContent)) {
      logInfo('instruction_sync_skipped', {
        reason: 'empty_instruction_file',
        filePath: absoluteFilePath,
        relativePath,
        projectPath,
        trigger,
      });
      return { success: true, captured: false, reason: 'empty_instruction_file' };
    }

    const cleanProjectName = resolveProjectName({ projectName, projectPath });
    const sourceId = `${INSTRUCTION_SOURCE}:${cleanProjectName}:${relativePath}`;
    const contentHash = hashText([sourceId, cleanContent].join('\n'));
    const syncKey = `${cleanProjectName}:${relativePath}`;
    if (skipIfUnchanged && syncedInstructionHashes.get(syncKey) === contentHash) {
      logInfo('instruction_sync_skipped', {
        reason: 'unchanged_instruction_file',
        filePath: absoluteFilePath,
        relativePath,
        projectName: cleanProjectName,
        contentHash,
        trigger,
      });
      return {
        success: true,
        captured: false,
        reason: 'unchanged_instruction_file',
        mode: 'project-knowledge',
        kind: 'project-instructions',
      };
    }

    logInfo('instruction_sync_start', {
      filePath: absoluteFilePath,
      relativePath,
      projectName: cleanProjectName,
      sessionId: readString(sessionId),
      provider: readString(provider),
      toolName: readString(toolName),
      contentHash,
      trigger,
    });
    const result = await ingestKnowledgeSourceToWiki({
      source: INSTRUCTION_SOURCE,
      sourceId,
      title: `${cleanProjectName} ${path.basename(relativePath)}`,
      projectName: cleanProjectName,
      projectRoot: readString(projectPath),
      sessionId: readString(sessionId),
      content: cleanContent,
      kind: 'project-instructions',
      modes: ['project-knowledge'],
      topicKey: 'mtl-md',
      summaryType: 'project-instructions',
      forceRecompile: true,
      metadata: {
        source: INSTRUCTION_SOURCE,
        sourceId,
        contentHash,
        instructionFile: true,
        instructionFileName: path.basename(relativePath),
        instructionFilePath: absoluteFilePath,
        relativePath,
        obsidianMode: 'project-knowledge',
        obsidianModes: ['project-knowledge'],
        provider: readString(provider),
        toolName: readString(toolName),
        trigger: readString(trigger),
      },
    });
    const obsidianBridge = summarizeObsidianResult(result);
    if (obsidianBridge.destination === 'obsidian' && readString(obsidianBridge.path || obsidianBridge.wikiPath)) {
      syncedInstructionHashes.set(syncKey, contentHash);
    }
    logInfo('instruction_sync_complete', {
      filePath: absoluteFilePath,
      relativePath,
      projectName: cleanProjectName,
      destination: obsidianBridge.destination || '',
      path: readString(obsidianBridge.path || obsidianBridge.wikiPath),
      fallbackPath: readString(obsidianBridge.fallbackPath),
      error: readString(obsidianBridge.error),
      contentHash,
      trigger,
    });

    return {
      success: true,
      captured: true,
      status: 'captured',
      reason: 'instruction_file_synced',
      mode: 'project-knowledge',
      kind: 'project-instructions',
      obsidianBridge,
      result,
    };
  };

  const syncProjectInstructionFiles = async ({
    projectPath = '',
    projectName = '',
    sessionId = '',
    provider = '',
    trigger = 'project_instruction_scan',
  } = {}) => {
    const cleanProjectPath = readString(projectPath);
    if (!cleanProjectPath) {
      logInfo('instruction_scan_skipped', { reason: 'missing_project_path', projectName, sessionId, trigger });
      return { success: true, captured: false, reason: 'missing_project_path', results: [] };
    }

    logInfo('instruction_scan_start', {
      projectPath: cleanProjectPath,
      projectName: readString(projectName),
      sessionId: readString(sessionId),
      provider: readString(provider),
      trigger,
      candidates: PROJECT_INSTRUCTION_CANDIDATES,
    });

    const results = [];
    for (const relativePath of PROJECT_INSTRUCTION_CANDIDATES) {
      const filePath = path.join(cleanProjectPath, relativePath);
      try {
        await fs.access(filePath);
      } catch {
        logInfo('instruction_scan_candidate_missing', {
          projectPath: cleanProjectPath,
          relativePath,
          filePath,
          trigger,
        });
        continue;
      }

      try {
        results.push(await syncInstructionFile({
          filePath,
          projectPath: cleanProjectPath,
          projectName,
          sessionId,
          provider,
          toolName: 'ProjectInstructionScan',
          trigger,
          skipIfUnchanged: true,
        }));
      } catch (error) {
        const failure = {
          success: false,
          captured: false,
          reason: 'instruction_file_sync_error',
          error: error?.message || String(error || 'Instruction file sync failed.'),
          filePath,
          relativePath,
        };
        logWarn('instruction_scan_candidate_failed', failure);
        results.push(failure);
      }
    }

    logInfo('instruction_scan_complete', {
      projectPath: cleanProjectPath,
      projectName: readString(projectName),
      sessionId: readString(sessionId),
      trigger,
      candidates: PROJECT_INSTRUCTION_CANDIDATES.length,
      found: results.length,
      captured: results.filter((result) => result?.captured).length,
      skipped: results.filter((result) => result && !result.captured).length,
      reasons: results.map((result) => result?.reason).filter(Boolean),
    });

    return {
      success: true,
      captured: results.some((result) => result?.captured),
      reason: 'project_instruction_scan',
      results,
    };
  };

  return {
    syncInstructionFile,
    syncProjectInstructionFiles,
  };
};

export const obsidianInstructionSyncService = createObsidianInstructionSyncService();
export const syncObsidianInstructionFile = (...args) => (
  obsidianInstructionSyncService.syncInstructionFile(...args)
);
export const syncObsidianProjectInstructionFiles = (...args) => (
  obsidianInstructionSyncService.syncProjectInstructionFiles(...args)
);
