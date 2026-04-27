import fs, { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

import express from 'express';

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
    name: 'MTL-Code Agent Repository',
    description: 'Shared prompt templates and skills for MTL-Code.',
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
    fs.writeFileSync(SOURCES_PATH, JSON.stringify({ schemaVersion: 1, sources: [DEFAULT_SOURCE] }, null, 2), { mode: 0o600 });
  }
}

function readSources() {
  ensureLocalRepository();
  const payload = readJsonSync(SOURCES_PATH, { schemaVersion: 1, sources: [DEFAULT_SOURCE] });
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const byId = new Map();
  byId.set(LOCAL_REPOSITORY_ID, DEFAULT_SOURCE);
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    if (!source.id || typeof source.id !== 'string') continue;
    byId.set(source.id, {
      ...source,
      enabled: source.enabled !== false,
      writable: source.id === LOCAL_REPOSITORY_ID ? true : Boolean(source.writable),
    });
  }
  return {
    schemaVersion: 1,
    sources: Array.from(byId.values()),
  };
}

async function saveSources(sources) {
  const normalized = sources.map((source) => ({
    ...source,
    enabled: source.enabled !== false,
    writable: source.id === LOCAL_REPOSITORY_ID ? true : Boolean(source.writable),
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
  if (value === 'agent' || value === 'agents' || value === 'template' || value === 'agent-template') {
    return 'agent-template';
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
  return kind === 'skill' ? 'Skill' : 'Agent Template';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 24);
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

function getMtlCodeConfigDir() {
  return process.env.MTL_CODE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
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
    return path.join(projectRoot, '.claude', 'agents', `${safeName}.md`);
  }
  const home = getMtlCodeConfigDir();
  if (kind === 'skill') {
    return path.join(home, 'skills', safeName, 'SKILL.md');
  }
  return path.join(home, 'agents', `${safeName}.md`);
}

async function writeInstallFile(filePath, content, overwrite) {
  await ensureDir(path.dirname(filePath));
  const flag = overwrite ? 'w' : 'wx';
  await fsp.writeFile(filePath, content, { flag, mode: 0o600 });
}

async function upsertLocalItem({ kind, name, title, description, author, tags, content, overwrite, icon, supportedApps, appSlots, capabilities }) {
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
    : `agents/${id}/${id}.md`;
  const finalContent = kind === 'skill'
    ? formatSkillMarkdown({ name: id, title, description, content })
    : formatAgentTemplateMarkdown({ name: id, description, prompt: content });

  const resolved = resolveLocalContentPath(contentPath);
  if (!resolved) {
    throw new Error('Invalid repository content path');
  }
  await ensureDir(path.dirname(resolved));
  await fsp.writeFile(resolved, finalContent, { mode: 0o600 });

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
    version: '1.0.0',
    likes: existingIndex >= 0 ? Number(catalog.items[existingIndex].likes || 0) : 0,
    downloads: existingIndex >= 0 ? Number(catalog.items[existingIndex].downloads || 0) : 0,
    contentPath,
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
  try {
    const kind = normalizeKind(req.body?.kind);
    if (!kind) {
      return res.status(400).json({ error: 'kind must be "agent-template" or "skill"' });
    }
    const {
      name,
      title,
      description,
      author,
      tags,
      content,
      overwrite = false,
      icon,
      supportedApps,
      appSlots,
      capabilities,
    } = req.body || {};
    if (!content || typeof content !== 'string') {
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
      overwrite: Boolean(overwrite),
      icon,
      supportedApps,
      appSlots,
      capabilities,
    });
    res.json({ success: true, item });
  } catch (error) {
    res.status(400).json({ error: 'Failed to upload repository item', details: error.message });
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

router.post('/install', async (req, res) => {
  try {
    const { repoId, itemId, target = 'user', projectPath, overwrite = false, configuration } = req.body || {};
    if (!repoId || !itemId) {
      return res.status(400).json({ error: 'repoId and itemId are required' });
    }
    const item = await findPublicItem(String(repoId), String(itemId));
    if (!item) {
      return res.status(404).json({ error: 'Repository item not found' });
    }
    const rawContent = await readItemContent(item);
    const content = item.kind === 'agent-template'
      ? applyAgentConfiguration(rawContent, configuration)
      : rawContent;
    const installPath = resolveInstallTarget(item.kind, item.name || item.id, target, projectPath);
    await writeInstallFile(installPath, content, Boolean(overwrite));

    if (item.repoId === LOCAL_REPOSITORY_ID) {
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

    res.json({
      success: true,
      item,
      installPath,
      target,
      content: item.kind === 'agent-template' ? content : undefined,
    });
  } catch (error) {
    const status = error?.code === 'EEXIST' ? 409 : 400;
    res.status(status).json({ error: 'Failed to install repository item', details: error.message });
  }
});

export default router;
