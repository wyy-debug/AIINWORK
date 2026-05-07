import fs from 'fs/promises';
import path from 'path';

import {
  ObsidianBridgeError,
  readObsidianBridgeConfig,
  sendObsidianDocument,
} from './obsidian-bridge-service.js';

const KNOWLEDGE_KINDS = new Set([
  'review-notes',
  'automation-run',
  'action-log',
  'project-summary',
  'session-summary',
  'architecture-decision',
  'decision',
  'plan',
  'ai-memory',
  'knowledge',
]);

const NON_KNOWLEDGE_PATTERNS = /\b(browser|screenshot|visual|preview|image|video|log-raw)\b/i;

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const sanitizeSegment = (value, fallback = 'Untitled') => {
  const sanitized = readString(value)
    .replace(/[\\/]+/g, ' ')
    .replace(/\.\.+/g, ' ')
    .replace(/[<>:"|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

const safeJson = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

const normalizeTags = (tags) => (
  Array.isArray(tags)
    ? [...new Set(tags.map(readString).filter(Boolean))]
    : []
);

const stripArtifactSyncMetadata = (metadata = {}) => (
  Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !key.startsWith('obsidian')),
  )
);

const createSlugFileName = (title) => `${sanitizeSegment(title)}.md`;

const quoteYaml = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const formatYamlScalar = (value) => {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = value == null ? '' : String(value);
  return text === '' || /(^\s|:\s|["'#[\]{}])/.test(text) ? quoteYaml(text) : text;
};

const yamlLines = (key, value) => {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return [];
  }
  if (Array.isArray(value)) {
    return [
      `${key}:`,
      ...value.map((entry) => `  - ${formatYamlScalar(entry)}`),
    ];
  }
  return [`${key}: ${formatYamlScalar(value)}`];
};

const formatFallbackMarkdown = (document, {
  reason = '',
  created = new Date().toISOString(),
  updated = new Date().toISOString(),
} = {}) => {
  const properties = {
    type: document.mode,
    source: 'argus',
    project: document.projectName,
    sessionId: document.sessionId,
    created,
    updated,
    tags: document.tags || [],
    argusId: document.argusId,
    kind: document.kind,
    status: document.status,
    sourceArtifactId: document.sourceArtifactId,
    templateId: document.templateId,
    related: document.related || [],
    confidence: document.confidence,
    obsidianFallback: true,
    obsidianFallbackReason: reason,
    targetMode: document.mode,
  };
  const frontmatter = [
    '---',
    ...Object.entries(properties).flatMap(([key, value]) => yamlLines(key, value)),
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${document.content}`;
};

const getFrontmatter = (content = '') => {
  if (!content.startsWith('---\n')) {
    return '';
  }
  const end = content.indexOf('\n---', 4);
  return end === -1 ? '' : content.slice(4, end);
};

const findFallbackPathByArgusId = async (directory, argusId) => {
  if (!argusId) {
    return '';
  }
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return '';
  }
  const pattern = new RegExp(`^argusId:\\s*['"]?${argusId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm');
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    const content = await fs.readFile(candidate, 'utf8').catch(() => '');
    if (pattern.test(getFrontmatter(content))) {
      return candidate;
    }
  }
  return '';
};

const resolveUniqueFallbackPath = async (directory, fileName) => {
  const parsed = path.parse(fileName);
  let candidate = path.join(directory, fileName);
  for (let index = 2; index < 10000; index += 1) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${parsed.name} ${index}${parsed.ext}`);
    } catch {
      return candidate;
    }
  }
  throw new Error('Could not choose a fallback knowledge path.');
};

const writeProjectKnowledgeFallback = async (document, {
  projectRoot,
  reason,
} = {}) => {
  if (!projectRoot) {
    throw new ObsidianBridgeError('Project root is required for Obsidian fallback writes.', {
      code: 'OBSIDIAN_FALLBACK_UNAVAILABLE',
      statusCode: 500,
    });
  }
  const mode = sanitizeSegment(document.mode, 'project-knowledge');
  const directory = path.join(projectRoot, 'docs', 'knowledge', mode);
  await fs.mkdir(directory, { recursive: true });

  const existingPath = await findFallbackPathByArgusId(directory, document.argusId);
  const fallbackPath = existingPath || await resolveUniqueFallbackPath(directory, createSlugFileName(document.title));
  const previous = existingPath ? await fs.readFile(existingPath, 'utf8').catch(() => '') : '';
  const created = previous.match(/^created:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g, '') || new Date().toISOString();
  await fs.writeFile(fallbackPath, formatFallbackMarkdown(document, {
    reason,
    created,
    updated: new Date().toISOString(),
  }), 'utf8');
  return fallbackPath;
};

export const isKnowledgeArtifact = (artifact = {}) => {
  const kind = readString(artifact.kind).toLowerCase();
  const source = readString(artifact.metadata?.source).toLowerCase();
  if (NON_KNOWLEDGE_PATTERNS.test(kind) || NON_KNOWLEDGE_PATTERNS.test(source)) {
    return false;
  }
  return KNOWLEDGE_KINDS.has(kind)
    || KNOWLEDGE_KINDS.has(source)
    || /\b(summary|decision|plan|memory|knowledge|review)\b/i.test(kind);
};

export const documentPayloadFromArtifact = (artifact = {}, overrides = {}) => {
  const metadata = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {};
  const documentMetadata = stripArtifactSyncMetadata(metadata);
  const sourceArtifactId = readString(artifact.id);
  const kind = readString(artifact.kind) || 'artifact';
  const mode = overrides.mode
    || metadata.obsidianMode
    || (kind === 'ai-memory' ? 'ai-memory' : 'project-knowledge');
  return {
    title: readString(overrides.title) || readString(artifact.title) || 'Untitled result',
    content: typeof overrides.content === 'string'
      ? overrides.content
      : typeof artifact.content === 'string'
        ? artifact.content
        : readString(artifact.filePath),
    mode,
    projectName: readString(overrides.projectName) || readString(artifact.projectName),
    sessionId: readString(overrides.sessionId) || readString(artifact.sessionId),
    argusId: readString(overrides.argusId) || (sourceArtifactId ? `artifact:${sourceArtifactId}` : ''),
    kind,
    status: readString(overrides.status) || readString(metadata.status) || 'final',
    sourceArtifactId,
    templateId: readString(overrides.templateId) || readString(metadata.templateId),
    related: normalizeTags(overrides.related || metadata.related),
    confidence: typeof overrides.confidence === 'number' ? overrides.confidence : metadata.confidence,
    tags: normalizeTags(overrides.tags || ['argus', kind]),
    metadata: {
      ...documentMetadata,
      sourceArtifactId,
      kind,
      artifactMetadata: safeJson(documentMetadata),
    },
  };
};

const shouldFallback = (error) => (
  error instanceof ObsidianBridgeError
    ? ['OBSIDIAN_BRIDGE_UNREACHABLE', 'OBSIDIAN_BRIDGE_REQUEST_FAILED'].includes(error.code)
    : true
);

export const createKnowledgeDocument = async (payload, {
  fetchImpl = globalThis.fetch,
  projectRoot = '',
} = {}) => {
  try {
    const result = await sendObsidianDocument(payload, { fetchImpl });
    return {
      success: true,
      destination: 'obsidian',
      path: result.path || '',
      fallbackPath: '',
      obsidian: result,
    };
  } catch (error) {
    const config = readObsidianBridgeConfig({ includeToken: true });
    if (!config.fallbackToProjectKnowledge || !shouldFallback(error)) {
      throw error;
    }
    const fallbackPath = await writeProjectKnowledgeFallback(payload, {
      projectRoot,
      reason: error?.message || 'Obsidian bridge unavailable.',
    });
    return {
      success: true,
      destination: 'fallback',
      path: '',
      fallbackPath,
      error: error?.message || '',
      errorCode: error?.code || 'OBSIDIAN_BRIDGE_ERROR',
    };
  }
};

export const createKnowledgeDocumentFromArtifact = async (artifact, options = {}) => (
  createKnowledgeDocument(documentPayloadFromArtifact(artifact, options), options)
);
