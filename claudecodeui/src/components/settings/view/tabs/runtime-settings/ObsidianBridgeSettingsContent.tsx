import { useEffect, useRef, useState } from 'react';
import { BookOpen, Brain, FolderOpen, PlugZap, RefreshCw, Save, Search, Sparkles, UploadCloud } from 'lucide-react';

import SettingsToggle from '../../SettingsToggle';
import { Button } from '../../../../../shared/view/ui';
import { apiFetch } from '../../../../../utils/api';
import type { SettingsProject } from '../../../types/types';

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
  autoExportKnowledgeArtifactsOptIn: boolean;
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
  wikiPrimaryEnabled: boolean;
  wikiCompilerEnabled: boolean;
  wikiReadbackEnabled: boolean;
  wikiReadbackIncludeRaw: boolean;
  wikiReadbackMaxResults: number;
  wikiRawFolder: string;
  wikiFolder: string;
  wikiIndexFolder: string;
  wikiMetaFolder: string;
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

const WIKI_SUMMARY_TYPES = [
  { value: 'auto', label: '自动总结' },
  { value: 'technical-review', label: '技术评审' },
  { value: 'project-summary', label: '项目总结' },
  { value: 'reading-note', label: '阅读笔记' },
  { value: 'decision-adr', label: '决策 ADR' },
  { value: 'meeting-notes', label: '会议纪要' },
  { value: 'general-wiki', label: '通用 Wiki' },
];

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
  autoExportKnowledgeArtifacts: false,
  autoExportKnowledgeArtifactsOptIn: false,
  readableVaultFolders: ['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory'],
  fallbackToProjectKnowledge: true,
  lastConnection: '',
  lastError: '',
  pluginVersion: '',
  aiMemoryReadbackEnabled: true,
  aiMemoryMaxResults: 8,
  aiMemoryProjectScopeEnabled: true,
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
};

const parseJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

type ObsidianBridgeSettingsContentProps = {
  projects?: SettingsProject[];
  selectedProject?: SettingsProject | null;
  onOpenSmallModelSettings?: () => void;
};

type ObsidianBridgeTab = 'connection' | 'knowledge' | 'advanced';

const OBSIDIAN_BRIDGE_TABS: Array<{ id: ObsidianBridgeTab; label: string }> = [
  { id: 'connection', label: '连接' },
  { id: 'knowledge', label: '知识库' },
  { id: 'advanced', label: '高级' },
];
const OBSIDIAN_BRIDGE_SETTINGS_CHANGED_EVENT = 'argusObsidianBridgeSettingsChanged';

export default function ObsidianBridgeSettingsContent({
  projects = [],
  selectedProject = null,
  onOpenSmallModelSettings,
}: ObsidianBridgeSettingsContentProps) {
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
  const [duplicateStatus, setDuplicateStatus] = useState<DuplicateCleanupStatus | null>(null);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const [isRunningBackfill, setIsRunningBackfill] = useState(false);
  const [knowledgeUploadProjectName, setKnowledgeUploadProjectName] = useState(
    () => selectedProject?.name || projects[0]?.name || '',
  );
  const [knowledgeUploadSummaryType, setKnowledgeUploadSummaryType] = useState('auto');
  const [isUploadingKnowledgeFiles, setIsUploadingKnowledgeFiles] = useState(false);
  const [knowledgeUploadStatus, setKnowledgeUploadStatus] = useState('');
  const [wikiReadbackPreview, setWikiReadbackPreview] = useState('');
  const [selectedObsidianTab, setSelectedObsidianTab] = useState<ObsidianBridgeTab>('connection');
  const knowledgeUploadInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    setKnowledgeUploadProjectName((previous) => {
      const stillExists = previous && projects.some((project) => project.name === previous);
      if (stillExists) return previous;
      return selectedProject?.name || projects[0]?.name || '';
    });
  }, [projects, selectedProject?.name]);

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
      window.dispatchEvent(new Event(OBSIDIAN_BRIDGE_SETTINGS_CHANGED_EVENT));
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
        parseJson<{ context?: string; results?: unknown[]; sources?: Array<{ path?: string; title?: string; snippet?: string; hitReason?: string }>; reranked?: boolean; rerankModel?: string; tokenBudgetUsed?: number }>(await apiFetch('/api/obsidian-bridge/context', {
          method: 'POST',
          body: JSON.stringify(payload),
        })),
      ]);
      const searchCount = Array.isArray(searchData.results) ? searchData.results.length : 0;
      const queryCount = Array.isArray(queryData.results) ? queryData.results.length : 0;
      const contextCount = Array.isArray(contextData.results) ? contextData.results.length : 0;
      const contextSources = Array.isArray(contextData.sources) ? contextData.sources : [];
      setWikiReadbackPreview([
        contextData.reranked ? `小模型已筛选：${contextData.rerankModel || '已启用'}` : '使用规则排序结果',
        `最终注入来源：${contextSources.length || contextCount} 条`,
        contextData.tokenBudgetUsed ? `注入长度预算：${contextData.tokenBudgetUsed}` : '',
        ...contextSources.slice(0, 5).map((source, index) => [
          `${index + 1}. ${source.title || source.path || 'Wiki source'}`,
          source.path ? `Path: ${source.path}` : '',
          source.hitReason ? `命中原因：${source.hitReason}` : '',
          source.snippet ? `Snippet: ${source.snippet}` : '',
        ].filter(Boolean).join('\n')),
      ].filter(Boolean).join('\n\n'));
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

  const uploadKnowledgeFiles = async (files: FileList | null) => {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length === 0) return;
    const projectName = knowledgeUploadProjectName.trim();
    if (!projectName) {
      setMessage('请先选择要落库的项目。');
      return;
    }

    setIsUploadingKnowledgeFiles(true);
    setKnowledgeUploadStatus('');
    try {
      await save({ quiet: true });
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });
      formData.append('projectName', projectName);
      formData.append('summaryType', knowledgeUploadSummaryType);

      const data = await parseJson<{
        importBatchId?: string;
        imported?: Array<{
          wikiStatus?: string;
          wikiPath?: string;
          rawPath?: string;
          wikiCompiler?: string;
          wikiCompileChunks?: number;
          wikiCompileFallbackReason?: string;
          summaryType?: string;
          compileQualityStatus?: string;
          compileRepairAttempts?: number;
          extractionStatus?: string;
          extractionEngine?: string;
          extractionFailureReason?: string;
          pdfExtractedPages?: number;
          pdfTruncated?: boolean;
        }>;
      }>(
        await apiFetch('/api/obsidian-bridge/wiki/upload', {
          method: 'POST',
          headers: {},
          body: formData,
        }),
      );
      const imported = Array.isArray(data.imported) ? data.imported : [];
      const rawCount = imported.filter((entry) => entry.rawPath).length || imported.length;
      const wikiCount = imported.filter((entry) => entry.wikiStatus === 'compiled' || entry.wikiPath).length;
      const failedCount = imported.filter((entry) => entry.wikiStatus === 'failed').length;
      const smallModelCount = imported.filter((entry) => entry.wikiCompiler === 'small-model').length;
      const fallbackCount = imported.filter((entry) => (
        entry.wikiCompiler === 'deterministic' && Boolean(entry.wikiCompileFallbackReason)
      )).length;
      const repairedCount = imported.filter((entry) => entry.compileQualityStatus === 'repaired').length;
      const needsReviewCount = imported.filter((entry) => entry.compileQualityStatus === 'needs-review').length;
      const chunkCount = imported.reduce((total, entry) => total + (Number(entry.wikiCompileChunks) || 0), 0);
      const pdfExtractedCount = imported.filter((entry) => (
        entry.extractionEngine === 'pdfjs-dist' && entry.extractionStatus === 'extracted'
      )).length;
      const pdfFailedReasons = [...new Set(imported
        .filter((entry) => entry.extractionEngine === 'pdfjs-dist' && entry.extractionStatus === 'extract_failed')
        .map((entry) => entry.extractionFailureReason || 'extract_failed'))];
      const pdfExtractedPages = imported.reduce((total, entry) => total + (Number(entry.pdfExtractedPages) || 0), 0);
      const pdfTruncatedCount = imported.filter((entry) => entry.pdfTruncated).length;
      const qualitySummary = [
        repairedCount ? `${repairedCount} repaired` : '',
        needsReviewCount ? `${needsReviewCount} needs review` : '',
      ].filter(Boolean).join(' / ');
      setKnowledgeUploadStatus([
        qualitySummary,
        `总结类型：${knowledgeUploadSummaryType}`,
        `上传完成：${rawCount} 个文件进入 Raw，${wikiCount} 个已编译 Wiki`,
        smallModelCount ? `${smallModelCount} 个小模型编译` : '',
        fallbackCount ? `${fallbackCount} 个 fallback 编译` : '',
        chunkCount ? `共处理 ${chunkCount} 个分块` : '',
        failedCount ? `${failedCount} 个需稍后重试` : '',
      ].filter(Boolean).join('，') + '。');
      setMessage(data.importBatchId ? `导入批次：${data.importBatchId}` : '知识库上传完成。');
      const pdfStatusSuffix = [
        pdfExtractedCount ? `${pdfExtractedCount} 个 PDF 已抽取文本（${pdfExtractedPages} 页）` : '',
        pdfTruncatedCount ? `${pdfTruncatedCount} 个 PDF 文本过长已截断` : '',
        pdfFailedReasons.length ? `PDF 抽取失败：${pdfFailedReasons.join(' / ')}` : '',
      ].filter(Boolean).join('；');
      if (pdfStatusSuffix) {
        setKnowledgeUploadStatus((previous) => [previous, pdfStatusSuffix].filter(Boolean).join(' '));
      }
      window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '上传到知识库失败。';
      setKnowledgeUploadStatus(nextMessage);
      setMessage(nextMessage);
    } finally {
      setIsUploadingKnowledgeFiles(false);
      if (knowledgeUploadInputRef.current) {
        knowledgeUploadInputRef.current.value = '';
      }
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

  const renderConnectionTab = () => (
    <div className="space-y-4">
      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">启用 Bridge</div>
            <p className="mt-1 text-xs text-muted-foreground">打开后，Argus 会通过本机 Obsidian 插件写入和读取 Wiki。</p>
          </div>
          <SettingsToggle
            checked={config.enabled}
            onChange={(enabled) => setConfig((previous) => ({ ...previous, enabled }))}
            ariaLabel="启用 Obsidian Bridge"
            disabled={isSaving || isTesting}
          />
        </div>
      </div>

      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <label className="text-sm font-medium text-foreground">Vault / 安装插件</label>
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
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
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
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <label className="text-sm font-medium text-foreground">当前 vault</label>
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

      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="text-sm font-medium text-foreground">
            Token / 测试连接
            <input
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={token}
              type="password"
              onChange={(event) => setToken(event.target.value)}
              placeholder={config.tokenConfigured ? '已配置 token' : '粘贴插件 token'}
            />
            <span className="mt-2 block text-xs font-normal text-muted-foreground">留空会继续使用当前 token。</span>
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={isSaving || isTesting || isTestingReadback}
          >
            {isTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            测试连接
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
        <div className="rounded-md border border-border/70 bg-muted/25 p-3">
          <div className="text-xs text-muted-foreground">最近错误</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{config.lastError || '无'}</div>
        </div>
      </div>
    </div>
  );

  const renderKnowledgeTab = () => (
    <div className="space-y-4">
      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <UploadCloud className="h-4 w-4" />
              <span>上传/保存成 Wiki</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Markdown、PDF、Office、HTML、CSV、JSON 等文件会先进入 Raw → Wiki → Index，再由 Wiki 回读注入对话。
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <select
              className="h-9 min-w-[150px] rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={knowledgeUploadSummaryType}
              onChange={(event) => setKnowledgeUploadSummaryType(event.target.value)}
              aria-label="Wiki 总结类型"
            >
              {WIKI_SUMMARY_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {projects.length > 0 ? (
              <select
                className="h-9 min-w-[180px] rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={knowledgeUploadProjectName}
                onChange={(event) => setKnowledgeUploadProjectName(event.target.value)}
                aria-label="选择知识库落库项目"
              >
                {projects.map((project) => (
                  <option key={project.name} value={project.name}>
                    {project.displayName || project.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="h-9 min-w-[180px] rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={knowledgeUploadProjectName}
                onChange={(event) => setKnowledgeUploadProjectName(event.target.value)}
                placeholder="项目名称"
                aria-label="知识库落库项目"
              />
            )}
            <input
              ref={knowledgeUploadInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".md,.markdown,.txt,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.html,.htm,.csv,.json,.jsonl"
              onChange={(event) => void uploadKnowledgeFiles(event.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => knowledgeUploadInputRef.current?.click()}
              disabled={isUploadingKnowledgeFiles || !knowledgeUploadProjectName.trim()}
            >
              {isUploadingKnowledgeFiles ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              上传现有文件
            </Button>
          </div>
        </div>
        {knowledgeUploadStatus && (
          <div className="mt-3 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            {knowledgeUploadStatus}
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Brain className="h-4 w-4" />
                <span>Wiki 回读注入</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">发送聊天消息时，从 Wiki 和索引里读取短上下文注入本轮请求。</p>
            </div>
            <SettingsToggle
              checked={config.wikiReadbackEnabled && config.aiMemoryReadbackEnabled}
              onChange={(enabled) => setConfig((previous) => ({
                ...previous,
                wikiReadbackEnabled: enabled,
                aiMemoryReadbackEnabled: enabled,
              }))}
              ariaLabel="启用 Wiki 回读注入"
            />
          </div>
        </div>

        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Sparkles className="h-4 w-4" />
                <span>小模型设置</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Wiki 总结和回读筛选复用 Agent 全局小模型配置。</p>
            </div>
            <Button type="button" variant="outline" onClick={onOpenSmallModelSettings}>
              打开小模型设置
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="space-y-4">
      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Search className="h-4 w-4" />
          <span>高级诊断</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">只有调试连接、迁移旧数据、清理重复笔记或自定义目录时才需要修改。</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-foreground">
          Endpoint
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={config.endpoint}
            onChange={(event) => setConfig((previous) => ({ ...previous, endpoint: event.target.value }))}
            placeholder="http://127.0.0.1:27177"
          />
          <span className="mt-2 block text-xs font-normal text-muted-foreground">只接受 127.0.0.1 和 localhost 地址。</span>
        </label>
        <label className="text-sm font-medium text-foreground">
          可读目录
          <textarea
            className="mt-2 min-h-24 w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={readableFoldersText}
            onChange={(event) => setReadableFoldersText(event.target.value)}
          />
        </label>
      </div>

      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="text-sm font-medium text-foreground">Raw/Wiki/Index 目录</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-muted-foreground">
            Raw 目录
            <input
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={config.wikiRawFolder}
              onChange={(event) => setConfig((previous) => ({ ...previous, wikiRawFolder: event.target.value }))}
              placeholder="Argus/Raw"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Wiki 目录
            <input
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={config.wikiFolder}
              onChange={(event) => setConfig((previous) => ({ ...previous, wikiFolder: event.target.value }))}
              placeholder="Argus/Wiki"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Index 目录
            <input
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={config.wikiIndexFolder}
              onChange={(event) => setConfig((previous) => ({ ...previous, wikiIndexFolder: event.target.value }))}
              placeholder="Argus/_Indexes"
            />
          </label>
        </div>
      </div>

      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
            search/context 测试
            <input
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={readbackQuery}
              onChange={(event) => setReadbackQuery(event.target.value)}
            />
          </label>
          <label className="w-full text-xs font-medium text-muted-foreground lg:w-36">
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
        <label className="mt-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
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
        {wikiReadbackPreview && (
          <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            {wikiReadbackPreview}
          </pre>
        )}
      </div>

      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          <div className="mt-3 truncate rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            {activeNotePreview}
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
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

        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">历史补扫</div>
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
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
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
              <div className="text-sm font-medium text-foreground">AI Memory 候选入口</div>
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
    </div>
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
          主界面只保留连接 Obsidian、上传/保存成 Wiki、Wiki 回读注入；诊断和迁移工具集中在高级页。
        </p>
      </div>

      <div className="border-y border-border bg-background/95">
        <div role="tablist" className="flex overflow-x-auto px-2 md:px-4">
          {OBSIDIAN_BRIDGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selectedObsidianTab === tab.id}
              onClick={() => setSelectedObsidianTab(tab.id)}
              className={[
                'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium touch-manipulation transition-colors duration-150',
                selectedObsidianTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {selectedObsidianTab === 'connection' && renderConnectionTab()}
        {selectedObsidianTab === 'knowledge' && renderKnowledgeTab()}
        {selectedObsidianTab === 'advanced' && renderAdvancedTab()}

        {message && (
          <div className="mt-4 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        )}

        <div className="mt-4 flex justify-end">
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
    </div>
  );
}
