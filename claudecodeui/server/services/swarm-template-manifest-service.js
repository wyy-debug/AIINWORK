import {
  normalizeAgentTemplateDependencies,
  normalizeAgentTemplateDialogs,
  normalizeAgentTemplateManifest,
} from './agent-template-manifest-service.js';

const ALLOWED_TOPOLOGIES = new Set(['queen', 'mesh', 'pipeline', 'committee', 'map_reduce']);
const ALLOWED_ACK_POLICIES = new Set(['none', 'at_most_once', 'at_least_once']);
const ALLOWED_MEMORY_PROMOTIONS = new Set(['manual', 'disabled']);
const FORBIDDEN_SWARM_KEYS = new Set([
  'html',
  'script',
  'component',
  'renderer',
  'remoteUrl',
  'iframe',
  'js',
  'eval',
  'wasmUrl',
]);

function sanitizeSlug(input, fallback = 'swarm-template') {
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

function normalizePositiveInteger(value, fallback, { min = 1, max = 100, label = 'value' } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const integer = Math.floor(number);
  if (integer < min || integer > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return integer;
}

function assertNoExecutableKeys(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_SWARM_KEYS.has(key)) {
      throw new Error(`unsupported executable swarm key in ${context}: ${key}`);
    }
  }
}

function normalizeRuntime(value = {}) {
  return normalizeAgentTemplateManifest({ id: 'runtime', version: '1.0.0', runtime: value }).runtime;
}

function normalizeRole(rawRole, index) {
  if (!rawRole || typeof rawRole !== 'object') return null;
  assertNoExecutableKeys(rawRole, 'role');
  const id = sanitizeSlug(rawRole.id || rawRole.name || rawRole.roleId || `role-${index + 1}`, '');
  if (!id) return null;
  const agentTemplateId = sanitizeSlug(
    rawRole.agentTemplateId || rawRole.agentId || rawRole.templateId || rawRole.subagent || rawRole.name,
    '',
  );
  if (!agentTemplateId) {
    throw new Error(`swarm role "${id}" must reference an agentTemplateId`);
  }
  return {
    id,
    label: normalizeString(rawRole.label || rawRole.title || id, id, 120),
    agentTemplateId,
    count: normalizePositiveInteger(rawRole.count, 1, { min: 1, max: 20, label: `role ${id} count` }),
    runtime: normalizeRuntime(rawRole.runtime),
    dependencies: normalizeAgentTemplateDependencies(rawRole.dependencies),
    dialogs: normalizeAgentTemplateDialogs(rawRole.dialogs),
    topics: normalizeStringArray(rawRole.topics || rawRole.subscriptions, 32, 120),
    ...(rawRole.metadata && typeof rawRole.metadata === 'object' ? { metadata: rawRole.metadata } : {}),
  };
}

function normalizeEdge(edge) {
  if (!edge || typeof edge !== 'object') return null;
  const from = sanitizeSlug(edge.from || edge.source || edge.fromRoleId, '');
  const to = sanitizeSlug(edge.to || edge.target || edge.toRoleId, '');
  if (!from || !to) return null;
  return {
    from,
    to,
    topic: normalizeString(edge.topic, `${from}.${to}`, 120),
  };
}

function normalizeTopology(value = {}, roles = []) {
  const source = value && typeof value === 'object' ? value : {};
  const type = normalizeString(source.type || source.kind, 'mesh', 40);
  if (!ALLOWED_TOPOLOGIES.has(type)) {
    throw new Error(`unsupported swarm topology: ${type}`);
  }
  const roleIds = new Set(roles.map((role) => role.id));
  const edges = Array.isArray(source.edges)
    ? source.edges.map(normalizeEdge).filter(Boolean).slice(0, 200)
    : [];
  for (const edge of edges) {
    if (!roleIds.has(edge.from) || !roleIds.has(edge.to)) {
      throw new Error(`unknown swarm role in topology edge: ${edge.from} -> ${edge.to}`);
    }
  }
  const coordinatorRoleId = sanitizeSlug(source.coordinatorRoleId || source.coordinator || source.queenRoleId, '');
  if (coordinatorRoleId && !roleIds.has(coordinatorRoleId)) {
    throw new Error(`unknown swarm role in coordinatorRoleId: ${coordinatorRoleId}`);
  }
  return {
    type,
    ...(coordinatorRoleId ? { coordinatorRoleId } : {}),
    edges,
  };
}

function normalizeAckPolicy(value, fallback = 'at_least_once') {
  const policy = normalizeString(value, fallback, 40);
  return ALLOWED_ACK_POLICIES.has(policy) ? policy : fallback;
}

function normalizeRouting(value = {}, roles = []) {
  const source = value && typeof value === 'object' ? value : {};
  const roleIds = new Set(roles.map((role) => role.id));
  const topics = Array.isArray(source.topics)
    ? source.topics.map((topic) => {
        if (typeof topic === 'string') {
          const name = normalizeString(topic, '', 120);
          return name ? { name, subscribers: [], ackPolicy: 'at_least_once' } : null;
        }
        if (!topic || typeof topic !== 'object') return null;
        const name = normalizeString(topic.name || topic.topic, '', 120);
        if (!name) return null;
        const subscribers = normalizeStringArray(topic.subscribers || topic.roles, 32, 80)
          .map((subscriber) => sanitizeSlug(subscriber, ''))
          .filter((subscriber) => roleIds.has(subscriber));
        return {
          name,
          subscribers,
          ackPolicy: normalizeAckPolicy(topic.ackPolicy),
        };
      }).filter(Boolean).slice(0, 100)
    : [];
  return { topics };
}

function normalizeBus(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    provider: normalizeString(source.provider, 'local-sqlite', 80),
    ackPolicy: normalizeAckPolicy(source.ackPolicy),
    retryLimit: normalizePositiveInteger(source.retryLimit, 3, { min: 0, max: 20, label: 'retryLimit' }),
    ttlMs: normalizePositiveInteger(source.ttlMs, 300000, { min: 1000, max: 86_400_000, label: 'ttlMs' }),
  };
}

function normalizeMemory(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const promotion = normalizeString(source.promotion, 'manual', 40);
  return {
    enabled: source.enabled !== false,
    promotion: ALLOWED_MEMORY_PROMOTIONS.has(promotion) ? promotion : 'manual',
    scopes: normalizeStringArray(source.scopes || ['facts', 'decisions', 'artifacts', 'role-notes'], 12, 80),
  };
}

function normalizePolicies(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    maxAgents: normalizePositiveInteger(source.maxAgents, 12, { min: 1, max: 100, label: 'maxAgents' }),
    maxDepth: normalizePositiveInteger(source.maxDepth, 4, { min: 1, max: 20, label: 'maxDepth' }),
    tokenBudget: normalizePositiveInteger(source.tokenBudget, 200000, { min: 1000, max: 10_000_000, label: 'tokenBudget' }),
    timeoutMs: normalizePositiveInteger(source.timeoutMs, 3600000, { min: 1000, max: 86_400_000, label: 'timeoutMs' }),
    messageSizeLimit: normalizePositiveInteger(source.messageSizeLimit, 32768, { min: 1024, max: 2 * 1024 * 1024, label: 'messageSizeLimit' }),
  };
}

function normalizeExamples(value) {
  return normalizeAgentTemplateManifest({ id: 'examples', version: '1.0.0', examples: value }).examples;
}

function normalizeCompat(value) {
  return normalizeAgentTemplateManifest({ id: 'compat', version: '1.0.0', compat: value }).compat;
}

export function normalizeSwarmTemplateManifest(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  assertNoExecutableKeys(source, 'manifest');
  const id = sanitizeSlug(source.id || source.name || fallback.id || fallback.name, 'swarm-template');
  const roles = Array.isArray(source.roles)
    ? source.roles.map(normalizeRole).filter(Boolean)
    : [];
  if (roles.length === 0) {
    throw new Error('swarm-template must define at least one role');
  }
  const roleIds = new Set();
  for (const role of roles) {
    if (roleIds.has(role.id)) {
      throw new Error(`duplicate swarm role id: ${role.id}`);
    }
    roleIds.add(role.id);
  }
  const policies = normalizePolicies(source.policies);
  const totalAgents = roles.reduce((sum, role) => sum + role.count, 0);
  if (totalAgents > policies.maxAgents) {
    throw new Error(`swarm role counts exceed maxAgents (${policies.maxAgents})`);
  }

  return {
    schemaVersion: Number.isFinite(Number(source.schemaVersion)) ? Number(source.schemaVersion) : 1,
    id,
    version: normalizeString(source.version, fallback.version || '1.0.0', 40),
    kind: 'swarm-template',
    topology: normalizeTopology(source.topology, roles),
    roles,
    routing: normalizeRouting(source.routing, roles),
    bus: normalizeBus(source.bus),
    memory: normalizeMemory(source.memory),
    policies,
    dependencies: normalizeAgentTemplateDependencies(source.dependencies || source.requires),
    dialogs: normalizeAgentTemplateDialogs(source.dialogs),
    examples: normalizeExamples(source.examples),
    compat: normalizeCompat(source.compat),
  };
}
