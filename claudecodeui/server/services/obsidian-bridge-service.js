import { appConfigDb } from '../database/db.js';

const CONFIG_KEY = 'obsidian_bridge';
const DEFAULT_PORT = '27177';
const DEFAULT_VAULT_ID = 'default';

export const OBSIDIAN_BRIDGE_MODES = [
  'project-knowledge',
  'second-brain',
  'ai-memory',
];

export const DEFAULT_OBSIDIAN_BRIDGE_CONFIG = {
  enabled: false,
  endpoint: 'http://127.0.0.1:27177',
  token: '',
  vaultName: '',
  defaultMode: 'project-knowledge',
  timeoutMs: 5000,
  autoExportKnowledgeArtifacts: true,
  readableVaultFolders: ['Argus/Projects', 'Argus/AIMemory', 'Argus/SecondBrain'],
  fallbackToProjectKnowledge: true,
  lastConnection: '',
  lastError: '',
  pluginVersion: '',
  aiMemoryReadbackEnabled: false,
  aiMemoryMaxResults: 5,
  aiMemoryProjectScopeEnabled: true,
  activeVaultId: DEFAULT_VAULT_ID,
  activeNoteReadbackEnabled: false,
  dailyNoteFolder: 'Daily',
  dailyNoteHeading: 'Argus',
  mcpEnabled: false,
  wikiCompilerEnabled: true,
  wikiRawFolder: 'Argus/Raw',
  wikiFolder: 'Argus/Wiki',
  wikiIndexFolder: 'Argus/_Indexes',
  wikiMetaFolder: 'Argus/_Meta',
  routingRules: {
    readingNotesMode: 'second-brain',
    projectKnowledgeMode: 'project-knowledge',
    aiMemoryMode: 'ai-memory',
    aiMemoryDirectWriteThreshold: 0.85,
    aiMemoryCandidateThreshold: 0.55,
  },
  vaults: [],
};

let configStore = appConfigDb;

export class ObsidianBridgeError extends Error {
  constructor(message, { code = 'OBSIDIAN_BRIDGE_ERROR', statusCode = 500, details = null } = {}) {
    super(message);
    this.name = 'ObsidianBridgeError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const setObsidianBridgeConfigStoreForTests = (store) => {
  configStore = store || appConfigDb;
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeMode = (value, fallback = DEFAULT_OBSIDIAN_BRIDGE_CONFIG.defaultMode) => (
  OBSIDIAN_BRIDGE_MODES.includes(value) ? value : fallback
);

const normalizeEndpoint = (value = DEFAULT_OBSIDIAN_BRIDGE_CONFIG.endpoint) => {
  const raw = readString(value) || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.endpoint;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed;

  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new ObsidianBridgeError('Obsidian bridge endpoint must be a valid local HTTP URL.', {
      code: 'OBSIDIAN_BRIDGE_BAD_ENDPOINT',
      statusCode: 400,
    });
  }

  if (parsed.protocol !== 'http:') {
    throw new ObsidianBridgeError('Obsidian bridge endpoint must use local HTTP.', {
      code: 'OBSIDIAN_BRIDGE_BAD_ENDPOINT',
      statusCode: 400,
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new ObsidianBridgeError('Obsidian bridge endpoint must be a loopback/local address.', {
      code: 'OBSIDIAN_BRIDGE_BAD_ENDPOINT',
      statusCode: 400,
    });
  }

  const host = hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
  const port = parsed.port || DEFAULT_PORT;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
};

const normalizeTimeout = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OBSIDIAN_BRIDGE_CONFIG.timeoutMs;
  }
  return Math.min(Math.max(parsed, 1000), 30000);
};

const normalizeMaxResults = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OBSIDIAN_BRIDGE_CONFIG.aiMemoryMaxResults;
  }
  return Math.min(Math.max(parsed, 1), 20);
};

const normalizeVaultId = (value, fallback = DEFAULT_VAULT_ID) => {
  const normalized = readString(value).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || fallback;
};

const normalizeVaultFolder = (value) => {
  const normalized = readString(value)
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    return '';
  }
  return normalized;
};

const normalizeVaultFolders = (value) => {
  const source = Array.isArray(value) ? value : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.readableVaultFolders;
  const folders = [...new Set(source.map(normalizeVaultFolder).filter(Boolean))];
  return folders.length > 0 ? folders : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.readableVaultFolders;
};

const normalizeProjectMappings = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .map(([projectName, folder]) => [readString(projectName), normalizeVaultFolder(folder)])
    .filter(([projectName, folder]) => projectName && folder));
};

const normalizeRoutingRules = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const directThreshold = Number(source.aiMemoryDirectWriteThreshold);
  const candidateThreshold = Number(source.aiMemoryCandidateThreshold);
  return {
    readingNotesMode: normalizeMode(source.readingNotesMode, 'second-brain'),
    projectKnowledgeMode: normalizeMode(source.projectKnowledgeMode, 'project-knowledge'),
    aiMemoryMode: normalizeMode(source.aiMemoryMode, 'ai-memory'),
    aiMemoryDirectWriteThreshold: Number.isFinite(directThreshold)
      ? Math.min(Math.max(directThreshold, 0.55), 0.99)
      : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.routingRules.aiMemoryDirectWriteThreshold,
    aiMemoryCandidateThreshold: Number.isFinite(candidateThreshold)
      ? Math.min(Math.max(candidateThreshold, 0.1), 0.9)
      : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.routingRules.aiMemoryCandidateThreshold,
  };
};

const normalizeVaultConfig = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const vaultId = normalizeVaultId(source.vaultId || fallback.vaultId);
  const readableFolders = normalizeVaultFolders(source.readableFolders || source.readableVaultFolders || fallback.readableFolders);
  return {
    vaultId,
    name: readString(source.name ?? source.vaultName ?? fallback.name ?? fallback.vaultName).slice(0, 160),
    endpoint: normalizeEndpoint(source.endpoint || fallback.endpoint || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.endpoint),
    token: readString(source.token ?? source.pairingToken ?? fallback.token),
    status: readString(source.status ?? fallback.status),
    readableFolders,
    writeBaseFolder: normalizeVaultFolder(source.writeBaseFolder || fallback.writeBaseFolder || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.vaults?.[0]?.writeBaseFolder || 'Argus') || 'Argus',
    projectMappings: normalizeProjectMappings(source.projectMappings || fallback.projectMappings),
    lastConnection: readString(source.lastConnection ?? fallback.lastConnection),
    lastError: readString(source.lastError ?? fallback.lastError).slice(0, 500),
    pluginVersion: readString(source.pluginVersion ?? fallback.pluginVersion).slice(0, 80),
  };
};

const buildLegacyVaultConfig = (source = {}) => normalizeVaultConfig({
  vaultId: DEFAULT_VAULT_ID,
  name: source.vaultName,
  endpoint: source.endpoint,
  token: source.token ?? source.pairingToken,
  readableFolders: source.readableVaultFolders,
  writeBaseFolder: source.writeBaseFolder || 'Argus',
  lastConnection: source.lastConnection,
  lastError: source.lastError,
  pluginVersion: source.pluginVersion,
});

const activeVaultFromConfig = (config) => (
  config.vaults.find((vault) => vault.vaultId === config.activeVaultId)
  || config.vaults[0]
  || buildLegacyVaultConfig(config)
);

const vaultForPayload = (config, payload = {}) => {
  if (payload.vaultId) {
    return config.vaults.find((entry) => entry.vaultId === payload.vaultId);
  }
  const projectName = readString(payload.projectName);
  if (projectName) {
    const mappedVault = config.vaults.find((vault) => (
      vault.projectMappings && Object.prototype.hasOwnProperty.call(vault.projectMappings, projectName)
    ));
    if (mappedVault) {
      return mappedVault;
    }
  }
  return activeVaultFromConfig(config);
};

export const normalizeObsidianBridgeConfig = (value = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const rawVaults = Array.isArray(source.vaults) && source.vaults.length > 0
    ? source.vaults
    : [buildLegacyVaultConfig(source)];
  const seenVaultIds = new Set();
  const vaults = rawVaults
    .map((vault, index) => normalizeVaultConfig(vault, {
      vaultId: index === 0 ? DEFAULT_VAULT_ID : `vault-${index + 1}`,
    }))
    .filter((vault) => {
      if (seenVaultIds.has(vault.vaultId)) {
        return false;
      }
      seenVaultIds.add(vault.vaultId);
      return true;
    });
  const activeVaultId = vaults.some((vault) => vault.vaultId === normalizeVaultId(source.activeVaultId))
    ? normalizeVaultId(source.activeVaultId)
    : vaults[0]?.vaultId || DEFAULT_VAULT_ID;
  const activeVault = vaults.find((vault) => vault.vaultId === activeVaultId) || vaults[0] || buildLegacyVaultConfig(source);

  return {
    enabled: source.enabled === true,
    endpoint: activeVault.endpoint,
    token: activeVault.token,
    vaultName: activeVault.name,
    defaultMode: normalizeMode(source.defaultMode),
    timeoutMs: normalizeTimeout(source.timeoutMs),
    autoExportKnowledgeArtifacts: source.autoExportKnowledgeArtifacts !== false,
    readableVaultFolders: activeVault.readableFolders,
    fallbackToProjectKnowledge: source.fallbackToProjectKnowledge !== false,
    lastConnection: activeVault.lastConnection || readString(source.lastConnection),
    lastError: (activeVault.lastError || readString(source.lastError)).slice(0, 500),
    pluginVersion: (activeVault.pluginVersion || readString(source.pluginVersion)).slice(0, 80),
    aiMemoryReadbackEnabled: source.aiMemoryReadbackEnabled === true,
    aiMemoryMaxResults: normalizeMaxResults(source.aiMemoryMaxResults),
    aiMemoryProjectScopeEnabled: source.aiMemoryProjectScopeEnabled !== false,
    activeVaultId,
    activeNoteReadbackEnabled: source.activeNoteReadbackEnabled === true,
    dailyNoteFolder: normalizeVaultFolder(source.dailyNoteFolder || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.dailyNoteFolder) || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.dailyNoteFolder,
    dailyNoteHeading: readString(source.dailyNoteHeading) || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.dailyNoteHeading,
    mcpEnabled: source.mcpEnabled === true,
    wikiCompilerEnabled: source.wikiCompilerEnabled !== false,
    wikiRawFolder: normalizeVaultFolder(source.wikiRawFolder || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiRawFolder) || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiRawFolder,
    wikiFolder: normalizeVaultFolder(source.wikiFolder || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiFolder) || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiFolder,
    wikiIndexFolder: normalizeVaultFolder(source.wikiIndexFolder || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiIndexFolder) || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiIndexFolder,
    wikiMetaFolder: normalizeVaultFolder(source.wikiMetaFolder || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiMetaFolder) || DEFAULT_OBSIDIAN_BRIDGE_CONFIG.wikiMetaFolder,
    routingRules: normalizeRoutingRules(source.routingRules),
    vaults,
  };
};

const toPublicConfig = (config) => {
  const { token: _token, ...rest } = config;
  return {
    ...rest,
    vaults: config.vaults.map(({ token: vaultToken, ...vault }) => ({
      ...vault,
      tokenConfigured: Boolean(vaultToken),
    })),
    tokenConfigured: Boolean(config.token),
  };
};

const readStoredConfig = () => {
  try {
    const raw = configStore.get(CONFIG_KEY);
    if (!raw) {
      return DEFAULT_OBSIDIAN_BRIDGE_CONFIG;
    }
    return normalizeObsidianBridgeConfig(JSON.parse(raw));
  } catch (error) {
    if (error instanceof ObsidianBridgeError) {
      throw error;
    }
    return DEFAULT_OBSIDIAN_BRIDGE_CONFIG;
  }
};

export const readObsidianBridgeConfig = ({ includeToken = false } = {}) => {
  const config = readStoredConfig();
  return includeToken ? config : toPublicConfig(config);
};

export const saveObsidianBridgeConfig = (value = {}) => {
  const previous = readStoredConfig();
  const incoming = value && typeof value === 'object' ? value : {};
  const shouldPreserveToken = !Object.prototype.hasOwnProperty.call(incoming, 'token')
    && !Object.prototype.hasOwnProperty.call(incoming, 'pairingToken');
  const previousVaultsById = new Map((previous.vaults || []).map((vault) => [vault.vaultId, vault]));
  const hasIncomingVaults = Array.isArray(incoming.vaults);
  const hasLegacyVaultFields = ['endpoint', 'token', 'pairingToken', 'vaultName', 'readableVaultFolders', 'writeBaseFolder']
    .some((key) => Object.prototype.hasOwnProperty.call(incoming, key));
  const incomingVaults = Array.isArray(incoming.vaults)
    ? incoming.vaults.map((vault, index) => {
      const vaultId = normalizeVaultId(vault?.vaultId, index === 0 ? DEFAULT_VAULT_ID : `vault-${index + 1}`);
      const previousVault = previousVaultsById.get(vaultId) || {};
      const shouldPreserveVaultToken = !Object.prototype.hasOwnProperty.call(vault || {}, 'token')
        && !Object.prototype.hasOwnProperty.call(vault || {}, 'pairingToken');
      return {
        ...previousVault,
        ...(vault || {}),
        vaultId,
        token: shouldPreserveVaultToken ? previousVault.token : vault.token ?? vault.pairingToken,
      };
    })
    : undefined;
  const normalized = normalizeObsidianBridgeConfig({
    ...previous,
    ...incoming,
    token: shouldPreserveToken ? previous.token : incoming.token ?? incoming.pairingToken,
    vaults: hasIncomingVaults ? incomingVaults : hasLegacyVaultFields ? undefined : previous.vaults,
  });

  configStore.set(CONFIG_KEY, JSON.stringify(normalized));
  return toPublicConfig(normalized);
};

const patchStoredBridgeStatus = (patch = {}) => {
  const current = readStoredConfig();
  const activeVault = activeVaultFromConfig(current);
  const vaults = current.vaults.map((vault) => {
    if (vault.vaultId !== activeVault.vaultId) {
      return vault;
    }
    return {
      ...vault,
      name: readString(patch.vaultName ?? patch.name) || vault.name,
      lastConnection: readString(patch.lastConnection) || vault.lastConnection,
      lastError: Object.prototype.hasOwnProperty.call(patch, 'lastError') ? readString(patch.lastError) : vault.lastError,
      pluginVersion: readString(patch.pluginVersion) || vault.pluginVersion,
      status: readString(patch.status) || vault.status,
    };
  });
  const normalized = normalizeObsidianBridgeConfig({
    ...current,
    ...patch,
    token: current.token,
    vaults,
  });
  configStore.set(CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
};

const normalizeTags = (tags) => (
  Array.isArray(tags)
    ? [...new Set(tags.map(readString).filter(Boolean))]
    : []
);

export const normalizeObsidianDocumentPayload = (payload = {}, defaultMode = 'project-knowledge') => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const title = readString(source.title);
  if (!title) {
    throw new ObsidianBridgeError('Document title is required.', {
      code: 'OBSIDIAN_DOCUMENT_INVALID',
      statusCode: 400,
    });
  }

  if (typeof source.content !== 'string') {
    throw new ObsidianBridgeError('Document content is required.', {
      code: 'OBSIDIAN_DOCUMENT_INVALID',
      statusCode: 400,
    });
  }

  const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
    ? source.metadata
    : {};
  const confidence = Number.parseFloat(String(source.confidence ?? ''));

  return {
    title,
    content: source.content,
    mode: normalizeMode(source.mode, normalizeMode(defaultMode)),
    baseFolder: normalizeVaultFolder(source.baseFolder || source.writeBaseFolder),
    projectName: readString(source.projectName),
    sessionId: readString(source.sessionId),
    argusId: readString(source.argusId),
    kind: readString(source.kind),
    status: readString(source.status),
    sourceArtifactId: readString(source.sourceArtifactId),
    templateId: readString(source.templateId),
    related: normalizeTags(source.related),
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : null,
    tags: normalizeTags(source.tags),
    metadata,
  };
};

const getConfiguredBridge = ({ requireEnabled = false, vaultId = '', payload = null } = {}) => {
  const config = readObsidianBridgeConfig({ includeToken: true });
  if (requireEnabled && !config.enabled) {
    throw new ObsidianBridgeError('Obsidian bridge is disabled.', {
      code: 'OBSIDIAN_BRIDGE_DISABLED',
      statusCode: 409,
    });
  }
  const vault = payload
    ? vaultForPayload(config, payload)
    : vaultId
    ? config.vaults.find((entry) => entry.vaultId === vaultId)
    : activeVaultFromConfig(config);
  if (!vault) {
    throw new ObsidianBridgeError('Obsidian bridge vault is not configured.', {
      code: 'OBSIDIAN_BRIDGE_VAULT_NOT_CONFIGURED',
      statusCode: 404,
    });
  }
  if (!vault.token) {
    throw new ObsidianBridgeError('Obsidian bridge token is not configured.', {
      code: 'OBSIDIAN_BRIDGE_NOT_CONFIGURED',
      statusCode: 400,
    });
  }
  return {
    ...config,
    endpoint: vault.endpoint,
    token: vault.token,
    vaultName: vault.name,
    writeBaseFolder: payload?.projectName && vault.projectMappings?.[payload.projectName]
      ? vault.projectMappings[payload.projectName]
      : vault.writeBaseFolder,
    readableVaultFolders: vault.readableFolders,
    activeVaultId: vault.vaultId,
    activeVault: vault,
  };
};

const readResponseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const callBridge = async (path, options = {}, config, fetchImpl) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(`${config.endpoint}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const data = await readResponseJson(response);
    if (!response.ok || data?.error) {
      throw new ObsidianBridgeError(data?.error || `Obsidian bridge returned HTTP ${response.status}.`, {
        code: data?.code || 'OBSIDIAN_BRIDGE_REQUEST_FAILED',
        statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
        details: data,
      });
    }
    return data || { success: true };
  } catch (error) {
    if (error instanceof ObsidianBridgeError) {
      throw error;
    }
    const message = error?.name === 'AbortError'
      ? 'Obsidian bridge request timed out.'
      : `Unable to reach Obsidian bridge: ${error?.message || 'unknown error'}`;
    throw new ObsidianBridgeError(message, {
      code: 'OBSIDIAN_BRIDGE_UNREACHABLE',
      statusCode: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const sendObsidianDocument = async (payload, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId, payload });
  const document = normalizeObsidianDocumentPayload(payload, config.defaultMode);
  if (!document.baseFolder && config.writeBaseFolder) {
    document.baseFolder = config.writeBaseFolder;
  }
  return callBridge('/argus/v1/documents', {
    method: 'POST',
    body: JSON.stringify(document),
  }, config, fetchImpl);
};

export const sendObsidianWikiIngest = async (payload, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId, payload });
  return callBridge('/argus/v1/wiki/ingest', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, config, fetchImpl);
};

export const sendObsidianWikiCompile = async (payload, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId, payload });
  return callBridge('/argus/v1/wiki/compile', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, config, fetchImpl);
};

export const lintObsidianWiki = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  return callBridge('/argus/v1/wiki/lint', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, config, fetchImpl);
};

export const testObsidianBridgeConnection = async ({
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge();
  try {
    const result = await callBridge('/argus/v1/status', {
      method: 'GET',
    }, config, fetchImpl);
    patchStoredBridgeStatus({
      vaultName: readString(result.vaultName),
      pluginVersion: readString(result.pluginVersion) || 'unknown',
      lastConnection: new Date().toISOString(),
      lastError: '',
    });
    return result;
  } catch (error) {
    patchStoredBridgeStatus({
      lastError: error?.message || 'Failed to connect to Obsidian bridge.',
    });
    throw error;
  }
};

export const normalizeObsidianSearchPayload = (payload = {}, config = readObsidianBridgeConfig()) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const limit = Number.parseInt(String(source.limit ?? ''), 10);
  return {
    vaultId: normalizeVaultId(source.vaultId || config.activeVaultId || DEFAULT_VAULT_ID),
    query: readString(source.query),
    folders: normalizeVaultFolders(source.folders || config.readableVaultFolders),
    filters: Array.isArray(source.filters) ? source.filters : [],
    sourceTypes: Array.isArray(source.sourceTypes) && source.sourceTypes.length > 0
      ? source.sourceTypes.filter((type) => ['markdown', 'canvas', 'excalidraw'].includes(type))
      : undefined,
    projectName: readString(source.projectName),
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 10,
  };
};

export const searchObsidianBridge = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  return callBridge('/argus/v1/search', {
    method: 'POST',
    body: JSON.stringify(normalizeObsidianSearchPayload(payload, config)),
  }, config, fetchImpl);
};

export const buildObsidianContext = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  return callBridge('/argus/v1/context', {
    method: 'POST',
    body: JSON.stringify(normalizeObsidianSearchPayload(payload, config)),
  }, config, fetchImpl);
};

const encodeBooleanParam = (value) => (value === false ? 'false' : 'true');

export const getActiveObsidianNote = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const params = new URLSearchParams({
    includeContent: encodeBooleanParam(payload.includeContent),
    includeSelection: encodeBooleanParam(payload.includeSelection),
  });
  return callBridge(`/argus/v1/active?${params.toString()}`, {
    method: 'GET',
  }, config, fetchImpl);
};

export const patchObsidianNote = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const { vaultId: _vaultId, ...body } = payload;
  return callBridge('/argus/v1/patch', {
    method: 'POST',
    body: JSON.stringify(body),
  }, config, fetchImpl);
};

export const queryObsidianNotes = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  return callBridge('/argus/v1/query', {
    method: 'POST',
    body: JSON.stringify(normalizeObsidianSearchPayload(payload, config)),
  }, config, fetchImpl);
};

export const appendObsidianPeriodicNote = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const { vaultId: _vaultId, ...body } = payload;
  return callBridge('/argus/v1/periodic/append', {
    method: 'POST',
    body: JSON.stringify(body),
  }, config, fetchImpl);
};

export const getObsidianGraph = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const { vaultId: _vaultId, ...body } = payload;
  return callBridge('/argus/v1/graph', {
    method: 'POST',
    body: JSON.stringify(body),
  }, config, fetchImpl);
};

export const scanObsidianDuplicates = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const { vaultId: _vaultId, ...body } = payload;
  return callBridge('/argus/v1/duplicates/scan', {
    method: 'POST',
    body: JSON.stringify(body),
  }, config, fetchImpl);
};

export const archiveObsidianDuplicates = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const { vaultId: _vaultId, ...body } = payload;
  return callBridge('/argus/v1/duplicates/archive', {
    method: 'POST',
    body: JSON.stringify(body),
  }, config, fetchImpl);
};
