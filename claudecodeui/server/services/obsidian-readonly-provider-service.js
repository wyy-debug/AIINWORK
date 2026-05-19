const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeTransport = (value = 'bridge') => {
  const normalized = readString(value).toLowerCase().replace(/_/g, '-');
  return ['bridge', 'local-http', 'mcp-stdio'].includes(normalized) ? normalized : 'bridge';
};

const normalizeEndpoint = (value = '') => readString(value).replace(/\/+$/, '');

const normalizeTimeout = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.min(Math.max(parsed, 100), 10000);
};

const defaultCapabilities = (enabled = false) => ({
  search: enabled,
  related: false,
  content: false,
  graph: false,
  indexStatus: false,
  write: false,
});

const normalizeCapabilities = (value) => {
  const capabilities = defaultCapabilities(false);
  if (Array.isArray(value)) {
    for (const key of value) {
      const normalized = readString(key);
      if (Object.prototype.hasOwnProperty.call(capabilities, normalized) && normalized !== 'write') {
        capabilities[normalized] = true;
      }
    }
    return capabilities;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(capabilities)) {
      capabilities[key] = key === 'write' ? false : value[key] === true;
    }
  }
  return capabilities;
};

export const normalizeReadOnlyObsidianProviderConfig = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    transport: normalizeTransport(source.transport || source.obsidianSemanticProviderTransport),
    providerId: readString(source.providerId || source.obsidianSemanticProvider || 'bridge-keyword') || 'bridge-keyword',
    endpoint: normalizeEndpoint(source.endpoint || source.obsidianSemanticProviderEndpoint),
    command: readString(source.command || source.obsidianSemanticProviderCommand),
    timeoutMs: normalizeTimeout(source.timeoutMs || source.obsidianSemanticProviderTimeoutMs),
  };
};

const createTimeoutSignal = (timeoutMs) => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
};

const elapsed = (startedAt, now) => Math.max(0, Number(now()) - Number(startedAt));

export const detectReadOnlyObsidianProviderCapabilities = async (config = {}, {
  fetchImpl = globalThis.fetch,
  mcpClient = null,
  now = () => Date.now(),
} = {}) => {
  const normalized = normalizeReadOnlyObsidianProviderConfig(config);
  const startedAt = now();
  const down = (error) => ({
    status: normalized.transport === 'bridge' ? 'ready' : 'down',
    providerId: normalized.providerId,
    transport: normalized.transport,
    readOnly: true,
    latencyMs: elapsed(startedAt, now),
    capabilities: normalized.transport === 'bridge' ? defaultCapabilities(true) : defaultCapabilities(false),
    index: {},
    error: error ? (error?.message || String(error)) : '',
  });

  if (normalized.transport === 'bridge') {
    return down(null);
  }

  try {
    if (normalized.transport === 'mcp-stdio') {
      if (!mcpClient || typeof mcpClient.callTool !== 'function') {
        return down(new Error('MCP stdio provider is not connected.'));
      }
      const response = await mcpClient.callTool('indexStatus', {});
      return {
        status: 'ready',
        providerId: readString(response?.providerId || normalized.providerId),
        transport: 'mcp-stdio',
        readOnly: true,
        latencyMs: elapsed(startedAt, now),
        capabilities: normalizeCapabilities(response?.capabilities || ['search', 'related', 'content', 'graph', 'indexStatus']),
        index: response?.index || {},
        error: '',
      };
    }

    if (typeof fetchImpl !== 'function') {
      return down(new Error('Fetch implementation is unavailable.'));
    }
    const response = await fetchImpl(`${normalized.endpoint}/status`, {
      method: 'GET',
      headers: {},
      signal: createTimeoutSignal(normalized.timeoutMs),
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return {
      status: 'ready',
      providerId: readString(payload.providerId || normalized.providerId),
      transport: 'local-http',
      readOnly: true,
      latencyMs: elapsed(startedAt, now),
      capabilities: normalizeCapabilities(payload.capabilities || payload.capabilityMap),
      index: payload.index || payload.indexMetadata || {},
      error: '',
    };
  } catch (error) {
    return down(error);
  }
};

export const queryReadOnlyObsidianProvider = async (payload = {}, {
  config = {},
  fetchImpl = globalThis.fetch,
  mcpClient = null,
  now = () => Date.now(),
} = {}) => {
  const normalized = normalizeReadOnlyObsidianProviderConfig(config);
  const startedAt = now();
  const body = {
    query: readString(payload.query),
    folders: Array.isArray(payload.folders) ? payload.folders : [],
    limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : 10,
    includeContent: payload.includeContent === true,
  };

  if (normalized.transport === 'mcp-stdio') {
    if (!mcpClient || typeof mcpClient.callTool !== 'function') {
      throw new Error('MCP stdio provider is not connected.');
    }
    const result = await mcpClient.callTool('search', body);
    const results = Array.isArray(result?.results) ? result.results : [];
    return {
      success: true,
      providerId: readString(result?.providerId || normalized.providerId),
      transport: 'mcp-stdio',
      readOnly: true,
      diagnostics: { status: 'ready', latencyMs: elapsed(startedAt, now), resultCount: results.length },
      results,
    };
  }

  if (normalized.transport !== 'local-http') {
    throw new Error('Read-only provider transport is not configured.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is unavailable.');
  }
  const response = await fetchImpl(`${normalized.endpoint}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: createTimeoutSignal(normalized.timeoutMs),
  });
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    success: true,
    providerId: readString(data.providerId || normalized.providerId),
    transport: 'local-http',
    readOnly: true,
    diagnostics: {
      status: 'ready',
      latencyMs: elapsed(startedAt, now),
      resultCount: results.length,
    },
    results,
  };
};
