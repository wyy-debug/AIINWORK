import { useEffect, useState } from 'react';
import { BookOpen, Brain, FolderOpen, PlugZap, RefreshCw, Save, Search, Sparkles } from 'lucide-react';

import SettingsToggle from '../../SettingsToggle';
import { Button } from '../../../../../shared/view/ui';
import { apiFetch } from '../../../../../utils/api';

type ObsidianBridgeMode = 'project-knowledge' | 'second-brain' | 'ai-memory';

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
  defaultMode: ObsidianBridgeMode;
  timeoutMs: number;
  tokenConfigured: boolean;
  autoExportKnowledgeArtifacts: boolean;
  readableVaultFolders: string[];
  fallbackToProjectKnowledge: boolean;
  lastConnection: string;
  lastError: string;
  pluginVersion: string;
  aiMemoryReadbackEnabled: boolean;
  aiMemoryMaxResults: number;
  aiMemoryProjectScopeEnabled: boolean;
  activeNoteReadbackEnabled: boolean;
  dailyNoteFolder: string;
  dailyNoteHeading: string;
  mcpEnabled: boolean;
  routingRules?: Record<string, unknown>;
};

type ObsidianVault = {
  name: string;
  path: string;
  open: boolean;
  hasObsidianConfig: boolean;
  pluginInstalled: boolean;
  pluginVersion: string;
};

type MemoryCandidate = {
  id: string;
  kind: string;
  text: string;
  confidence: number;
  stableKey: string;
  status: string;
};

type RoutingPreview = {
  mode?: ObsidianBridgeMode;
  routingMode?: ObsidianBridgeMode;
  routingReason?: string;
  routingSignals?: string[];
  routingConfidence?: number;
  confidence?: number;
  wouldWrite?: boolean;
  memoryAction?: string;
};

type DuplicateCleanupStatus = {
  duplicateGroups?: unknown[];
  archived?: Array<{ from?: string; to?: string }>;
};

type BackfillStatus = {
  running?: boolean;
  total?: number;
  processed?: number;
  captured?: number;
  skipped?: number;
  errors?: unknown[];
};

const DEFAULT_CONFIG: ObsidianBridgeConfig = {
  enabled: false,
  activeVaultId: 'default',
  vaults: [],
  endpoint: 'http://127.0.0.1:27177',
  vaultName: '',
  defaultMode: 'project-knowledge',
  timeoutMs: 5000,
  tokenConfigured: false,
  autoExportKnowledgeArtifacts: true,
  readableVaultFolders: ['Argus/Projects', 'Argus/AIMemory', 'Argus/SecondBrain'],
  fallbackToProjectKnowledge: true,
  lastConnection: '',
  lastError: '',
  pluginVersion: '',
  aiMemoryReadbackEnabled: false,
  aiMemoryMaxResults: 5,
  aiMemoryProjectScopeEnabled: true,
  activeNoteReadbackEnabled: false,
  dailyNoteFolder: 'Daily',
  dailyNoteHeading: 'Argus',
  mcpEnabled: false,
};

const MODES: Array<{ value: ObsidianBridgeMode; label: string; description: string }> = [
  {
    value: 'project-knowledge',
    label: '项目知识库',
    description: '计划、总结、会话记录和决策沉淀。',
  },
  {
    value: 'second-brain',
    label: '第二大脑',
    description: '日记、阅读、想法、人物和长期主题。',
  },
  {
    value: 'ai-memory',
    label: 'AI 记忆',
    description: '偏好、长期事实、决策和回忆索引。',
  },
];

const getModeLabel = (mode?: string) => MODES.find((entry) => entry.value === mode)?.label || mode || '未选择';

const parseJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

export default function ObsidianBridgeSettingsContent() {
  const [config, setConfig] = useState<ObsidianBridgeConfig>(DEFAULT_CONFIG);
  const [token, setToken] = useState('');
  const [readableFoldersText, setReadableFoldersText] = useState(DEFAULT_CONFIG.readableVaultFolders.join('\n'));
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingReadback, setIsTestingReadback] = useState(false);
  const [isLoadingVaults, setIsLoadingVaults] = useState(false);
  const [isInstallingPlugin, setIsInstallingPlugin] = useState(false);
  const [readbackQuery, setReadbackQuery] = useState('项目记忆');
  const [vaults, setVaults] = useState<ObsidianVault[]>([]);
  const [selectedVaultPath, setSelectedVaultPath] = useState('');
  const [activeNotePreview, setActiveNotePreview] = useState('');
  const [mcpInstallText, setMcpInstallText] = useState('');
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [routingPreviewText, setRoutingPreviewText] = useState('请总结这篇阅读笔记，保留长期想法和用户偏好。');
  const [routingPreview, setRoutingPreview] = useState<RoutingPreview | null>(null);
  const [isTestingRouting, setIsTestingRouting] = useState(false);
  const [duplicateStatus, setDuplicateStatus] = useState<DuplicateCleanupStatus | null>(null);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const [isRunningBackfill, setIsRunningBackfill] = useState(false);

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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const settingsPromise = apiFetch('/api/settings/obsidian-bridge')
          .then((response) => parseJson<{ config: ObsidianBridgeConfig }>(response));
        const vaultsPromise = apiFetch('/api/obsidian-bridge/vaults')
          .then((response) => parseJson<{ vaults?: ObsidianVault[] }>(response))
          .catch(() => ({ vaults: [] }));
        const [data, vaultData] = await Promise.all([
          settingsPromise,
          vaultsPromise,
        ]);
        if (!cancelled) {
          const nextConfig = { ...DEFAULT_CONFIG, ...data.config };
          const nextVaults = Array.isArray(vaultData.vaults) ? vaultData.vaults : [];
          setConfig(nextConfig);
          setVaults(nextVaults);
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

  const save = async ({ quiet = false } = {}) => {
    setIsSaving(true);
    try {
      const payload = {
        ...config,
        vaults: config.vaults.length > 0
          ? config.vaults.map((vault) => (
            vault.vaultId === config.activeVaultId
              ? {
                ...vault,
                endpoint: config.endpoint,
                readableFolders: readableFoldersText
                  .split(/\r?\n/)
                  .map((folder) => folder.trim())
                  .filter(Boolean),
                ...(token.trim() ? { token: token.trim() } : {}),
              }
              : vault
          ))
          : config.vaults,
        readableVaultFolders: readableFoldersText
          .split(/\r?\n/)
          .map((folder) => folder.trim())
          .filter(Boolean),
        ...(token.trim() ? { token: token.trim() } : {}),
      };
      const data = await parseJson<{ config: ObsidianBridgeConfig }>(
        await apiFetch('/api/settings/obsidian-bridge', {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      );
      const nextConfig = { ...DEFAULT_CONFIG, ...data.config };
      setConfig(nextConfig);
      setReadableFoldersText(nextConfig.readableVaultFolders.join('\n'));
      setToken('');
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
      const data = await parseJson<{ vaultName?: string; plugin?: string; pluginVersion?: string }>(
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

  const testSearchAndContext = async () => {
    setIsTestingReadback(true);
    try {
      await save({ quiet: true });
      const payload = {
        query: readbackQuery || '项目记忆',
        folders: config.readableVaultFolders,
        limit: config.aiMemoryMaxResults,
      };
      const [searchData, queryData, contextData] = await Promise.all([
        parseJson<{ results?: unknown[] }>(await apiFetch('/api/obsidian-bridge/search', {
          method: 'POST',
          body: JSON.stringify(payload),
        })),
        parseJson<{ results?: unknown[] }>(await apiFetch('/api/obsidian-bridge/query', {
          method: 'POST',
          body: JSON.stringify({ ...payload, sourceTypes: ['markdown', 'canvas', 'excalidraw'] }),
        })),
        parseJson<{ context?: string; results?: unknown[] }>(await apiFetch('/api/obsidian-bridge/context', {
          method: 'POST',
          body: JSON.stringify(payload),
        })),
      ]);
      const searchCount = Array.isArray(searchData.results) ? searchData.results.length : 0;
      const queryCount = Array.isArray(queryData.results) ? queryData.results.length : 0;
      const contextCount = Array.isArray(contextData.results) ? contextData.results.length : 0;
      setMessage(`搜索返回 ${searchCount} 篇笔记；结构化查询返回 ${queryCount} 个来源；上下文返回 ${contextCount} 篇笔记。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Obsidian 搜索/上下文测试失败。');
    } finally {
      setIsTestingReadback(false);
    }
  };

  const testActiveNote = async () => {
    setIsTestingReadback(true);
    try {
      await save({ quiet: true });
      const data = await parseJson<{ note?: { path?: string; title?: string; selection?: string } }>(
        await apiFetch('/api/obsidian-bridge/active', {
          method: 'POST',
          body: JSON.stringify({ includeContent: false, includeSelection: true }),
        }),
      );
      const note = data.note;
      setActiveNotePreview(note?.path ? `${note.title || '未命名'} -> ${note.path}${note.selection ? '（含选中文本）' : ''}` : '无当前笔记。');
      setMessage(note?.path ? '已通过 Obsidian Bridge 读取当前笔记。' : 'Obsidian 没有返回当前笔记。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '测试当前笔记失败。');
    } finally {
      setIsTestingReadback(false);
    }
  };

  const testRouting = async () => {
    setIsTestingRouting(true);
    try {
      await save({ quiet: true });
      const data = await parseJson<RoutingPreview>(
        await apiFetch('/api/obsidian-bridge/routing/preview', {
          method: 'POST',
          body: JSON.stringify({
            content: routingPreviewText,
            defaultMode: config.defaultMode,
          }),
        }),
      );
      setRoutingPreview(data);
      const mode = data.routingMode || data.mode || config.defaultMode;
      const confidence = data.routingConfidence ?? data.confidence ?? 0;
      setMessage(`自动路由：${getModeLabel(mode)}（${Math.round(confidence * 100)}%）。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Obsidian 自动路由测试失败。');
    } finally {
      setIsTestingRouting(false);
    }
  };

  const scanDuplicates = async () => {
    setIsCleaningDuplicates(true);
    try {
      await save({ quiet: true });
      const data = await parseJson<DuplicateCleanupStatus>(
        await apiFetch('/api/obsidian-bridge/duplicates/scan', {
          method: 'POST',
          body: JSON.stringify({ keep: 'latest' }),
        }),
      );
      setDuplicateStatus(data);
      const groups = Array.isArray(data.duplicateGroups) ? data.duplicateGroups.length : 0;
      setMessage(`重复扫描发现 ${groups} 组。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '扫描 Obsidian 重复笔记失败。');
    } finally {
      setIsCleaningDuplicates(false);
    }
  };

  const archiveDuplicates = async () => {
    setIsCleaningDuplicates(true);
    try {
      await save({ quiet: true });
      const data = await parseJson<DuplicateCleanupStatus>(
        await apiFetch('/api/obsidian-bridge/duplicates/archive', {
          method: 'POST',
          body: JSON.stringify({ keep: 'latest' }),
        }),
      );
      setDuplicateStatus(data);
      const archived = Array.isArray(data.archived) ? data.archived.length : 0;
      setMessage(`已归档 ${archived} 篇重复笔记到 _duplicates。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '归档 Obsidian 重复笔记失败。');
    } finally {
      setIsCleaningDuplicates(false);
    }
  };

  const loadBackfillStatus = async () => {
    try {
      const data = await parseJson<BackfillStatus>(
        await apiFetch('/api/obsidian-bridge/auto-capture/status'),
      );
      setBackfillStatus(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取自动补扫状态失败。');
    }
  };

  const runBackfill = async () => {
    setIsRunningBackfill(true);
    try {
      await save({ quiet: true });
      const data = await parseJson<BackfillStatus>(
        await apiFetch('/api/obsidian-bridge/auto-capture/backfill', { method: 'POST' }),
      );
      setBackfillStatus(data);
      setMessage('历史 assistant 回复自动补扫已开始或已完成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '运行自动补扫失败。');
    } finally {
      setIsRunningBackfill(false);
    }
  };

  const installMcp = async () => {
    try {
      const data = await parseJson<{ command?: string; env?: Record<string, string> }>(
        await apiFetch('/api/obsidian-bridge/mcp/install', { method: 'POST' }),
      );
      setMcpInstallText(`${data.command || 'node scripts/obsidian-bridge-mcp.mjs'}\n${JSON.stringify(data.env || {}, null, 2)}`);
      setConfig((previous) => ({ ...previous, mcpEnabled: true }));
      setMessage('MCP 安装命令已生成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成 MCP 安装命令失败。');
    }
  };

  const loadMemoryCandidates = async () => {
    try {
      const data = await parseJson<{ candidates?: MemoryCandidate[] }>(
        await apiFetch('/api/obsidian-bridge/memory/candidates'),
      );
      setMemoryCandidates(Array.isArray(data.candidates) ? data.candidates : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载 AI 记忆候选失败。');
    }
  };

  const commitMemoryCandidate = async (candidateId: string) => {
    try {
      const data = await parseJson<{ committed?: MemoryCandidate[] }>(
        await apiFetch('/api/obsidian-bridge/memory/commit', {
          method: 'POST',
          body: JSON.stringify({ candidateIds: [candidateId] }),
        }),
      );
      setMemoryCandidates((previous) => previous.map((candidate) => (
        candidate.id === candidateId
          ? { ...candidate, status: data.committed?.[0]?.status || 'accepted' }
          : candidate
      )));
      setMessage('AI 记忆候选已写入 Obsidian。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '写入 AI 记忆候选失败。');
    }
  };

  const selectedMode = MODES.find((mode) => mode.value === config.defaultMode) || MODES[0];

  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            <span>Obsidian 知识库</span>
          </div>
          <h3 className="mt-1 text-lg font-semibold text-foreground">Argus Bridge for Obsidian</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            将自动沉淀的知识文档写入本机 Obsidian 插件；不可达时可回退到项目文档。
          </p>
        </div>
        <SettingsToggle
          checked={config.enabled}
          onChange={(enabled) => setConfig((previous) => ({ ...previous, enabled }))}
          ariaLabel="启用 Obsidian Bridge"
          disabled={isSaving || isTesting}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-md border border-border/70 bg-muted/20 p-3 lg:col-span-2">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="min-w-0 flex-1">
              <label className="text-sm font-medium text-foreground">Obsidian vault</label>
              {vaults.length > 0 && (
                <select
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={selectedVaultPath}
                  onChange={(event) => setSelectedVaultPath(event.target.value)}
                >
                  {vaults.map((vault) => (
                    <option key={vault.path} value={vault.path}>
                      {vault.name}
                      {vault.open ? '（已打开）' : ''}
                      {vault.pluginInstalled ? ` - argus-bridge ${vault.pluginVersion || '已安装'}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedVaultPath}
                onChange={(event) => setSelectedVaultPath(event.target.value)}
                placeholder="C:\Users\you\Documents\ObsidianVault"
              />
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:pb-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadVaults()}
                disabled={isLoadingVaults || isInstallingPlugin}
              >
                {isLoadingVaults ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                刷新 vault
              </Button>
              <Button
                type="button"
                onClick={installPluginToVault}
                disabled={isInstallingPlugin || !selectedVaultPath.trim()}
              >
                {isInstallingPlugin ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                安装插件到 vault
              </Button>
            </div>
          </div>
        </div>

        {config.vaults.length > 0 && (
          <div className="rounded-md border border-border/70 bg-muted/20 p-3 lg:col-span-2">
            <label className="text-sm font-medium text-foreground">当前桥接 vault</label>
            <select
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={config.activeVaultId}
              onChange={(event) => {
                const vault = config.vaults.find((entry) => entry.vaultId === event.target.value);
                setConfig((previous) => ({
                  ...previous,
                  activeVaultId: event.target.value,
                  endpoint: vault?.endpoint || previous.endpoint,
                  vaultName: vault?.name || previous.vaultName,
                  readableVaultFolders: vault?.readableFolders || previous.readableVaultFolders,
                }));
                if (vault?.readableFolders) {
                  setReadableFoldersText(vault.readableFolders.join('\n'));
                }
              }}
            >
              {config.vaults.map((vault) => (
                <option key={vault.vaultId} value={vault.vaultId}>
                  {vault.name || vault.vaultId}
                  {vault.tokenConfigured ? ' - 已配置 token' : ' - 缺少 token'}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-foreground">插件地址</label>
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={config.endpoint}
            onChange={(event) => setConfig((previous) => ({ ...previous, endpoint: event.target.value }))}
            placeholder="http://127.0.0.1:27177"
          />
          <p className="mt-2 text-xs text-muted-foreground">只接受 127.0.0.1 和 localhost 地址。</p>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">配对 token</label>
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={token}
            type="password"
            onChange={(event) => setToken(event.target.value)}
            placeholder={config.tokenConfigured ? '已配置 token' : '粘贴插件 token'}
          />
          <p className="mt-2 text-xs text-muted-foreground">留空会继续使用当前 token。</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
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
          <div className="mt-1 truncate text-sm font-medium text-foreground">
            {config.lastConnection ? new Date(config.lastConnection).toLocaleString() : '从未连接'}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">自动导出知识结果</div>
              <p className="mt-1 text-xs text-muted-foreground">Review notes、action 总结、计划和 AI 记忆会自动导出。</p>
            </div>
            <SettingsToggle
              checked={config.autoExportKnowledgeArtifacts}
              onChange={(autoExportKnowledgeArtifacts) => setConfig((previous) => ({
                ...previous,
                autoExportKnowledgeArtifacts,
              }))}
              ariaLabel="自动导出知识结果"
            />
          </div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">不可达时回退到项目文档</div>
              <p className="mt-1 text-xs text-muted-foreground">Obsidian 不可达时，把 Markdown 写入 docs/knowledge。</p>
            </div>
            <SettingsToggle
              checked={config.fallbackToProjectKnowledge}
              onChange={(fallbackToProjectKnowledge) => setConfig((previous) => ({
                ...previous,
                fallbackToProjectKnowledge,
              }))}
              ariaLabel="不可达时回退到项目文档"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Brain className="h-4 w-4" />
              <span>AI 记忆读回</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">发送聊天消息时，Argus 会从授权的 Obsidian 目录读取一小段上下文。</p>
          </div>
          <SettingsToggle
            checked={config.aiMemoryReadbackEnabled}
            onChange={(aiMemoryReadbackEnabled) => setConfig((previous) => ({
              ...previous,
              aiMemoryReadbackEnabled,
            }))}
            ariaLabel="启用 AI 记忆读回"
          />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_160px]">
          <label className="text-xs font-medium text-muted-foreground">
            测试查询
            <input
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={readbackQuery}
              onChange={(event) => setReadbackQuery(event.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            最大结果数
            <input
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              type="number"
              min={1}
              max={20}
              value={config.aiMemoryMaxResults}
              onChange={(event) => setConfig((previous) => ({
                ...previous,
                aiMemoryMaxResults: Number.parseInt(event.target.value, 10) || DEFAULT_CONFIG.aiMemoryMaxResults,
              }))}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={config.aiMemoryProjectScopeEnabled}
              onChange={(event) => setConfig((previous) => ({
                ...previous,
                aiMemoryProjectScopeEnabled: event.target.checked,
              }))}
            />
            优先读取当前项目范围内的 AI 记忆目录。
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={testSearchAndContext}
            disabled={isSaving || isTestingReadback}
          >
            {isTestingReadback ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            测试 search/context
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-border/70 bg-background/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={config.activeNoteReadbackEnabled}
              onChange={(event) => setConfig((previous) => ({
                ...previous,
                activeNoteReadbackEnabled: event.target.checked,
              }))}
            />
            对话读回时包含当前 Obsidian 笔记或选中文本。
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={testActiveNote}
            disabled={isSaving || isTestingReadback}
          >
            测试当前笔记
          </Button>
        </div>
        {activeNotePreview && (
          <div className="mt-2 truncate rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            {activeNotePreview}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-foreground">
          Daily note 目录
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={config.dailyNoteFolder}
            onChange={(event) => setConfig((previous) => ({ ...previous, dailyNoteFolder: event.target.value }))}
            placeholder="Daily"
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Daily note 标题
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={config.dailyNoteHeading}
            onChange={(event) => setConfig((previous) => ({ ...previous, dailyNoteHeading: event.target.value }))}
            placeholder="Argus"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-border/70 bg-muted/20 p-3 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">测试自动路由</div>
              <p className="mt-1 text-xs text-muted-foreground">预览一段回复会进入哪个 Obsidian 库，并显示置信度和命中信号。</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={testRouting}
              disabled={isTestingRouting || isSaving}
            >
              {isTestingRouting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              测试自动路由
            </Button>
          </div>
          <textarea
            className="mt-3 min-h-24 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={routingPreviewText}
            onChange={(event) => setRoutingPreviewText(event.target.value)}
          />
          {routingPreview && (
            <div className="mt-3 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">
                {getModeLabel(routingPreview.routingMode || routingPreview.mode || config.defaultMode)}
                {' '}
                ({Math.round(((routingPreview.routingConfidence ?? routingPreview.confidence ?? 0) as number) * 100)}%)
              </div>
              <div className="mt-1">
                是否写入：{routingPreview.wouldWrite === false ? '否' : '是'}
                {' · '}
                AI 记忆处理：{routingPreview.memoryAction || '无'}
              </div>
              {routingPreview.routingReason && <div className="mt-1">{routingPreview.routingReason}</div>}
              {Array.isArray(routingPreview.routingSignals) && routingPreview.routingSignals.length > 0 && (
                <div className="mt-1">命中信号：{routingPreview.routingSignals.join(', ')}</div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="text-sm font-medium text-foreground">重复笔记清理</div>
          <p className="mt-1 text-xs text-muted-foreground">保留最新重复笔记，把旧副本移动到 Argus/_duplicates。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={scanDuplicates} disabled={isCleaningDuplicates || isSaving}>
              扫描重复
            </Button>
            <Button type="button" variant="outline" onClick={archiveDuplicates} disabled={isCleaningDuplicates || isSaving}>
              归档重复
            </Button>
          </div>
          {duplicateStatus && (
            <div className="mt-3 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              分组：{Array.isArray(duplicateStatus.duplicateGroups) ? duplicateStatus.duplicateGroups.length : 0}
              {' · '}
              已归档：{Array.isArray(duplicateStatus.archived) ? duplicateStatus.archived.length : 0}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">历史回复自动补扫</div>
            <p className="mt-1 text-xs text-muted-foreground">用同一套幂等捕获服务扫描旧 assistant 回复。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={loadBackfillStatus}>
              刷新状态
            </Button>
            <Button type="button" variant="outline" onClick={runBackfill} disabled={isRunningBackfill || isSaving}>
              {isRunningBackfill ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              运行补扫
            </Button>
          </div>
        </div>
        {backfillStatus && (
          <div className="mt-3 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            {backfillStatus.running ? '运行中' : '空闲'}
            {' · '}
            会话：{backfillStatus.processed || 0}/{backfillStatus.total || 0}
            {' · '}
            已捕获：{backfillStatus.captured || 0}
            {' · '}
            已跳过：{backfillStatus.skipped || 0}
            {' · '}
            错误：{Array.isArray(backfillStatus.errors) ? backfillStatus.errors.length : 0}
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium text-foreground">默认写入形态</label>
        <select
          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={config.defaultMode}
          onChange={(event) => setConfig((previous) => ({
            ...previous,
            defaultMode: event.target.value as ObsidianBridgeMode,
          }))}
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">{selectedMode.description}</p>
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium text-foreground">可读取的 vault 目录</label>
        <textarea
          className="mt-2 min-h-24 w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={readableFoldersText}
          onChange={(event) => setReadableFoldersText(event.target.value)}
        />
        <p className="mt-2 text-xs text-muted-foreground">搜索和 AI 上下文读回只会读取这些目录。</p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">MCP 入口</div>
              <p className="mt-1 text-xs text-muted-foreground">通过 Argus 暴露 Obsidian active/query/context/patch/memory 工具。</p>
            </div>
            <Button type="button" variant="outline" onClick={installMcp}>
              安装 MCP
            </Button>
          </div>
          {mcpInstallText && (
            <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-background p-2 text-xs text-muted-foreground">
              {mcpInstallText}
            </pre>
          )}
        </div>

        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">AI 记忆候选队列</div>
              <p className="mt-1 text-xs text-muted-foreground">候选内容会保持待确认，确认后才写入 AIMemory。</p>
            </div>
            <Button type="button" variant="outline" onClick={loadMemoryCandidates}>
              刷新
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {memoryCandidates.length === 0 ? (
              <div className="rounded-md border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                暂无已加载的待确认候选。
              </div>
            ) : memoryCandidates.slice(0, 5).map((candidate) => (
              <div key={candidate.id} className="rounded-md border border-border/70 bg-background/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{candidate.kind} · {candidate.status}</span>
                  {candidate.status !== 'accepted' && (
                    <Button type="button" variant="outline" onClick={() => void commitMemoryCandidate(candidate.id)}>
                      写入
                    </Button>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{candidate.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {config.lastError && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {config.lastError}
        </div>
      )}

      {message && (
        <div className="mt-4 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={testConnection}
          disabled={isSaving || isTesting || isTestingReadback}
        >
          {isTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          测试连接
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={isSaving || isTesting || isTestingReadback}
        >
          <Save className="h-4 w-4" />
          保存 Bridge
        </Button>
      </div>
    </div>
  );
}
