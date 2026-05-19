const PROVIDERS = {
  'smart-connections': {
    id: 'smart-connections',
    label: 'Smart Connections',
    source: 'obsidian-plugin',
  },
  'open-connections': {
    id: 'open-connections',
    label: 'Open Connections',
    source: 'obsidian-plugin',
  },
  'bridge-keyword': {
    id: 'bridge-keyword',
    label: 'Bridge keyword search',
    source: 'argus-bridge',
  },
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeProviderId = (value = 'auto') => {
  const raw = readString(value).toLowerCase();
  if (raw === 'smart-connections' || raw === 'smart_connections') return 'smart-connections';
  if (raw === 'open-connections' || raw === 'open_connections') return 'open-connections';
  if (raw === 'bridge-keyword' || raw === 'keyword') return 'bridge-keyword';
  if (raw === 'disabled') return 'disabled';
  return 'auto';
};

export const normalizeObsidianSemanticIndexMetadata = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const itemCount = Number.parseInt(String(source.itemCount ?? ''), 10);
  const dimensions = Number.parseInt(String(source.dimensions ?? ''), 10);
  return {
    providerId: normalizeProviderId(source.providerId || source.provider || ''),
    embeddingModel: readString(source.embeddingModel || source.model).slice(0, 160),
    itemCount: Number.isFinite(itemCount) && itemCount >= 0 ? itemCount : 0,
    dimensions: Number.isFinite(dimensions) && dimensions > 0 ? dimensions : 0,
    lastIndexedAt: readString(source.lastIndexedAt || source.updatedAt).slice(0, 80),
    storagePath: readString(source.storagePath || source.indexPath).slice(0, 500),
  };
};

const normalizeProviderFromStatus = (provider = {}) => {
  const id = normalizeProviderId(provider.id || provider.providerId || provider.name);
  const base = PROVIDERS[id] || {
    id,
    label: readString(provider.label || provider.name) || id,
    source: 'obsidian-plugin',
  };
  return {
    ...base,
    label: readString(provider.label || provider.name) || base.label,
    available: provider.available === true,
    readOnly: provider.readOnly !== false,
    itemCount: Number.isFinite(Number(provider.itemCount)) ? Number(provider.itemCount) : 0,
    embeddingModel: readString(provider.embeddingModel || provider.model),
    lastIndexedAt: readString(provider.lastIndexedAt || provider.updatedAt),
  };
};

const normalizeStatusProviders = (status = {}) => (
  Array.isArray(status.semanticProviders)
    ? status.semanticProviders.map(normalizeProviderFromStatus).filter((provider) => provider.id && provider.id !== 'auto')
    : []
);

const resolvePreferredProvider = ({ config = {}, status = {} } = {}) => {
  const configuredProvider = normalizeProviderId(config.obsidianSemanticProvider);
  const providers = normalizeStatusProviders(status);
  if (configuredProvider === 'disabled') {
    return { ...PROVIDERS['bridge-keyword'], id: 'disabled', label: 'Disabled', available: false, readOnly: true };
  }
  if (configuredProvider !== 'auto') {
    return providers.find((provider) => provider.id === configuredProvider)
      || { ...(PROVIDERS[configuredProvider] || { id: configuredProvider, label: configuredProvider }), available: false, readOnly: true };
  }
  return providers.find((provider) => provider.id === 'smart-connections' && provider.available)
    || providers.find((provider) => provider.id === 'open-connections' && provider.available)
    || providers[0]
    || { ...PROVIDERS['bridge-keyword'], available: true, readOnly: true };
};

export const buildObsidianSemanticIndexState = ({
  config = {},
  status = {},
  error = '',
} = {}) => {
  const configuredProvider = normalizeProviderId(config.obsidianSemanticProvider);
  const fallbackEnabled = config.obsidianSemanticFallbackEnabled !== false;
  const provider = resolvePreferredProvider({ config, status });
  const metadata = normalizeObsidianSemanticIndexMetadata({
    ...(config.obsidianSemanticIndexMetadata || {}),
    ...(provider.itemCount ? { itemCount: provider.itemCount } : {}),
    ...(provider.embeddingModel ? { embeddingModel: provider.embeddingModel } : {}),
    ...(provider.lastIndexedAt ? { lastIndexedAt: provider.lastIndexedAt } : {}),
    providerId: provider.id === 'disabled' ? configuredProvider : provider.id,
  });
  const states = new Set();

  if (configuredProvider === 'disabled') states.add('semantic-disabled');
  if (!provider.available && provider.id !== 'bridge-keyword' && provider.id !== 'disabled') states.add('provider-unavailable');
  if (provider.id !== 'bridge-keyword' && provider.id !== 'disabled' && metadata.itemCount === 0) states.add('index-metadata-missing');
  if (error) states.add('semantic-query-failed');
  if (fallbackEnabled && (states.has('provider-unavailable') || states.has('index-metadata-missing') || states.has('semantic-query-failed'))) {
    states.add('keyword-fallback-ready');
  }

  const stateList = [...states];
  const statusName = configuredProvider === 'disabled'
    ? 'disabled'
    : stateList.length > 0
      ? 'degraded'
      : 'ready';
  const fallbackMode = statusName === 'ready' && provider.id !== 'bridge-keyword'
    ? 'semantic'
    : fallbackEnabled
      ? 'keyword-bridge-search'
      : 'none';

  return {
    status: statusName,
    provider,
    configuredProvider,
    fallbackMode,
    states: stateList,
    indexMetadata: metadata,
    repairActions: [
      { id: 'refresh-semantic-index', label: 'Refresh semantic index', safe: true, enabled: true },
      { id: 'open-provider-settings', label: 'Open provider settings', safe: true, enabled: true },
      { id: 'use-keyword-fallback', label: 'Use keyword fallback', safe: true, enabled: fallbackEnabled },
    ],
    actions: [
      ...(states.has('index-metadata-missing') ? ['Refresh semantic index metadata from Obsidian'] : []),
      ...(states.has('provider-unavailable') ? ['Enable Smart Connections or Open Connections in Obsidian'] : []),
      ...(states.has('keyword-fallback-ready') ? ['Using Bridge keyword search until local semantic index is ready'] : []),
    ],
  };
};

export const queryObsidianSemanticIndex = async (payload = {}, {
  state = buildObsidianSemanticIndexState(),
  semanticSearch,
  fallbackSearch,
} = {}) => {
  const queryPayload = {
    query: readString(payload.query),
    folders: Array.isArray(payload.folders) ? payload.folders : [],
    limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : 10,
    providerId: state.provider?.id,
  };

  if (state.status === 'ready' && state.provider?.id !== 'bridge-keyword' && typeof semanticSearch === 'function') {
    try {
      const result = await semanticSearch(queryPayload);
      return {
        success: true,
        providerUsed: state.provider.id,
        fallback: false,
        ...(result || {}),
      };
    } catch (error) {
      if (state.fallbackMode === 'none' || typeof fallbackSearch !== 'function') {
        throw error;
      }
      const fallbackResult = await fallbackSearch(queryPayload);
      return {
        success: true,
        providerUsed: 'bridge-keyword',
        fallback: true,
        fallbackReason: error?.message || 'Semantic provider failed.',
        ...(fallbackResult || {}),
      };
    }
  }

  if (typeof fallbackSearch === 'function') {
    const fallbackResult = await fallbackSearch(queryPayload);
    return {
      success: true,
      providerUsed: 'bridge-keyword',
      fallback: state.provider?.id !== 'bridge-keyword',
      fallbackReason: state.actions?.[0] || '',
      ...(fallbackResult || {}),
    };
  }

  return {
    success: false,
    providerUsed: state.provider?.id || 'unknown',
    fallback: false,
    results: [],
    error: 'No semantic or fallback search provider is available.',
  };
};
