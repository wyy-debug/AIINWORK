import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listBuiltInRecipes } from '../../shared/recipes.js';

const CAPABILITY_KINDS = new Set(['skill', 'mcp-server', 'recipe', 'workflow', 'agent-template']);

function normalizeString(value, fallback = '', maxLength = 240) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function sanitizeSlug(value, fallback = 'capability') {
  const slug = normalizeString(value, fallback, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function normalizeKind(value) {
  const kind = normalizeString(value, 'skill', 40).toLowerCase();
  if (kind === 'mcp' || kind === 'mcp_server' || kind === 'mcp-server-template') return 'mcp-server';
  if (kind === 'agent' || kind === 'template') return 'agent-template';
  if (kind === 'workflow-package') return 'workflow';
  return CAPABILITY_KINDS.has(kind) ? kind : 'skill';
}

function normalizeStringArray(value, maxItems = 40) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const text = normalizeString(entry, '', 120);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizeDependencies(value = {}) {
  return {
    skills: normalizeStringArray(value.skills || value.requiredSkills),
    mcpServers: normalizeStringArray(value.mcpServers || value.requiredMcpServers || value.mcp),
    recipes: normalizeStringArray(value.recipes || value.requiredRecipes),
    workflows: normalizeStringArray(value.workflows || value.requiredWorkflows),
  };
}

function normalizeSetupFields(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((field) => {
      if (!field || typeof field !== 'object') return null;
      const key = normalizeString(field.key || field.id || field.name, '', 120);
      if (!key) return null;
      return {
        key,
        label: normalizeString(field.label || key, key, 120),
        required: Boolean(field.required),
        type: normalizeString(field.type || 'text', 'text', 40),
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeConfiguration(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const normalizedKey = normalizeString(key, '', 120);
    if (!normalizedKey) continue;
    const text = normalizeString(rawValue, '', 4000);
    if (!text) continue;
    result[normalizedKey] = text;
  }
  return result;
}

function hasRequiredConfiguration(setupFields = [], configuration = {}) {
  return setupFields
    .filter((field) => field.required)
    .every((field) => Boolean(normalizeString(configuration[field.key], '', 4000)));
}

export function normalizeCapabilityMarketplaceItem(value = {}, options = {}) {
  const kind = normalizeKind(value.kind || value.type);
  const rawId = value.id || value.itemId || value.name || value.title;
  const slug = sanitizeSlug(String(rawId || '').replace(/^(skill|mcp-server|recipe|workflow|agent-template)-/, ''), kind);
  const id = `${kind}-${slug}`;
  const setupFields = normalizeSetupFields(value.setupFields || value.mcp?.setupFields || value.configurationFields);
  const installed = options.installed === true || value.installState === 'installed' || value.installed === true;
  const hasEnabledOverride = Object.prototype.hasOwnProperty.call(options, 'enabled')
    || Object.prototype.hasOwnProperty.call(value, 'enabled');
  const enabled = hasEnabledOverride ? (options.enabled === true || value.enabled === true) : installed;
  const configuration = normalizeConfiguration(options.configuration || value.configuration || {});
  const configurationStatus = setupFields.some((field) => field.required) && !hasRequiredConfiguration(setupFields, configuration)
    ? 'needs-configuration'
    : 'ready';

  return {
    id,
    kind,
    name: normalizeString(value.name || value.title || slug, slug, 160),
    title: normalizeString(value.title || value.displayName || value.name || slug, slug, 160),
    description: normalizeString(value.description || '', '', 1000),
    source: normalizeString(value.source || value.repoName || value.provider || 'marketplace', 'marketplace', 120),
    repoId: normalizeString(value.repoId || '', '', 120),
    itemId: normalizeString(value.itemId || value.id || '', '', 120),
    tags: normalizeStringArray(value.tags, 24),
    dependencies: normalizeDependencies(value.dependencies || value),
    setupFields,
    setupRequired: setupFields.some((field) => field.required),
    installState: installed ? 'installed' : 'available',
    enabled,
    configurationStatus,
  };
}

export function getBuiltInEnterpriseCapabilities() {
  const enterpriseMcp = [
    {
      kind: 'mcp-server',
      id: 'redmine',
      name: 'Redmine',
      description: 'Connect Redmine issues, comments, and acceptance criteria to agent workflows.',
      source: 'MTL local enterprise',
      tags: ['issue-tracking', 'enterprise'],
      setupFields: [
        { key: 'REDMINE_URL', label: 'Redmine URL', required: true },
        { key: 'REDMINE_TOKEN', label: 'API token', required: true, type: 'password' },
      ],
    },
    {
      kind: 'mcp-server',
      id: 'wechat',
      name: 'WeChat',
      description: 'Bridge team notifications and approvals through WeChat enterprise workflows.',
      source: 'MTL local enterprise',
      tags: ['chatops', 'enterprise'],
      setupFields: [
        { key: 'WECHAT_WEBHOOK_URL', label: 'Webhook URL', required: true },
      ],
    },
    {
      kind: 'mcp-server',
      id: 'crashsight',
      name: 'CrashSight',
      description: 'Fetch crash reports, stack traces, build metadata, and crash frequency.',
      source: 'MTL local enterprise',
      tags: ['crash', 'mobile', 'enterprise'],
      setupFields: [
        { key: 'CRASHSIGHT_TOKEN', label: 'CrashSight token', required: true, type: 'password' },
      ],
    },
    {
      kind: 'mcp-server',
      id: 'internal-code-search',
      name: 'Internal Code Search',
      description: 'Search private monorepos, ownership maps, and indexed code intelligence.',
      source: 'MTL local enterprise',
      tags: ['code-search', 'enterprise'],
      setupFields: [
        { key: 'CODE_SEARCH_URL', label: 'Search endpoint', required: true },
      ],
    },
  ];
  const recipeById = new Map(listBuiltInRecipes().map((recipe) => [recipe.id, recipe]));
  const enterpriseWorkflows = [
    ['crashsight-analysis', 'crashsight-analysis', ['workflow', 'crash', 'enterprise']],
    ['redmine-review', 'redmine-review', ['workflow', 'ticket', 'enterprise']],
    ['code-impact-analysis', 'code-impact-analysis', ['workflow', 'impact', 'enterprise']],
    ['publish-pr', 'pr-description', ['workflow', 'git', 'delivery']],
  ].map(([id, recipeId, tags]) => {
    const recipe = recipeById.get(recipeId);
    return {
      kind: 'workflow',
      id,
      name: id === 'publish-pr' ? 'Publish PR' : recipe?.title || id,
      description: recipe?.description || 'Install a built-in workflow template.',
      source: 'MTL workflow templates',
      tags,
      dependencies: {
        skills: (recipe?.dependencies?.skills || []).map((item) => item.name || item).filter(Boolean),
        mcpServers: (recipe?.dependencies?.mcpServers || []).map((item) => item.name || item).filter(Boolean),
        recipes: [recipeId],
      },
    };
  });
  return [...enterpriseMcp, ...enterpriseWorkflows].map((item) => normalizeCapabilityMarketplaceItem(item));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function capabilityKey(kind, name) {
  return `${kind}-${sanitizeSlug(name, kind)}`;
}

function installedSkillKeys(skills = []) {
  const keys = new Set();
  for (const skill of skills) {
    keys.add(capabilityKey('skill', skill.name || skill.title));
  }
  return keys;
}

function installedMcpKeys(servers = []) {
  const keys = new Set();
  for (const server of servers) {
    keys.add(capabilityKey('mcp-server', server.name || server.serverName));
  }
  return keys;
}

function mergeItems(items) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    byId.set(item.id, {
      ...existing,
      ...item,
      tags: normalizeStringArray([...(existing.tags || []), ...(item.tags || [])], 40),
      dependencies: {
        skills: normalizeStringArray([...(existing.dependencies?.skills || []), ...(item.dependencies?.skills || [])]),
        mcpServers: normalizeStringArray([...(existing.dependencies?.mcpServers || []), ...(item.dependencies?.mcpServers || [])]),
        recipes: normalizeStringArray([...(existing.dependencies?.recipes || []), ...(item.dependencies?.recipes || [])]),
        workflows: normalizeStringArray([...(existing.dependencies?.workflows || []), ...(item.dependencies?.workflows || [])]),
      },
      installState: existing.installState === 'installed' || item.installState === 'installed' ? 'installed' : 'available',
      enabled: Boolean(existing.enabled || item.enabled),
      configurationStatus: existing.configurationStatus === 'ready' || item.configurationStatus === 'ready'
        ? 'ready'
        : (item.configurationStatus || existing.configurationStatus || 'ready'),
    });
  }
  return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function createCapabilityMarketplaceStore({ rootDir = path.join(os.homedir(), '.mtl-code-ui', 'capability-marketplace') } = {}) {
  const statePath = path.join(rootDir, 'state.json');

  return {
    async getState() {
      const state = await readJson(statePath, { enabled: {}, installed: {}, configurations: {} });
      return {
        enabled: state && typeof state.enabled === 'object' ? state.enabled : {},
        installed: state && typeof state.installed === 'object' ? state.installed : {},
        configurations: state && typeof state.configurations === 'object' ? state.configurations : {},
      };
    },

    async installCapability(itemId, { scope = 'user', configuration = {} } = {}) {
      const id = normalizeString(itemId, '', 160);
      if (!id) throw new Error('Marketplace item id is required');
      const normalizedScope = scope === 'project' ? 'project' : 'user';
      const state = await this.getState();
      state.installed[id] = {
        scope: normalizedScope,
        installedAt: new Date().toISOString(),
      };
      state.configurations[id] = normalizeConfiguration(configuration);
      if (state.enabled[id] === undefined) {
        state.enabled[id] = true;
      }
      await writeJson(statePath, state);
      return {
        id,
        installState: 'installed',
        enabled: state.enabled[id],
        configurationStatus: Object.keys(state.configurations[id]).length > 0 ? 'ready' : 'needs-configuration',
      };
    },

    async setEnabled(itemId, enabled) {
      const id = normalizeString(itemId, '', 160);
      if (!id) throw new Error('Marketplace item id is required');
      const state = await this.getState();
      state.enabled[id] = Boolean(enabled);
      await writeJson(statePath, state);
      return { id, enabled: state.enabled[id] };
    },

    async listMarketplace({ repositoryItems = [], installedSkills = [], installedMcpServers = [] } = {}) {
      const state = await this.getState();
      const skillKeys = installedSkillKeys(installedSkills);
      const mcpKeys = installedMcpKeys(installedMcpServers);
      const normalizedRepository = repositoryItems.map((item) => {
        const normalized = normalizeCapabilityMarketplaceItem(item);
        return normalizeCapabilityMarketplaceItem(normalized, {
          installed: skillKeys.has(normalized.id) || mcpKeys.has(normalized.id) || Boolean(state.installed[normalized.id]),
          enabled: state.enabled[normalized.id] === true,
          configuration: state.configurations[normalized.id],
        });
      });
      const installedSkillItems = installedSkills.map((skill) => normalizeCapabilityMarketplaceItem({
        kind: 'skill',
        id: skill.name || skill.title,
        name: skill.name || skill.title,
        title: skill.title || skill.name,
        description: skill.description || '',
        source: `${skill.provider || 'local'} ${skill.scope || ''}`.trim(),
      }, { installed: true, enabled: state.enabled[capabilityKey('skill', skill.name || skill.title)] !== false }));
      const installedMcpItems = installedMcpServers.map((server) => normalizeCapabilityMarketplaceItem({
        kind: 'mcp-server',
        id: server.name || server.serverName,
        name: server.name || server.serverName,
        source: `${server.provider || 'provider'} ${server.scope || ''}`.trim(),
      }, { installed: true, enabled: state.enabled[capabilityKey('mcp-server', server.name || server.serverName)] !== false }));
      const builtIn = getBuiltInEnterpriseCapabilities().map((item) => normalizeCapabilityMarketplaceItem(item, {
        installed: mcpKeys.has(item.id) || Boolean(state.installed[item.id]),
        enabled: state.enabled[item.id] === true || mcpKeys.has(item.id),
        configuration: state.configurations[item.id],
      }));

      return {
        schemaVersion: 1,
        items: mergeItems([...builtIn, ...normalizedRepository, ...installedSkillItems, ...installedMcpItems]),
      };
    },
  };
}
