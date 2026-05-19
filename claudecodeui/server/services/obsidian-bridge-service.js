import { appConfigDb } from '../database/db.js';
import {
  listObsidianVaults as defaultListObsidianVaults,
  readObsidianBridgePluginData as defaultReadObsidianBridgePluginData,
} from './obsidian-bridge-installer-service.js';
import {
  buildObsidianSemanticIndexState,
  normalizeObsidianSemanticIndexMetadata,
  queryObsidianSemanticIndex,
} from './obsidian-semantic-index-service.js';
import {
  detectReadOnlyObsidianProviderCapabilities,
  normalizeReadOnlyObsidianProviderConfig,
  queryReadOnlyObsidianProvider,
} from './obsidian-readonly-provider-service.js';
import {
  DEFAULT_OBSIDIAN_READABLE_FOLDERS,
  validateObsidianFolderPolicy,
} from './obsidian-folder-policy-service.js';

const CONFIG_KEY = 'obsidian_bridge';
const DEFAULT_PORT = '27177';
const DEFAULT_VAULT_ID = 'default';
const MAIN_PATH_SWITCH_SCOPE = 'global-v1';

export const OBSIDIAN_BRIDGE_MODES = [
  'project-knowledge',
  'second-brain',
  'ai-memory',
];

export const DEFAULT_OBSIDIAN_BRIDGE_CONFIG = {
  enabled: true,
  endpoint: 'http://127.0.0.1:27177',
  token: '',
  vaultName: '',
  defaultMode: 'project-knowledge',
  timeoutMs: 5000,
  autoExportKnowledgeArtifacts: false,
  autoExportKnowledgeArtifactsOptIn: false,
  readableVaultFolders: DEFAULT_OBSIDIAN_READABLE_FOLDERS,
  fallbackToProjectKnowledge: true,
  lastConnection: '',
  lastQuery: '',
  lastWrite: '',
  lastError: '',
  pluginVersion: '',
  aiMemoryReadbackEnabled: false,
  aiMemoryMaxResults: 8,
  aiMemoryProjectScopeEnabled: true,
  activeVaultId: DEFAULT_VAULT_ID,
  activeNoteReadbackEnabled: false,
  dailyNoteFolder: 'Daily',
  dailyNoteHeading: 'Argus',
  mcpEnabled: false,
  wikiPrimaryEnabled: true,
  wikiCompilerEnabled: true,
  wikiReadbackEnabled: true,
  wikiReadbackIncludeRaw: false,
  wikiReadbackMaxResults: 8,
  wikiRawFolder: 'Argus/Raw',
  wikiFolder: 'Argus/Wiki',
  wikiIndexFolder: 'Argus/_Indexes',
  wikiMetaFolder: 'Argus/_Meta',
  codegraphEnabled: true,
  codegraphBackgroundSyncEnabled: true,
  codegraphWriteObsidianSummaries: true,
  codegraphLazyLlmSummaries: false,
  codegraphMaxSymbolNotes: 50,
  codegraphImpactMaxDepth: 2,
  codegraphImpactLimit: 50,
  codegraphGhostPolicy: 'deprecate',
  codegraphAutoDeleteGhostNotes: false,
  codegraphStorageRoot: '',
  codegraphExportLevel: 'structural',
  codegraphMaxEmbeddedSymbols: 200,
  obsidianSemanticProvider: 'auto',
  obsidianSemanticFallbackEnabled: true,
  obsidianSemanticIndexMetadata: {},
  obsidianSemanticProviderTransport: 'bridge',
  obsidianSemanticProviderEndpoint: '',
  obsidianSemanticProviderCommand: '',
  obsidianSemanticProviderTimeoutMs: 1500,
  obsidianMainPathSwitchScope: MAIN_PATH_SWITCH_SCOPE,
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

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

const normalizeGlobalMainPathSwitch = (source, key) => {
  if (!hasOwn(source, key)) {
    return DEFAULT_OBSIDIAN_BRIDGE_CONFIG[key] === true;
  }
  if (source.obsidianMainPathSwitchScope !== MAIN_PATH_SWITCH_SCOPE && source[key] === false) {
    return DEFAULT_OBSIDIAN_BRIDGE_CONFIG[key] === true;
  }
  return source[key] === true;
};

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

const normalizeCodeGraphStorageRoot = (value) => (
  readString(value).replace(/[<>|?*\x00-\x1f]/g, '').trim()
);

const REQUIRED_WIKI_READABLE_FOLDERS = DEFAULT_OBSIDIAN_READABLE_FOLDERS;

const normalizeVaultFolders = (value) => {
  const source = Array.isArray(value) ? value : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.readableVaultFolders;
  const folders = [...new Set([
    ...source,
    ...REQUIRED_WIKI_READABLE_FOLDERS,
  ].map(normalizeVaultFolder).filter(Boolean))];
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
    enabled: normalizeGlobalMainPathSwitch(source, 'enabled'),
    endpoint: activeVault.endpoint,
    token: activeVault.token,
    vaultName: activeVault.name,
    defaultMode: normalizeMode(source.defaultMode),
    timeoutMs: normalizeTimeout(source.timeoutMs),
    autoExportKnowledgeArtifacts: source.autoExportKnowledgeArtifacts === true
      && source.autoExportKnowledgeArtifactsOptIn === true,
    autoExportKnowledgeArtifactsOptIn: source.autoExportKnowledgeArtifactsOptIn === true,
    readableVaultFolders: activeVault.readableFolders,
    fallbackToProjectKnowledge: source.fallbackToProjectKnowledge !== false,
    lastConnection: activeVault.lastConnection || readString(source.lastConnection),
    lastQuery: readString(source.lastQuery).slice(0, 500),
    lastWrite: readString(source.lastWrite).slice(0, 500),
    lastError: (activeVault.lastError || readString(source.lastError)).slice(0, 500),
    pluginVersion: (activeVault.pluginVersion || readString(source.pluginVersion)).slice(0, 80),
    wikiPrimaryEnabled: source.wikiPrimaryEnabled !== false,
    wikiReadbackEnabled: normalizeGlobalMainPathSwitch(source, 'wikiReadbackEnabled'),
    wikiReadbackIncludeRaw: source.wikiReadbackIncludeRaw === true,
    wikiReadbackMaxResults: normalizeMaxResults(source.wikiReadbackMaxResults ?? source.aiMemoryMaxResults),
    aiMemoryReadbackEnabled: normalizeGlobalMainPathSwitch(source, 'aiMemoryReadbackEnabled'),
    aiMemoryMaxResults: normalizeMaxResults(source.aiMemoryMaxResults ?? source.wikiReadbackMaxResults),
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
    codegraphEnabled: normalizeGlobalMainPathSwitch(source, 'codegraphEnabled'),
    codegraphBackgroundSyncEnabled: source.codegraphBackgroundSyncEnabled !== false,
    codegraphWriteObsidianSummaries: source.codegraphWriteObsidianSummaries !== false,
    codegraphLazyLlmSummaries: source.codegraphLazyLlmSummaries === true,
    codegraphMaxSymbolNotes: normalizeNumberRange(source.codegraphMaxSymbolNotes, DEFAULT_OBSIDIAN_BRIDGE_CONFIG.codegraphMaxSymbolNotes, 1, 200),
    codegraphImpactMaxDepth: normalizeNumberRange(source.codegraphImpactMaxDepth, DEFAULT_OBSIDIAN_BRIDGE_CONFIG.codegraphImpactMaxDepth, 1, 5),
    codegraphImpactLimit: normalizeNumberRange(source.codegraphImpactLimit, DEFAULT_OBSIDIAN_BRIDGE_CONFIG.codegraphImpactLimit, 1, 200),
    codegraphGhostPolicy: normalizeCodeGraphGhostPolicy(source.codegraphGhostPolicy),
    codegraphAutoDeleteGhostNotes: source.codegraphAutoDeleteGhostNotes === true,
    codegraphStorageRoot: normalizeCodeGraphStorageRoot(source.codegraphStorageRoot),
    codegraphExportLevel: normalizeCodeGraphExportLevel(source.codegraphExportLevel),
    codegraphMaxEmbeddedSymbols: normalizeNumberRange(source.codegraphMaxEmbeddedSymbols, DEFAULT_OBSIDIAN_BRIDGE_CONFIG.codegraphMaxEmbeddedSymbols, 1, 1000),
    obsidianSemanticProvider: normalizeObsidianSemanticProvider(source.obsidianSemanticProvider),
    obsidianSemanticFallbackEnabled: source.obsidianSemanticFallbackEnabled !== false,
    obsidianSemanticIndexMetadata: normalizeObsidianSemanticIndexMetadata(source.obsidianSemanticIndexMetadata),
    obsidianSemanticProviderTransport: normalizeReadOnlyObsidianProviderConfig(source).transport,
    obsidianSemanticProviderEndpoint: normalizeReadOnlyObsidianProviderConfig(source).endpoint,
    obsidianSemanticProviderCommand: normalizeReadOnlyObsidianProviderConfig(source).command,
    obsidianSemanticProviderTimeoutMs: normalizeReadOnlyObsidianProviderConfig(source).timeoutMs,
    obsidianMainPathSwitchScope: MAIN_PATH_SWITCH_SCOPE,
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
    const raw = readStoredConfigRaw();
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

const normalizeNumberRange = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
};

const normalizeCodeGraphGhostPolicy = (value) => (
  ['deprecate', 'archive', 'ignore'].includes(value) ? value : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.codegraphGhostPolicy
);

const normalizeCodeGraphExportLevel = (value) => (
  ['structural', 'all'].includes(value) ? value : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.codegraphExportLevel
);

const normalizeObsidianSemanticProvider = (value) => {
  const normalized = readString(value).toLowerCase().replace(/_/g, '-');
  return ['auto', 'smart-connections', 'open-connections', 'bridge-keyword', 'disabled'].includes(normalized)
    ? normalized
    : DEFAULT_OBSIDIAN_BRIDGE_CONFIG.obsidianSemanticProvider;
};

const readStoredConfigRaw = () => {
  try {
    return configStore.get(CONFIG_KEY) || '';
  } catch {
    return '';
  }
};

export const readObsidianBridgeConfig = ({ includeToken = false } = {}) => {
  const config = readStoredConfig();
  return includeToken ? config : toPublicConfig(config);
};

export const getObsidianSemanticIndexState = () => {
  const config = readObsidianBridgeConfig({ includeToken: true });
  const metadata = normalizeObsidianSemanticIndexMetadata(config.obsidianSemanticIndexMetadata);
  const semanticProviders = metadata.providerId && metadata.providerId !== 'auto'
    ? [{
      id: metadata.providerId,
      available: metadata.itemCount > 0,
      readOnly: true,
      itemCount: metadata.itemCount,
      embeddingModel: metadata.embeddingModel,
      lastIndexedAt: metadata.lastIndexedAt,
    }]
    : [];
  return buildObsidianSemanticIndexState({
    config,
    status: { semanticProviders },
  });
};

export const getObsidianReadOnlyProviderCapabilities = async ({
  fetchImpl = globalThis.fetch,
  mcpClient = null,
} = {}) => {
  const config = readObsidianBridgeConfig({ includeToken: true });
  return detectReadOnlyObsidianProviderCapabilities({
    transport: config.obsidianSemanticProviderTransport,
    providerId: config.obsidianSemanticProvider,
    endpoint: config.obsidianSemanticProviderEndpoint,
    command: config.obsidianSemanticProviderCommand,
    timeoutMs: config.obsidianSemanticProviderTimeoutMs,
  }, { fetchImpl, mcpClient });
};

const hasAuthError = (value = '') => /\b(401|403|unauthori[sz]ed|forbidden|stale\s+token|token)\b/i.test(value);

const hasWriteFailure = (value = '') => /\b(write|save|upsert|patch)\b.*\b(fail|failed|error|denied)\b|\b(fail|failed|error|denied)\b.*\b(write|save|upsert|patch)\b/i.test(value);

const buildBridgeRepairActions = () => [
  { id: 'reconnect', label: 'Reconnect', safe: true, enabled: true },
  { id: 'reinstall-plugin', label: 'Reinstall plugin', safe: true, enabled: true },
  { id: 'select-vault', label: 'Select vault', safe: true, enabled: true },
  { id: 'refresh-folders', label: 'Refresh folders', safe: true, enabled: true },
  { id: 'run-test-query', label: 'Run test query', safe: true, enabled: true },
  { id: 'run-test-write', label: 'Run test write', safe: true, enabled: true },
];

export const getObsidianBridgeHealth = () => {
  const config = readObsidianBridgeConfig({ includeToken: true });
  const activeVault = activeVaultFromConfig(config);
  const semanticIndex = getObsidianSemanticIndexState();
  const folderPolicy = validateObsidianFolderPolicy(config);
  const lastError = readString(config.lastError || activeVault?.lastError);
  const tokenConfigured = Boolean(config.token || activeVault?.token);
  const pluginVersion = readString(config.pluginVersion || activeVault?.pluginVersion);
  const vaultName = readString(config.vaultName || activeVault?.name);
  const writableFolders = config.wikiPrimaryEnabled === false
    ? []
    : [normalizeVaultFolder(activeVault?.writeBaseFolder || '')].filter(Boolean);
  const readableFolders = normalizeVaultFolders(config.readableVaultFolders || activeVault?.readableFolders);
  const tokenStatus = !tokenConfigured
    ? 'missing'
    : hasAuthError(lastError)
      ? 'stale'
      : 'configured';
  const pluginStatus = pluginVersion ? 'installed' : 'not-installed';
  const states = new Set();

  if (config.enabled === false) states.add('disabled');
  if (!pluginVersion) states.add('not-installed');
  if (!tokenConfigured) states.add('not-paired');
  if (!vaultName) states.add('wrong-vault');
  if (tokenStatus === 'stale') states.add('stale-token');
  if (config.codegraphEnabled !== false && !readString(config.codegraphStorageRoot)) states.add('indexing-missing');
  if (config.wikiReadbackEnabled !== false && !readableFolders.some((folder) => /wiki/i.test(folder))) states.add('no-wiki-notes');
  if (writableFolders.length === 0) states.add('read-only-mode');
  if (hasWriteFailure(lastError)) states.add('write-failed');

  const stateList = [...states];
  const status = config.enabled === false
    ? 'disabled'
    : stateList.length > 0
      ? 'degraded'
      : 'ok';
  const actions = [];
  if (config.enabled === false) actions.push('Enable Obsidian Bridge in Settings');
  if (!tokenConfigured || tokenStatus === 'stale') actions.push('Reconnect Obsidian Bridge');
  if (!pluginVersion) actions.push('Reinstall Obsidian plugin');
  if (!vaultName) actions.push('Select the correct Obsidian vault');
  if (writableFolders.length === 0) actions.push('Confirm write folders or disable read-only mode');
  if (config.codegraphEnabled !== false && !readString(config.codegraphStorageRoot)) actions.push('Refresh CodeGraph indexing state');

  return {
    status,
    states: stateList,
    contract: {
      bridgeEnabled: config.enabled !== false,
      vaultSelected: Boolean(vaultName),
      pluginStatus,
      tokenStatus,
      writableFolders,
      readableFolders,
      lastQuery: readString(config.lastQuery),
      lastWrite: readString(config.lastWrite),
      lastError,
      vaultName,
      endpoint: readString(config.endpoint),
      pluginVersion,
    },
    semanticIndex,
    folderPolicy,
    repairActions: buildBridgeRepairActions(),
    actions,
    safeLogs: [
      `status=${status}`,
      `states=${stateList.join(',') || 'none'}`,
      `endpoint=${readString(config.endpoint) || 'unset'}`,
      `vault=${vaultName || 'unset'}`,
      `plugin=${pluginVersion || 'missing'}`,
      `lastError=${lastError || 'none'}`,
    ],
  };
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

const chooseReachableVault = (vaults = [], config = {}) => {
  const reachable = (Array.isArray(vaults) ? vaults : [])
    .filter((vault) => vault?.bridgeReachable === true && vault.bridgeEndpoint && vault.tokenConfigured);
  if (reachable.length === 0) {
    return null;
  }

  const activeVault = activeVaultFromConfig(config);
  return reachable.find((vault) => readString(vault.name).toLowerCase() === readString(activeVault.name || config.vaultName).toLowerCase())
    || reachable.find((vault) => readString(vault.bridgeEndpoint) === readString(activeVault.endpoint || config.endpoint))
    || reachable.find((vault) => vault.open === true)
    || reachable[0];
};

const scoreRepairVaultCandidate = (vault, config = {}) => {
  const activeVault = activeVaultFromConfig(config);
  let score = 0;
  if (vault?.bridgeReachable === true) score += 100;
  if (vault?.open === true) score += 20;
  if (readString(vault?.name).toLowerCase() === readString(activeVault.name || config.vaultName).toLowerCase()) score += 30;
  if (readString(vault?.bridgeEndpoint) === readString(activeVault.endpoint || config.endpoint)) score += 10;
  if (vault?.pluginInstalled) score += 5;
  return score;
};

const chooseRepairVaultCandidate = (vaults = [], config = {}) => {
  const reachable = chooseReachableVault(vaults, config);
  if (reachable) {
    return reachable;
  }

  const candidates = (Array.isArray(vaults) ? vaults : [])
    .filter((vault) => vault?.path && vault.bridgeEndpoint && vault.tokenConfigured)
    .sort((left, right) => scoreRepairVaultCandidate(right, config) - scoreRepairVaultCandidate(left, config));
  return candidates[0] || null;
};

const shouldEmitObsidianDebugLog = (logger) => Boolean(
  logger
    && (
      logger !== console
      || process.env.ARGUS_OBSIDIAN_DEBUG === '1'
      || process.env.ARGUS_DEBUG_PACKAGE === '1'
      || process.env.ARGUS_PACKAGE_CHANNEL === 'debug'
    ),
);

const logObsidianBridge = (logger, event, details = {}, level = 'log') => {
  if (!shouldEmitObsidianDebugLog(logger)) return;
  const writer = level === 'warn'
    ? logger.warn || logger.log || logger.info
    : logger.log || logger.info || logger.warn;
  if (typeof writer !== 'function') return;
  writer.call(logger, `[Obsidian Bridge] ${event} ${JSON.stringify({
    at: new Date().toISOString(),
    ...details,
  })}`);
};

export const repairObsidianBridgeConfigFromReachableVaults = async ({
  allowDisabledBootstrap = false,
  fetchImpl = globalThis.fetch,
  listVaults = defaultListObsidianVaults,
  readPluginData = defaultReadObsidianBridgePluginData,
  statusTimeoutMs = 1500,
  logger = console,
} = {}) => {
  const current = readObsidianBridgeConfig({ includeToken: true });
  const hasStoredBridgeConfig = Boolean(readStoredConfigRaw());
  if (!current.enabled && !(allowDisabledBootstrap && !hasStoredBridgeConfig)) {
    logObsidianBridge(logger, 'repair_skip_disabled', {
      allowDisabledBootstrap,
      hasStoredBridgeConfig,
    });
    return null;
  }

  let discoveredVaults = [];
  try {
    discoveredVaults = await listVaults({
      fetchImpl,
      statusTimeoutMs,
    });
  } catch (error) {
    logObsidianBridge(logger, 'repair_discovery_failed', {
      message: error?.message || String(error || 'Vault discovery failed.'),
    }, 'warn');
  }

  logObsidianBridge(logger, 'repair_discovery', {
    count: Array.isArray(discoveredVaults) ? discoveredVaults.length : 0,
    currentEndpoint: current.endpoint,
    currentVaultName: current.vaultName,
    candidates: (Array.isArray(discoveredVaults) ? discoveredVaults : []).slice(0, 5).map((vault) => ({
      name: readString(vault?.name),
      endpoint: readString(vault?.bridgeEndpoint),
      reachable: vault?.bridgeReachable,
      tokenConfigured: vault?.tokenConfigured === true,
      open: vault?.open === true,
      pluginVersion: readString(vault?.statusPluginVersion || vault?.pluginVersion),
    })),
  });

  const selectedVault = chooseRepairVaultCandidate(discoveredVaults, current);
  if (!selectedVault?.path) {
    logObsidianBridge(logger, 'repair_no_candidate', {
      currentEndpoint: current.endpoint,
      currentVaultName: current.vaultName,
    }, 'warn');
    return null;
  }

  const bridgeData = await readPluginData(selectedVault.path).catch(() => ({}));
  const endpoint = readString(bridgeData.endpoint || selectedVault.bridgeEndpoint);
  const token = readString(bridgeData.token);
  if (!endpoint || !token) {
    logObsidianBridge(logger, 'repair_candidate_incomplete', {
      vaultName: readString(selectedVault.name),
      endpoint,
      hasToken: Boolean(token),
    }, 'warn');
    return null;
  }

  const activeVault = activeVaultFromConfig(current);
  const vaultId = activeVault.vaultId || current.activeVaultId || DEFAULT_VAULT_ID;
  const nextVault = {
    ...activeVault,
    vaultId,
    name: readString(selectedVault.statusVaultName || selectedVault.name || activeVault.name),
    endpoint,
    token,
    readableFolders: Array.isArray(bridgeData.readableFolders) && bridgeData.readableFolders.length > 0
      ? bridgeData.readableFolders
      : selectedVault.readableFolders || activeVault.readableFolders,
    writeBaseFolder: readString(bridgeData.baseFolder || selectedVault.baseFolder || activeVault.writeBaseFolder) || 'Argus',
    pluginVersion: readString(selectedVault.statusPluginVersion || selectedVault.pluginVersion || activeVault.pluginVersion),
    lastConnection: new Date().toISOString(),
    lastError: '',
  };
  saveObsidianBridgeConfig({
    ...current,
    enabled: true,
    activeVaultId: vaultId,
    vaults: [
      ...(current.vaults || []).filter((vault) => vault.vaultId !== vaultId),
      nextVault,
    ],
    lastError: '',
  });
  logObsidianBridge(logger, 'repair_saved', {
    vaultName: nextVault.name,
    endpoint,
    previousEndpoint: activeVault.endpoint || current.endpoint,
    pluginVersion: nextVault.pluginVersion,
    reachable: selectedVault.bridgeReachable,
  }, selectedVault.bridgeReachable === true ? 'log' : 'warn');
  return getConfiguredBridge({ requireEnabled: true, vaultId });
};

const readResponseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const bridgePayloadSummary = (path, payload = {}) => {
  const body = payload && typeof payload === 'object' ? payload : {};
  if (path === '/argus/v1/files/upsert') {
    return {
      notePath: readString(body.path),
      kind: readString(body.kind),
      title: readString(body.title),
      contentBytes: Buffer.byteLength(String(body.content || ''), 'utf8'),
    };
  }
  if (path === '/argus/v1/patch') {
    return {
      notePath: readString(body.target?.path || body.path),
      operation: readString(body.operation),
      heading: readString(body.heading),
      contentBytes: Buffer.byteLength(String(body.content || ''), 'utf8'),
    };
  }
  if (path === '/argus/v1/query') {
    return {
      query: readString(body.query),
      folders: Array.isArray(body.folders) ? body.folders.slice(0, 5) : [],
      limit: body.limit,
      filterCount: Array.isArray(body.filters) ? body.filters.length : 0,
    };
  }
  return {};
};

const callBridge = async (path, options = {}, config, fetchImpl, {
  allowRepair = true,
  repairBridgeConfig = repairObsidianBridgeConfigFromReachableVaults,
  vaultId = '',
  payload = null,
  logger = console,
  payloadSummary = null,
} = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  timeout.unref?.();
  const startedAt = Date.now();
  const method = readString(options.method || 'GET').toUpperCase();

  try {
    logObsidianBridge(logger, 'request_start', {
      method,
      path,
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      vaultName: config.vaultName,
      pluginVersion: config.pluginVersion,
      ...(payloadSummary || bridgePayloadSummary(path, payload)),
    });
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
      logObsidianBridge(logger, 'request_failed', {
        method,
        path,
        endpoint: config.endpoint,
        status: response.status,
        code: data?.code || 'OBSIDIAN_BRIDGE_REQUEST_FAILED',
        message: data?.error || `Obsidian bridge returned HTTP ${response.status}.`,
        durationMs: Date.now() - startedAt,
      }, 'warn');
      throw new ObsidianBridgeError(data?.error || `Obsidian bridge returned HTTP ${response.status}.`, {
        code: data?.code || 'OBSIDIAN_BRIDGE_REQUEST_FAILED',
        statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
        details: data,
      });
    }
    logObsidianBridge(logger, 'request_success', {
      method,
      path,
      endpoint: config.endpoint,
      status: response.status,
      durationMs: Date.now() - startedAt,
      resultKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [],
    });
    return data || { success: true };
  } catch (error) {
    if (error instanceof ObsidianBridgeError) {
      throw error;
    }
    const message = error?.name === 'AbortError'
      ? 'Obsidian bridge request timed out.'
      : `Unable to reach Obsidian bridge: ${error?.message || 'unknown error'}`;
    if (allowRepair && typeof repairBridgeConfig === 'function') {
      logObsidianBridge(logger, 'repair_attempt', {
        method,
        path,
        endpoint: config.endpoint,
        reason: message,
        durationMs: Date.now() - startedAt,
      }, 'warn');
      const repairedConfig = await repairBridgeConfig({
        fetchImpl,
        statusTimeoutMs: Math.min(config.timeoutMs || 5000, 1500),
        logger,
      }).catch((repairError) => {
        logObsidianBridge(logger, 'repair_failed', {
          method,
          path,
          endpoint: config.endpoint,
          message: repairError?.message || String(repairError || 'Bridge repair failed.'),
        }, 'warn');
        return null;
      });
      if (repairedConfig?.endpoint && repairedConfig.endpoint !== config.endpoint && repairedConfig.token) {
        logObsidianBridge(logger, 'repair_retry', {
          method,
          path,
          previousEndpoint: config.endpoint,
          nextEndpoint: repairedConfig.endpoint,
        }, 'warn');
        const nextConfig = payload || vaultId
          ? getConfiguredBridge({
            requireEnabled: true,
            vaultId: vaultId || repairedConfig.activeVaultId,
            payload,
          })
          : repairedConfig;
        return callBridge(path, options, nextConfig, fetchImpl, {
          allowRepair: false,
          repairBridgeConfig,
          vaultId,
          payload,
          logger,
          payloadSummary,
        });
      }
    }
    logObsidianBridge(logger, 'request_unreachable', {
      method,
      path,
      endpoint: config.endpoint,
      message,
      durationMs: Date.now() - startedAt,
    }, 'warn');
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
  repairBridgeConfig = repairObsidianBridgeConfigFromReachableVaults,
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
  }, config, fetchImpl, {
    repairBridgeConfig,
    vaultId: payload.vaultId,
    payload,
  });
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

export const updateObsidianWikiViews = async (payload, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId, payload });
  return callBridge('/argus/v1/wiki/views/update', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, config, fetchImpl);
};

export const migrateObsidianWikiLegacy = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  return callBridge('/argus/v1/wiki/migrate-legacy', {
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

export const searchObsidianSemanticIndex = async (payload = {}, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const bridgeConfig = readObsidianBridgeConfig({ includeToken: true });
  const readOnlyProvider = normalizeReadOnlyObsidianProviderConfig({
    transport: bridgeConfig.obsidianSemanticProviderTransport,
    providerId: bridgeConfig.obsidianSemanticProvider,
    endpoint: bridgeConfig.obsidianSemanticProviderEndpoint,
    command: bridgeConfig.obsidianSemanticProviderCommand,
    timeoutMs: bridgeConfig.obsidianSemanticProviderTimeoutMs,
  });
  const state = readOnlyProvider.transport === 'bridge'
    ? getObsidianSemanticIndexState()
    : {
      ...getObsidianSemanticIndexState(),
      status: 'ready',
      provider: {
        id: readOnlyProvider.providerId,
        label: readOnlyProvider.providerId,
        available: true,
        readOnly: true,
      },
    };
  const normalizedPayload = normalizeObsidianSearchPayload(payload, config);
  return queryObsidianSemanticIndex(normalizedPayload, {
    state,
    semanticSearch: (nextPayload) => (
      readOnlyProvider.transport === 'bridge'
        ? callBridge('/argus/v1/semantic/search', {
          method: 'POST',
          body: JSON.stringify(nextPayload),
        }, config, fetchImpl)
        : queryReadOnlyObsidianProvider(nextPayload, {
          config: readOnlyProvider,
          fetchImpl,
        })
    ),
    fallbackSearch: (nextPayload) => searchObsidianBridge(nextPayload, { fetchImpl }),
  });
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
  logger = console,
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
  }, config, fetchImpl, {
    payload,
    logger,
    payloadSummary: bridgePayloadSummary('/argus/v1/patch', payload),
  });
};

export const upsertObsidianMarkdownFile = async (payload = {}, {
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new ObsidianBridgeError('Fetch implementation is unavailable.', {
      code: 'OBSIDIAN_BRIDGE_UNAVAILABLE',
      statusCode: 500,
    });
  }

  const config = getConfiguredBridge({ requireEnabled: true, vaultId: payload.vaultId });
  const { vaultId: _vaultId, ...body } = payload;
  return callBridge('/argus/v1/files/upsert', {
    method: 'POST',
    body: JSON.stringify(body),
  }, config, fetchImpl, {
    payload,
    logger,
    payloadSummary: bridgePayloadSummary('/argus/v1/files/upsert', payload),
  });
};

export const queryObsidianNotes = async (payload = {}, {
  fetchImpl = globalThis.fetch,
  logger = console,
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
  }, config, fetchImpl, {
    payload,
    logger,
    payloadSummary: bridgePayloadSummary('/argus/v1/query', payload),
  });
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
