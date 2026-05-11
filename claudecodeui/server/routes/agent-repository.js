import fs, { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import express from 'express';

import { providerMcpService } from '../modules/providers/services/mcp.service.js';
import {
  normalizeAgentTemplateDependencies,
  normalizeAgentTemplateDialogs,
  normalizeAgentTemplateManifest,
  normalizeTemplatePackageFiles,
} from '../services/agent-template-manifest-service.js';
import { normalizeSwarmTemplateManifest } from '../services/swarm-template-manifest-service.js';
import {
  exportSwarmTemplatePackage,
  importSwarmTemplatePackage,
  resolveSwarmRoleBindings,
} from '../services/swarm-template-package-service.js';
import { resolveAgentTemplateDependencies } from '../services/agent-repository-dependency-resolver-service.js';
import { listInstalledSkills } from '../services/agent-skill-service.js';
import { readMtlCodeModelSettings, readStoredModelProfiles } from '../services/mtl-code-model-service.js';
import {
  exportClaudeCodeAgentMarkdown,
  parseClaudeCodeAgentMarkdown,
} from '../services/claude-code-agent-compat-service.js';

const router = express.Router();

const UI_DATA_DIR = path.join(os.homedir(), '.mtl-code-ui');
const REPOSITORY_ROOT = process.env.MTL_CODE_AGENT_REPOSITORY_DIR
  || path.join(UI_DATA_DIR, 'agent-repository');
const LOCAL_REPOSITORY_ID = 'local';
const LOCAL_REPOSITORY_DIR = path.join(REPOSITORY_ROOT, 'local');
const LOCAL_CATALOG_PATH = path.join(LOCAL_REPOSITORY_DIR, 'catalog.json');
const SOURCES_PATH = path.join(REPOSITORY_ROOT, 'sources.json');
const LIKES_PATH = path.join(REPOSITORY_ROOT, 'likes.json');
const MAX_REMOTE_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_FILES = 200;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;

const DEFAULT_SOURCE = {
  id: LOCAL_REPOSITORY_ID,
  name: 'Local Remote Repository',
  type: 'local',
  enabled: true,
  writable: true,
};

function nowIso() {
  return new Date().toISOString();
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

function createEmptyCatalog() {
  return {
    schemaVersion: 1,
    name: 'Argus Agent Repository',
    description: 'Shared prompt templates and skills for Argus.',
    updatedAt: nowIso(),
    items: [],
  };
}

function readJsonSync(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    // Corrupt local state should not make settings unusable.
  }
  return fallback;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function ensureLocalRepository() {
  ensureDirSync(LOCAL_REPOSITORY_DIR);
  if (!fs.existsSync(LOCAL_CATALOG_PATH)) {
    fs.writeFileSync(LOCAL_CATALOG_PATH, JSON.stringify(createEmptyCatalog(), null, 2), { mode: 0o600 });
  }
  if (!fs.existsSync(SOURCES_PATH)) {
    fs.writeFileSync(SOURCES_PATH, JSON.stringify({ schemaVersion: 1, sources: [] }, null, 2), { mode: 0o600 });
  }
}

function readSources() {
  ensureLocalRepository();
  const payload = readJsonSync(SOURCES_PATH, { schemaVersion: 1, sources: [] });
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const byId = new Map();
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    if (!source.id || typeof source.id !== 'string') continue;
    if (source.id === LOCAL_REPOSITORY_ID || source.type === 'local') continue;
    byId.set(source.id, {
      ...source,
      enabled: source.enabled !== false,
      writable: Boolean(source.writable),
    });
  }
  return {
    schemaVersion: 1,
    sources: Array.from(byId.values()),
  };
}

async function saveSources(sources) {
  const normalized = sources
    .filter((source) => source && source.id !== LOCAL_REPOSITORY_ID && source.type !== 'local')
    .map((source) => ({
      ...source,
      enabled: source.enabled !== false,
      writable: Boolean(source.writable),
    }));
  await writeJson(SOURCES_PATH, { schemaVersion: 1, sources: normalized });
}

async function readLocalCatalog() {
  ensureLocalRepository();
  const catalog = await readJson(LOCAL_CATALOG_PATH, createEmptyCatalog());
  return {
    ...createEmptyCatalog(),
    ...catalog,
    items: Array.isArray(catalog.items) ? catalog.items : [],
  };
}

async function saveLocalCatalog(catalog) {
  await writeJson(LOCAL_CATALOG_PATH, {
    ...catalog,
    schemaVersion: 1,
    updatedAt: nowIso(),
    items: Array.isArray(catalog.items) ? catalog.items : [],
  });
}

function readLikes() {
  const payload = readJsonSync(LIKES_PATH, { liked: {}, overlays: {} });
  return {
    liked: payload && typeof payload.liked === 'object' ? payload.liked : {},
    overlays: payload && typeof payload.overlays === 'object' ? payload.overlays : {},
  };
}

async function saveLikes(likes) {
  await writeJson(LIKES_PATH, likes);
}

function sanitizeSlug(input, fallback = 'item') {
  const slug = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function validateSlug(slug) {
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(slug);
}

function normalizeKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  if (value === 'skill' || value === 'skills') return 'skill';
  if (value === 'mcp' || value === 'mcps' || value === 'mcp-server' || value === 'mcp_servers' || value === 'mcp-server-template') {
    return 'mcp-server';
  }
  if (value === 'agent' || value === 'agents' || value === 'template' || value === 'agent-template') {
    return 'agent-template';
  }
  if (value === 'swarm' || value === 'swarms' || value === 'swarm-template') {
    return 'swarm-template';
  }
  return null;
}

function getPublicItemId(kind, slug) {
  return `${kind}-${slug}`;
}

function getRawItemSlug(rawItem) {
  return sanitizeSlug(rawItem.id || rawItem.name || rawItem.slug || rawItem.title);
}

function publicKindLabel(kind) {
  if (kind === 'skill') return 'Skill';
  if (kind === 'mcp-server') return 'MCP Server';
  if (kind === 'swarm-template') return 'Swarm Template';
  return 'Agent Template';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeInstallName(value) {
  return sanitizeSlug(value)
    .replace(/^(agent-template|skill|mcp-server)-/, '')
    .replace(/^mcp-/, '')
    .replace(/^skill-/, '');
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => typeof entry[0] === 'string' && typeof entry[1] === 'string'),
  );
}

function omitUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function normalizeMcpField(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const key = String(entry.key || entry.name || '').trim();
  if (!key) return null;
  const type = String(entry.type || 'text').trim().toLowerCase();
  const target = String(entry.target || entry.scope || 'env').trim().toLowerCase();
  return {
    key,
    label: String(entry.label || key).trim(),
    type: ['text', 'password', 'path', 'path-list', 'number', 'select', 'boolean'].includes(type) ? type : 'text',
    target: ['env', 'arg', 'args', 'cwd', 'url', 'header', 'tool-argument', 'metadata'].includes(target) ? target : 'env',
    required: Boolean(entry.required),
    placeholder: typeof entry.placeholder === 'string' ? entry.placeholder : '',
    description: typeof entry.description === 'string' ? entry.description : '',
    defaultValue: typeof entry.defaultValue === 'string'
      ? entry.defaultValue
      : typeof entry.default === 'string'
        ? entry.default
        : '',
    options: normalizeStringArray(entry.options),
  };
}

function normalizeMcpDefinition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const transport = String(value.transport || value.type || 'stdio').trim().toLowerCase();
  const setupFields = Array.isArray(value.setupFields || value.configuration || value.configSchema)
    ? (value.setupFields || value.configuration || value.configSchema).map(normalizeMcpField).filter(Boolean)
    : [];
  const runtimeFields = Array.isArray(value.runtimeFields || value.toolInputs)
    ? (value.runtimeFields || value.toolInputs).map(normalizeMcpField).filter(Boolean)
    : [];
  const tools = Array.isArray(value.tools)
    ? value.tools
      .map((tool) => {
        if (typeof tool === 'string') return { name: tool, description: '' };
        if (!tool || typeof tool !== 'object') return null;
        const name = String(tool.name || '').trim();
        if (!name) return null;
        return {
          name,
          description: typeof tool.description === 'string' ? tool.description : '',
        };
      })
      .filter(Boolean)
    : [];
  return {
    serverName: String(value.serverName || value.name || '').trim(),
    transport: ['stdio', 'http', 'sse'].includes(transport) ? transport : 'stdio',
    command: typeof value.command === 'string' ? value.command.trim() : '',
    args: normalizeStringArray(value.args),
    env: normalizeRecord(value.env),
    cwd: typeof value.cwd === 'string' ? value.cwd.trim() : '',
    url: typeof value.url === 'string' ? value.url.trim() : '',
    headers: normalizeRecord(value.headers),
    setupFields,
    runtimeFields,
    tools,
    postInstall: value.postInstall && typeof value.postInstall === 'object'
      ? {
          type: typeof value.postInstall.type === 'string' ? value.postInstall.type.trim() : '',
          command: typeof value.postInstall.command === 'string' ? value.postInstall.command.trim() : '',
          args: normalizeStringArray(value.postInstall.args),
        }
      : typeof value.postInstall === 'string'
        ? { type: value.postInstall, command: '', args: [] }
        : null,
  };
}

function normalizeSupportedApps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        const label = entry.trim();
        return label ? { id: sanitizeSlug(label), label } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const label = String(entry.label || entry.name || entry.id || '').trim();
      if (!label) return null;
      return {
        id: sanitizeSlug(entry.id || entry.name || label),
        label,
        icon: typeof entry.icon === 'string' ? entry.icon : undefined,
        category: typeof entry.category === 'string' ? entry.category : undefined,
      };
    })
    .filter(Boolean)
    .slice(0, 32);
}

function normalizeAppSlots(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const label = String(entry.label || entry.name || entry.id || '').trim();
      if (!label) return null;
      return {
        id: sanitizeSlug(entry.id || entry.name || label),
        label,
        placeholder: typeof entry.placeholder === 'string' ? entry.placeholder : 'Add application',
        required: Boolean(entry.required),
        options: normalizeSupportedApps(entry.options),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function safeRelativePath(input) {
  const value = String(input || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function normalizePackageFiles(value, { requireSkillMd = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    if (requireSkillMd) throw new Error('skill package must include SKILL.md');
    return [];
  }
  if (value.length > MAX_PACKAGE_FILES) {
    throw new Error(`skill package can include at most ${MAX_PACKAGE_FILES} files`);
  }

  const files = [];
  const seen = new Set();
  let totalBytes = 0;

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const relativePath = safeRelativePath(entry.path || entry.name);
    if (!relativePath || relativePath.endsWith('/')) {
      throw new Error('skill package contains an invalid file path');
    }
    const key = relativePath.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`skill package contains duplicate file path: ${relativePath}`);
    }
    seen.add(key);

    const encoding = entry.encoding === 'base64' ? 'base64' : 'utf8';
    if (typeof entry.content !== 'string') {
      throw new Error(`skill package file ${relativePath} is missing content`);
    }
    const buffer = Buffer.from(entry.content, encoding);
    totalBytes += buffer.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`skill package is too large; maximum is ${Math.round(MAX_PACKAGE_BYTES / 1024 / 1024)}MB`);
    }

    files.push({
      path: relativePath,
      buffer,
      size: buffer.length,
    });
  }

  if (files.length === 0) {
    throw new Error('skill package must include at least one file');
  }
  if (requireSkillMd && !files.some((file) => file.path.toLowerCase() === 'skill.md')) {
    throw new Error('skill package must include SKILL.md at the package root');
  }

  return files;
}

function resolveLocalContentPath(contentPath) {
  const safePath = safeRelativePath(contentPath);
  if (!safePath) return null;
  const resolved = path.resolve(LOCAL_REPOSITORY_DIR, safePath);
  const localRoot = path.resolve(LOCAL_REPOSITORY_DIR);
  if (resolved !== localRoot && !resolved.startsWith(localRoot + path.sep)) {
    return null;
  }
  return resolved;
}

function escapeYamlDoubleQuoted(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n');
}

function formatAgentTemplateMarkdown({ name, description, prompt, tools, model, color }) {
  const lines = [
    '---',
    `name: ${name}`,
    `description: "${escapeYamlDoubleQuoted(description || 'Custom agent template')}"`,
  ];
  if (Array.isArray(tools) && tools.length > 0) {
    lines.push(`tools: ${tools.join(', ')}`);
  }
  if (model) {
    lines.push(`model: ${String(model).trim()}`);
  }
  if (color) {
    lines.push(`color: ${String(color).trim()}`);
  }
  lines.push('---', '', String(prompt || '').trim(), '');
  return lines.join('\n');
}

function formatSkillMarkdown({ name, title, description, content }) {
  const trimmed = String(content || '').trim();
  if (trimmed.startsWith('---')) {
    return `${trimmed}\n`;
  }
  return [
    '---',
    `name: ${name}`,
    `description: "${escapeYamlDoubleQuoted(description || title || 'Custom skill')}"`,
    '---',
    '',
    trimmed,
    '',
  ].join('\n');
}

function extractItems(catalog) {
  const items = [];
  if (Array.isArray(catalog?.items)) {
    items.push(...catalog.items);
  }
  if (Array.isArray(catalog?.agents)) {
    items.push(...catalog.agents.map((item) => ({ ...item, kind: item.kind || 'agent-template' })));
  }
  if (Array.isArray(catalog?.templates)) {
    items.push(...catalog.templates.map((item) => ({ ...item, kind: item.kind || 'agent-template' })));
  }
  if (Array.isArray(catalog?.skills)) {
    items.push(...catalog.skills.map((item) => ({ ...item, kind: item.kind || 'skill' })));
  }
  if (Array.isArray(catalog?.mcpServers)) {
    items.push(...catalog.mcpServers.map((item) => ({ ...item, kind: item.kind || 'mcp-server' })));
  }
  if (Array.isArray(catalog?.mcps)) {
    items.push(...catalog.mcps.map((item) => ({ ...item, kind: item.kind || 'mcp-server' })));
  }
  return items;
}

function resolveRemoteUrl(baseUrl, candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

function deriveRemoteHubAdminItemsUrl(catalogUrl) {
  const url = new URL(catalogUrl);
  url.pathname = '/api/agent-repository-server/items';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function normalizeCatalogPackageFiles(rawItem, source) {
  const rawFiles = Array.isArray(rawItem.packageFiles)
    ? rawItem.packageFiles
    : Array.isArray(rawItem.files)
      ? rawItem.files
      : [];
  return rawFiles
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const relativePath = safeRelativePath(entry.path || entry.name);
      if (!relativePath) return null;

      const contentPath = entry.contentPath || entry.path || null;
      let contentUrl = entry.contentUrl || entry.url || null;
      if (source.type === 'local') {
        const localPath = contentPath ? safeRelativePath(contentPath) : null;
        if (!localPath) return null;
        contentUrl = `/api/agent-repository/local/content?path=${encodeURIComponent(localPath)}`;
        return {
          path: relativePath,
          size: Number(entry.size || 0),
          contentPath: localPath,
          contentUrl,
        };
      }

      if (source.url && contentUrl) {
        contentUrl = resolveRemoteUrl(source.url, contentUrl);
      }
      if (!contentUrl) return null;
      return {
        path: relativePath,
        size: Number(entry.size || 0),
        contentUrl,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PACKAGE_FILES);
}

function mergeDependencyGroups(...groups) {
  const merged = { skills: [], mcpServers: [], modelProfiles: [] };
  const seen = new Set();
  const add = (dependency, key) => {
    if (!dependency || typeof dependency !== 'object') return;
    const name = dependency.name || dependency.itemId || dependency.id;
    const identity = `${dependency.kind || key}:${dependency.repoId || ''}:${dependency.itemId || dependency.id || name}:${Boolean(dependency.optional)}`.toLowerCase();
    if (!name || seen.has(identity)) return;
    seen.add(identity);
    merged[key].push(dependency);
  };
  for (const group of groups) {
    const normalized = normalizeAgentTemplateDependencies(group);
    for (const dependency of normalized.skills) add(dependency, 'skills');
    for (const dependency of normalized.mcpServers) add(dependency, 'mcpServers');
    for (const dependency of normalized.modelProfiles) add(dependency, 'modelProfiles');
  }
  return merged;
}

function likeKey(repoId, itemId) {
  return `${repoId}:${itemId}`;
}

function normalizeCatalogItem(rawItem, source, catalog, likesState) {
  const kind = normalizeKind(rawItem.kind || rawItem.type);
  if (!kind) return null;

  const slug = getRawItemSlug(rawItem);
  if (!validateSlug(slug)) return null;
  const id = getPublicItemId(kind, slug);

  const key = likeKey(source.id, id);
  const overlayLikes = Number(likesState.overlays[key] || 0);
  const likes = Math.max(0, Number(rawItem.likes || 0) + overlayLikes);

  let contentUrl = rawItem.contentUrl || rawItem.url || null;
  const contentPath = rawItem.contentPath || rawItem.path || null;
  if (source.type === 'local' && !contentUrl && contentPath) {
    contentUrl = `/api/agent-repository/local/content?path=${encodeURIComponent(contentPath)}`;
  } else if (source.url && contentUrl) {
    contentUrl = resolveRemoteUrl(source.url, contentUrl);
  }

  const likeUrl = rawItem.likeUrl && source.url
    ? resolveRemoteUrl(source.url, rawItem.likeUrl)
    : rawItem.likeUrl || null;
  const packageFiles = kind === 'skill' || kind === 'mcp-server' || kind === 'agent-template' || kind === 'swarm-template'
    ? normalizeCatalogPackageFiles(rawItem, source)
    : [];
  const templateManifest = kind === 'agent-template'
    ? normalizeAgentTemplateManifest(rawItem.manifest && typeof rawItem.manifest === 'object' ? rawItem.manifest : rawItem, {
        id: rawItem.id || rawItem.name || slug,
        version: rawItem.version || '1.0.0',
      })
    : null;
  const swarmManifest = kind === 'swarm-template'
    ? normalizeSwarmTemplateManifest(rawItem.manifest && typeof rawItem.manifest === 'object' ? rawItem.manifest : rawItem, {
        id: rawItem.id || rawItem.name || slug,
        version: rawItem.version || '1.0.0',
      })
    : null;
  const swarmDependencies = swarmManifest
    ? mergeDependencyGroups(swarmManifest.dependencies, ...swarmManifest.roles.map((role) => role.dependencies))
    : null;

  return {
    id,
    kind,
    name: rawItem.name || slug,
    title: rawItem.title || rawItem.displayName || rawItem.name || slug,
    description: rawItem.description || '',
    author: rawItem.author || catalog?.author || '',
    version: rawItem.version || '1.0.0',
    tags: Array.isArray(rawItem.tags) ? rawItem.tags.filter((tag) => typeof tag === 'string') : [],
    icon: typeof rawItem.icon === 'string' ? rawItem.icon : null,
    supportedApps: normalizeSupportedApps(rawItem.supportedApps || rawItem.apps || rawItem.integrations),
    appSlots: normalizeAppSlots(rawItem.appSlots || rawItem.setupSlots || rawItem.applicationSlots),
    capabilities: normalizeStringArray(rawItem.capabilities || rawItem.features),
    ...(kind === 'agent-template'
      ? {
          packageId: templateManifest.id,
          packageVersion: templateManifest.version,
          runtime: templateManifest.runtime,
          dependencies: templateManifest.dependencies,
          dialogs: templateManifest.dialogs,
          examples: templateManifest.examples,
          compat: templateManifest.compat,
        }
      : {}),
    ...(kind === 'swarm-template'
      ? {
          packageId: swarmManifest.id,
          packageVersion: swarmManifest.version,
          topology: swarmManifest.topology,
          roles: swarmManifest.roles,
          routing: swarmManifest.routing,
          bus: swarmManifest.bus,
          memory: swarmManifest.memory,
          policies: swarmManifest.policies,
          dependencies: swarmDependencies,
          dialogs: swarmManifest.dialogs,
          examples: swarmManifest.examples,
          compat: swarmManifest.compat,
        }
      : {}),
    ...(kind === 'mcp-server' ? { mcp: normalizeMcpDefinition(rawItem.mcp || rawItem.mcpServer || rawItem.runtime) } : {}),
    likes,
    liked: Boolean(likesState.liked[key]),
    downloads: Number(rawItem.downloads || rawItem.downloadCount || 0),
    createdAt: rawItem.createdAt || null,
    updatedAt: rawItem.updatedAt || catalog?.updatedAt || null,
    repoId: source.id,
    repoName: source.name,
    repoWritable: Boolean(source.writable),
    contentUrl,
    contentPath: source.type === 'local' ? contentPath : null,
    packageFiles,
    inlineContent: typeof rawItem.content === 'string' ? rawItem.content : null,
    likeUrl,
    sourceUrl: source.url || null,
  };
}

async function fetchText(url, label = 'remote resource') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REMOTE_TEXT_BYTES) {
      throw new Error(`${label} is too large`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_REMOTE_TEXT_BYTES) {
      throw new Error(`${label} is too large`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinary(url, label = 'remote file') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_PACKAGE_BYTES) {
      throw new Error(`${label} is too large`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_PACKAGE_BYTES) {
      throw new Error(`${label} is too large`);
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteCatalog(source) {
  if (!source.url || typeof source.url !== 'string') {
    throw new Error('Remote source URL is required');
  }
  const raw = await fetchText(source.url, `Repository ${source.name || source.id}`);
  return JSON.parse(raw);
}

async function loadCatalogs() {
  const { sources } = readSources();
  const likesState = readLikes();
  const repositories = [];
  const items = [];
  const errors = [];

  for (const source of sources) {
    if (source.enabled === false) {
      repositories.push({
        id: source.id,
        name: source.name || source.id,
        type: source.type || 'remote',
        url: source.url || (source.type === 'local' ? '/api/agent-repository/local/catalog' : null),
        enabled: false,
        writable: Boolean(source.writable),
        description: '',
        updatedAt: null,
        itemCount: 0,
      });
      continue;
    }
    try {
      const catalog = source.type === 'local'
        ? await readLocalCatalog()
        : await fetchRemoteCatalog(source);
      const normalizedSource = {
        id: source.id,
        name: source.name || catalog.name || source.id,
        type: source.type || 'remote',
        url: source.url || (source.type === 'local' ? '/api/agent-repository/local/catalog' : null),
        enabled: source.enabled !== false,
        writable: Boolean(source.writable),
      };
      repositories.push({
        ...normalizedSource,
        description: catalog.description || '',
        updatedAt: catalog.updatedAt || null,
        itemCount: extractItems(catalog).length,
      });
      for (const rawItem of extractItems(catalog)) {
        const item = normalizeCatalogItem(rawItem, normalizedSource, catalog, likesState);
        if (item) items.push(item);
      }
    } catch (error) {
      errors.push({
        repoId: source.id,
        repoName: source.name || source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  items.sort((a, b) => {
    if (b.likes !== a.likes) return b.likes - a.likes;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });

  return {
    repositories,
    items,
    errors,
  };
}

async function findPublicItem(repoId, itemId) {
  const catalog = await loadCatalogs();
  return catalog.items.find((item) => item.repoId === repoId && item.id === itemId) || null;
}

async function readItemContent(item) {
  if (item.inlineContent) {
    return item.inlineContent;
  }
  if (item.repoId === LOCAL_REPOSITORY_ID) {
    const contentPath = item.contentPath || item.contentUrl;
    const resolved = resolveLocalContentPath(contentPath);
    if (!resolved) {
      throw new Error('Invalid local content path');
    }
    return await fsp.readFile(resolved, 'utf8');
  }
  if (item.contentUrl) {
    return await fetchText(item.contentUrl, `${publicKindLabel(item.kind)} ${item.title}`);
  }
  throw new Error('Item does not provide content');
}

async function readItemPackageFiles(item) {
  if (!['skill', 'mcp-server', 'agent-template', 'swarm-template'].includes(item.kind) || !Array.isArray(item.packageFiles) || item.packageFiles.length === 0) {
    return [];
  }

  const files = [];
  let totalBytes = 0;
  for (const packageFile of item.packageFiles) {
    const relativePath = safeRelativePath(packageFile.path);
    if (!relativePath) {
      throw new Error(`${publicKindLabel(item.kind)} package contains an invalid file path`);
    }

    let buffer;
    if (item.repoId === LOCAL_REPOSITORY_ID) {
      const resolved = resolveLocalContentPath(packageFile.contentPath);
      if (!resolved) {
        throw new Error(`Invalid local package file path: ${relativePath}`);
      }
      buffer = await fsp.readFile(resolved);
    } else if (packageFile.contentUrl) {
      buffer = await fetchBinary(packageFile.contentUrl, `Skill file ${relativePath}`);
    } else {
      throw new Error(`Skill package file ${relativePath} does not provide content`);
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`${publicKindLabel(item.kind)} package is too large; maximum is ${Math.round(MAX_PACKAGE_BYTES / 1024 / 1024)}MB`);
    }
    files.push({ path: relativePath, buffer, size: buffer.length });
  }

  if (item.kind === 'skill' && !files.some((file) => file.path.toLowerCase() === 'skill.md')) {
    throw new Error('skill package must include SKILL.md at the package root');
  }
  return files;
}

function normalizeAppBindings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const bindings = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') continue;
    const slot = sanitizeSlug(key);
    const app = entry.trim();
    if (slot && app) {
      bindings[slot] = app.slice(0, 120);
    }
  }
  return bindings;
}

function applyAgentConfiguration(content, configuration) {
  if (!configuration || typeof configuration !== 'object') return content;
  const appBindings = normalizeAppBindings(configuration.appBindings);
  const bindingEntries = Object.entries(appBindings);
  if (bindingEntries.length === 0) return content;

  const lines = [
    '',
    '## Configured applications',
    '',
    'Use these selected applications when the matching MCP server, connector, or tool is available. If an application is not connected in the current workspace, ask the user to connect or confirm an alternative before taking action.',
    '',
    ...bindingEntries.map(([slot, app]) => `- ${slot}: ${app}`),
    '',
  ];
  return `${String(content || '').trimEnd()}\n${lines.join('\n')}`;
}

function applyMcpTemplate(value, replacements) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\$\{installDir\}/g, replacements.installDir)
    .replace(/\$\{installPath\}/g, replacements.installDir)
    .replace(/\$\{projectPath\}/g, replacements.projectPath || '')
    .replace(/\$\{workspacePath\}/g, replacements.projectPath || '');
}

function normalizeMcpValues(configuration) {
  if (!configuration || typeof configuration !== 'object') return {};
  const source = configuration.mcpValues && typeof configuration.mcpValues === 'object'
    ? configuration.mcpValues
    : configuration;
  return normalizeRecord(source);
}

function buildMcpServerPayload(item, installDir, target, projectPath, configuration) {
  const mcp = item.mcp || {};
  const serverName = sanitizeSlug(mcp.serverName || item.name || item.id, 'mcp-server');
  const transport = ['stdio', 'http', 'sse'].includes(mcp.transport) ? mcp.transport : 'stdio';
  const replacements = { installDir, projectPath: projectPath || '' };
  const values = normalizeMcpValues(configuration);
  const setupFields = Array.isArray(mcp.setupFields) ? mcp.setupFields : [];
  const env = {};
  for (const [key, value] of Object.entries(mcp.env || {})) {
    env[key] = applyMcpTemplate(value, replacements);
  }
  const headers = {};
  for (const [key, value] of Object.entries(mcp.headers || {})) {
    headers[key] = applyMcpTemplate(value, replacements);
  }

  let command = applyMcpTemplate(mcp.command || '', replacements);
  let args = Array.isArray(mcp.args) ? mcp.args.map((arg) => applyMcpTemplate(arg, replacements)) : [];
  let cwd = applyMcpTemplate(mcp.cwd || installDir, replacements);
  let url = applyMcpTemplate(mcp.url || '', replacements);

  for (const field of setupFields) {
    const key = String(field.key || '').trim();
    if (!key) continue;
    const value = values[key] || field.defaultValue || '';
    if (field.required && !String(value).trim()) {
      throw new Error(`MCP configuration "${field.label || key}" is required`);
    }
    if (!String(value).trim()) continue;
    if (field.target === 'arg' || field.target === 'args') {
      args.push(applyMcpTemplate(value, replacements));
    } else if (field.target === 'cwd') {
      cwd = applyMcpTemplate(value, replacements);
    } else if (field.target === 'url') {
      url = applyMcpTemplate(value, replacements);
    } else if (field.target === 'header') {
      headers[key] = applyMcpTemplate(value, replacements);
    } else if (field.target !== 'tool-argument' && field.target !== 'metadata') {
      env[key] = applyMcpTemplate(value, replacements);
    }
  }

  return {
    name: serverName,
    scope: target === 'project' ? 'project' : 'user',
    workspacePath: target === 'project' ? projectPath : undefined,
    transport,
    command,
    args,
    env,
    cwd,
    url,
    headers,
  };
}

function quoteWindowsShellArg(value) {
  const text = String(value);
  if (!/[ \t\n\v"]/.test(text)) return text;
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, '$&$&')}"`;
}

function normalizeSpawnCommand(command, args) {
  if (
    process.platform === 'win32'
    && /\.(?:cmd|bat)$/i.test(String(command || '').trim())
  ) {
    const shell = process.env.ComSpec || 'cmd.exe';
    return {
      command: shell,
      args: ['/d', '/s', '/c', [command, ...args].map(quoteWindowsShellArg).join(' ')],
    };
  }
  return { command, args };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      const normalized = normalizeSpawnCommand(command, Array.isArray(args) ? args : []);
      child = spawn(normalized.command, normalized.args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env || {}) },
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({ code: -1, stdout, stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      finish({ code: -1, stdout, stderr: `${stderr}${stderr ? '\n' : ''}Command timed out` });
    }, options.timeoutMs || 120_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ code: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function runMcpPostInstallIfNeeded(item, installDir) {
  const postInstall = item.mcp?.postInstall;
  const wantsNpmInstall = postInstall?.type === 'npm-install'
    || postInstall?.type === 'npm'
    || item.mcp?.npmInstall === true;
  if (!wantsNpmInstall) return null;
  const packageJsonPath = path.join(installDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;
  const command = String(postInstall?.command || '').trim()
    || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = Array.isArray(postInstall?.args) && postInstall.args.length > 0
    ? postInstall.args
    : ['install', '--omit=dev', '--ignore-scripts'];
  const result = await runProcess(command, args, { cwd: installDir, timeoutMs: 180_000 });
  if (result.code !== 0) {
    throw new Error(`MCP package post-install failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  return { command, args, stdout: result.stdout, stderr: result.stderr };
}

function getMtlCodeConfigDir() {
  return process.env.MTL_CODE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
}

function getMcpInstallBase(target, projectPath) {
  if (target === 'project') {
    if (!projectPath || typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
      throw new Error('Project install requires an absolute projectPath');
    }
    return path.join(path.resolve(projectPath), '.mtl-code', 'mcp-servers');
  }
  return path.join(getMtlCodeConfigDir(), 'mcp-servers');
}

function getSwarmTemplateInstallBase(target, projectPath) {
  if (target === 'project') {
    if (!projectPath || typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
      throw new Error('Project install requires an absolute projectPath');
    }
    return path.join(path.resolve(projectPath), '.mtl-code', 'swarm-templates');
  }
  return path.join(getMtlCodeConfigDir(), 'swarm-templates');
}

function resolveInstallTarget(kind, name, target, projectPath) {
  const safeName = sanitizeSlug(name);
  if (!validateSlug(safeName)) {
    throw new Error('Invalid item name');
  }
  if (target === 'project') {
    if (!projectPath || typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
      throw new Error('Project install requires an absolute projectPath');
    }
    const projectRoot = path.resolve(projectPath);
    if (kind === 'skill') {
      return path.join(projectRoot, '.claude', 'skills', safeName, 'SKILL.md');
    }
    if (kind === 'mcp-server') {
      return path.join(getMcpInstallBase(target, projectPath), safeName);
    }
    if (kind === 'swarm-template') {
      return path.join(getSwarmTemplateInstallBase(target, projectPath), `${safeName}.json`);
    }
    return path.join(projectRoot, '.claude', 'agents', `${safeName}.md`);
  }
  const home = getMtlCodeConfigDir();
  if (kind === 'skill') {
    return path.join(home, 'skills', safeName, 'SKILL.md');
  }
  if (kind === 'mcp-server') {
    return path.join(getMcpInstallBase(target, projectPath), safeName);
  }
  if (kind === 'swarm-template') {
    return path.join(getSwarmTemplateInstallBase(target, projectPath), `${safeName}.json`);
  }
  return path.join(home, 'agents', `${safeName}.md`);
}

async function writeInstallFile(filePath, content, overwrite) {
  await ensureDir(path.dirname(filePath));
  const flag = overwrite ? 'w' : 'wx';
  await fsp.writeFile(filePath, content, { flag, mode: 0o600 });
}

function assertInstallPathSafe(targetPath, target = 'user', projectPath = '', kind = '') {
  const resolved = path.resolve(targetPath);
  const base = target === 'project'
    ? kind === 'mcp-server' || kind === 'swarm-template'
      ? path.resolve(projectPath, '.mtl-code')
      : path.resolve(projectPath, '.claude')
    : path.resolve(getMtlCodeConfigDir());
  if (resolved === base || resolved.startsWith(base + path.sep)) {
    return resolved;
  }
  throw new Error('Install target is outside the allowed install directory');
}

async function writeInstallPackage(targetDir, files, overwrite, { target = 'user', projectPath = '', kind = 'skill' } = {}) {
  const root = path.resolve(targetDir);
  assertInstallPathSafe(root, target, projectPath, kind);
  if (overwrite) {
    await fsp.rm(root, { recursive: true, force: true });
  }
  await ensureDir(root);

  if (!overwrite) {
    for (const file of files) {
      const relativePath = safeRelativePath(file.path);
      if (!relativePath) throw new Error('Invalid package file path');
      const targetPath = path.resolve(root, ...relativePath.split('/'));
      if (targetPath !== root && !targetPath.startsWith(root + path.sep)) {
        throw new Error('Invalid package file path');
      }
      if (fs.existsSync(targetPath)) {
        const error = new Error(`Install target already exists: ${relativePath}`);
        error.code = 'EEXIST';
        error.relativePath = relativePath;
        error.installPath = root;
        throw error;
      }
    }
  }

  for (const file of files) {
    const relativePath = safeRelativePath(file.path);
    const targetPath = path.resolve(root, ...relativePath.split('/'));
    await ensureDir(path.dirname(targetPath));
    await fsp.writeFile(targetPath, file.buffer, { mode: 0o600 });
  }
}

function dependencyLookupValues(dependency) {
  return [
    dependency.itemId,
    dependency.id,
    dependency.name,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
}

function dependencyMatchesItem(item, dependency) {
  const rawValues = dependencyLookupValues(dependency);
  const normalizedValues = new Set(rawValues.map(normalizeInstallName).filter(Boolean));
  const directValues = new Set(rawValues.map((value) => value.toLowerCase()));
  const itemValues = [
    item.id,
    item.name,
    item.title,
    item.mcp?.serverName,
  ].filter((value) => typeof value === 'string' && value.trim());
  if (itemValues.some((value) => directValues.has(value.toLowerCase()))) {
    return true;
  }
  return itemValues.some((value) => normalizedValues.has(normalizeInstallName(value)));
}

function findDependencyItem(catalog, dependency, parentRepoId) {
  const kind = dependency.kind === 'mcp-server' ? 'mcp-server' : 'skill';
  const candidates = catalog.items.filter((item) => (
    item.kind === kind
    && (!dependency.repoId || item.repoId === dependency.repoId)
  ));
  const sameRepo = candidates.filter((item) => item.repoId === parentRepoId);
  return [...sameRepo, ...candidates].find((item) => dependencyMatchesItem(item, dependency)) || null;
}

async function bumpLocalDownload(item) {
  if (item.repoId !== LOCAL_REPOSITORY_ID) return;
  const catalog = await readLocalCatalog();
  const index = catalog.items.findIndex((candidate) => {
    const candidateKind = normalizeKind(candidate.kind);
    return candidateKind === item.kind && getPublicItemId(candidateKind, getRawItemSlug(candidate)) === item.id;
  });
  if (index >= 0) {
    catalog.items[index].downloads = Number(catalog.items[index].downloads || 0) + 1;
    await saveLocalCatalog(catalog);
  }
}

function dependencySummary(item, result, status = 'installed') {
  return {
    kind: item.kind,
    repoId: item.repoId,
    itemId: item.id,
    name: item.name,
    title: item.title,
    status,
    installPath: result?.installPath || null,
    ...(result?.mcpServer ? { mcpServer: result.mcpServer } : {}),
    ...(result?.postInstall ? { postInstall: result.postInstall } : {}),
  };
}

function isMissingRequiredMcpConfiguration(error) {
  return typeof error?.message === 'string'
    && /^MCP configuration ".+" is required$/.test(error.message);
}

function flattenMcpServerNames(groupedServers) {
  if (!groupedServers || typeof groupedServers !== 'object') return [];
  return Object.values(groupedServers)
    .flatMap((servers) => Array.isArray(servers) ? servers : [])
    .map((server) => server?.name)
    .filter((name) => typeof name === 'string' && name.trim());
}

async function readInstalledDependencyNames({ projectPath = '' } = {}) {
  const [skillsResult, mcpServers, modelSettings] = await Promise.all([
    listInstalledSkills({ workspacePath: projectPath }),
    providerMcpService.listProviderMcpServers('claude', { workspacePath: projectPath }).catch(() => ({})),
    readMtlCodeModelSettings().catch(() => ({})),
  ]);
  const profiles = readStoredModelProfiles(modelSettings, process.env);
  return {
    skills: Array.isArray(skillsResult?.skills)
      ? skillsResult.skills.map((skill) => skill.name).filter(Boolean)
      : [],
    mcpServers: flattenMcpServerNames(mcpServers),
    modelProfiles: profiles
      .flatMap((profile) => [profile.id, profile.name, profile.model])
      .filter(Boolean),
  };
}

function selectedDependenciesFromOptionalIds(dependencies, selectedOptionalDependencyIds = []) {
  const selectedIds = new Set((Array.isArray(selectedOptionalDependencyIds) ? selectedOptionalDependencyIds : [])
    .map((value) => normalizeInstallName(value)));
  const selected = { skills: [], mcpServers: [], modelProfiles: [] };
  const addIfSelected = (dependency, key, kind) => {
    const name = dependency.name || dependency.itemId || dependency.id || '';
    const dependencyId = normalizeInstallName(`${kind}:${name}`);
    if (dependency.optional && selectedIds.has(dependencyId)) {
      selected[key].push(name);
    }
  };
  for (const dependency of dependencies?.skills || []) addIfSelected(dependency, 'skills', 'skill');
  for (const dependency of dependencies?.mcpServers || []) addIfSelected(dependency, 'mcpServers', 'mcp-server');
  for (const dependency of dependencies?.modelProfiles || []) addIfSelected(dependency, 'modelProfiles', 'model-profile');
  return selected;
}

function resolveRoleBindingsForCatalogItem(item, catalog) {
  if (!item || item.kind !== 'swarm-template') return null;
  const installedAgents = (catalog?.items || [])
    .filter((candidate) => candidate.kind === 'agent-template')
    .map((candidate) => ({
      id: candidate.packageId || candidate.name || candidate.id,
      name: candidate.name,
      templateId: candidate.packageId,
    }));
  const bundledAgentTemplates = Array.isArray(item.bundledAgentTemplates)
    ? item.bundledAgentTemplates
    : [];
  return resolveSwarmRoleBindings({
    manifest: {
      id: item.packageId || item.name,
      version: item.packageVersion || item.version,
      kind: 'swarm-template',
      topology: item.topology,
      roles: item.roles,
      routing: item.routing,
      bus: item.bus,
      memory: item.memory,
      policies: item.policies,
      dialogs: item.dialogs,
      dependencies: item.dependencies,
      examples: item.examples,
      compat: item.compat,
    },
    installedAgents,
    bundledAgentTemplates,
  });
}

async function installRepositoryItem(item, options = {}) {
  const {
    target = 'user',
    projectPath,
    overwrite = false,
    configuration,
    catalog,
    installDependencies = true,
    visited = new Set(),
  } = options;
  const visitKey = `${item.repoId}:${item.id}`;
  if (visited.has(visitKey)) {
    return {
      success: true,
      item,
      installPath: null,
      target,
      dependencies: [],
      skipped: true,
    };
  }
  visited.add(visitKey);

  const dependencies = [];
  if (installDependencies && (item.kind === 'agent-template' || item.kind === 'swarm-template')) {
    const dependencyCatalog = catalog || await loadCatalogs();
    const declared = item.dependencies || { skills: [], mcpServers: [] };
    const dependencyEntries = [
      ...(Array.isArray(declared.skills) ? declared.skills : []),
      ...(Array.isArray(declared.mcpServers) ? declared.mcpServers : []),
      ...(Array.isArray(declared.modelProfiles) ? declared.modelProfiles : []),
    ];

    for (const dependency of dependencyEntries) {
      if (dependency.kind === 'model-profile') {
        dependencies.push({
          kind: dependency.kind,
          name: dependency.name,
          status: dependency.optional ? 'declared-optional' : 'needs-configuration',
        });
        continue;
      }
      const dependencyItem = findDependencyItem(dependencyCatalog, dependency, item.repoId);
      if (!dependencyItem) {
        const label = `${dependency.kind === 'mcp-server' ? 'MCP' : 'Skill'} ${dependency.name}`;
        if (dependency.optional) {
          dependencies.push({ kind: dependency.kind, name: dependency.name, status: 'missing-optional' });
          continue;
        }
        dependencies.push({ kind: dependency.kind, name: dependency.name, status: 'missing-required', error: `Agent dependency not found: ${label}` });
        continue;
      }

      try {
        const dependencyResult = await installRepositoryItem(dependencyItem, {
          target,
          projectPath,
          overwrite: dependency.overwrite ?? false,
          configuration: dependency.configuration,
          catalog: dependencyCatalog,
          installDependencies: false,
          visited,
        });
        dependencies.push(dependencySummary(dependencyItem, dependencyResult));
      } catch (error) {
        if (error?.code === 'EEXIST') {
          dependencies.push(dependencySummary(dependencyItem, {
            installPath: error.installPath,
          }, 'already-installed'));
          continue;
        }
        if (dependencyItem.kind === 'mcp-server' && isMissingRequiredMcpConfiguration(error)) {
          dependencies.push({
            kind: dependencyItem.kind,
            repoId: dependencyItem.repoId,
            itemId: dependencyItem.id,
            name: dependencyItem.name,
            title: dependencyItem.title,
            status: 'needs-configuration',
            error: error.message,
          });
          continue;
        }
        if (dependency.optional) {
          dependencies.push({
            kind: dependencyItem.kind,
            repoId: dependencyItem.repoId,
            itemId: dependencyItem.id,
            name: dependencyItem.name,
            title: dependencyItem.title,
            status: 'failed-optional',
            error: error.message,
          });
          continue;
        }
        dependencies.push({
          kind: dependencyItem.kind,
          repoId: dependencyItem.repoId,
          itemId: dependencyItem.id,
          name: dependencyItem.name,
          title: dependencyItem.title,
          status: 'failed-required',
          error: error.message,
        });
        continue;
      }
    }
  }

  const installPath = resolveInstallTarget(item.kind, item.name || item.id, target, projectPath);
  let responseContent;
  let responseInstallPath = installPath;
  let mcpServer = null;
  let postInstall = null;

  if (item.kind === 'mcp-server') {
    const packageFiles = await readItemPackageFiles(item);
    if (packageFiles.length > 0) {
      await writeInstallPackage(installPath, packageFiles, Boolean(overwrite), { target, projectPath, kind: item.kind });
    } else {
      await ensureDir(installPath);
    }
    responseInstallPath = installPath;
    postInstall = await runMcpPostInstallIfNeeded(item, installPath);
    const mcpPayload = buildMcpServerPayload(item, installPath, target, projectPath, configuration);
    mcpServer = await providerMcpService.upsertProviderMcpServer('claude', mcpPayload);
  } else if (item.kind === 'swarm-template' && Array.isArray(item.packageFiles) && item.packageFiles.length > 0) {
    const packageFiles = await readItemPackageFiles(item);
    const installDir = installPath.replace(/\.json$/i, '');
    await writeInstallPackage(installDir, packageFiles, Boolean(overwrite), { target, projectPath, kind: item.kind });
    responseInstallPath = installDir;
  } else if (item.kind === 'skill' && Array.isArray(item.packageFiles) && item.packageFiles.length > 0) {
    const packageFiles = await readItemPackageFiles(item);
    const installDir = path.dirname(installPath);
    await writeInstallPackage(installDir, packageFiles, Boolean(overwrite), { target, projectPath, kind: item.kind });
    responseInstallPath = installDir;
  } else {
    const rawContent = await readItemContent(item);
    const content = item.kind === 'agent-template'
      ? applyAgentConfiguration(rawContent, configuration)
      : rawContent;
    await writeInstallFile(installPath, content, Boolean(overwrite));
    responseContent = item.kind === 'agent-template' || item.kind === 'swarm-template' ? content : undefined;
  }

  await bumpLocalDownload(item);

  return {
    success: true,
    item,
    installPath: responseInstallPath,
    target,
    content: responseContent,
    dependencies,
    ...(mcpServer ? { mcpServer } : {}),
    ...(postInstall ? { postInstall } : {}),
  };
}

async function removeInstallTarget(kind, name, target, projectPath) {
  const installPath = resolveInstallTarget(kind, name, target, projectPath);
  const targetPath = kind === 'skill' ? path.dirname(installPath) : installPath;
  const resolvedTarget = assertInstallPathSafe(targetPath, target, projectPath, kind);
  await fsp.rm(resolvedTarget, { recursive: kind === 'skill' || kind === 'mcp-server', force: true });
  return resolvedTarget;
}

async function upsertLocalItem({
  kind,
  name,
  title,
  description,
  author,
  tags,
  content,
  packageFiles,
  overwrite,
  icon,
  supportedApps,
  appSlots,
  capabilities,
  dependencies,
  mcp,
  runtime,
  dialogs,
  examples,
  compat,
  topology,
  roles,
  routing,
  bus,
  memory,
  policies,
}) {
  const id = sanitizeSlug(name || title);
  if (!validateSlug(id)) {
    throw new Error('Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores');
  }

  const catalog = await readLocalCatalog();
  const existingIndex = catalog.items.findIndex((item) => item.id === id && normalizeKind(item.kind) === kind);
  if (existingIndex >= 0 && !overwrite) {
    throw new Error(`${publicKindLabel(kind)} "${id}" already exists`);
  }

  const createdAt = existingIndex >= 0 ? catalog.items[existingIndex].createdAt || nowIso() : nowIso();
  const contentPath = kind === 'skill'
    ? `skills/${id}/SKILL.md`
    : kind === 'mcp-server'
      ? `mcp/${id}/package.json`
      : kind === 'swarm-template'
        ? `swarms/${id}/manifest.json`
        : `agents/${id}/${id}.md`;
  const normalizedPackageFiles = kind === 'agent-template' || kind === 'swarm-template'
    ? normalizeTemplatePackageFiles(packageFiles)
    : kind === 'skill' || kind === 'mcp-server'
      ? normalizePackageFiles(packageFiles, { requireSkillMd: kind === 'skill' && Array.isArray(packageFiles) && packageFiles.length > 0 })
    : [];
  const parsedSwarmContent = kind === 'swarm-template' && content && String(content).trim().startsWith('{')
    ? JSON.parse(content)
    : {};
  const swarmManifest = kind === 'swarm-template'
    ? normalizeSwarmTemplateManifest({
        id,
        version: '1.0.0',
        kind: 'swarm-template',
        ...parsedSwarmContent,
        ...omitUndefined({
          topology,
          roles,
          routing,
          bus,
          memory,
          policies,
          dependencies,
          dialogs,
          examples,
          compat,
        }),
      })
    : null;

  const resolved = resolveLocalContentPath(contentPath);
  if (!resolved) {
    throw new Error('Invalid repository content path');
  }

  let catalogPackageFiles = [];
  if ((kind === 'skill' || kind === 'mcp-server' || kind === 'agent-template' || kind === 'swarm-template') && normalizedPackageFiles.length > 0) {
    const packageRootPath = kind === 'mcp-server'
      ? `mcp/${id}`
      : kind === 'agent-template'
        ? `agents/${id}/package`
        : kind === 'swarm-template'
          ? `swarms/${id}/package`
        : `skills/${id}`;
    const packageRoot = resolveLocalContentPath(packageRootPath);
    if (!packageRoot) throw new Error('Invalid repository package path');
    if (existingIndex >= 0 && overwrite) {
      await fsp.rm(packageRoot, { recursive: true, force: true });
    }
    for (const file of normalizedPackageFiles) {
      const fileContentPath = `${packageRootPath}/${file.path}`;
      const filePath = resolveLocalContentPath(fileContentPath);
      if (!filePath) throw new Error('Invalid repository package file path');
      await ensureDir(path.dirname(filePath));
      await fsp.writeFile(filePath, file.buffer, { mode: 0o600 });
      catalogPackageFiles.push({
        path: file.path,
        contentPath: fileContentPath,
        size: file.size,
      });
    }
  } else {
    if ((!content || typeof content !== 'string') && kind !== 'swarm-template') {
      throw new Error('content is required');
    }
    const finalContent = kind === 'skill'
      ? formatSkillMarkdown({ name: id, title, description, content })
      : kind === 'mcp-server'
        ? String(content || description || `MCP server package for ${title || id}.`)
        : kind === 'swarm-template'
          ? JSON.stringify(swarmManifest, null, 2)
          : formatAgentTemplateMarkdown({ name: id, description, prompt: content });
    await ensureDir(path.dirname(resolved));
    await fsp.writeFile(resolved, finalContent, { mode: 0o600 });
  }

  const item = {
    id,
    kind,
    name: id,
    title: title || id,
    description: description || '',
    author: author || '',
    tags: Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [],
    icon: typeof icon === 'string' ? icon.trim() : '',
    supportedApps: normalizeSupportedApps(supportedApps),
    appSlots: normalizeAppSlots(appSlots),
    capabilities: normalizeStringArray(capabilities),
    ...(kind === 'agent-template'
      ? {
          dependencies: normalizeAgentTemplateDependencies(dependencies),
          runtime: normalizeAgentTemplateManifest({ id, version: '1.0.0', runtime }).runtime,
          dialogs: normalizeAgentTemplateDialogs(dialogs),
          examples: normalizeAgentTemplateManifest({ id, version: '1.0.0', examples }).examples,
          compat: normalizeAgentTemplateManifest({ id, version: '1.0.0', compat }).compat,
        }
      : {}),
    ...(kind === 'swarm-template'
      ? (() => {
          const manifest = swarmManifest;
          return {
            topology: manifest.topology,
            roles: manifest.roles,
            routing: manifest.routing,
            bus: manifest.bus,
            memory: manifest.memory,
            policies: manifest.policies,
            dependencies: mergeDependencyGroups(manifest.dependencies, ...manifest.roles.map((role) => role.dependencies)),
            dialogs: manifest.dialogs,
            examples: manifest.examples,
            compat: manifest.compat,
          };
        })()
      : {}),
    ...(kind === 'mcp-server' ? { mcp: normalizeMcpDefinition(mcp) } : {}),
    version: '1.0.0',
    likes: existingIndex >= 0 ? Number(catalog.items[existingIndex].likes || 0) : 0,
    downloads: existingIndex >= 0 ? Number(catalog.items[existingIndex].downloads || 0) : 0,
    contentPath,
    ...(catalogPackageFiles.length > 0 ? { packageFiles: catalogPackageFiles } : {}),
    createdAt,
    updatedAt: nowIso(),
  };

  if (existingIndex >= 0) {
    catalog.items[existingIndex] = item;
  } else {
    catalog.items.push(item);
  }
  await saveLocalCatalog(catalog);
  return item;
}

router.get('/sources', (req, res) => {
  try {
    const { sources } = readSources();
    res.json({ sources });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read repository sources', details: error.message });
  }
});

router.post('/sources', async (req, res) => {
  try {
    const { name, url, enabled = true } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'url must be a valid URL' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Only http:// and https:// repository URLs are supported' });
    }

    const sourcesPayload = readSources();
    const baseName = name || parsed.hostname.split('.').filter(Boolean)[0] || 'repository';
    const baseId = sanitizeSlug(baseName, 'repository');
    let id = baseId;
    let suffix = 2;
    while (sourcesPayload.sources.some((source) => source.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const source = {
      id,
      name: String(name || baseName).trim(),
      type: 'remote',
      url: parsed.toString(),
      enabled: enabled !== false,
      writable: false,
      addedAt: nowIso(),
    };

    await fetchRemoteCatalog(source);
    sourcesPayload.sources.push(source);
    await saveSources(sourcesPayload.sources);
    res.json({ success: true, source });
  } catch (error) {
    res.status(400).json({ error: 'Failed to add repository source', details: error.message });
  }
});

router.put('/sources/:repoId', async (req, res) => {
  try {
    const repoId = req.params.repoId;
    const sourcesPayload = readSources();
    const index = sourcesPayload.sources.findIndex((source) => source.id === repoId);
    if (index < 0) {
      return res.status(404).json({ error: 'Repository source not found' });
    }
    if (repoId === LOCAL_REPOSITORY_ID) {
      return res.status(400).json({ error: 'The local repository source cannot be modified' });
    }
    const current = sourcesPayload.sources[index];
    const updated = {
      ...current,
      name: typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : current.name,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : current.enabled,
    };
    sourcesPayload.sources[index] = updated;
    await saveSources(sourcesPayload.sources);
    res.json({ success: true, source: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update repository source', details: error.message });
  }
});

router.delete('/sources/:repoId', async (req, res) => {
  try {
    const repoId = req.params.repoId;
    if (repoId === LOCAL_REPOSITORY_ID) {
      return res.status(400).json({ error: 'The local repository source cannot be removed' });
    }
    const sourcesPayload = readSources();
    const nextSources = sourcesPayload.sources.filter((source) => source.id !== repoId);
    if (nextSources.length === sourcesPayload.sources.length) {
      return res.status(404).json({ error: 'Repository source not found' });
    }
    await saveSources(nextSources);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove repository source', details: error.message });
  }
});

router.post('/local/init', async (req, res) => {
  try {
    ensureLocalRepository();
    const catalog = await readLocalCatalog();
    res.json({
      success: true,
      repository: {
        ...DEFAULT_SOURCE,
        catalogPath: LOCAL_CATALOG_PATH,
        catalogUrl: '/api/agent-repository/local/catalog',
        itemCount: catalog.items.length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize local repository', details: error.message });
  }
});

router.get('/local/catalog', async (req, res) => {
  try {
    res.json(await readLocalCatalog());
  } catch (error) {
    res.status(500).json({ error: 'Failed to read local repository catalog', details: error.message });
  }
});

router.get('/local/content', async (req, res) => {
  try {
    const resolved = resolveLocalContentPath(req.query.path);
    if (!resolved) {
      return res.status(400).json({ error: 'Invalid content path' });
    }
    const content = await fsp.readFile(resolved, 'utf8');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(content);
  } catch (error) {
    res.status(404).json({ error: 'Content not found', details: error.message });
  }
});

router.get('/catalog', async (req, res) => {
  try {
    const catalog = await loadCatalogs();
    res.json(catalog);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load repository catalog', details: error.message });
  }
});

router.post('/upload', async (req, res) => {
  res.status(410).json({
    error: 'Local repository upload is disabled',
    details: 'Upload to a configured remote Agent/Skill/MCP Hub instead.',
  });
});

router.post('/remote-upload', async (req, res) => {
  try {
    const { repoId, adminToken } = req.body || {};
    if (!repoId || typeof repoId !== 'string') {
      return res.status(400).json({ error: 'repoId is required' });
    }
    if (!adminToken || typeof adminToken !== 'string') {
      return res.status(400).json({ error: 'adminToken is required' });
    }
    const { sources } = readSources();
    const source = sources.find((candidate) => candidate.id === repoId && candidate.type !== 'local');
    if (!source?.url) {
      return res.status(404).json({ error: 'Remote repository source not found' });
    }
    const kind = normalizeKind(req.body?.kind);
    if (!kind) {
      return res.status(400).json({ error: 'kind must be "agent-template", "swarm-template", "skill", or "mcp-server"' });
    }
    const {
      name,
      title,
      description,
      author,
      tags,
      content,
      packageFiles,
      overwrite = false,
      icon,
      supportedApps,
      appSlots,
      capabilities,
      dependencies,
      mcp,
      runtime,
      dialogs,
      examples,
      compat,
      topology,
      roles,
      routing,
      bus,
      memory,
      policies,
    } = req.body || {};
    if (
      (!content || typeof content !== 'string')
      && (!Array.isArray(packageFiles) || packageFiles.length === 0)
      && !(kind === 'swarm-template' && Array.isArray(roles) && roles.length > 0)
    ) {
      return res.status(400).json({ error: 'content is required' });
    }
    const remoteUrl = deriveRemoteHubAdminItemsUrl(source.url);
    const response = await fetch(remoteUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        kind,
        name,
        title,
        description,
        author,
        tags,
        content,
        packageFiles,
        overwrite: Boolean(overwrite),
        icon,
        supportedApps,
        appSlots,
        capabilities,
        dependencies,
        mcp,
        runtime,
        dialogs,
        examples,
        compat,
        topology,
        roles,
        routing,
        bus,
        memory,
        policies,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const authDetails = response.status === 401 || response.status === 403
        ? `Remote Hub "${source.name}" rejected the upload token for ${source.url}. Check the Hub JSON config adminToken/submitToken and enter the matching token in Repository upload settings.`
        : '';
      return res.status(response.status).json({
        error: data.error || 'Failed to upload repository item to remote Hub',
        details: data.details || data.message || authDetails || `Remote Hub returned HTTP ${response.status}`,
        repository: {
          id: source.id,
          name: source.name,
          url: source.url,
        },
      });
    }
    res.json({ success: true, item: data.item || data.catalogItem || null, repository: source });
  } catch (error) {
    res.status(400).json({ error: 'Failed to upload repository item to remote Hub', details: error.message });
  }
});

router.post('/local/upload', async (req, res) => {
  try {
    const kind = normalizeKind(req.body?.kind);
    if (!kind) {
      return res.status(400).json({ error: 'kind must be "agent-template", "swarm-template", "skill", or "mcp-server"' });
    }
    const {
      name,
      title,
      description,
      author,
      tags,
      content,
      packageFiles,
      overwrite = false,
      icon,
      supportedApps,
      appSlots,
      capabilities,
      dependencies,
      mcp,
      runtime,
      dialogs,
      examples,
      compat,
      topology,
      roles,
      routing,
      bus,
      memory,
      policies,
    } = req.body || {};
    if (
      (!content || typeof content !== 'string')
      && (!Array.isArray(packageFiles) || packageFiles.length === 0)
      && !(kind === 'swarm-template' && Array.isArray(roles) && roles.length > 0)
    ) {
      return res.status(400).json({ error: 'content is required' });
    }
    const item = await upsertLocalItem({
      kind,
      name,
      title,
      description,
      author,
      tags,
      content,
      packageFiles,
      overwrite: Boolean(overwrite),
      icon,
      supportedApps,
      appSlots,
      capabilities,
      dependencies,
      mcp,
      runtime,
      dialogs,
      examples,
      compat,
      topology,
      roles,
      routing,
      bus,
      memory,
      policies,
    });
    res.json({ success: true, item });
  } catch (error) {
    res.status(400).json({ error: 'Failed to upload local repository item', details: error.message });
  }
});

router.post('/items/:repoId/:itemId/like', async (req, res) => {
  try {
    const { repoId, itemId } = req.params;
    const item = await findPublicItem(repoId, itemId);
    if (!item) {
      return res.status(404).json({ error: 'Repository item not found' });
    }
    const likesState = readLikes();
    const key = likeKey(repoId, itemId);
    const currentLiked = Boolean(likesState.liked[key]);
    const nextLiked = req.body?.liked === undefined ? !currentLiked : Boolean(req.body.liked);

    if (repoId === LOCAL_REPOSITORY_ID) {
      const catalog = await readLocalCatalog();
      const index = catalog.items.findIndex((candidate) => {
        const candidateKind = normalizeKind(candidate.kind);
        return candidateKind === item.kind && getPublicItemId(candidateKind, getRawItemSlug(candidate)) === itemId;
      });
      if (index >= 0) {
        const previousLikes = Math.max(0, Number(catalog.items[index].likes || 0));
        catalog.items[index].likes = Math.max(0, previousLikes + (nextLiked ? 1 : -1) - (currentLiked ? 1 : 0));
        catalog.items[index].updatedAt = nowIso();
        await saveLocalCatalog(catalog);
      }
    } else if (item.likeUrl) {
      try {
        await fetch(item.likeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId, kind: item.kind, liked: nextLiked }),
        });
      } catch {
        // Remote like endpoints are optional. Fall back to a local overlay.
        likesState.overlays[key] = Math.max(0, Number(likesState.overlays[key] || 0) + (nextLiked ? 1 : -1) - (currentLiked ? 1 : 0));
      }
    } else {
      likesState.overlays[key] = Math.max(0, Number(likesState.overlays[key] || 0) + (nextLiked ? 1 : -1) - (currentLiked ? 1 : 0));
    }

    if (nextLiked) {
      likesState.liked[key] = true;
    } else {
      delete likesState.liked[key];
    }
    await saveLikes(likesState);

    const updatedItem = await findPublicItem(repoId, itemId);
    res.json({ success: true, item: updatedItem });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update like', details: error.message });
  }
});

router.post('/dependencies/resolve', async (req, res) => {
  try {
    const {
      dependencies,
      selectedDependencies,
      selectedOptionalDependencyIds,
      projectPath = '',
    } = req.body || {};
    const normalizedDependencies = normalizeAgentTemplateDependencies(dependencies);
    const installed = await readInstalledDependencyNames({
      projectPath: typeof projectPath === 'string' ? projectPath : '',
    });
    const catalog = await loadCatalogs();
    const selected = selectedDependencies && typeof selectedDependencies === 'object'
      ? selectedDependencies
      : selectedDependenciesFromOptionalIds(normalizedDependencies, selectedOptionalDependencyIds);
    const result = resolveAgentTemplateDependencies({
      dependencies: normalizedDependencies,
      installed,
      selectedDependencies: selected,
      catalogItems: catalog.items,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to resolve agent template dependencies',
      details: error.message,
    });
  }
});

router.post('/compat/claude-code/import', (req, res) => {
  try {
    const { markdown, id, version } = req.body || {};
    if (typeof markdown !== 'string' || !markdown.trim()) {
      return res.status(400).json({ error: 'markdown is required' });
    }
    res.json({
      success: true,
      ...parseClaudeCodeAgentMarkdown(markdown, { id, version }),
    });
  } catch (error) {
    res.status(400).json({ error: 'Failed to import Claude Code agent', details: error.message });
  }
});

router.post('/compat/claude-code/export', (req, res) => {
  try {
    const markdown = exportClaudeCodeAgentMarkdown(req.body?.agent || req.body || {});
    res.type('text/markdown').send(markdown);
  } catch (error) {
    res.status(400).json({ error: 'Failed to export Claude Code agent', details: error.message });
  }
});

router.post('/swarm-template/export', (req, res) => {
  try {
    const payload = exportSwarmTemplatePackage({
      manifest: req.body?.manifest || req.body?.template || req.body || {},
      roleBindingResolution: req.body?.roleBindingResolution || null,
      examples: req.body?.examples || null,
      transcript: req.body?.transcript || null,
    });
    res.json({ success: true, package: payload });
  } catch (error) {
    res.status(400).json({ error: 'Failed to export swarm template package', details: error.message });
  }
});

router.post('/swarm-template/import', (req, res) => {
  try {
    const payload = importSwarmTemplatePackage(req.body?.package || req.body || {});
    res.json({ success: true, ...payload });
  } catch (error) {
    res.status(400).json({ error: 'Failed to import swarm template package', details: error.message });
  }
});

router.post('/install', async (req, res) => {
  try {
    const { repoId, itemId, target = 'user', projectPath, overwrite = false, configuration } = req.body || {};
    if (!repoId || !itemId) {
      return res.status(400).json({ error: 'repoId and itemId are required' });
    }
    const catalog = await loadCatalogs();
    const item = catalog.items.find((candidate) => candidate.repoId === String(repoId) && candidate.id === String(itemId)) || null;
    if (!item) {
      return res.status(404).json({ error: 'Repository item not found' });
    }
    const result = await installRepositoryItem(item, {
      target,
      projectPath,
      overwrite: Boolean(overwrite),
      configuration,
      catalog,
    });
    let dependencyResolution = null;
    let roleBindingResolution = null;
    let installStatus = 'enabled';
    if (item.kind === 'agent-template' || item.kind === 'swarm-template') {
      const selectedDependencies = configuration?.selectedDependencies && typeof configuration.selectedDependencies === 'object'
        ? configuration.selectedDependencies
        : {};
      const installed = await readInstalledDependencyNames({
        projectPath: typeof projectPath === 'string' ? projectPath : '',
      });
      dependencyResolution = resolveAgentTemplateDependencies({
        dependencies: normalizeAgentTemplateDependencies(item.dependencies || {}),
        installed,
        selectedDependencies,
        catalogItems: catalog.items,
      });
      if (dependencyResolution.blockingMissing?.length) {
        installStatus = 'draft';
      }
    }
    if (item.kind === 'swarm-template') {
      roleBindingResolution = resolveRoleBindingsForCatalogItem(item, catalog);
      if (roleBindingResolution?.blockingMissing?.length) {
        installStatus = 'draft';
      }
    }
    res.json({
      ...result,
      status: installStatus,
      dependencyResolution,
      roleBindingResolution,
    });
  } catch (error) {
    const status = error?.code === 'EEXIST' ? 409 : 400;
    if (error?.code === 'EEXIST') {
      return res.status(status).json({
        error: 'Install target already exists',
        code: 'INSTALL_TARGET_EXISTS',
        details: `安装目标已经存在：${error.relativePath || '文件已存在'}。请点击“更新”，或勾选“Overwrite existing installed files”后重试。`,
        conflictPath: error.relativePath || null,
        installPath: error.installPath || null,
      });
    }
    res.status(status).json({ error: 'Failed to install repository item', details: error.message });
  }
});

router.delete('/install', async (req, res) => {
  try {
    const { repoId, itemId, target = 'user', projectPath } = req.body || {};
    if (!repoId || !itemId) {
      return res.status(400).json({ error: 'repoId and itemId are required' });
    }
    const item = await findPublicItem(String(repoId), String(itemId));
    if (!item) {
      return res.status(404).json({ error: 'Repository item not found' });
    }

    const itemKind = item.kind;
    const installPath = await removeInstallTarget(
      item.kind,
      item.name || item.id,
      target,
      projectPath,
    );
    let mcpRemoved = null;
    if (itemKind === 'mcp-server') {
      const mcp = item.mcp || {};
      const serverName = sanitizeSlug(mcp.serverName || item.name || item.id, 'mcp-server');
      mcpRemoved = await providerMcpService.removeProviderMcpServer('claude', {
        name: serverName,
        scope: target === 'project' ? 'project' : 'user',
        workspacePath: target === 'project' ? projectPath : undefined,
      });
    }
    res.json({
      success: true,
      item,
      installPath,
      target,
      ...(mcpRemoved ? { mcpRemoved } : {}),
    });
  } catch (error) {
    res.status(400).json({ error: 'Failed to uninstall repository item', details: error.message });
  }
});

export default router;
