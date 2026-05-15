import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { completeSmallModelJson as defaultCompleteJson } from './small-model-service.js';
import { readObsidianBridgeConfig as defaultReadObsidianBridgeConfig } from './obsidian-bridge-service.js';
import { createMemoryCandidates as defaultCreateMemoryCandidates } from './obsidian-memory-service.js';

const defaultIngestKnowledgeSourceToWiki = async (...args) => {
  const module = await import('./obsidian-wiki-service.js');
  return module.ingestKnowledgeSourceToWiki(...args);
};

const AUTO_MEMORY_SOURCE = 'auto-memory';
const ALLOWED_MEMORY_TYPES = new Set(['user', 'feedback', 'project', 'reference']);
const FUTURE_PREFERENCE_RE = '(?:以后|后续|接下来)(?:请|回答|回复|最终|结论|都|要|不要|别|在|如果|遇到|看到)';
const EXPLICIT_MEMORY_PREFIX_RE = new RegExp(`^(?:记住|请记住|帮我记住|你要记住|${FUTURE_PREFERENCE_RE}|从现在起|remember(?:\\s+that)?|please\\s+remember|from\\s+now\\s+on|going\\s+forward)[\\s:：,，-]*`, 'i');
const EXPLICIT_MEMORY_SIGNAL_RE = new RegExp(`(?:记住|请记住|帮我记住|你要记住|${FUTURE_PREFERENCE_RE}|从现在起|remember(?:\\s+that)?|please\\s+remember|from\\s+now\\s+on|going\\s+forward)`, 'i');
const URL_RE = /\bhttps?:\/\/\S+/i;

const readString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeWhitespace = (value = '') => readString(value).replace(/\s+/g, ' ');

const hashText = (value = '') => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex')
  .slice(0, 16);

const slug = (value = '') => normalizeWhitespace(value)
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'memory';

const projectNameFromPath = (projectPath = '') => {
  const cleanPath = readString(projectPath);
  if (!cleanPath) return '';
  const segments = cleanPath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || '';
};

const projectMemoryKey = ({ projectPath = '', projectName = '' } = {}) => {
  const source = readString(projectPath) || readString(projectName) || 'General';
  const normalized = source
    .replace(/^[A-Za-z]:/, (drive) => `${drive[0]}-`)
    .replace(/[\\/:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'General';
};

const titleForMemory = (memory = {}) => (
  readString(memory.title)
  || normalizeWhitespace(memory.text).slice(0, 72)
  || `${memory.type || 'memory'} memory`
);

const isInitCommand = ({ previousUserPrompt = '', userPrompt = '', content = '' } = {}) => {
  const prompt = normalizeWhitespace(previousUserPrompt || userPrompt).toLowerCase();
  const body = normalizeWhitespace(content).toLowerCase();
  return /^\/init(?:\s|$)/.test(prompt)
    || body.includes('please analyze this codebase and create a mtl.md file')
    || body.includes('create a mtl.md file, which will be given to future instances');
};

const normalizeRoutingRules = (config = {}) => {
  const direct = Number(config.routingRules?.aiMemoryDirectWriteThreshold);
  const candidate = Number(config.routingRules?.aiMemoryCandidateThreshold);
  return {
    directThreshold: Number.isFinite(direct) ? Math.min(Math.max(direct, 0.55), 0.99) : 0.85,
    candidateThreshold: Number.isFinite(candidate) ? Math.min(Math.max(candidate, 0.1), 0.9) : 0.55,
  };
};

const memoryScopeForType = (type = '') => (
  type === 'user' || type === 'feedback' ? 'global' : 'project'
);

const projectNameForMemory = (memory = {}, payload = {}) => {
  if (memory.type === 'user') return 'User';
  if (memory.type === 'feedback') return 'Feedback';
  return readString(payload.projectName) || projectNameFromPath(payload.projectPath) || 'General';
};

const normalizeMemory = (entry = {}, payload = {}) => {
  const type = readString(entry.type || entry.kind || entry.memoryType).toLowerCase();
  const text = normalizeWhitespace(entry.text || entry.content || entry.memory);
  if (!ALLOWED_MEMORY_TYPES.has(type) || !text) {
    return null;
  }
  const rawConfidence = Number(entry.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(Math.max(rawConfidence, 0), 1) : 0;
  const scope = memoryScopeForType(type);
  const stableKey = readString(entry.stableKey)
    || `${type}:${scope}:${hashText([
      type,
      scope,
      readString(payload.projectName || payload.projectPath),
      text,
    ].join('\n'))}`;
  return {
    type,
    kind: type,
    title: titleForMemory({ ...entry, type, text }),
    text,
    confidence,
    scope,
    stableKey,
    projectName: projectNameForMemory({ type }, payload),
  };
};

const memoriesFromJson = (json = {}, payload = {}) => {
  const raw = Array.isArray(json.memories)
    ? json.memories
    : Array.isArray(json.memory)
      ? json.memory
      : [];
  return raw.map((entry) => normalizeMemory(entry, payload)).filter(Boolean);
};

const classifyExplicitMemory = (text = '') => {
  if (URL_RE.test(text)) return 'reference';
  if (/(?:我是|我叫|我的角色|我的职业|我负责|my role|i am|i work as|i maintain)/i.test(text)) {
    return 'user';
  }
  if (/(?:项目|需求|截止|上线|发布|里程碑|业务|project|deadline|launch|release|milestone)/i.test(text)) {
    return 'project';
  }
  return 'feedback';
};

const explicitMemoriesFromPayload = (payload = {}) => {
  const prompt = normalizeWhitespace(payload.previousUserPrompt || payload.userPrompt);
  if (!prompt || !EXPLICIT_MEMORY_SIGNAL_RE.test(prompt)) {
    return [];
  }
  if (isInitCommand(payload)) {
    return [];
  }

  const withoutPrefix = normalizeWhitespace(prompt.replace(EXPLICIT_MEMORY_PREFIX_RE, ''));
  const text = withoutPrefix || prompt;
  if (text.length < 4) {
    return [];
  }

  const type = classifyExplicitMemory(text);
  return [normalizeMemory({
    type,
    title: text.slice(0, 72),
    text,
    confidence: 0.92,
  }, payload)].filter(Boolean);
};

const buildExtractionPrompt = (payload = {}) => JSON.stringify({
  instruction: [
    'Extract durable memory items from this assistant turn.',
    'Only return user, feedback, project, or reference memories.',
    'Do not record code structure, Git history, init templates, transient logs, tool output, or obvious repository facts that can be read with tools.',
    'Return JSON: {"memories":[{"type":"user|feedback|project|reference","title":"","text":"","confidence":0-1}]}',
  ].join(' '),
  projectName: readString(payload.projectName),
  projectPath: readString(payload.projectPath),
  previousUserPrompt: readString(payload.previousUserPrompt || payload.userPrompt).slice(0, 2000),
  assistantContent: readString(payload.content).slice(0, 8000),
});

const fallbackMemoryRoot = () => (
  process.env.MTL_CODE_HOME
  || process.env.MTL_CODE_CONFIG_DIR
  || path.join(os.homedir(), '.mtl-code')
);

export const writeLocalFallbackMemory = async ({
  memory = {},
  projectName = '',
  projectPath = '',
  error = null,
} = {}) => {
  const memoryDir = path.join(
    fallbackMemoryRoot(),
    'projects',
    projectMemoryKey({ projectPath, projectName }),
    'memory',
  );
  await fs.mkdir(memoryDir, { recursive: true });
  const filePath = path.join(memoryDir, `obsidian-fallback-${slug(memory.title || memory.text)}-${hashText(memory.stableKey || memory.text)}.md`);
  const body = [
    '---',
    `name: ${titleForMemory(memory)}`,
    `description: ${titleForMemory(memory)}`,
    `type: ${memory.type || 'project'}`,
    `scope: ${memory.scope || memoryScopeForType(memory.type)}`,
    'source: auto-memory',
    'obsidianSync: pending',
    `obsidianError: ${normalizeWhitespace(error?.message || error || '')}`,
    `createdAt: ${new Date().toISOString()}`,
    '---',
    '',
    memory.text || '',
    '',
  ].join('\n');
  await fs.writeFile(filePath, body, 'utf8');
  return { path: filePath };
};

const createDirectPayload = (memory = {}, payload = {}) => ({
  source: AUTO_MEMORY_SOURCE,
  sourceId: `${AUTO_MEMORY_SOURCE}:${memory.stableKey}`,
  title: memory.title,
  content: memory.text,
  mode: 'ai-memory',
  modes: ['ai-memory'],
  projectName: memory.projectName,
  sessionId: readString(payload.sessionId),
  kind: memory.type,
  metadata: {
    source: AUTO_MEMORY_SOURCE,
    sourceId: `${AUTO_MEMORY_SOURCE}:${memory.stableKey}`,
    memoryStableKey: memory.stableKey,
    memoryType: memory.type,
    memoryScope: memory.scope,
    projectName: readString(payload.projectName),
    projectPath: readString(payload.projectPath),
    provider: readString(payload.provider),
    previousUserPrompt: normalizeWhitespace(payload.previousUserPrompt || payload.userPrompt).slice(0, 1000),
    confidence: memory.confidence,
    obsidianMode: 'ai-memory',
    obsidianModes: ['ai-memory'],
  },
});

const createCandidatePayload = (memory = {}, payload = {}) => ({
  candidates: [{
    kind: memory.type,
    text: memory.text,
    confidence: memory.confidence,
    stableKey: memory.stableKey,
    status: 'pending',
  }],
  source: {
    source: AUTO_MEMORY_SOURCE,
    sourceId: `${AUTO_MEMORY_SOURCE}:${memory.stableKey}`,
    sessionId: readString(payload.sessionId),
    projectName: readString(payload.projectName) || projectNameFromPath(payload.projectPath),
    title: memory.title,
    provider: readString(payload.provider),
    memoryType: memory.type,
    memoryScope: memory.scope,
  },
});

export const createObsidianAutoMemoryService = ({
  completeJson = defaultCompleteJson,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  ingestKnowledgeSourceToWiki = defaultIngestKnowledgeSourceToWiki,
  createMemoryCandidates = defaultCreateMemoryCandidates,
  writeFallbackMemory = writeLocalFallbackMemory,
} = {}) => {
  const captureObsidianAutoMemory = async (payload = {}) => {
    const content = readString(payload.content);
    if (!content) {
      return { success: true, captured: false, reason: 'empty' };
    }
    if (isInitCommand(payload)) {
      return { success: true, captured: false, reason: 'init_command' };
    }

    const config = readObsidianBridgeConfig({ includeToken: false });
    if (!config.enabled || config.aiMemoryReadbackEnabled === false) {
      return { success: true, captured: false, reason: 'disabled' };
    }

    const extraction = await completeJson({
      purpose: 'auto-memory',
      maxTokens: 900,
      systemPrompt: [
        'You are an Argus automatic memory extractor. Return JSON only.',
        'Save only durable non-obvious memory. Never save /init templates, code structure, git history, or transient debugging logs.',
      ].join('\n'),
      userPrompt: buildExtractionPrompt(payload),
    });
    let memories = [];
    if (extraction.success) {
      memories = memoriesFromJson(extraction.json, payload);
    }
    if (memories.length === 0) {
      memories = explicitMemoriesFromPayload(payload);
    }
    if (!extraction.success && memories.length === 0) {
      return {
        success: true,
        captured: false,
        reason: extraction.reason || 'extractor_unavailable',
      };
    }

    if (memories.length === 0) {
      return { success: true, captured: false, reason: 'no_memory' };
    }

    const rules = normalizeRoutingRules(config);
    const written = [];
    const candidates = [];
    const fallbacks = [];
    const skipped = [];

    for (const memory of memories) {
      if (memory.confidence >= rules.directThreshold) {
        try {
          const result = await ingestKnowledgeSourceToWiki(createDirectPayload(memory, payload));
          written.push({ memory, result });
        } catch (error) {
          const fallback = await writeFallbackMemory({
            memory,
            projectName: readString(payload.projectName) || projectNameFromPath(payload.projectPath),
            projectPath: readString(payload.projectPath),
            error,
          });
          fallbacks.push({ memory, fallback, error: error?.message || String(error) });
        }
        continue;
      }

      if (memory.confidence >= rules.candidateThreshold) {
        const result = await createMemoryCandidates(createCandidatePayload(memory, payload));
        candidates.push({ memory, result });
        continue;
      }

      skipped.push(memory);
    }

    return {
      success: true,
      captured: written.length + candidates.length + fallbacks.length > 0,
      status: fallbacks.length > 0
        ? 'fallback'
        : candidates.length > 0 && written.length === 0
          ? 'candidate'
          : written.length > 0
            ? 'captured'
            : 'skipped',
      reason: written.length + candidates.length + fallbacks.length > 0 ? 'auto_memory' : 'below_threshold',
      directCount: written.length,
      candidateCount: candidates.length,
      fallbackCount: fallbacks.length,
      skippedCount: skipped.length,
      memories,
      written,
      candidates,
      fallbacks,
    };
  };

  return {
    captureObsidianAutoMemory,
  };
};

export const obsidianAutoMemoryService = createObsidianAutoMemoryService();
export const captureObsidianAutoMemory = (...args) => (
  obsidianAutoMemoryService.captureObsidianAutoMemory(...args)
);
