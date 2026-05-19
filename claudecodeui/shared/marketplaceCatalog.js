export const MARKETPLACE_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'agent-template', label: 'Agents' }),
  Object.freeze({ id: 'recipe', label: 'Recipes' }),
  Object.freeze({ id: 'skill', label: 'Skills' }),
  Object.freeze({ id: 'mcp-server', label: 'MCP Servers' }),
]);

const CATEGORY_IDS = new Set(MARKETPLACE_CATEGORIES.map((category) => category.id));

export function normalizeMarketplaceKind(value) {
  const kind = String(value || '').trim();
  return CATEGORY_IDS.has(kind) ? kind : 'agent-template';
}

export function normalizeMarketplaceItem(item = {}) {
  const kind = normalizeMarketplaceKind(item.kind);
  const dependencies = item.dependencies && typeof item.dependencies === 'object'
    ? item.dependencies
    : {};
  return {
    ...item,
    kind,
    tags: Array.isArray(item.tags) ? item.tags : [],
    dependencies: {
      skills: Array.isArray(dependencies.skills) ? dependencies.skills : [],
      mcpServers: Array.isArray(dependencies.mcpServers) ? dependencies.mcpServers : [],
      modelProfiles: Array.isArray(dependencies.modelProfiles) ? dependencies.modelProfiles : [],
    },
  };
}

export function getMarketplaceDependencyHealth(item = {}, enterprisePolicy = {}) {
  const normalized = normalizeMarketplaceItem(item);
  const dependencies = [
    ...normalized.dependencies.skills.map((dependency) => ({ ...dependency, kind: 'skill' })),
    ...normalized.dependencies.mcpServers.map((dependency) => ({ ...dependency, kind: 'mcp-server' })),
    ...normalized.dependencies.modelProfiles.map((dependency) => ({ ...dependency, kind: 'model-profile' })),
  ];
  const blockedKinds = new Set(Array.isArray(enterprisePolicy.blockedKinds) ? enterprisePolicy.blockedKinds : []);
  const unavailable = blockedKinds.has(normalized.kind);
  return {
    installed: dependencies.filter((dependency) => dependency.status === 'installed'),
    missing: dependencies.filter((dependency) => !dependency.optional && dependency.status !== 'installed'),
    needsConfig: dependencies.filter((dependency) => dependency.status === 'needs-configuration'),
    unavailable,
    blocker: unavailable ? 'Enterprise policy blocks this marketplace category.' : '',
  };
}
