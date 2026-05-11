import { normalizeSwarmTemplateManifest } from './swarm-template-manifest-service.js';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildTemplateIndex(items = []) {
  const ids = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    for (const value of [item?.id, item?.name, item?.agentTemplateId, item?.templateId]) {
      const id = normalizeId(value);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function safeExamples(value) {
  return Array.isArray(value) ? value.slice(0, 24) : [];
}

export function resolveSwarmRoleBindings({
  manifest,
  installedAgents = [],
  bundledAgentTemplates = [],
} = {}) {
  const normalized = normalizeSwarmTemplateManifest(manifest);
  const installed = buildTemplateIndex(installedAgents);
  const bundled = buildTemplateIndex(bundledAgentTemplates);
  const roles = normalized.roles.map((role) => {
    const agentTemplateId = normalizeId(role.agentTemplateId);
    const status = installed.has(agentTemplateId)
      ? 'available'
      : bundled.has(agentTemplateId)
        ? 'bundled'
        : 'missing';
    return {
      roleId: role.id,
      label: role.label,
      agentTemplateId: role.agentTemplateId,
      status,
    };
  });
  const blockingMissing = roles.filter((role) => role.status === 'missing');
  return {
    status: blockingMissing.length ? 'draft' : 'ready',
    roles,
    blockingMissing,
  };
}

export function exportSwarmTemplatePackage({
  manifest,
  roleBindingResolution = null,
  examples = null,
} = {}) {
  const normalized = normalizeSwarmTemplateManifest(manifest);
  const sourceDialogs = manifest && typeof manifest === 'object' && manifest.dialogs && typeof manifest.dialogs === 'object'
    ? manifest.dialogs
    : normalized.dialogs;
  return {
    schemaVersion: 1,
    kind: 'swarm-template-package',
    exportedAt: new Date().toISOString(),
    manifest: {
      ...normalized,
      dialogs: sourceDialogs,
      examples: safeExamples(examples ?? normalized.examples),
    },
    roleBindingResolution,
  };
}

export function importSwarmTemplatePackage(pkg = {}) {
  if (!pkg || typeof pkg !== 'object') {
    throw new Error('swarm template package is required');
  }
  if (pkg.kind !== 'swarm-template-package' && pkg.kind !== 'swarm-template') {
    throw new Error('unsupported swarm template package kind');
  }
  const manifest = normalizeSwarmTemplateManifest(pkg.manifest || pkg);
  return {
    manifest,
    roleBindingResolution: pkg.roleBindingResolution || null,
    importedAt: new Date().toISOString(),
  };
}
