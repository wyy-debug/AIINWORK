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
const LEGACY_CLAUDE_INSTRUCTION_FILE = 'CLAUDE.md';
const PROJECT_INSTRUCTION_CANDIDATES = [
  PROJECT_INSTRUCTION_FILE,
  LEGACY_CLAUDE_INSTRUCTION_FILE,
  `.mtl-code/${PROJECT_INSTRUCTION_FILE}`,
  `.claude/${LEGACY_CLAUDE_INSTRUCTION_FILE}`,
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
  return PROJECT_INSTRUCTION_CANDIDATES.includes(normalized);
};

const topicKeyForInstructionPath = (relativePath = '') => (
  normalizeSlashes(relativePath)
    .toLowerCase()
    .replace(/\.md$/i, '-md')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'project-instructions'
);

const buildGeneratedInstructionContent = ({ projectName = '' } = {}) => {
  const cleanProjectName = readString(projectName) || 'this repository';
  return [
    '# MTL.md',
    '',
    `This file provides guidance to Argus when working in ${cleanProjectName}.`,
    '',
    '## Project Notes',
    '',
    '- Keep this file concise. Add only non-obvious commands, conventions, setup requirements, and workflow constraints.',
    '- Verify stale guidance against the repository before relying on it.',
    '',
  ].join('\n');
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

  const findProjectInstructionFiles = async (projectPath = '') => {
    const cleanProjectPath = readString(projectPath);
    if (!cleanProjectPath) return [];

    const files = [];
    for (const relativePath of PROJECT_INSTRUCTION_CANDIDATES) {
      const filePath = path.join(cleanProjectPath, relativePath);
      try {
        await fs.access(filePath);
        files.push({ relativePath, filePath });
      } catch {
        // Missing candidates are logged by the scan path, not this helper.
      }
    }
    return files;
  };

  const ensureProjectInstructionFile = async ({
    projectPath = '',
    projectName = '',
    provider = '',
    trigger = 'preflight_project_conversation',
  } = {}) => {
    const cleanProjectPath = readString(projectPath);
    if (!cleanProjectPath) {
      logInfo('instruction_preflight_skipped', { reason: 'missing_project_path', projectName, provider, trigger });
      return { success: true, created: false, reason: 'missing_project_path' };
    }

    const existing = await findProjectInstructionFiles(cleanProjectPath);
    if (existing.length > 0) {
      const first = existing[0];
      logInfo('instruction_preflight_exists', {
        projectPath: cleanProjectPath,
        projectName: readString(projectName),
        provider: readString(provider),
        trigger,
        relativePath: first.relativePath,
        filePath: first.filePath,
        count: existing.length,
      });
      return {
        success: true,
        created: false,
        reason: 'instruction_file_exists',
        relativePath: first.relativePath,
        filePath: first.filePath,
        files: existing,
      };
    }

    const generatedProjectName = resolveProjectName({ projectName, projectPath: cleanProjectPath });
    const generatedPath = path.join(cleanProjectPath, PROJECT_INSTRUCTION_FILE);
    try {
      await fs.writeFile(
        generatedPath,
        buildGeneratedInstructionContent({ projectName: generatedProjectName }),
        { encoding: 'utf8', flag: 'wx' },
      );
      logInfo('instruction_file_generated', {
        projectPath: cleanProjectPath,
        filePath: generatedPath,
        relativePath: PROJECT_INSTRUCTION_FILE,
        projectName: generatedProjectName,
        provider: readString(provider),
        trigger,
      });
      return {
        success: true,
        created: true,
        reason: 'instruction_file_created',
        relativePath: PROJECT_INSTRUCTION_FILE,
        filePath: generatedPath,
      };
    } catch (error) {
      if (error?.code === 'EEXIST') {
        return {
          success: true,
          created: false,
          reason: 'instruction_file_exists',
          relativePath: PROJECT_INSTRUCTION_FILE,
          filePath: generatedPath,
        };
      }
      const failure = {
        success: false,
        created: false,
        reason: 'instruction_file_generate_error',
        error: error?.message || String(error || 'Instruction file generation failed.'),
        relativePath: PROJECT_INSTRUCTION_FILE,
        filePath: generatedPath,
      };
      logWarn('instruction_file_generate_failed', failure);
      return failure;
    }
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
    const topicKey = topicKeyForInstructionPath(relativePath);
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
      topicKey,
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
        topicKey,
        obsidianMode: 'project-knowledge',
        obsidianModes: ['project-knowledge'],
        generatedInstructionFile: trigger === 'auto_create_project_instruction',
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
    const existingInstructionFiles = await findProjectInstructionFiles(cleanProjectPath);
    const existingInstructionFilePaths = new Set(existingInstructionFiles.map((file) => file.relativePath));
    for (const relativePath of PROJECT_INSTRUCTION_CANDIDATES) {
      const filePath = path.join(cleanProjectPath, relativePath);
      if (!existingInstructionFilePaths.has(relativePath)) {
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

    let generated = false;
    if (existingInstructionFiles.length === 0) {
      const ensureResult = await ensureProjectInstructionFile({
        projectPath: cleanProjectPath,
        projectName,
        provider,
        trigger: 'auto_create_project_instruction',
      });
      generated = ensureResult.created === true;
      if (ensureResult.success && ensureResult.filePath) {
        results.push(await syncInstructionFile({
          filePath: ensureResult.filePath,
          projectPath: cleanProjectPath,
          projectName,
          sessionId,
          provider,
          toolName: 'ProjectInstructionAutoCreate',
          trigger: 'auto_create_project_instruction',
          skipIfUnchanged: false,
        }));
      } else {
        results.push({
          success: false,
          captured: false,
          reason: ensureResult.reason || 'instruction_file_generate_error',
          error: ensureResult.error || '',
          filePath: ensureResult.filePath || '',
          relativePath: ensureResult.relativePath || PROJECT_INSTRUCTION_FILE,
        });
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
      generated,
      reasons: results.map((result) => result?.reason).filter(Boolean),
    });

    return {
      success: true,
      captured: results.some((result) => result?.captured),
      reason: 'project_instruction_scan',
      generated,
      results,
    };
  };

  return {
    ensureProjectInstructionFile,
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
export const ensureObsidianProjectInstructionFile = (...args) => (
  obsidianInstructionSyncService.ensureProjectInstructionFile(...args)
);
