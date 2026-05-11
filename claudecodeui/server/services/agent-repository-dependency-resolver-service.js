import { normalizeAgentTemplateDependencies } from './agent-template-manifest-service.js';

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(skill|mcp-server|mcp)-/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dependencyName(dependency) {
  return dependency?.name || dependency?.itemId || dependency?.id || '';
}

function selectedSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map(normalizeName).filter(Boolean));
}

function normalizeInstalled(installed = {}) {
  return {
    skills: selectedSet(installed.skills),
    mcpServers: selectedSet(installed.mcpServers),
    modelProfiles: selectedSet(installed.modelProfiles),
  };
}

function normalizeSelected(selectedDependencies = {}) {
  return {
    skills: selectedSet(selectedDependencies.skills),
    mcpServers: selectedSet(selectedDependencies.mcpServers),
    modelProfiles: selectedSet(selectedDependencies.modelProfiles),
  };
}

function dependencyKey(dependency) {
  return normalizeName(dependencyName(dependency));
}

function addSelected(target, dependency) {
  const name = dependencyKey(dependency);
  if (!name) return;
  if (dependency.kind === 'skill' && !target.skills.includes(name)) target.skills.push(name);
  if (dependency.kind === 'mcp-server' && !target.mcpServers.includes(name)) target.mcpServers.push(name);
  if (dependency.kind === 'model-profile' && !target.modelProfiles.includes(name)) target.modelProfiles.push(name);
}

function installedHas(installed, dependency) {
  const name = dependencyKey(dependency);
  if (!name) return false;
  if (dependency.kind === 'skill') return installed.skills.has(name);
  if (dependency.kind === 'mcp-server') return installed.mcpServers.has(name);
  if (dependency.kind === 'model-profile') return installed.modelProfiles.has(name);
  return false;
}

function catalogHas(catalogItems, dependency) {
  const name = dependencyKey(dependency);
  if (!name) return false;
  return catalogItems.some((item) => {
    if (!item || item.kind !== dependency.kind) return false;
    return [
      item.name,
      item.id,
      item.itemId,
      item.title,
      item.mcp?.serverName,
    ].some((value) => normalizeName(value) === name);
  });
}

function selectedHas(selected, dependency) {
  const name = dependencyKey(dependency);
  if (!name) return false;
  if (dependency.kind === 'skill') return selected.skills.has(name);
  if (dependency.kind === 'mcp-server') return selected.mcpServers.has(name);
  if (dependency.kind === 'model-profile') return selected.modelProfiles.has(name);
  return false;
}

function dependencyStatus({ dependency, installed, selected, catalogItems }) {
  const installedMatch = installedHas(installed, dependency);
  const selectedMatch = selectedHas(selected, dependency);
  const catalogMatch = catalogHas(catalogItems, dependency);
  if (selectedMatch && (installedMatch || catalogMatch || dependency.kind === 'model-profile')) return 'selected';
  if (installedMatch || catalogMatch) return 'available';
  if (dependency.kind === 'model-profile') return 'needs-configuration';
  return 'missing';
}

function dependencyEntry(dependency, status) {
  return {
    kind: dependency.kind,
    name: dependencyName(dependency),
    optional: Boolean(dependency.optional),
    status,
    ...(dependency.id ? { id: dependency.id } : {}),
    ...(dependency.itemId ? { itemId: dependency.itemId } : {}),
    ...(dependency.repoId ? { repoId: dependency.repoId } : {}),
  };
}

export function resolveAgentTemplateDependencies({
  dependencies = {},
  installed = {},
  selectedDependencies = {},
  catalogItems = [],
} = {}) {
  const normalizedDependencies = normalizeAgentTemplateDependencies(dependencies);
  const installedSets = normalizeInstalled(installed);
  const selectedSets = normalizeSelected(selectedDependencies);
  const selectedOutput = { skills: [], mcpServers: [], modelProfiles: [] };
  const required = [];
  const optional = [];
  const blockingMissing = [];

  const allDependencies = [
    ...normalizedDependencies.skills,
    ...normalizedDependencies.mcpServers,
    ...normalizedDependencies.modelProfiles,
  ];

  for (const dependency of allDependencies) {
    const status = dependencyStatus({
      dependency,
      installed: installedSets,
      selected: selectedSets,
      catalogItems,
    });
    const entry = dependencyEntry(dependency, status);
    const isBlocking = !dependency.optional && (status === 'missing' || status === 'needs-configuration');
    if (isBlocking) {
      blockingMissing.push(entry);
    }
    if (status === 'selected' || (!dependency.optional && status === 'available')) {
      addSelected(selectedOutput, dependency);
    }
    if (dependency.optional) {
      optional.push(entry);
    } else {
      required.push(entry);
    }
  }

  return {
    required,
    optional,
    blockingMissing,
    selectedDependencies: selectedOutput,
  };
}
