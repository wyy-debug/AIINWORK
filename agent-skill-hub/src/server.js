import crypto from 'node:crypto';
import express from 'express';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT || process.env.HUB_PORT || 4877);
const HOST = process.env.HOST || process.env.HUB_HOST || '0.0.0.0';
const PUBLIC_BASE_PATH = process.env.HUB_PUBLIC_BASE_PATH || '/agent-repository';
const ADMIN_BASE_PATH = process.env.HUB_ADMIN_BASE_PATH || '/api/admin';
const DATA_ROOT = process.env.HUB_DATA_DIR
  || process.env.MTL_CODE_REMOTE_AGENT_REPOSITORY_DIR
  || path.join(os.homedir(), '.mtl-agent-skill-hub');
const STORE_PATH = path.join(DATA_ROOT, 'store.json');
const CONTENT_ROOT = path.join(DATA_ROOT, 'content');
const PUBLISHED_DIR = path.join(CONTENT_ROOT, 'published');
const SUBMISSIONS_DIR = path.join(CONTENT_ROOT, 'submissions');
const MAX_CONTENT_BYTES = Number(process.env.HUB_MAX_CONTENT_BYTES || 2 * 1024 * 1024);
const MAX_PACKAGE_FILES = Number(process.env.HUB_MAX_PACKAGE_FILES || 200);
const MAX_PACKAGE_BYTES = Number(process.env.HUB_MAX_PACKAGE_BYTES || 20 * 1024 * 1024);
const BODY_LIMIT_MB = Math.ceil((Math.max(MAX_CONTENT_BYTES, MAX_PACKAGE_BYTES) + 1024 * 1024) / 1024 / 1024);

app.set('trust proxy', true);
app.use(express.json({ limit: `${BODY_LIMIT_MB}mb` }));
app.use(express.urlencoded({ extended: false, limit: `${BODY_LIMIT_MB}mb` }));

function nowIso() {
  return new Date().toISOString();
}

function configuredName() {
  return process.env.HUB_NAME
    || process.env.MTL_CODE_REMOTE_REPOSITORY_NAME
    || 'Agent/Skill Hub';
}

function configuredDescription() {
  return process.env.HUB_DESCRIPTION
    || process.env.MTL_CODE_REMOTE_REPOSITORY_DESCRIPTION
    || 'Shared Agent templates and Skills.';
}

function createEmptyStore() {
  return {
    schemaVersion: 1,
    name: configuredName(),
    description: configuredDescription(),
    updatedAt: nowIso(),
    items: [],
    submissions: [],
    likes: {},
  };
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

async function writeStore(store) {
  await ensureDir(path.dirname(STORE_PATH));
  await fsp.writeFile(
    STORE_PATH,
    JSON.stringify({
      ...store,
      schemaVersion: 1,
      name: store.name || configuredName(),
      description: store.description || configuredDescription(),
      updatedAt: nowIso(),
      items: Array.isArray(store.items) ? store.items : [],
      submissions: Array.isArray(store.submissions) ? store.submissions : [],
      likes: store.likes && typeof store.likes === 'object' ? store.likes : {},
    }, null, 2),
    { mode: 0o600 },
  );
}

async function ensureStore() {
  await ensureDir(PUBLISHED_DIR);
  await ensureDir(SUBMISSIONS_DIR);
  try {
    await fsp.access(STORE_PATH);
  } catch {
    await writeStore(createEmptyStore());
  }
}

async function readStore() {
  await ensureStore();
  try {
    const parsed = JSON.parse(await fsp.readFile(STORE_PATH, 'utf8'));
    return {
      ...createEmptyStore(),
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      likes: parsed.likes && typeof parsed.likes === 'object' ? parsed.likes : {},
    };
  } catch {
    return createEmptyStore();
  }
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

function publicKindLabel(kind) {
  return kind === 'skill' ? 'Skill' : 'Agent Template';
}

function publicItemId(kind, name) {
  return `${kind}-${sanitizeSlug(name)}`;
}

function createSubmissionId(kind, name) {
  return `${kind}-${sanitizeSlug(name)}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function safeTags(tags) {
  if (typeof tags === 'string') {
    return tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
  }
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function safeStringArray(value, limit = 24) {
  if (typeof value === 'string') {
    return safeTags(value).slice(0, limit);
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function safeSupportedApps(value) {
  if (typeof value === 'string') {
    return safeTags(value).map((label) => ({ id: sanitizeSlug(label), label }));
  }
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

function safeAppSlots(value) {
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
        options: safeSupportedApps(entry.options),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function escapeYamlDoubleQuoted(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n');
}

function formatAgentTemplateMarkdown({ name, description, content, tools, model, color }) {
  const lines = [
    '---',
    `name: ${name}`,
    `description: "${escapeYamlDoubleQuoted(description || 'Shared agent template')}"`,
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
  lines.push('---', '', String(content || '').trim(), '');
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
    `description: "${escapeYamlDoubleQuoted(description || title || 'Shared skill')}"`,
    '---',
    '',
    trimmed,
    '',
  ].join('\n');
}

function prepareContent(kind, payload) {
  const content = String(payload.content || '').trim();
  if (!content) {
    throw new Error('content is required');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new Error('content is too large');
  }

  const name = sanitizeSlug(payload.name || payload.title);
  if (!validateSlug(name)) {
    throw new Error('name must start with a letter or number and contain only letters, numbers, hyphens, and underscores');
  }

  const formatted = kind === 'skill'
    ? formatSkillMarkdown({ name, title: payload.title, description: payload.description, content })
    : formatAgentTemplateMarkdown({
        name,
        description: payload.description,
        content,
        tools: payload.tools,
        model: payload.model,
        color: payload.color,
      });

  return { name, formatted };
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
    files.push({ path: relativePath, buffer, size: buffer.length });
  }

  if (files.length === 0) {
    throw new Error('skill package must include at least one file');
  }
  if (requireSkillMd && !files.some((file) => file.path.toLowerCase() === 'skill.md')) {
    throw new Error('skill package must include SKILL.md at the package root');
  }
  return files;
}

function safeContentPath(contentPath) {
  const normalized = path.normalize(String(contentPath || ''));
  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null;
  }
  const resolved = path.resolve(CONTENT_ROOT, normalized);
  const root = path.resolve(CONTENT_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

function getPublishedContentPath(itemId) {
  return path.join('published', `${itemId}.md`);
}

function getSubmissionContentPath(submissionId) {
  return path.join('submissions', `${submissionId}.md`);
}

function getPublishedPackageRoot(itemId) {
  return path.join('published', itemId);
}

function getSubmissionPackageRoot(submissionId) {
  return path.join('submissions', submissionId);
}

async function readStoredContent(contentPath) {
  const resolved = safeContentPath(contentPath);
  if (!resolved) throw new Error('Invalid content path');
  return await fsp.readFile(resolved, 'utf8');
}

async function readStoredBuffer(contentPath) {
  const resolved = safeContentPath(contentPath);
  if (!resolved) throw new Error('Invalid content path');
  return await fsp.readFile(resolved);
}

async function writeStoredContent(contentPath, content) {
  const resolved = safeContentPath(contentPath);
  if (!resolved) throw new Error('Invalid content path');
  await ensureDir(path.dirname(resolved));
  await fsp.writeFile(resolved, content, { mode: 0o600 });
}

async function writeStoredBuffer(contentPath, buffer) {
  const resolved = safeContentPath(contentPath);
  if (!resolved) throw new Error('Invalid content path');
  await ensureDir(path.dirname(resolved));
  await fsp.writeFile(resolved, buffer, { mode: 0o600 });
}

async function writeStoredPackage(rootPath, files) {
  const root = safeContentPath(rootPath);
  if (!root) throw new Error('Invalid package path');
  await fsp.rm(root, { recursive: true, force: true });
  const packageFiles = [];
  for (const file of files) {
    const relativePath = safeRelativePath(file.path);
    if (!relativePath) throw new Error('Invalid package file path');
    const contentPath = path.join(rootPath, ...relativePath.split('/'));
    await writeStoredBuffer(contentPath, file.buffer);
    packageFiles.push({
      path: relativePath,
      contentPath,
      size: file.size,
    });
  }
  return packageFiles;
}

async function readStoredPackageFiles(packageFiles) {
  if (!Array.isArray(packageFiles) || packageFiles.length === 0) return [];
  const files = [];
  let totalBytes = 0;
  for (const file of packageFiles) {
    const relativePath = safeRelativePath(file.path);
    if (!relativePath || !file.contentPath) throw new Error('Invalid package file path');
    const buffer = await readStoredBuffer(file.contentPath);
    totalBytes += buffer.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`skill package is too large; maximum is ${Math.round(MAX_PACKAGE_BYTES / 1024 / 1024)}MB`);
    }
    files.push({ path: relativePath, buffer, size: buffer.length });
  }
  if (files.length > 0 && !files.some((file) => file.path.toLowerCase() === 'skill.md')) {
    throw new Error('skill package must include SKILL.md at the package root');
  }
  return files;
}

async function removeStoredContent(contentPath) {
  const resolved = safeContentPath(contentPath);
  if (resolved) {
    await fsp.rm(resolved, { force: true, recursive: true });
  }
}

function getOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

function publicCatalogUrl(req) {
  return `${getOrigin(req)}${PUBLIC_BASE_PATH}/catalog.json`;
}

function likeClientFingerprint(req, body = {}) {
  const explicitClient = body.clientId || req.headers['x-mtl-repository-client'];
  const source = explicitClient
    ? `client:${explicitClient}`
    : `request:${req.ip || ''}:${req.headers['user-agent'] || ''}:${req.headers['x-forwarded-for'] || ''}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

function getLikeEntry(store, itemId) {
  if (!store.likes[itemId] || typeof store.likes[itemId] !== 'object') {
    store.likes[itemId] = { count: 0, clients: {} };
  }
  if (!store.likes[itemId].clients || typeof store.likes[itemId].clients !== 'object') {
    store.likes[itemId].clients = {};
  }
  store.likes[itemId].count = Math.max(0, Number(store.likes[itemId].count || 0));
  return store.likes[itemId];
}

function currentLikes(store, itemId) {
  return Math.max(0, Number(store.likes?.[itemId]?.count || 0));
}

function encodePackagePath(relativePath) {
  return String(relativePath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function toCatalogItem(store, item) {
  const packageFiles = Array.isArray(item.packageFiles)
    ? item.packageFiles
      .map((file) => {
        const relativePath = safeRelativePath(file.path);
        if (!relativePath) return null;
        return {
          path: relativePath,
          size: Number(file.size || 0),
          contentUrl: `./content/${encodeURIComponent(item.id)}/${encodePackagePath(relativePath)}`,
        };
      })
      .filter(Boolean)
    : [];

  return {
    id: item.name,
    kind: item.kind,
    name: item.name,
    title: item.title || item.name,
    description: item.description || '',
    author: item.author || '',
    version: item.version || '1.0.0',
    tags: safeTags(item.tags),
    icon: item.icon || '',
    supportedApps: safeSupportedApps(item.supportedApps),
    appSlots: safeAppSlots(item.appSlots),
    capabilities: safeStringArray(item.capabilities),
    likes: currentLikes(store, item.id),
    downloads: Number(item.downloads || 0),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    contentUrl: packageFiles.length > 0
      ? `./content/${encodeURIComponent(item.id)}/SKILL.md`
      : `./content/${encodeURIComponent(item.id)}.md`,
    ...(packageFiles.length > 0 ? { packageFiles } : {}),
    likeUrl: `./items/${encodeURIComponent(item.id)}/like`,
  };
}

function toAdminSubmission(store, submission, includeContent = false, content = null) {
  return {
    id: submission.id,
    kind: submission.kind,
    name: submission.name,
    title: submission.title || submission.name,
    description: submission.description || '',
    author: submission.author || '',
    tags: safeTags(submission.tags),
    icon: submission.icon || '',
    supportedApps: safeSupportedApps(submission.supportedApps),
    appSlots: safeAppSlots(submission.appSlots),
    capabilities: safeStringArray(submission.capabilities),
    status: submission.status || 'pending',
    submittedAt: submission.submittedAt || null,
    reviewedAt: submission.reviewedAt || null,
    publishedItemId: submission.publishedItemId || null,
    rejectionReason: submission.rejectionReason || null,
    catalogItem: submission.publishedItemId
      ? toCatalogItem(store, store.items.find((item) => item.id === submission.publishedItemId) || submission)
      : null,
    ...(includeContent ? { content } : {}),
  };
}

function toAdminItem(store, item, includeContent = false, content = null) {
  return {
    ...item,
    likes: currentLikes(store, item.id),
    catalogItem: toCatalogItem(store, item),
    ...(includeContent ? { content } : {}),
  };
}

function getSubmitToken() {
  return process.env.HUB_SUBMIT_TOKEN || process.env.MTL_CODE_REPOSITORY_SUBMIT_TOKEN || '';
}

function getAdminToken() {
  return process.env.HUB_ADMIN_TOKEN || process.env.MTL_CODE_HUB_ADMIN_TOKEN || '';
}

function displayHost(host) {
  return host === '0.0.0.0' || host === '::' ? 'localhost' : host;
}

function getLanAccessUrls() {
  if (HOST !== '0.0.0.0' && HOST !== '::') return [];
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => `http://${entry.address}:${PORT}`);
}

function contentTypeForPath(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'text/markdown; charset=utf-8';
  if (extension === '.txt' || extension === '.log') return 'text/plain; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(extension)) return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.html' || extension === '.htm') return 'text/html; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function requestToken(req) {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return bearer
    || req.headers['x-hub-admin-token']
    || req.headers['x-repository-admin-token']
    || req.headers['x-repository-submit-token']
    || req.body?.adminToken
    || req.body?.submitToken
    || '';
}

function isLoopbackRequest(req) {
  const remote = req.socket.remoteAddress || '';
  return remote === '127.0.0.1'
    || remote === '::1'
    || remote === '::ffff:127.0.0.1'
    || remote === 'localhost';
}

function requireSubmitTokenIfConfigured(req, res, next) {
  const configured = getSubmitToken();
  if (!configured) return next();
  if (requestToken(req) !== configured) {
    return res.status(401).json({ error: 'Invalid repository submit token' });
  }
  return next();
}

function requireAdmin(req, res, next) {
  const configured = getAdminToken();
  if (configured) {
    if (requestToken(req) === configured) return next();
    return res.status(401).json({ error: 'Invalid Hub admin token' });
  }
  if (isLoopbackRequest(req)) return next();
  return res.status(401).json({ error: 'Hub admin token is required for non-local requests' });
}

async function createSubmission(payload, req) {
  const kind = normalizeKind(payload.kind);
  if (!kind) throw new Error('kind must be "agent-template" or "skill"');

  let name;
  let formatted = null;
  let packageFiles = [];
  if (kind === 'skill' && Array.isArray(payload.packageFiles) && payload.packageFiles.length > 0) {
    name = sanitizeSlug(payload.name || payload.title);
    if (!validateSlug(name)) {
      throw new Error('name must start with a letter or number and contain only letters, numbers, hyphens, and underscores');
    }
    packageFiles = normalizePackageFiles(payload.packageFiles, { requireSkillMd: true });
  } else {
    const prepared = prepareContent(kind, payload);
    name = prepared.name;
    formatted = prepared.formatted;
  }

  const submissionId = createSubmissionId(kind, name);
  let contentPath = getSubmissionContentPath(submissionId);
  let storedPackageFiles = [];
  if (packageFiles.length > 0) {
    const packageRoot = getSubmissionPackageRoot(submissionId);
    storedPackageFiles = await writeStoredPackage(packageRoot, packageFiles);
    contentPath = path.join(packageRoot, 'SKILL.md');
  } else {
    await writeStoredContent(contentPath, formatted);
  }

  return {
    id: submissionId,
    kind,
    name,
    title: String(payload.title || name).trim(),
    description: String(payload.description || '').trim(),
    author: String(payload.author || '').trim(),
    tags: safeTags(payload.tags),
    icon: typeof payload.icon === 'string' ? payload.icon.trim() : '',
    supportedApps: safeSupportedApps(payload.supportedApps || payload.apps || payload.integrations),
    appSlots: safeAppSlots(payload.appSlots || payload.setupSlots || payload.applicationSlots),
    capabilities: safeStringArray(payload.capabilities || payload.features),
    status: 'pending',
    contentPath,
    ...(storedPackageFiles.length > 0 ? { packageFiles: storedPackageFiles } : {}),
    submittedAt: nowIso(),
    submitterIpHash: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex'),
  };
}

async function publishSubmission(store, submission, payload = {}) {
  const kind = normalizeKind(payload.kind || submission.kind);
  if (!kind) throw new Error('Invalid submission kind');

  const name = sanitizeSlug(payload.name || submission.name);
  if (!validateSlug(name)) throw new Error('Invalid publish name');

  const itemId = publicItemId(kind, name);
  const existingIndex = store.items.findIndex((item) => item.id === itemId);
  if (existingIndex >= 0 && !payload.overwrite) {
    const existing = store.items[existingIndex];
    if (existing.id !== submission.publishedItemId) {
      throw new Error(`${publicKindLabel(kind)} "${name}" already exists`);
    }
  }

  let publishedContentPath = getPublishedContentPath(itemId);
  let publishedPackageFiles = [];
  if (kind === 'skill' && Array.isArray(payload.packageFiles) && payload.packageFiles.length > 0) {
    const files = normalizePackageFiles(payload.packageFiles, { requireSkillMd: true });
    const packageRoot = getPublishedPackageRoot(itemId);
    publishedPackageFiles = await writeStoredPackage(packageRoot, files);
    publishedContentPath = path.join(packageRoot, 'SKILL.md');
  } else if (kind === 'skill' && Array.isArray(submission.packageFiles) && submission.packageFiles.length > 0 && !(typeof payload.content === 'string' && payload.content.trim())) {
    const files = await readStoredPackageFiles(submission.packageFiles);
    const packageRoot = getPublishedPackageRoot(itemId);
    publishedPackageFiles = await writeStoredPackage(packageRoot, files);
    publishedContentPath = path.join(packageRoot, 'SKILL.md');
  } else {
    const content = typeof payload.content === 'string' && payload.content.trim()
      ? prepareContent(kind, { ...submission, ...payload, name }).formatted
      : await readStoredContent(submission.contentPath);
    await writeStoredContent(publishedContentPath, content);
  }

  const previous = existingIndex >= 0 ? store.items[existingIndex] : null;
  const item = {
    id: itemId,
    kind,
    name,
    title: String(payload.title || submission.title || name).trim(),
    description: String(payload.description ?? submission.description ?? '').trim(),
    author: String(payload.author ?? submission.author ?? '').trim(),
    tags: safeTags(payload.tags || submission.tags),
    icon: typeof payload.icon === 'string' ? payload.icon.trim() : submission.icon || '',
    supportedApps: safeSupportedApps(payload.supportedApps || submission.supportedApps),
    appSlots: safeAppSlots(payload.appSlots || submission.appSlots),
    capabilities: safeStringArray(payload.capabilities || submission.capabilities),
    version: String(payload.version || previous?.version || '1.0.0').trim(),
    status: 'published',
    contentPath: publishedContentPath,
    ...(publishedPackageFiles.length > 0 ? { packageFiles: publishedPackageFiles } : {}),
    downloads: Number(previous?.downloads || 0),
    createdAt: previous?.createdAt || nowIso(),
    updatedAt: nowIso(),
    publishedAt: previous?.publishedAt || nowIso(),
  };

  if (existingIndex >= 0) {
    store.items[existingIndex] = item;
  } else {
    store.items.push(item);
  }
  getLikeEntry(store, itemId);
  submission.status = 'published';
  submission.reviewedAt = nowIso();
  submission.publishedItemId = itemId;
  delete submission.rejectionReason;
  return item;
}

async function publishDirect(store, payload) {
  const kind = normalizeKind(payload.kind);
  if (!kind) throw new Error('kind must be "agent-template" or "skill"');

  let name;
  let formatted = null;
  let packageFiles = [];
  if (kind === 'skill' && Array.isArray(payload.packageFiles) && payload.packageFiles.length > 0) {
    name = sanitizeSlug(payload.name || payload.title);
    if (!validateSlug(name)) {
      throw new Error('name must start with a letter or number and contain only letters, numbers, hyphens, and underscores');
    }
    packageFiles = normalizePackageFiles(payload.packageFiles, { requireSkillMd: true });
  } else {
    const prepared = prepareContent(kind, payload);
    name = prepared.name;
    formatted = prepared.formatted;
  }

  const itemId = publicItemId(kind, name);
  const existingIndex = store.items.findIndex((item) => item.id === itemId);
  if (existingIndex >= 0 && !payload.overwrite) {
    throw new Error(`${publicKindLabel(kind)} "${name}" already exists`);
  }

  let contentPath = getPublishedContentPath(itemId);
  let storedPackageFiles = [];
  if (packageFiles.length > 0) {
    const packageRoot = getPublishedPackageRoot(itemId);
    storedPackageFiles = await writeStoredPackage(packageRoot, packageFiles);
    contentPath = path.join(packageRoot, 'SKILL.md');
  } else {
    await writeStoredContent(contentPath, formatted);
  }

  const previous = existingIndex >= 0 ? store.items[existingIndex] : null;
  const item = {
    id: itemId,
    kind,
    name,
    title: String(payload.title || name).trim(),
    description: String(payload.description || '').trim(),
    author: String(payload.author || '').trim(),
    tags: safeTags(payload.tags),
    icon: typeof payload.icon === 'string' ? payload.icon.trim() : '',
    supportedApps: safeSupportedApps(payload.supportedApps || payload.apps || payload.integrations),
    appSlots: safeAppSlots(payload.appSlots || payload.setupSlots || payload.applicationSlots),
    capabilities: safeStringArray(payload.capabilities || payload.features),
    version: String(payload.version || previous?.version || '1.0.0').trim(),
    status: 'published',
    contentPath,
    ...(storedPackageFiles.length > 0 ? { packageFiles: storedPackageFiles } : {}),
    downloads: Number(previous?.downloads || 0),
    createdAt: previous?.createdAt || nowIso(),
    updatedAt: nowIso(),
    publishedAt: previous?.publishedAt || nowIso(),
  };

  if (existingIndex >= 0) {
    store.items[existingIndex] = item;
  } else {
    store.items.push(item);
  }
  getLikeEntry(store, itemId);
  return item;
}

const publicRouter = express.Router();
const adminRouter = express.Router();

publicRouter.get('/catalog.json', async (req, res) => {
  try {
    const store = await readStore();
    const publishedItems = store.items.filter((item) => item.status === 'published');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      schemaVersion: 1,
      name: store.name,
      description: store.description,
      updatedAt: store.updatedAt,
      items: publishedItems.map((item) => toCatalogItem(store, item)),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read repository catalog', details: error.message });
  }
});

publicRouter.get('/content/:itemId/*', async (req, res) => {
  try {
    const itemId = String(req.params.itemId || '');
    const relativePath = safeRelativePath(req.params[0]);
    if (!relativePath) return res.status(400).json({ error: 'Invalid package file path' });

    const store = await readStore();
    const item = store.items.find((candidate) => candidate.id === itemId && candidate.status === 'published');
    if (!item || !Array.isArray(item.packageFiles)) return res.status(404).json({ error: 'Repository item not found' });

    const packageFile = item.packageFiles.find((file) => String(file.path || '').toLowerCase() === relativePath.toLowerCase());
    if (!packageFile) return res.status(404).json({ error: 'Package file not found' });

    const content = await readStoredBuffer(packageFile.contentPath);
    if (relativePath.toLowerCase() === 'skill.md') {
      item.downloads = Number(item.downloads || 0) + 1;
      await writeStore(store);
    }

    res.setHeader('Content-Type', contentTypeForPath(relativePath));
    res.setHeader('Cache-Control', 'no-store');
    return res.send(content);
  } catch (error) {
    return res.status(404).json({ error: 'Repository package file not found', details: error.message });
  }
});

publicRouter.get('/content/:itemFile', async (req, res) => {
  try {
    const itemId = String(req.params.itemFile || '').replace(/\.md$/i, '');
    const store = await readStore();
    const item = store.items.find((candidate) => candidate.id === itemId && candidate.status === 'published');
    if (!item) return res.status(404).json({ error: 'Repository item not found' });

    const content = await readStoredContent(item.contentPath);
    item.downloads = Number(item.downloads || 0) + 1;
    await writeStore(store);

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(content);
  } catch (error) {
    return res.status(404).json({ error: 'Repository content not found', details: error.message });
  }
});

publicRouter.post('/items/:itemId/like', async (req, res) => {
  try {
    const itemId = String(req.params.itemId || '');
    const store = await readStore();
    const item = store.items.find((candidate) => candidate.id === itemId && candidate.status === 'published');
    if (!item) return res.status(404).json({ error: 'Repository item not found' });

    const fingerprint = likeClientFingerprint(req, req.body || {});
    const likeEntry = getLikeEntry(store, itemId);
    const currentLiked = Boolean(likeEntry.clients[fingerprint]);
    const nextLiked = req.body?.liked === undefined ? !currentLiked : Boolean(req.body.liked);

    if (nextLiked && !currentLiked) {
      likeEntry.clients[fingerprint] = true;
      likeEntry.count += 1;
    } else if (!nextLiked && currentLiked) {
      delete likeEntry.clients[fingerprint];
      likeEntry.count = Math.max(0, likeEntry.count - 1);
    }

    item.updatedAt = nowIso();
    await writeStore(store);
    return res.json({ success: true, liked: nextLiked, likes: likeEntry.count, item: toCatalogItem(store, item) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update like', details: error.message });
  }
});

publicRouter.post('/submit', requireSubmitTokenIfConfigured, async (req, res) => {
  try {
    const store = await readStore();
    const submission = await createSubmission(req.body || {}, req);
    store.submissions.push(submission);
    await writeStore(store);
    return res.status(202).json({ success: true, submission: toAdminSubmission(store, submission), status: 'pending' });
  } catch (error) {
    return res.status(400).json({ error: 'Failed to submit repository item', details: error.message });
  }
});

adminRouter.use(requireAdmin);

adminRouter.get('/status', async (req, res) => {
  try {
    const store = await readStore();
    res.json({
      success: true,
      repository: {
        root: DATA_ROOT,
        catalogUrl: publicCatalogUrl(req),
        publicBasePath: PUBLIC_BASE_PATH,
        publishedItems: store.items.filter((item) => item.status === 'published').length,
        pendingSubmissions: store.submissions.filter((submission) => submission.status === 'pending').length,
        rejectedSubmissions: store.submissions.filter((submission) => submission.status === 'rejected').length,
        submitTokenRequired: Boolean(getSubmitToken()),
        adminTokenRequired: Boolean(getAdminToken()),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read repository status', details: error.message });
  }
});

adminRouter.get('/catalog', async (req, res) => {
  try {
    const store = await readStore();
    res.json({
      success: true,
      catalogUrl: publicCatalogUrl(req),
      catalog: {
        schemaVersion: 1,
        name: store.name,
        description: store.description,
        updatedAt: store.updatedAt,
        items: store.items.filter((item) => item.status === 'published').map((item) => toCatalogItem(store, item)),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read repository catalog', details: error.message });
  }
});

adminRouter.get('/submissions', async (req, res) => {
  try {
    const status = String(req.query.status || 'pending');
    const store = await readStore();
    const submissions = store.submissions
      .filter((submission) => status === 'all' || (submission.status || 'pending') === status)
      .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    res.json({ success: true, submissions: submissions.map((submission) => toAdminSubmission(store, submission)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read submissions', details: error.message });
  }
});

adminRouter.get('/submissions/:submissionId', async (req, res) => {
  try {
    const store = await readStore();
    const submission = store.submissions.find((candidate) => candidate.id === req.params.submissionId);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    const content = await readStoredContent(submission.contentPath);
    return res.json({ success: true, submission: toAdminSubmission(store, submission, true, content) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to read submission', details: error.message });
  }
});

adminRouter.post('/submissions/:submissionId/publish', async (req, res) => {
  try {
    const store = await readStore();
    const submission = store.submissions.find((candidate) => candidate.id === req.params.submissionId);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const item = await publishSubmission(store, submission, req.body || {});
    await writeStore(store);
    return res.json({ success: true, item: toAdminItem(store, item), submission: toAdminSubmission(store, submission) });
  } catch (error) {
    const status = /already exists/i.test(error.message) ? 409 : 400;
    return res.status(status).json({ error: 'Failed to publish submission', details: error.message });
  }
});

adminRouter.post('/submissions/:submissionId/reject', async (req, res) => {
  try {
    const store = await readStore();
    const submission = store.submissions.find((candidate) => candidate.id === req.params.submissionId);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    submission.status = 'rejected';
    submission.reviewedAt = nowIso();
    submission.rejectionReason = String(req.body?.reason || '').trim();
    await writeStore(store);
    return res.json({ success: true, submission: toAdminSubmission(store, submission) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reject submission', details: error.message });
  }
});

adminRouter.get('/items', async (req, res) => {
  try {
    const store = await readStore();
    const items = store.items
      .filter((item) => item.status === 'published')
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json({ success: true, items: items.map((item) => toAdminItem(store, item)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read repository items', details: error.message });
  }
});

adminRouter.post('/items', async (req, res) => {
  try {
    const store = await readStore();
    const item = await publishDirect(store, req.body || {});
    await writeStore(store);
    res.status(201).json({ success: true, item: toAdminItem(store, item) });
  } catch (error) {
    const status = /already exists/i.test(error.message) ? 409 : 400;
    res.status(status).json({ error: 'Failed to publish repository item', details: error.message });
  }
});

adminRouter.get('/items/:itemId', async (req, res) => {
  try {
    const store = await readStore();
    const item = store.items.find((candidate) => candidate.id === req.params.itemId && candidate.status === 'published');
    if (!item) return res.status(404).json({ error: 'Repository item not found' });
    const content = await readStoredContent(item.contentPath);
    return res.json({ success: true, item: toAdminItem(store, item, true, content) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to read repository item', details: error.message });
  }
});

adminRouter.patch('/items/:itemId', async (req, res) => {
  try {
    const store = await readStore();
    const index = store.items.findIndex((candidate) => candidate.id === req.params.itemId && candidate.status === 'published');
    if (index < 0) return res.status(404).json({ error: 'Repository item not found' });

    const current = store.items[index];
    const next = {
      ...current,
      title: typeof req.body?.title === 'string' ? req.body.title.trim() : current.title,
      description: typeof req.body?.description === 'string' ? req.body.description.trim() : current.description,
      author: typeof req.body?.author === 'string' ? req.body.author.trim() : current.author,
      tags: Array.isArray(req.body?.tags) || typeof req.body?.tags === 'string' ? safeTags(req.body.tags) : current.tags,
      icon: typeof req.body?.icon === 'string' ? req.body.icon.trim() : current.icon,
      supportedApps: Array.isArray(req.body?.supportedApps) || typeof req.body?.supportedApps === 'string'
        ? safeSupportedApps(req.body.supportedApps)
        : current.supportedApps,
      appSlots: Array.isArray(req.body?.appSlots) ? safeAppSlots(req.body.appSlots) : current.appSlots,
      capabilities: Array.isArray(req.body?.capabilities) || typeof req.body?.capabilities === 'string'
        ? safeStringArray(req.body.capabilities)
        : current.capabilities,
      version: typeof req.body?.version === 'string' ? req.body.version.trim() : current.version,
      updatedAt: nowIso(),
    };

    if (typeof req.body?.content === 'string' && req.body.content.trim()) {
      const prepared = prepareContent(current.kind, { ...next, content: req.body.content });
      await writeStoredContent(current.contentPath, prepared.formatted);
    }

    store.items[index] = next;
    await writeStore(store);
    return res.json({ success: true, item: toAdminItem(store, next) });
  } catch (error) {
    return res.status(400).json({ error: 'Failed to update repository item', details: error.message });
  }
});

adminRouter.delete('/items/:itemId', async (req, res) => {
  try {
    const store = await readStore();
    const index = store.items.findIndex((candidate) => candidate.id === req.params.itemId);
    if (index < 0) return res.status(404).json({ error: 'Repository item not found' });

    const [removed] = store.items.splice(index, 1);
    await removeStoredContent(Array.isArray(removed.packageFiles) && removed.packageFiles.length > 0
      ? path.dirname(removed.contentPath)
      : removed.contentPath);
    delete store.likes[removed.id];
    await writeStore(store);
    return res.json({ success: true, item: removed });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete repository item', details: error.message });
  }
});

app.use(PUBLIC_BASE_PATH, publicRouter);
app.use(ADMIN_BASE_PATH, adminRouter);
app.use('/api/agent-repository-server', adminRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'agent-skill-hub', catalogUrl: `${getOrigin(req)}${PUBLIC_BASE_PATH}/catalog.json` });
});

await ensureStore();

app.listen(PORT, HOST, () => {
  const adminMode = getAdminToken() ? 'token protected' : 'local-only without HUB_ADMIN_TOKEN';
  const localUrl = `http://${displayHost(HOST)}:${PORT}`;
  console.log(`Agent/Skill Hub listening on ${HOST}:${PORT}`);
  console.log(`Local URL: ${localUrl}`);
  console.log(`Catalog URL: ${localUrl}${PUBLIC_BASE_PATH}/catalog.json`);
  for (const url of getLanAccessUrls()) {
    console.log(`LAN URL: ${url}`);
  }
  console.log(`Data root: ${DATA_ROOT}`);
  console.log(`Admin: ${adminMode}`);
});
