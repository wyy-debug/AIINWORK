import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

const UI_DATA_DIR = process.env.MTL_CODE_UI_DATA_DIR || path.join(os.homedir(), '.mtl-code-ui');
const AGENT_KNOWLEDGE_DIR = process.env.MTL_CODE_AGENT_KNOWLEDGE_DIR || path.join(UI_DATA_DIR, 'agents', 'knowledge');
const MAX_TEXT_BYTES_PER_FILE = 1024 * 1024;
const MAX_CHUNK_CHARS = 1800;
const MAX_CHUNKS_PER_SOURCE = 80;
const MAX_PROMPT_CHARS = 14000;
const MAX_PROMPT_CHUNKS = 8;
const VECTOR_DIMENSIONS = 256;
const VECTOR_MODEL = 'local-hash-v1';

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.mdx',
  '.json',
  '.jsonl',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.sql',
  '.sh',
  '.ps1',
  '.bat',
  '.log',
]);

function nowIso() {
  return new Date().toISOString();
}

function sanitizeSegment(value, fallback = 'item') {
  const text = String(value || '')
    .trim()
    .replace(/[<>:"|?*\x00-\x1f]+/g, '-')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return text || fallback;
}

function sanitizeAgentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeRelativePath(value, fallback) {
  const raw = String(value || fallback || '').replace(/\\/g, '/');
  const parts = raw
    .split('/')
    .map((part) => sanitizeSegment(part))
    .filter(Boolean);
  return parts.length > 0 ? parts.join('/') : sanitizeSegment(fallback || 'file');
}

function isTextLikeFile(fileName, mimeType = '') {
  const extension = path.extname(fileName).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || String(mimeType || '').startsWith('text/');
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tokenizeText(value, limit = 4096) {
  const lower = String(value || '').toLowerCase();
  const latinTerms = lower
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  const cjkTerms = [...lower.matchAll(/[\u4e00-\u9fff]{2,}/g)]
    .map((match) => match[0])
    .flatMap((term) => {
      const grams = [term];
      for (let index = 0; index < Math.min(term.length - 1, 48); index += 1) {
        grams.push(term.slice(index, index + 2));
      }
      return grams;
    });
  return [...latinTerms, ...cjkTerms].slice(0, limit);
}

function createTextEmbedding(value) {
  const tokens = tokenizeText(value);
  const vector = new Array(VECTOR_DIMENSIONS).fill(0);
  if (tokens.length === 0) {
    return vector;
  }

  tokens.forEach((token) => {
    const hash = hashToken(token);
    const index = hash % VECTOR_DIMENSIONS;
    vector[index] += hash & 1 ? 1 : -1;
  });

  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => Number((item / magnitude).toFixed(6)));
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return 0;
  }
  return left.reduce((score, value, index) => score + value * right[index], 0);
}

async function readTextFile(filePath) {
  const stat = await fs.stat(filePath);
  const bytesToRead = Math.min(stat.size, MAX_TEXT_BYTES_PER_FILE);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, 0);
    return buffer.toString('utf8').replace(/\u0000/g, '').trim();
  } finally {
    await handle.close();
  }
}

function chunkText(text, meta) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!normalized) return [];

  const chunks = [];
  let cursor = 0;
  while (cursor < normalized.length && chunks.length < MAX_CHUNKS_PER_SOURCE) {
    const slice = normalized.slice(cursor, cursor + MAX_CHUNK_CHARS);
    const breakAt = slice.lastIndexOf('\n\n');
    const chunkBody = breakAt > 600 ? slice.slice(0, breakAt) : slice;
    chunks.push({
      id: `${meta.sourceId}:${chunks.length + 1}`,
      sourceId: meta.sourceId,
      sourceName: meta.sourceName,
      relativePath: meta.relativePath,
      text: chunkBody.trim(),
      embeddingModel: VECTOR_MODEL,
      embedding: createTextEmbedding(`${meta.sourceName} ${meta.relativePath}\n${chunkBody}`),
    });
    cursor += chunkBody.length;
  }
  return chunks.filter((chunk) => chunk.text);
}

function groupFiles(files, relativePaths, mode) {
  const groups = new Map();

  files.forEach((file, index) => {
    const relativePath = normalizeRelativePath(relativePaths[index] || file.originalname, file.originalname);
    const parts = relativePath.split('/');
    const sourceName = mode === 'folder' ? parts[0] || 'uploaded-folder' : path.basename(relativePath);
    const groupKey = mode === 'folder' ? sourceName : `${sourceName}-${index}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        name: sourceName,
        type: mode === 'folder' ? 'folder' : 'file',
        files: [],
      });
    }

    groups.get(groupKey).files.push({
      file,
      relativePath,
    });
  });

  return [...groups.values()];
}

export function parseRelativePaths(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveAgentKnowledgeFiles(agentId, files, options = {}) {
  const safeAgentId = sanitizeAgentId(agentId);
  if (!safeAgentId) {
    throw new Error('Invalid agent id');
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No knowledge files provided');
  }

  const mode = options.mode === 'folder' ? 'folder' : 'file';
  const relativePaths = Array.isArray(options.relativePaths) ? options.relativePaths : [];
  const agentDir = path.join(AGENT_KNOWLEDGE_DIR, safeAgentId);
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });

  const groups = groupFiles(files, relativePaths, mode);
  const sources = [];

  for (const group of groups) {
    const sourceId = `${Date.now()}-${sanitizeSegment(group.name).toLowerCase()}`;
    const sourceDir = path.join(agentDir, sourceId);
    const filesDir = path.join(sourceDir, 'files');
    await fs.mkdir(filesDir, { recursive: true, mode: 0o700 });

    const indexedFiles = [];
    const chunks = [];

    for (const item of group.files) {
      const targetRelativePath = normalizeRelativePath(item.relativePath, item.file.originalname);
      const targetPath = path.join(filesDir, ...targetRelativePath.split('/'));
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      await fs.copyFile(item.file.path, targetPath);

      const indexedFile = {
        name: path.basename(targetRelativePath),
        relativePath: targetRelativePath,
        size: item.file.size,
        mimeType: item.file.mimetype || '',
        indexed: false,
      };

      if (isTextLikeFile(targetRelativePath, item.file.mimetype)) {
        const text = await readTextFile(targetPath);
        const fileChunks = chunkText(text, {
          sourceId,
          sourceName: group.name,
          relativePath: targetRelativePath,
        });
        chunks.push(...fileChunks);
        indexedFile.indexed = fileChunks.length > 0;
        indexedFile.chunkCount = fileChunks.length;
      }

      indexedFiles.push(indexedFile);
    }

    const status = chunks.length > 0 ? 'indexed' : 'failed';
    const manifest = {
      schemaVersion: 1,
      embeddingModel: VECTOR_MODEL,
      source: {
        id: sourceId,
        type: group.type,
        name: group.name,
        status,
        storageKey: sourceId,
        fileCount: indexedFiles.length,
        chunkCount: chunks.length,
        addedAt: nowIso(),
      },
      files: indexedFiles,
      chunks: chunks.slice(0, MAX_CHUNKS_PER_SOURCE),
      updatedAt: nowIso(),
    };

    await fs.writeFile(path.join(sourceDir, 'index.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    sources.push(manifest.source);
  }

  await Promise.all(
    files.map((file) => fs.unlink(file.path).catch(() => {})),
  );

  return sources;
}

function resolveAgentKnowledgeDir(agentId) {
  const safeAgentId = sanitizeAgentId(agentId);
  if (!safeAgentId) {
    throw new Error('Invalid agent id');
  }
  return path.join(AGENT_KNOWLEDGE_DIR, safeAgentId);
}

function resolveSourceDir(agentId, source) {
  const agentDir = resolveAgentKnowledgeDir(agentId);
  const storageKey = sanitizeSegment(source?.storageKey || source?.id);
  if (!storageKey) {
    throw new Error('Invalid knowledge source id');
  }
  const resolved = path.resolve(agentDir, storageKey);
  const root = path.resolve(agentDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid knowledge source path');
  }
  return resolved;
}

async function readSourceManifest(agentId, source) {
  try {
    const manifestPath = path.join(resolveSourceDir(agentId, source), 'index.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    return manifest && Array.isArray(manifest.chunks) ? manifest : null;
  } catch {
    return null;
  }
}

export async function listAgentKnowledgeSources(agentId, sources = []) {
  const normalizedSources = Array.isArray(sources) ? sources : [];
  const manifests = await Promise.all(normalizedSources.map((source) => readSourceManifest(agentId, source)));

  return normalizedSources.map((source, index) => {
    const manifest = manifests[index];
    if (!manifest) {
      return {
        ...source,
        files: [],
      };
    }
    return {
      ...source,
      ...manifest.source,
      files: Array.isArray(manifest.files) ? manifest.files : [],
      embeddingModel: manifest.embeddingModel || '',
      updatedAt: manifest.updatedAt || source.updatedAt || source.addedAt || '',
    };
  });
}

export async function deleteAgentKnowledgeSource(agentId, source) {
  const sourceDir = resolveSourceDir(agentId, source);
  await fs.rm(sourceDir, { recursive: true, force: true });
}

export async function deleteAgentKnowledge(agentId) {
  const agentDir = resolveAgentKnowledgeDir(agentId);
  await fs.rm(agentDir, { recursive: true, force: true });
}

function resolveStoredFilePath(filesDir, relativePath) {
  const normalized = normalizeRelativePath(relativePath, relativePath);
  const resolved = path.resolve(filesDir, ...normalized.split('/'));
  const root = path.resolve(filesDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid stored knowledge file path');
  }
  return { resolved, normalized };
}

export async function reindexAgentKnowledgeSource(agentId, source) {
  const sourceDir = resolveSourceDir(agentId, source);
  const manifestPath = path.join(sourceDir, 'index.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const filesDir = path.join(sourceDir, 'files');
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const sourceMeta = manifest.source || source || {};
  const sourceId = sourceMeta.id || source.id;
  const sourceName = sourceMeta.name || source.name || 'knowledge';

  const indexedFiles = [];
  const chunks = [];

  for (const file of manifestFiles) {
    const relativePath = file.relativePath || file.name;
    const { resolved, normalized } = resolveStoredFilePath(filesDir, relativePath);
    const stat = await fs.stat(resolved);
    const indexedFile = {
      name: path.basename(normalized),
      relativePath: normalized,
      size: stat.size,
      mimeType: file.mimeType || '',
      indexed: false,
    };

    if (isTextLikeFile(normalized, indexedFile.mimeType)) {
      const text = await readTextFile(resolved);
      const fileChunks = chunkText(text, {
        sourceId,
        sourceName,
        relativePath: normalized,
      });
      chunks.push(...fileChunks);
      indexedFile.indexed = fileChunks.length > 0;
      indexedFile.chunkCount = fileChunks.length;
    }

    indexedFiles.push(indexedFile);
  }

  const nextSource = {
    ...source,
    ...sourceMeta,
    status: chunks.length > 0 ? 'indexed' : 'failed',
    storageKey: sourceMeta.storageKey || source.storageKey || source.id,
    fileCount: indexedFiles.length,
    chunkCount: chunks.length,
    addedAt: sourceMeta.addedAt || source.addedAt || nowIso(),
  };

  const nextManifest = {
    ...manifest,
    schemaVersion: 1,
    embeddingModel: VECTOR_MODEL,
    source: nextSource,
    files: indexedFiles,
    chunks: chunks.slice(0, MAX_CHUNKS_PER_SOURCE),
    updatedAt: nowIso(),
  };

  await fs.writeFile(manifestPath, JSON.stringify(nextManifest, null, 2), { mode: 0o600 });
  return nextSource;
}

function tokenizeQuery(query) {
  return [...new Set(tokenizeText(query, 80))].slice(0, 40);
}

function scoreChunk(chunk, terms, queryEmbedding, fallbackIndex) {
  const haystack = `${chunk.sourceName} ${chunk.relativePath} ${chunk.text}`.toLowerCase();
  const keywordScore = terms.reduce((score, term) => {
    if (!term) return score;
    const firstMatch = haystack.indexOf(term);
    if (firstMatch < 0) return score;
    const exactBoost = haystack.includes(` ${term} `) ? 2 : 1;
    return score + exactBoost + Math.max(0, 1 - firstMatch / 10000);
  }, 0);
  const chunkEmbedding = Array.isArray(chunk.embedding)
    ? chunk.embedding
    : createTextEmbedding(`${chunk.sourceName} ${chunk.relativePath}\n${chunk.text}`);
  const vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, chunkEmbedding)) * 6;

  if (terms.length === 0) {
    return vectorScore + Math.max(0.01, 1 - fallbackIndex / 1000);
  }

  return keywordScore + vectorScore;
}

export async function buildAgentKnowledgeContext(agent, query = '', options = {}) {
  const sources = Array.isArray(agent?.knowledgeSources)
    ? agent.knowledgeSources.filter((source) => source.status === 'indexed')
    : [];
  if (!agent?.id || sources.length === 0) {
    return { prompt: '', excerptCount: 0, promptLength: 0, excerpts: [] };
  }

  const manifests = await Promise.all(sources.map((source) => readSourceManifest(agent.id, source)));
  const chunks = manifests
    .filter(Boolean)
    .flatMap((manifest) => manifest.chunks || []);

  if (chunks.length === 0) {
    return { prompt: '', excerptCount: 0, promptLength: 0, excerpts: [] };
  }

  const terms = tokenizeQuery(query);
  const queryEmbedding = createTextEmbedding(query || terms.join(' '));
  const ranked = chunks
    .map((chunk, index) => ({
      chunk,
      score: scoreChunk(chunk, terms, queryEmbedding, index),
    }))
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, options.maxChunks || MAX_PROMPT_CHUNKS);

  if (ranked.length === 0) {
    return { prompt: '', excerptCount: 0, promptLength: 0, excerpts: [] };
  }

  const lines = [
    `Agent RAG knowledge excerpts from uploaded files (${VECTOR_MODEL} retrieval):`,
    'Use these excerpts as private reference material for this Agent. If the excerpts are insufficient, say what is missing instead of inventing details.',
    'When answering from this material, mention the source label such as [K1] when useful.',
  ];
  let charBudget = options.maxChars || MAX_PROMPT_CHARS;

  const excerpts = [];
  ranked.forEach((entry, index) => {
    if (charBudget <= 0) return;
    const { chunk } = entry;
    const header = `\n[K${index + 1}] ${chunk.sourceName} / ${chunk.relativePath}`;
    const text = chunk.text.slice(0, Math.max(0, charBudget - header.length));
    if (!text.trim()) return;
    lines.push(header, text);
    excerpts.push({
      label: `K${index + 1}`,
      sourceName: chunk.sourceName,
      relativePath: chunk.relativePath,
      score: Number(entry.score.toFixed(4)),
      chars: text.length,
    });
    charBudget -= header.length + text.length;
  });

  const prompt = lines.join('\n');
  return {
    prompt,
    excerptCount: excerpts.length,
    promptLength: prompt.length,
    excerpts,
  };
}

export async function buildAgentKnowledgePrompt(agent, query = '', options = {}) {
  return (await buildAgentKnowledgeContext(agent, query, options)).prompt;
}
