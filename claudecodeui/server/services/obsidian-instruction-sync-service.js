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
} = {}) => {
  const syncedInstructionHashes = new Map();

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
      return { success: true, captured: false, reason: 'disabled' };
    }

    const absoluteFilePath = resolveFilePath({ filePath, projectPath });
    if (!absoluteFilePath) {
      return { success: true, captured: false, reason: 'missing_file_path' };
    }

    const relativePath = relativeInstructionPath({ absoluteFilePath, projectPath });
    if (!isSupportedProjectInstructionPath(relativePath)) {
      return { success: true, captured: false, reason: 'unsupported_instruction_path' };
    }

    const content = await fs.readFile(absoluteFilePath, 'utf8');
    const cleanContent = content.slice(0, MAX_INSTRUCTION_CONTENT_CHARS);
    if (!readString(cleanContent)) {
      return { success: true, captured: false, reason: 'empty_instruction_file' };
    }

    const cleanProjectName = resolveProjectName({ projectName, projectPath });
    const sourceId = `${INSTRUCTION_SOURCE}:${cleanProjectName}:${relativePath}`;
    const contentHash = hashText([sourceId, cleanContent].join('\n'));
    const syncKey = `${cleanProjectName}:${relativePath}`;
    if (skipIfUnchanged && syncedInstructionHashes.get(syncKey) === contentHash) {
      return {
        success: true,
        captured: false,
        reason: 'unchanged_instruction_file',
        mode: 'project-knowledge',
        kind: 'project-instructions',
      };
    }

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
      return { success: true, captured: false, reason: 'missing_project_path', results: [] };
    }

    const results = [];
    for (const relativePath of PROJECT_INSTRUCTION_CANDIDATES) {
      const filePath = path.join(cleanProjectPath, relativePath);
      try {
        await fs.access(filePath);
      } catch {
        continue;
      }

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
    }

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
