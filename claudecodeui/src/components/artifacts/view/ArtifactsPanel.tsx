import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Clipboard, FileText, MessageSquarePlus, RefreshCw, Trash2, UploadCloud } from 'lucide-react';

import type { Project } from '../../../types/app';
import { apiFetch } from '../../../utils/api';
import { Badge, Button, ScrollArea } from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';

type Artifact = {
  id: string;
  kind: string;
  title: string;
  projectName: string;
  sessionId: string;
  content?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type ObsidianBridgeStatus = {
  destination?: string;
  path?: string;
  fallbackPath?: string;
  error?: string;
  errorCode?: string;
  mode?: string;
  updatedAt?: string;
};

type ArtifactsPanelProps = {
  selectedProject: Project;
  sessionId?: string | null;
};

const parseJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

const formatRoutingReason = (reason = '') => {
  const trimmed = reason.trim();
  if (!trimmed) return '';
  if (/No assistant content to route\./i.test(trimmed)) {
    return '没有可沉淀的内容。';
  }
  const matched = trimmed.match(/^Matched (.+); routed to ([\w-]+)\.$/i);
  if (matched) {
    const signals = matched[1] === 'default mode' ? '默认规则' : matched[1];
    return `命中 ${signals}，已用于 Wiki 总结。`;
  }
  return trimmed;
};

const getObsidianStatus = (artifact: Artifact | null) => {
  const metadata = artifact?.metadata || {};
  const bridge = metadata.obsidianBridge as ObsidianBridgeStatus | undefined;
  const status = typeof metadata.obsidianStatus === 'string'
    ? metadata.obsidianStatus
    : bridge?.destination === 'obsidian'
      ? 'synced'
      : bridge?.destination === 'fallback'
        ? 'fallback'
        : bridge?.destination === 'error'
          ? 'failed'
          : 'not_sent';

  if (status === 'synced') {
    return {
      label: '已保存到 Wiki',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
      detail: bridge?.path || String(metadata.wikiPath || metadata.obsidianPath || ''),
    };
  }
  if (status === 'fallback') {
    return {
      label: '已回退到 docs/knowledge',
      tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
      detail: bridge?.fallbackPath || String(metadata.obsidianFallbackPath || ''),
    };
  }
  if (status === 'failed') {
    return {
      label: '同步失败',
      tone: 'border-destructive/30 bg-destructive/10 text-destructive',
      detail: bridge?.error || String(metadata.obsidianLastError || ''),
    };
  }
  if (status === 'skipped') {
    return {
      label: '未保存',
      tone: 'border-border bg-muted/50 text-muted-foreground',
      detail: formatRoutingReason(String(metadata.routingReason || metadata.obsidianLastError || '')),
    };
  }
  if (status === 'candidate') {
    return {
      label: '待确认记忆',
      tone: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
      detail: formatRoutingReason(String(metadata.routingReason || '')),
    };
  }
  if (status === 'duplicate') {
    return {
      label: '已保存过',
      tone: 'border-border bg-muted/50 text-muted-foreground',
      detail: bridge?.path || String(metadata.wikiPath || metadata.obsidianPath || ''),
    };
  }
  return {
    label: '未保存',
    tone: 'border-border bg-muted/50 text-muted-foreground',
    detail: '',
  };
};

const getArtifactPreview = (artifact: Artifact) => (
  artifact.content || artifact.filePath || '没有可预览的内容。'
);

const WIKI_SUMMARY_TYPES = [
  { value: 'auto', label: '自动总结' },
  { value: 'technical-review', label: '技术评审' },
  { value: 'project-summary', label: '项目总结' },
  { value: 'reading-note', label: '阅读笔记' },
  { value: 'decision-adr', label: '决策 ADR' },
  { value: 'meeting-notes', label: '会议纪要' },
  { value: 'general-wiki', label: '通用 Wiki' },
];

export default function ArtifactsPanel({ selectedProject, sessionId }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [wikiUploadStatus, setWikiUploadStatus] = useState('');
  const [wikiSummaryType, setWikiSummaryType] = useState('auto');
  const wikiUploadInputRef = useRef<HTMLInputElement>(null);

  const activeArtifact = useMemo(
    () => selectedArtifact || artifacts.find((artifact) => artifact.id === selectedId) || artifacts[0] || null,
    [artifacts, selectedArtifact, selectedId],
  );

  const load = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
      const params = new URLSearchParams({ projectName: selectedProject.name });
      if (sessionId) params.set('sessionId', sessionId);
      const data = await parseJson<{ artifacts: Artifact[] }>(await apiFetch(`/api/artifacts?${params.toString()}`));
      const nextArtifacts = data.artifacts || [];
      setArtifacts(nextArtifacts);
      setSelectedId((previous) => (
        previous && nextArtifacts.some((artifact) => artifact.id === previous)
          ? previous
          : nextArtifacts[0]?.id || ''
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载结果失败');
    } finally {
      setBusy('');
    }
  }, [selectedProject.name, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedArtifact(null);
      return;
    }
    let cancelled = false;
    const loadArtifact = async () => {
      try {
        const data = await parseJson<{ artifact: Artifact }>(await apiFetch(`/api/artifacts/${encodeURIComponent(selectedId)}`));
        if (!cancelled) setSelectedArtifact(data.artifact);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '加载结果详情失败');
      }
    };
    void loadArtifact();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const deleteArtifact = async (artifact: Artifact) => {
    if (!window.confirm(`删除结果「${artifact.title}」？`)) {
      return;
    }
    setBusy(artifact.id);
    try {
      await parseJson(await apiFetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`, { method: 'DELETE' }));
      window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
      setSelectedArtifact(null);
      setSelectedId('');
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除结果失败');
    } finally {
      setBusy('');
    }
  };

  const attachArtifactToChat = async (artifact: Artifact) => {
    if (!sessionId) {
      setError('请先打开或创建一个对话，再把结果放入对话。');
      return;
    }
    try {
      const data = await parseJson<{ context: string }>(await apiFetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/attach-to-session`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          projectName: selectedProject.name,
        }),
      }));
      window.dispatchEvent(new CustomEvent('argus-attach-context', {
        detail: { source: 'results', artifactId: artifact.id, text: data.context },
      }));
      window.dispatchEvent(new CustomEvent('argus-append-chat-input', {
        detail: { text: data.context },
      }));
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : '放入对话失败');
    }
  };

  const copySummary = async (artifact: Artifact) => {
    const summary = [
      `Result: ${artifact.title}`,
      `Kind: ${artifact.kind}`,
      getArtifactPreview(artifact),
    ].filter(Boolean).join('\n');
    await navigator.clipboard?.writeText(summary);
  };

  const sendArtifactToObsidian = async (artifact: Artifact) => {
    setBusy(`obsidian:${artifact.id}`);
    setError('');
    try {
      const data = await parseJson<{ artifact: Artifact; obsidianBridge: ObsidianBridgeStatus }>(
        await apiFetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/send-to-obsidian`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'auto', summaryType: wikiSummaryType }),
        }),
      );
      setSelectedArtifact(data.artifact);
      setArtifacts((previous) => previous.map((entry) => (
        entry.id === data.artifact.id ? data.artifact : entry
      )));
      if (data.obsidianBridge?.destination === 'fallback') {
        setError(`Obsidian 不可达，已回退保存到 ${data.obsidianBridge.fallbackPath}。`);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '保存到 Wiki 失败');
    } finally {
      setBusy('');
    }
  };

  const uploadFilesToWiki = async (files: FileList | null) => {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length === 0) return;
    setBusy('wiki-upload');
    setError('');
    setWikiUploadStatus('');
    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => formData.append('files', file));
      formData.append('projectName', selectedProject.name);
      formData.append('summaryType', wikiSummaryType);
      if (sessionId) formData.append('sessionId', sessionId);
      const data = await parseJson<{
        imported?: Array<{
          wikiStatus?: string;
          wikiPath?: string;
          rawPath?: string;
          wikiCompiler?: string;
          wikiCompileChunks?: number;
          wikiCompileFallbackReason?: string;
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
      const compiled = imported.filter((entry) => entry.wikiStatus === 'compiled').length;
      const smallModelCount = imported.filter((entry) => entry.wikiCompiler === 'small-model').length;
      const fallbackCount = imported.filter((entry) => (
        entry.wikiCompiler === 'deterministic' && Boolean(entry.wikiCompileFallbackReason)
      )).length;
      const chunkCount = imported.reduce((total, entry) => total + (Number(entry.wikiCompileChunks) || 0), 0);
      const pdfExtractedCount = imported.filter((entry) => (
        entry.extractionEngine === 'pdfjs-dist' && entry.extractionStatus === 'extracted'
      )).length;
      const pdfFailedReasons = [...new Set(imported
        .filter((entry) => entry.extractionEngine === 'pdfjs-dist' && entry.extractionStatus === 'extract_failed')
        .map((entry) => entry.extractionFailureReason || 'extract_failed'))];
      const pdfExtractedPages = imported.reduce((total, entry) => total + (Number(entry.pdfExtractedPages) || 0), 0);
      const pdfTruncatedCount = imported.filter((entry) => entry.pdfTruncated).length;
      setWikiUploadStatus([
        `上传完成：${imported.length} 个文件进入 Raw，${compiled} 个已编译 Wiki`,
        smallModelCount ? `${smallModelCount} 个小模型总结` : '',
        fallbackCount ? `${fallbackCount} 个 fallback 总结` : '',
        chunkCount ? `共处理 ${chunkCount} 个分块` : '',
      ].filter(Boolean).join('，') + '。');
      const pdfStatusSuffix = [
        pdfExtractedCount ? `${pdfExtractedCount} 个 PDF 已抽取文本（${pdfExtractedPages} 页）` : '',
        pdfTruncatedCount ? `${pdfTruncatedCount} 个 PDF 文本过长已截断` : '',
        pdfFailedReasons.length ? `PDF 抽取失败：${pdfFailedReasons.join(' / ')}` : '',
      ].filter(Boolean).join('；');
      if (pdfStatusSuffix) {
        setWikiUploadStatus((previous) => [previous, pdfStatusSuffix].filter(Boolean).join(' '));
      }
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传文件到 Wiki 失败');
    } finally {
      setBusy('');
      if (wikiUploadInputRef.current) wikiUploadInputRef.current.value = '';
    }
  };

  const obsidianStatusView = useMemo(() => getObsidianStatus(activeArtifact), [activeArtifact]);
  const routingReason = typeof activeArtifact?.metadata?.routingReason === 'string'
    ? activeArtifact.metadata.routingReason
    : '';
  const routingReasonText = formatRoutingReason(routingReason);
  const artifactCountText = `${artifacts.length} 个结果`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-[72px] flex-col gap-3 border-b border-border/70 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>Results</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="truncate">{selectedProject.name}</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">项目结果</h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={wikiSummaryType}
            onChange={(event) => setWikiSummaryType(event.target.value)}
            aria-label="Wiki 总结类型"
          >
            {WIKI_SUMMARY_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={load} disabled={busy === 'load'}>
            <RefreshCw className={cn('h-4 w-4', busy === 'load' && 'animate-spin')} />
            刷新
          </Button>
          <input
            ref={wikiUploadInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".md,.markdown,.txt,.log,.pdf,.html,.htm,.csv,.json,.jsonl,.yaml,.yml,.xml"
            onChange={(event) => void uploadFilesToWiki(event.target.files)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => wikiUploadInputRef.current?.click()}
            disabled={busy === 'wiki-upload'}
          >
            <UploadCloud className={cn('h-4 w-4', busy === 'wiki-upload' && 'animate-pulse')} />
            上传文件到 Wiki
          </Button>
        </div>
      </div>

      {error && <div className="border-b border-border/70 px-5 py-2 text-sm text-destructive">{error}</div>}
      {wikiUploadStatus && <div className="border-b border-border/70 px-5 py-2 text-sm text-emerald-700 dark:text-emerald-300">{wikiUploadStatus}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-r border-border/70 bg-muted/10">
          <div className="flex h-12 items-center justify-between border-b border-border/70 px-4">
            <div className="text-sm font-medium text-foreground">当前结果</div>
            <Badge variant="outline">{artifactCountText}</Badge>
          </div>
          <ScrollArea className="h-[calc(100%-3rem)]">
            <div className="space-y-2 p-3">
              {artifacts.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  还没有结果。运行 review、总结或上传文件后，这里会显示可保存到 Wiki 的内容。
                </div>
              ) : artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => setSelectedId(artifact.id)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left transition',
                    activeArtifact?.id === artifact.id ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-background hover:bg-accent/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{artifact.title}</span>
                    <Badge variant="outline" className="shrink-0">{artifact.kind}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{new Date(artifact.createdAt).toLocaleString()}</div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <section className="flex min-h-0 flex-col">
          {!activeArtifact ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              选择一个结果查看详情。
            </div>
          ) : (
            <>
              <div className="border-b border-border/70 px-4 py-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>结果详情</span>
                      <span>·</span>
                      <span>{activeArtifact.kind}</span>
                    </div>
                    <h3 className="mt-1 truncate text-base font-semibold text-foreground">{activeArtifact.title}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', obsidianStatusView.tone)}>
                        {obsidianStatusView.label}
                      </span>
                      {obsidianStatusView.detail && (
                        <span className="max-w-full truncate text-xs text-muted-foreground" title={obsidianStatusView.detail}>
                          {obsidianStatusView.detail}
                        </span>
                      )}
                    </div>
                    {routingReasonText && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground" title={routingReasonText}>
                        说明：{routingReasonText}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => sendArtifactToObsidian(activeArtifact)}
                      disabled={busy === `obsidian:${activeArtifact.id}`}
                    >
                      <BookOpen className={cn('h-4 w-4', busy === `obsidian:${activeArtifact.id}` && 'animate-pulse')} />
                      保存到 Wiki
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => copySummary(activeArtifact)}>
                      <Clipboard className="h-4 w-4" />
                      复制内容
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => attachArtifactToChat(activeArtifact)} disabled={!sessionId}>
                      <MessageSquarePlus className="h-4 w-4" />
                      放入对话
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteArtifact(activeArtifact)} disabled={busy === activeArtifact.id}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                      删除结果
                    </Button>
                  </div>
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1 bg-muted/20">
                {activeArtifact.content?.startsWith('data:image/') ? (
                  <img src={activeArtifact.content} alt={activeArtifact.title} className="m-4 max-w-[calc(100%-2rem)] rounded-md border border-border/70 bg-background" />
                ) : (
                  <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground">
                    {getArtifactPreview(activeArtifact)}
                  </pre>
                )}
              </ScrollArea>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
