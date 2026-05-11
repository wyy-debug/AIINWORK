export type RepositoryDependencyKind = 'skill' | 'mcp-server' | 'model-profile';

export type RepositoryDependencyLike = {
  kind: RepositoryDependencyKind | string;
  name?: string;
  id?: string;
  itemId?: string;
  optional?: boolean;
};

export type AgentTemplateDependenciesLike = {
  skills?: RepositoryDependencyLike[];
  mcpServers?: RepositoryDependencyLike[];
  modelProfiles?: RepositoryDependencyLike[];
};

export interface ResolveAgentTemplateDependencyStateInput {
  dependencies?: AgentTemplateDependenciesLike;
  installedSkills?: string[];
  installedMcpServers?: string[];
  installedModelProfiles?: string[];
  selectedOptionalDependencyIds?: string[];
}

function normalizeName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^skill-/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dependencyName(dependency: RepositoryDependencyLike): string {
  return dependency.name || dependency.itemId || dependency.id || '';
}

export function dependencySelectionId(dependency: RepositoryDependencyLike): string {
  return `${dependency.kind}:${normalizeName(dependencyName(dependency))}`;
}

function normalizeSet(values: string[] = []) {
  return new Set(values.map(normalizeName).filter(Boolean));
}

function collectDependencies(dependencies?: AgentTemplateDependenciesLike): RepositoryDependencyLike[] {
  return [
    ...(dependencies?.skills || []).map((dependency) => ({ ...dependency, kind: dependency.kind || 'skill' })),
    ...(dependencies?.mcpServers || []).map((dependency) => ({ ...dependency, kind: dependency.kind || 'mcp-server' })),
    ...(dependencies?.modelProfiles || []).map((dependency) => ({ ...dependency, kind: dependency.kind || 'model-profile' })),
  ];
}

function isInstalled(dependency: RepositoryDependencyLike, installed: {
  skills: Set<string>;
  mcpServers: Set<string>;
  modelProfiles: Set<string>;
}): boolean {
  const name = normalizeName(dependencyName(dependency));
  if (!name) return false;
  if (dependency.kind === 'skill') return installed.skills.has(name);
  if (dependency.kind === 'mcp-server') return installed.mcpServers.has(name);
  if (dependency.kind === 'model-profile') return installed.modelProfiles.has(name);
  return false;
}

function addSelected(target: { skills: string[]; mcpServers: string[]; modelProfiles: string[] }, dependency: RepositoryDependencyLike) {
  const name = normalizeName(dependencyName(dependency));
  if (!name) return;
  if (dependency.kind === 'skill' && !target.skills.includes(name)) target.skills.push(name);
  if (dependency.kind === 'mcp-server' && !target.mcpServers.includes(name)) target.mcpServers.push(name);
  if (dependency.kind === 'model-profile' && !target.modelProfiles.includes(name)) target.modelProfiles.push(name);
}

export function resolveAgentTemplateDependencyState(input: ResolveAgentTemplateDependencyStateInput) {
  const installed = {
    skills: normalizeSet(input.installedSkills),
    mcpServers: normalizeSet(input.installedMcpServers),
    modelProfiles: normalizeSet(input.installedModelProfiles),
  };
  const selectedOptional = new Set((input.selectedOptionalDependencyIds || []).map(normalizeName));
  const requiredMissing: RepositoryDependencyLike[] = [];
  const optionalAvailable: RepositoryDependencyLike[] = [];
  const selectedDependencies = { skills: [] as string[], mcpServers: [] as string[], modelProfiles: [] as string[] };

  for (const dependency of collectDependencies(input.dependencies)) {
    const installedDependency = isInstalled(dependency, installed);
    if (!dependency.optional && !installedDependency) {
      requiredMissing.push(dependency);
      continue;
    }
    if (!dependency.optional) {
      addSelected(selectedDependencies, dependency);
      continue;
    }
    if (installedDependency) {
      optionalAvailable.push(dependency);
      if (selectedOptional.has(normalizeName(dependencySelectionId(dependency)))) {
        addSelected(selectedDependencies, dependency);
      }
    }
  }

  return {
    requiredMissing,
    optionalAvailable,
    selectedDependencies,
    hasBlockingRequiredMissing: requiredMissing.length > 0,
    agentStatus: requiredMissing.length > 0 ? 'draft' as const : 'enabled' as const,
  };
}
