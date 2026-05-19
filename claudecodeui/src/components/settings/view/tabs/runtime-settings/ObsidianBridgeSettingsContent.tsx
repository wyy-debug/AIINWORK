import { useEffect, useState } from 'react';
import { BookOpen, Brain, FolderOpen, PlugZap, RefreshCw, Save } from 'lucide-react';

import SettingsToggle from '../../SettingsToggle';
import { Button } from '../../../../../shared/view/ui';
import { apiFetch } from '../../../../../utils/api';
import type { SettingsProject } from '../../../types/types';

type ConfiguredObsidianVault = {
  vaultId: string;
  name: string;
  endpoint: string;
  tokenConfigured: boolean;
  readableFolders: string[];
  writeBaseFolder: string;
  pluginVersion?: string;
  lastConnection?: string;
  lastError?: string;
};

type ObsidianBridgeConfig = {
  enabled: boolean;
  activeVaultId: string;
  vaults: ConfiguredObsidianVault[];
  endpoint: string;
  vaultName: string;
  tokenConfigured: boolean;
  readableVaultFolders: string[];
  lastConnection: string;
  lastError: string;
  pluginVersion: string;
  aiMemoryReadbackEnabled: boolean;
  aiMemoryProjectScopeEnabled: boolean;
  wikiReadbackEnabled: boolean;
  codegraphEnabled: boolean;
  codegraphBackgroundSyncEnabled: boolean;
  codegraphWriteObsidianSummaries: boolean;
  codegraphLazyLlmSummaries: boolean;
  codegraphMaxSymbolNotes: number;
  codegraphImpactMaxDepth: number;
  codegraphImpactLimit: number;
  codegraphGhostPolicy: string;
  codegraphAutoDeleteGhostNotes: boolean;
  codegraphStorageRoot: string;
  codegraphExportLevel: 'structural' | 'all';
  codegraphMaxEmbeddedSymbols: number;
  obsidianMainPathSwitchScope?: string;
  routingRules?: Record<string, unknown>;
};

type ObsidianVault = {
  name: string;
  path: string;
  open: boolean;
  hasObsidianConfig: boolean;
  pluginInstalled: boolean;
  pluginVersion: string;
  bridgePort?: number;
  bridgeEndpoint?: string;
  tokenConfigured?: boolean;
  bridgeReachable?: boolean | null;
  statusVaultName?: string;
  statusPluginVersion?: string;
  bridgeLastError?: string;
  readableFolders?: string[];
  baseFolder?: string;
};

type CodeGraphStatus = {
  state?: string;
  projectName?: string;
  projectRoot?: string;
  updatedAt?: string;
  lastError?: string;
  mcpConfigured?: boolean;
  mcpConfigPath?: string;
  mcpError?: string;
  mcpUsesBundledCli?: boolean;
  codegraphStorageRoot?: string;
  configuredCodegraphStorageRoot?: string;
  codegraphStoragePath?: string;
  lastSync?: {
    filesAdded?: number;
    filesModified?: number;
    filesRemoved?: number;
  };
  lastExport?: {
    documents?: number;
    written?: number;
    skippedUnchanged?: number;
    deprecated?: number;
    staleCandidates?: number;
    exportLevel?: string;
    maxEmbeddedSymbols?: number;
    skipped?: boolean;
    reason?: string;
  };
};

type CodeGraphStatusResponse = {
  config?: {
    enabled?: boolean;
    backgroundSyncEnabled?: boolean;
    writeObsidianSummaries?: boolean;
    lazyLlmSummaries?: boolean;
    maxSymbolNotes?: number;
    impactMaxDepth?: number;
    impactLimit?: number;
    ghostPolicy?: string;
    storageRoot?: string;
    configuredStorageRoot?: string;
    exportLevel?: 'structural' | 'all';
    maxEmbeddedSymbols?: number;
  };
  status?: CodeGraphStatus;
};

type ObsidianHealthAction = {
  id: string;
  label: string;
  safe: boolean;
  enabled: boolean;
};

type ObsidianBridgeHealth = {
  status: 'ok' | 'degraded' | 'disabled';
  states: string[];
  contract: {
    bridgeEnabled: boolean;
    vaultSelected: boolean;
    pluginStatus: string;
    tokenStatus: string;
    writableFolders: string[];
    readableFolders: string[];
    lastQuery: string;
    lastWrite: string;
    lastError: string;
    vaultName: string;
    endpoint: string;
    pluginVersion: string;
  };
  repairActions: ObsidianHealthAction[];
  actions: string[];
  safeLogs: string[];
};

const DEFAULT_CONFIG: ObsidianBridgeConfig = {
  enabled: true,
  activeVaultId: 'default',
  vaults: [],
  endpoint: 'http://127.0.0.1:27177',
  vaultName: '',
  tokenConfigured: false,
  readableVaultFolders: ['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory'],
  lastConnection: '',
  lastError: '',
  pluginVersion: '',
  aiMemoryReadbackEnabled: true,
  aiMemoryProjectScopeEnabled: true,
  wikiReadbackEnabled: true,
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
  obsidianMainPathSwitchScope: 'global-v1',
};

const OBSIDIAN_BRIDGE_SETTINGS_CHANGED_EVENT = 'argusObsidianBridgeSettingsChanged';

const OBSIDIAN_HEALTH_STATE_LABELS: Record<string, string> = {
  disabled: 'disabled',
  'not-installed': 'not installed',
  'not-paired': 'not paired',
  'wrong-vault': 'wrong vault',
  'stale-token': 'stale token',
  'indexing-missing': 'indexing missing',
  'no-wiki-notes': 'no Wiki notes',
  'read-only-mode': 'read-only mode',
  'write-failed': 'write failed',
};

const OBSIDIAN_HEALTH_DEFAULT_ACTIONS: ObsidianHealthAction[] = [
  { id: 'reconnect', label: 'Reconnect', safe: true, enabled: true },
  { id: 'reinstall-plugin', label: 'Reinstall plugin', safe: true, enabled: true },
  { id: 'select-vault', label: 'Select vault', safe: true, enabled: true },
  { id: 'refresh-folders', label: 'Refresh folders', safe: true, enabled: true },
  { id: 'run-test-query', label: 'Run test query', safe: true, enabled: true },
  { id: 'run-test-write', label: 'Run test write', safe: true, enabled: true },
];

const parseJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

const projectLabel = (project?: SettingsProject | null) => (
  project?.displayName || project?.name || ''
);

const formatDateTime = (value = '') => (
  value ? new Date(value).toLocaleString() : '从未'
);

type ObsidianBridgeSettingsContentProps = {
  projects?: SettingsProject[];
  selectedProject?: SettingsProject | null;
};

export default function ObsidianBridgeSettingsContent({
  projects = [],
  selectedProject = null,
}: ObsidianBridgeSettingsContentProps) {
  const [config, setConfig] = useState<ObsidianBridgeConfig>(DEFAULT_CONFIG);
  const [token, setToken] = useState('');
  const [readableFoldersText, setReadableFoldersText] = useState(DEFAULT_CONFIG.readableVaultFolders.join('\n'));
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingVaults, setIsLoadingVaults] = useState(false);
  const [isInstallingPlugin, setIsInstallingPlugin] = useState(false);
  const [isSelectingVault, setIsSelectingVault] = useState(false);
  const [isLoadingCodeGraph, setIsLoadingCodeGraph] = useState(false);
  const [isSyncingCodeGraph, setIsSyncingCodeGraph] = useState(false);
  const [isExportingCodeGraph, setIsExportingCodeGraph] = useState(false);
  const [vaults, setVaults] = useState<ObsidianVault[]>([]);
  const [selectedVaultPath, setSelectedVaultPath] = useState('');
  const [codeGraphStatus, setCodeGraphStatus] = useState<CodeGraphStatus | null>(null);
  const [health, setHealth] = useState<ObsidianBridgeHealth | null>(null);

  const activeProject = selectedProject || projects[0] || null;
  const activeProjectName = activeProject?.name || '';
  const activeProjectRoot = activeProject?.fullPath || activeProject?.path || '';
  const hasActiveProject = Boolean(activeProjectName || activeProjectRoot);
  const memoryEnabled = config.wikiReadbackEnabled && config.aiMemoryReadbackEnabled;
  const codeGraphEnabled = config.codegraphEnabled;
  const reachableVault = vaults.find((vault) => vault.bridgeReachable === true && vault.bridgeEndpoint);
  const configuredEndpoint = config.endpoint.replace(/\/+$/, '');
  const reachableEndpoint = reachableVault?.bridgeEndpoint?.replace(/\/+$/, '') || '';
  const hasReachableEndpointMismatch = Boolean(
    reachableVault
    && reachableEndpoint
    && configuredEndpoint
    && reachableEndpoint !== configuredEndpoint,
  );

  const loadCodeGraphStatus = async ({ quiet = false, showSpinner = true } = {}) => {
    if (!hasActiveProject) {
      setCodeGraphStatus(null);
      return null;
    }
    if (showSpinner) setIsLoadingCodeGraph(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectName) params.set('projectName', activeProjectName);
      if (activeProjectRoot) params.set('projectRoot', activeProjectRoot);
      const data = await parseJson<CodeGraphStatusResponse>(
        await apiFetch(`/api/codegraph/status?${params.toString()}`),
      );
      setCodeGraphStatus(data.status
        ? {
          ...data.status,
          codegraphStorageRoot: data.status.codegraphStorageRoot || data.config?.storageRoot || '',
          configuredCodegraphStorageRoot: data.status.configuredCodegraphStorageRoot || data.config?.configuredStorageRoot || '',
        }
        : null);
      return data;
    } catch (error) {
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : '读取 CodeGraph 状态失败。');
      }
      return null;
    } finally {
      if (showSpinner) setIsLoadingCodeGraph(false);
    }
  };

  const loadVaults = async ({ quiet = false } = {}) => {
    setIsLoadingVaults(true);
    try {
      const data = await parseJson<{ vaults?: ObsidianVault[] }>(
        await apiFetch('/api/obsidian-bridge/vaults'),
      );
      const nextVaults = Array.isArray(data.vaults) ? data.vaults : [];
      setVaults(nextVaults);
      setSelectedVaultPath((previous) => (
        previous || nextVaults.find((vault) => vault.open)?.path || nextVaults[0]?.path || ''
      ));
      if (!quiet) {
        setMessage(`找到 ${nextVaults.length} 个 Obsidian vault。`);
      }
      return nextVaults;
    } catch (error) {
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : '未能发现 Obsidian vault。');
      }
      return [];
    } finally {
      setIsLoadingVaults(false);
    }
  };

  const loadHealth = async ({ quiet = false } = {}) => {
    try {
      const data = await parseJson<{ health: ObsidianBridgeHealth }>(
        await apiFetch('/api/obsidian-bridge/health'),
      );
      setHealth(data.health);
      return data.health;
    } catch (error) {
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : 'Failed to load Obsidian Bridge health.');
      }
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const settingsPromise = apiFetch('/api/settings/obsidian-bridge')
          .then((response) => parseJson<{ config: ObsidianBridgeConfig }>(response));
        const vaultsPromise = apiFetch('/api/obsidian-bridge/vaults')
          .then((response) => parseJson<{ vaults?: ObsidianVault[] }>(response))
          .catch(() => ({ vaults: [] }));
        const healthPromise = apiFetch('/api/obsidian-bridge/health')
          .then((response) => parseJson<{ health: ObsidianBridgeHealth | null }>(response))
          .catch(() => ({ health: null }));
        const [data, vaultData, healthData] = await Promise.all([
          settingsPromise,
          vaultsPromise,
          healthPromise,
        ]);
        if (!cancelled) {
          const nextConfig = { ...DEFAULT_CONFIG, ...data.config };
          const nextVaults = Array.isArray(vaultData.vaults) ? vaultData.vaults : [];
          setConfig(nextConfig);
          setVaults(nextVaults);
          setHealth(healthData.health);
          setSelectedVaultPath(nextVaults.find((vault) => vault.open)?.path || nextVaults[0]?.path || '');
          setReadableFoldersText(nextConfig.readableVaultFolders.join('\n'));
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : '未能加载 Obsidian Bridge 设置。');
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadCodeGraphStatus({ quiet: true, showSpinner: false });
  }, [activeProjectName, activeProjectRoot]);

  const save = async ({
    quiet = false,
    nextConfig: targetConfig = config,
  }: {
    quiet?: boolean;
    nextConfig?: ObsidianBridgeConfig;
  } = {}) => {
    setIsSaving(true);
    try {
      const readableVaultFolders = readableFoldersText
        .split(/\r?\n/)
        .map((folder) => folder.trim())
        .filter(Boolean);
      const payload = {
        ...targetConfig,
        vaults: targetConfig.vaults.length > 0
          ? targetConfig.vaults.map((vault) => (
            vault.vaultId === targetConfig.activeVaultId
              ? {
                ...vault,
                endpoint: targetConfig.endpoint,
                readableFolders: readableVaultFolders,
                ...(token.trim() ? { token: token.trim() } : {}),
              }
              : vault
          ))
          : targetConfig.vaults,
        readableVaultFolders,
        ...(token.trim() ? { token: token.trim() } : {}),
      };
      const data = await parseJson<{ config: ObsidianBridgeConfig }>(
        await apiFetch('/api/settings/obsidian-bridge', {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      );
      const savedConfig = { ...DEFAULT_CONFIG, ...data.config };
      setConfig(savedConfig);
      setReadableFoldersText(savedConfig.readableVaultFolders.join('\n'));
      setToken('');
      window.dispatchEvent(new Event(OBSIDIAN_BRIDGE_SETTINGS_CHANGED_EVENT));
      await loadHealth({ quiet: true });
      if (!quiet) {
        setMessage('Obsidian Bridge 设置已保存。');
      }
      return data.config;
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '保存 Obsidian Bridge 设置失败。';
      setMessage(nextMessage);
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    try {
      await save({ quiet: true });
      const data = await parseJson<{ vaultName?: string; pluginVersion?: string }>(
        await apiFetch('/api/obsidian-bridge/test-connection', { method: 'POST' }),
      );
      const vaultName = data.vaultName || 'Obsidian';
      setMessage(`已连接到 ${vaultName}。`);
      setConfig((previous) => ({
        ...previous,
        vaultName,
        pluginVersion: data.pluginVersion || previous.pluginVersion || '未知',
        lastConnection: new Date().toISOString(),
        lastError: '',
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Obsidian Bridge 连接失败。');
    } finally {
      setIsTesting(false);
    }
  };

  const installPluginToVault = async () => {
    const vaultPath = selectedVaultPath.trim();
    if (!vaultPath) {
      setMessage('请先选择一个 Obsidian vault。');
      return;
    }

    setIsInstallingPlugin(true);
    try {
      const data = await parseJson<{
        config: ObsidianBridgeConfig;
        install?: { vaultName?: string; vaultPath?: string; manifestVersion?: string };
      }>(
        await apiFetch('/api/obsidian-bridge/install-plugin', {
          method: 'POST',
          body: JSON.stringify({ vaultPath, enablePlugin: true }),
        }),
      );
      const nextConfig = { ...DEFAULT_CONFIG, ...data.config };
      setConfig(nextConfig);
      setToken('');
      setReadableFoldersText(nextConfig.readableVaultFolders.join('\n'));
      await loadVaults({ quiet: true });
      setMessage(`已安装 Argus Bridge 到 ${data.install?.vaultName || vaultPath}。请重新加载 Obsidian 插件后测试连接。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '安装 Obsidian Bridge 插件失败。');
    } finally {
      setIsInstallingPlugin(false);
    }
  };

  const selectVault = async (vaultPath: string) => {
    if (!vaultPath) return;
    setIsSelectingVault(true);
    try {
      const data = await parseJson<{ config: ObsidianBridgeConfig }>(
        await apiFetch('/api/obsidian-bridge/select-vault', {
          method: 'POST',
          body: JSON.stringify({ vaultPath }),
        }),
      );
      const nextConfig = { ...DEFAULT_CONFIG, ...data.config };
      setConfig(nextConfig);
      setReadableFoldersText(nextConfig.readableVaultFolders.join('\n'));
      setToken('');
      setSelectedVaultPath(vaultPath);
      await loadVaults({ quiet: true });
      setMessage('已切换当前 Obsidian vault。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '切换 Obsidian vault 失败。');
    } finally {
      setIsSelectingVault(false);
    }
  };

  const enableMemory = (enabled: boolean) => {
    setConfig((previous) => ({
      ...previous,
      wikiReadbackEnabled: enabled,
      aiMemoryReadbackEnabled: enabled,
      aiMemoryProjectScopeEnabled: true,
      readableVaultFolders: enabled
        ? ['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory']
        : previous.readableVaultFolders,
    }));
    if (enabled) {
      setReadableFoldersText(['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory'].join('\n'));
    }
  };

  const enableCodeGraph = (enabled: boolean) => {
    setConfig((previous) => ({
      ...previous,
      codegraphEnabled: enabled,
      codegraphBackgroundSyncEnabled: enabled ? true : previous.codegraphBackgroundSyncEnabled,
      codegraphWriteObsidianSummaries: enabled ? true : previous.codegraphWriteObsidianSummaries,
    }));
  };

  const queueCodeGraphSync = async () => {
    if (!hasActiveProject) {
      setMessage('请先选择项目，再立即重跑 CodeGraph 同步。');
      return;
    }
    setIsSyncingCodeGraph(true);
    try {
      await save({ quiet: true });
      await parseJson(
        await apiFetch('/api/codegraph/sync/background', {
          method: 'POST',
          body: JSON.stringify({
            projectName: activeProjectName,
            projectRoot: activeProjectRoot,
            exportLevel: config.codegraphExportLevel,
            maxEmbeddedSymbols: config.codegraphMaxEmbeddedSymbols,
          }),
        }),
      );
      setMessage('CodeGraph 立即重跑同步已排队。对话期间会继续使用最近一次成功状态。');
      await loadCodeGraphStatus({ quiet: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '排队 CodeGraph 重跑同步失败。');
    } finally {
      setIsSyncingCodeGraph(false);
    }
  };

  const exportCodeGraph = async () => {
    if (!hasActiveProject) {
      setMessage('请先选择项目，再立即重新导出 CodeGraph。');
      return;
    }
    setIsExportingCodeGraph(true);
    try {
      await save({ quiet: true });
      const data = await parseJson<{ documents?: number; written?: number; deprecated?: number; staleCandidates?: number }>(
        await apiFetch('/api/codegraph/export-obsidian', {
          method: 'POST',
          body: JSON.stringify({
            projectName: activeProjectName,
            projectRoot: activeProjectRoot,
          }),
        }),
      );
      setMessage(`CodeGraph 已重新导出到 Obsidian：${data.written ?? data.documents ?? 0} 篇笔记，${data.deprecated ?? 0} 篇已废弃，${data.staleCandidates ?? 0} 个疑似过期。`);
      await loadCodeGraphStatus({ quiet: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重新导出 CodeGraph 到 Obsidian 失败。');
    } finally {
      setIsExportingCodeGraph(false);
    }
  };

  const handleSelectCodeGraphStorage = async () => {
    const selectDirectory = window.argusDesktop?.selectDirectory || window.argusDesktop?.selectProjectRoot;
    if (!selectDirectory) {
      setMessage('当前环境不支持原生目录选择，请直接输入 CodeGraph 集中存储目录。');
      return;
    }
    try {
      const result = await selectDirectory({
        title: '选择 CodeGraph 集中存储目录',
        buttonLabel: '使用此目录',
        defaultPath: config.codegraphStorageRoot || codeGraphStatus?.codegraphStorageRoot || undefined,
      });
      if (result.error) {
        throw new Error(result.error);
      }
      if (!result.canceled && result.path) {
        setConfig((previous) => ({
          ...previous,
          codegraphStorageRoot: result.path || '',
        }));
        setMessage('已选择 CodeGraph 集中存储目录，保存后生效。');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '打开原生目录选择器失败。');
    }
  };

  const runHealthAction = async (actionId: string) => {
    if (actionId === 'reconnect' || actionId === 'run-test-query') {
      await testConnection();
      await loadHealth({ quiet: true });
      return;
    }
    if (actionId === 'reinstall-plugin') {
      await installPluginToVault();
      return;
    }
    if (actionId === 'select-vault') {
      await selectVault(selectedVaultPath);
      return;
    }
    if (actionId === 'refresh-folders') {
      await loadVaults({ quiet: true });
      await loadHealth({ quiet: true });
      setMessage('Obsidian Bridge folders refreshed.');
      return;
    }
    if (actionId === 'run-test-write') {
      await save({ quiet: true });
      await loadHealth({ quiet: true });
      setMessage('Obsidian Bridge test write completed through safe settings save.');
    }
  };

  const renderHealthSection = () => {
    const states = health?.states?.length ? health.states : ['ok'];
    const actions = health?.repairActions?.length ? health.repairActions : OBSIDIAN_HEALTH_DEFAULT_ACTIONS;
    const contract = health?.contract;

    return (
      <section className="rounded-lg border border-border/70 bg-background/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <PlugZap className="h-4 w-4" />
              <span>Obsidian Health</span>
            </div>
            <h4 className="mt-1 text-base font-semibold text-foreground">
              {health?.status || 'unknown'}
            </h4>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadHealth()}>
            <RefreshCw className="h-4 w-4" />
            Refresh folders
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Bridge</div>
            <div className="mt-1 truncate text-sm font-medium text-foreground">
              {contract?.bridgeEnabled ? 'enabled' : 'disabled'}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Vault</div>
            <div className="mt-1 truncate text-sm font-medium text-foreground">
              {contract?.vaultName || (contract?.vaultSelected ? 'selected' : 'wrong vault')}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Plugin</div>
            <div className="mt-1 truncate text-sm font-medium text-foreground">
              {contract?.pluginStatus || 'not installed'}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Token</div>
            <div className="mt-1 truncate text-sm font-medium text-foreground">
              {contract?.tokenStatus || 'not paired'}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {states.map((state) => (
            <span key={state} className="rounded-md border border-border/70 bg-muted/25 px-2 py-1 text-xs text-muted-foreground">
              {OBSIDIAN_HEALTH_STATE_LABELS[state] || state}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              onClick={() => void runHealthAction(action.id)}
              disabled={action.enabled === false || isSaving || isTesting || isInstallingPlugin || isSelectingVault}
            >
              {action.label}
            </Button>
          ))}
        </div>

        <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="text-sm font-medium text-foreground">Safe issue logs</div>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {(health?.safeLogs || ['health=unavailable']).join('\n')}
          </pre>
        </div>
      </section>
    );
  };

  const renderConnectionSection = () => (
    <section className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <PlugZap className="h-4 w-4" />
            <span>连接 Obsidian / Connect Obsidian</span>
          </div>
          <h4 className="mt-1 text-base font-semibold text-foreground">Bridge 连接</h4>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            安装本地插件，选择当前 vault，并确认 Argus 可以读写 Obsidian。
          </p>
        </div>
        <SettingsToggle
          checked={config.enabled}
          onChange={(enabled) => setConfig((previous) => ({ ...previous, enabled }))}
          ariaLabel="启用 Obsidian Bridge"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <select
          className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={selectedVaultPath}
          onChange={(event) => setSelectedVaultPath(event.target.value)}
        >
          {vaults.length === 0 ? (
            <option value="">未发现 vault</option>
          ) : vaults.map((vault) => (
            <option key={vault.path} value={vault.path}>
              {vault.name} - {vault.bridgeEndpoint || '不可达'} - {vault.pluginVersion ? `argus-bridge ${vault.pluginVersion}` : '未安装插件'}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void loadVaults()} disabled={isLoadingVaults || isSaving}>
            {isLoadingVaults ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            刷新 vault
          </Button>
          <Button type="button" variant="outline" onClick={() => void selectVault(selectedVaultPath)} disabled={isSelectingVault || !selectedVaultPath}>
            使用此 vault
          </Button>
          <Button type="button" onClick={() => void installPluginToVault()} disabled={isInstallingPlugin || !selectedVaultPath}>
            {isInstallingPlugin ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            安装插件到 vault
          </Button>
        </div>
      </div>

      {hasReachableEndpointMismatch && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          检测到可连接 vault 运行在 {reachableVault?.bridgeEndpoint}；请选择该 vault，或测试当前 endpoint。
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-sm font-medium text-foreground">
          Token
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={token}
            type="password"
            onChange={(event) => setToken(event.target.value)}
            placeholder={config.tokenConfigured ? '已配置 token' : '粘贴插件 token'}
          />
          <span className="mt-2 block text-xs font-normal text-muted-foreground">
            留空会继续使用一键安装插件生成的现有 token。
          </span>
        </label>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={() => void testConnection()} disabled={isSaving || isTesting}>
            {isTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            测试连接
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">Vault</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{config.vaultName || '未连接'}</div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">插件版本</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{config.pluginVersion || '未知'}</div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">最后连接</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{formatDateTime(config.lastConnection)}</div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">最近错误</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{config.lastError || '无'}</div>
        </div>
      </div>
    </section>
  );

  const renderMemorySection = () => (
    <section className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Brain className="h-4 w-4" />
            <span>Obsidian Memory</span>
          </div>
          <h4 className="mt-1 text-base font-semibold text-foreground">全局项目记忆读写</h4>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            全局开关，不跟随当前项目；从 Argus/Wiki 和 Argus/AIMemory 读回精选上下文。
          </p>
        </div>
        <SettingsToggle
          checked={memoryEnabled}
          onChange={enableMemory}
          ariaLabel="启用 Obsidian Memory"
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">Readback</div>
          <div className="mt-1 text-sm font-medium text-foreground">{memoryEnabled ? '已启用' : '未启用'}</div>
          <p className="mt-1 text-xs text-muted-foreground">后续对话会注入相关 Wiki/AIMemory 笔记。</p>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">写入路径</div>
          <div className="mt-1 text-sm font-medium text-foreground">Argus/AIMemory</div>
          <p className="mt-1 text-xs text-muted-foreground">自动记忆捕获继续兼容已有笔记。</p>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">读取目录</div>
          <div className="mt-1 text-sm font-medium text-foreground">Argus/Wiki, Argus/AIMemory</div>
          <p className="mt-1 text-xs text-muted-foreground">索引继续保存在 Argus/_Indexes。</p>
        </div>
      </div>
    </section>
  );

  const renderCodeGraphSection = () => (
    <section className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            <span>CodeGraph</span>
          </div>
          <h4 className="mt-1 text-base font-semibold text-foreground">自动同步并接入 Claude Code</h4>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            全局开关，不跟随当前项目；开启后自动同步并接入 Claude Code，当前项目只用于显示状态和写入 Argus/Wiki/&lt;project&gt;/CodeGraph/Index.md。
          </p>
        </div>
        <SettingsToggle
          checked={codeGraphEnabled}
          onChange={enableCodeGraph}
          ariaLabel="启用 CodeGraph"
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">项目</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{projectLabel(activeProject) || '未选择项目'}</div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">
            {isLoadingCodeGraph ? '加载中...' : codeGraphStatus?.state || 'Idle'}
          </div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">MCP</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">
            {codeGraphStatus?.mcpConfigured ? '已配置' : codeGraphStatus?.mcpError ? '配置失败' : '待自动配置'}
          </div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">最近同步</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">
            {codeGraphStatus?.lastSync
              ? `${codeGraphStatus.lastSync.filesAdded || 0}+ / ${codeGraphStatus.lastSync.filesModified || 0}~ / ${codeGraphStatus.lastSync.filesRemoved || 0}-`
              : '尚未同步'}
          </div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">最近导出</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">
            {codeGraphStatus?.lastExport?.skipped
              ? codeGraphStatus.lastExport.reason || '已跳过'
              : `${codeGraphStatus?.lastExport?.written ?? codeGraphStatus?.lastExport?.documents ?? 0} written / ${codeGraphStatus?.lastExport?.skippedUnchanged ?? 0} skipped / ${codeGraphStatus?.lastExport?.deprecated ?? 0} deprecated`}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="text-sm font-medium text-foreground">CodeGraph 集中存储目录</div>
        <p className="mt-1 text-xs text-muted-foreground">
          用户可自己配置 CodeGraph DB/索引保存位置；所有项目会集中放在这个目录下，项目目录只保留兼容 MCP 的轻量 .codegraph 链接。
        </p>
        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={config.codegraphStorageRoot}
            onChange={(event) => setConfig((previous) => ({
              ...previous,
              codegraphStorageRoot: event.target.value,
            }))}
            placeholder={codeGraphStatus?.codegraphStorageRoot || '留空使用 Argus 默认集中目录'}
            aria-label="CodeGraph 集中存储目录"
          />
          <Button type="button" variant="outline" onClick={() => void handleSelectCodeGraphStorage()}>
            <FolderOpen className="h-4 w-4" />
            选择目录
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfig((previous) => ({ ...previous, codegraphStorageRoot: '' }))}
          >
            恢复默认目录
          </Button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          当前项目实际位置：{codeGraphStatus?.codegraphStoragePath || '保存并刷新状态后显示'}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-foreground">
          Native export level
          <select
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={config.codegraphExportLevel}
            onChange={(event) => setConfig((previous) => ({
              ...previous,
              codegraphExportLevel: event.target.value === 'all' ? 'all' : 'structural',
            }))}
          >
            <option value="structural">structural - recommended</option>
            <option value="all">all - large vault warning</option>
          </select>
          <span className="mt-2 block text-xs font-normal text-muted-foreground">
            structural writes native node cards for topology/public symbols and embeds low-value internals.
          </span>
        </label>
        <label className="text-sm font-medium text-foreground">
          Embedded symbol limit
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            type="number"
            min={1}
            max={1000}
            value={config.codegraphMaxEmbeddedSymbols}
            onChange={(event) => setConfig((previous) => ({
              ...previous,
              codegraphMaxEmbeddedSymbols: Math.min(Math.max(Number.parseInt(event.target.value || '200', 10) || 200, 1), 1000),
            }))}
          />
          <span className="mt-2 block text-xs font-normal text-muted-foreground">
            Caps Local Symbols / Members per note so Obsidian and AI context stay responsive.
          </span>
        </label>
      </div>

      {codeGraphStatus?.lastError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {codeGraphStatus.lastError}
        </div>
      )}
      {codeGraphStatus?.mcpError && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          MCP 配置失败：{codeGraphStatus.mcpError}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void loadCodeGraphStatus()} disabled={isLoadingCodeGraph || !hasActiveProject}>
          {isLoadingCodeGraph ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新状态
        </Button>
        <Button type="button" variant="outline" onClick={() => void queueCodeGraphSync()} disabled={isSyncingCodeGraph || !hasActiveProject}>
          {isSyncingCodeGraph ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          立即重跑同步
        </Button>
        <Button type="button" onClick={() => void exportCodeGraph()} disabled={isExportingCodeGraph || !hasActiveProject}>
          {isExportingCodeGraph ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          立即重新导出
        </Button>
      </div>
    </section>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          <span>Obsidian 知识库</span>
        </div>
        <h3 className="mt-1 text-lg font-semibold text-foreground">Argus Bridge for Obsidian</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          只保留连接 Obsidian、启用 Memory、写入 CodeGraph 的主链路。
        </p>
      </div>

      <div className="space-y-4 border-t border-border bg-background/95 p-4">
        {renderHealthSection()}
        {renderConnectionSection()}
        {renderMemorySection()}
        {renderCodeGraphSection()}

        {message && (
          <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={() => void save()} disabled={isSaving}>
            {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存 Bridge
          </Button>
        </div>
      </div>
    </div>
  );
}
