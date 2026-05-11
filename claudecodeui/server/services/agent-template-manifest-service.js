const MAX_PACKAGE_FILES = 200;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_DIALOG_FIELDS = 24;
const MAX_DIALOG_OPTIONS = 48;
const MAX_DIALOG_PRESETS = 12;
const ALLOWED_DIALOG_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'select',
  'multiselect',
  'boolean',
  'number',
  'path',
  'mcpServer',
  'skill',
  'modelProfile',
]);
const FORBIDDEN_DIALOG_KEYS = new Set([
  'html',
  'script',
  'component',
  'renderer',
  'remoteUrl',
  'iframe',
]);

function sanitizeSlug(input, fallback = 'agent-template') {
  const slug = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function normalizeString(value, fallback = '', maxLength = 240) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeStringArray(value, maxItems = 40, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const text = normalizeString(entry, '', maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function safeRelativePath(input) {
  const raw = String(input || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  const normalized = parts.join('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  return normalized;
}

export function normalizeTemplatePackageFiles(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (value.length > MAX_PACKAGE_FILES) {
    throw new Error(`agent template package can include at most ${MAX_PACKAGE_FILES} files`);
  }

  const files = [];
  const lowerPaths = new Map();
  let totalBytes = 0;

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const relativePath = safeRelativePath(entry.path || entry.name);
    if (!relativePath || relativePath.endsWith('/')) {
      throw new Error('agent template package contains an invalid file path');
    }

    const lowerPath = relativePath.toLowerCase();
    const existing = lowerPaths.get(lowerPath);
    if (existing) {
      throw new Error(`case-only package path collision: ${existing} and ${relativePath}`);
    }
    lowerPaths.set(lowerPath, relativePath);

    const encoding = entry.encoding === 'base64' ? 'base64' : 'utf8';
    if (typeof entry.content !== 'string') {
      throw new Error(`agent template package file ${relativePath} is missing content`);
    }
    const buffer = Buffer.from(entry.content, encoding);
    totalBytes += buffer.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`agent template package is too large; maximum is ${Math.round(MAX_PACKAGE_BYTES / 1024 / 1024)}MB`);
    }
    files.push({ path: relativePath, buffer, size: buffer.length });
  }

  return files;
}

function normalizeDependency(value, kind, optional) {
  if (typeof value === 'string') {
    const name = normalizeString(value, '', 120);
    return name ? { kind, name, optional } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const name = normalizeString(
    value.name || value.serverName || value.profileId || value.id || value.itemId || value.title,
    '',
    120,
  );
  if (!name) return null;
  return {
    kind,
    name,
    ...(typeof value.id === 'string' ? { id: normalizeString(value.id, '', 120) } : {}),
    ...(typeof value.itemId === 'string' ? { itemId: normalizeString(value.itemId, '', 120) } : {}),
    ...(typeof value.repoId === 'string' ? { repoId: normalizeString(value.repoId, '', 120) } : {}),
    optional: typeof value.optional === 'boolean' ? value.optional : optional,
    ...(value.configuration && typeof value.configuration === 'object' ? { configuration: value.configuration } : {}),
  };
}

function collectDependencyGroup(target, source, optional) {
  const addMany = (entries, kind, listName) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      const normalized = normalizeDependency(entry, kind, optional);
      if (!normalized) continue;
      const list = target[listName];
      const key = `${normalized.repoId || ''}:${normalized.itemId || normalized.id || normalized.name}`.toLowerCase();
      if (!list.some((candidate) => `${candidate.repoId || ''}:${candidate.itemId || candidate.id || candidate.name}`.toLowerCase() === key)) {
        list.push(normalized);
      }
    }
  };

  if (!source || typeof source !== 'object') return;
  addMany(source.skills || source.skillDependencies || source.requiredSkills, 'skill', 'skills');
  addMany(source.mcpServers || source.mcp || source.requiredMcpServers, 'mcp-server', 'mcpServers');
  addMany(source.modelProfiles || source.models || source.requiredModelProfiles, 'model-profile', 'modelProfiles');
}

export function normalizeAgentTemplateDependencies(value = {}) {
  const dependencies = { skills: [], mcpServers: [], modelProfiles: [] };
  if (Array.isArray(value)) {
    collectDependencyGroup(dependencies, { skills: value }, false);
    return dependencies;
  }

  collectDependencyGroup(dependencies, value, false);
  collectDependencyGroup(dependencies, value?.required, false);
  collectDependencyGroup(dependencies, value?.optional, true);
  return dependencies;
}

function normalizeScalar(value) {
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeDialogAnswerValue(field, value) {
  if (!field) return undefined;
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (field.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  if (field.type === 'multiselect') {
    if (!Array.isArray(value)) return undefined;
    const selected = normalizeStringArray(value, MAX_DIALOG_OPTIONS, 160);
    return selected.length > 0 ? selected : [];
  }
  return typeof value === 'string' ? value.slice(0, 2000) : undefined;
}

function normalizeDialogPreset(preset, fieldsById) {
  if (!preset || typeof preset !== 'object') return null;
  const id = sanitizeSlug(preset.id || preset.name || preset.label, '');
  const label = normalizeString(preset.label || preset.title || id, id, 120);
  if (!id || !label) return null;

  const rawAnswers = preset.answers && typeof preset.answers === 'object' && !Array.isArray(preset.answers)
    ? preset.answers
    : {};
  const answers = {};
  for (const [rawKey, rawValue] of Object.entries(rawAnswers)) {
    const key = normalizeString(rawKey, '', 80)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const field = fieldsById.get(key);
    if (!field) {
      throw new Error(`unknown dialog field in preset "${id}": ${rawKey}`);
    }
    const normalizedValue = normalizeDialogAnswerValue(field, rawValue);
    if (normalizedValue === undefined) {
      throw new Error(`invalid preset answer for field "${key}" in preset "${id}"`);
    }
    answers[key] = normalizedValue;
  }

  const description = normalizeString(preset.description || preset.help, '', 500);
  return {
    id,
    label,
    ...(description ? { description } : {}),
    answers,
  };
}

function assertNoExecutableDialogKeys(field) {
  for (const key of Object.keys(field)) {
    if (FORBIDDEN_DIALOG_KEYS.has(key)) {
      throw new Error(`unsupported executable dialog key: ${key}`);
    }
  }
}

function normalizeDialogField(field) {
  if (!field || typeof field !== 'object') return null;
  const type = normalizeString(field.type || 'text', 'text', 40);
  if (!ALLOWED_DIALOG_FIELD_TYPES.has(type)) {
    throw new Error(`unsupported dialog field type: ${type}`);
  }
  assertNoExecutableDialogKeys(field);
  const id = normalizeString(field.id || field.key || field.name, '', 80)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const label = normalizeString(field.label || field.title || id, id, 120);
  if (!id || !label) return null;

  const normalized = {
    id,
    label,
    type,
    required: Boolean(field.required),
  };
  const placeholder = normalizeString(field.placeholder, '', 240);
  const description = normalizeString(field.description || field.help, '', 500);
  const defaultValue = normalizeScalar(field.defaultValue ?? field.default);
  const options = normalizeStringArray(field.options, MAX_DIALOG_OPTIONS, 160);
  if (placeholder) normalized.placeholder = placeholder;
  if (description) normalized.description = description;
  if (defaultValue !== undefined) normalized.defaultValue = defaultValue;
  if (options.length > 0) normalized.options = options;
  return normalized;
}

export function normalizeDialogSchema(value) {
  if (!value || typeof value !== 'object') return null;
  const fields = Array.isArray(value.fields)
    ? value.fields.map(normalizeDialogField).filter(Boolean).slice(0, MAX_DIALOG_FIELDS)
    : [];
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const rawPresets = Array.isArray(value.presets) ? value.presets : [];
  if (rawPresets.length > MAX_DIALOG_PRESETS) {
    throw new Error(`dialog schema can include at most ${MAX_DIALOG_PRESETS} presets`);
  }
  const presets = rawPresets
    .map((preset) => normalizeDialogPreset(preset, fieldsById))
    .filter(Boolean);
  const presetIds = new Set();
  const dedupedPresets = [];
  for (const preset of presets) {
    if (presetIds.has(preset.id)) continue;
    presetIds.add(preset.id);
    dedupedPresets.push(preset);
  }
  const requestedDefaultPresetId = sanitizeSlug(value.defaultPresetId || value.defaultPreset || '', '');
  const defaultPresetId = requestedDefaultPresetId && presetIds.has(requestedDefaultPresetId)
    ? requestedDefaultPresetId
    : dedupedPresets[0]?.id || '';
  return {
    title: normalizeString(value.title, '', 120),
    description: normalizeString(value.description, '', 500),
    fields,
    ...(dedupedPresets.length > 0 ? { presets: dedupedPresets } : {}),
    ...(defaultPresetId ? { defaultPresetId } : {}),
  };
}

export function normalizeAgentTemplateDialogs(value = {}) {
  if (!value || typeof value !== 'object') return {};
  const dialogs = {};
  for (const key of ['setup', 'launch', 'result']) {
    const schema = normalizeDialogSchema(value[key]);
    if (schema && (schema.title || schema.description || schema.fields.length > 0 || schema.presets?.length > 0)) {
      dialogs[key] = schema;
    }
  }
  return dialogs;
}

function normalizeRuntime(value = {}) {
  const runtime = value && typeof value === 'object' ? value : {};
  return {
    tools: normalizeStringArray(runtime.tools, 80, 120),
    model: normalizeString(runtime.model, '', 160),
    permissionMode: normalizeString(runtime.permissionMode, '', 80),
    ...(runtime.mcpServers && typeof runtime.mcpServers === 'object' ? { mcpServers: runtime.mcpServers } : {}),
  };
}

function normalizeExamples(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((example) => {
      if (!example || typeof example !== 'object') return null;
      const title = normalizeString(example.title || example.name, '', 120);
      const transcript = Array.isArray(example.transcript)
        ? example.transcript
            .map((turn) => {
              if (!turn || typeof turn !== 'object') return null;
              const role = ['user', 'assistant', 'system'].includes(turn.role) ? turn.role : 'user';
              const content = normalizeString(turn.content, '', 4000);
              return content ? { role, content } : null;
            })
            .filter(Boolean)
            .slice(0, 20)
        : [];
      return title || transcript.length > 0 ? { title, transcript } : null;
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeCompat(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    ...(value.claudeCode ? { claudeCode: normalizeString(value.claudeCode, '', 80) } : {}),
    ...(value.argusUi ? { argusUi: normalizeString(value.argusUi, '', 80) } : {}),
    ...(value.mtlCode ? { mtlCode: normalizeString(value.mtlCode, '', 80) } : {}),
  };
}

export function normalizeAgentTemplateManifest(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = sanitizeSlug(source.id || source.name || fallback.id || fallback.name);
  const dependencySource = source.dependencies || source.requires || {
    skills: source.skills || source.skillDependencies || source.requiredSkills,
    mcpServers: source.mcpServers || source.mcps || source.mcpDependencies || source.requiredMcpServers || source.requiredMcps,
    modelProfiles: source.modelProfiles || source.models || source.requiredModelProfiles,
  };
  return {
    schemaVersion: Number.isFinite(Number(source.schemaVersion)) ? Number(source.schemaVersion) : 1,
    id,
    version: normalizeString(source.version, fallback.version || '1.0.0', 40),
    kind: 'agent-template',
    runtime: normalizeRuntime(source.runtime),
    dependencies: normalizeAgentTemplateDependencies(dependencySource),
    dialogs: normalizeAgentTemplateDialogs(source.dialogs),
    examples: normalizeExamples(source.examples),
    compat: normalizeCompat(source.compat),
  };
}
