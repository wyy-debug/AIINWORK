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

type ObsidianBridgeMode = 'auto' | 'project-knowledge' | 'second-brain' | 'ai-memory';

type ObsidianBridgeStatus = {
  destination?: string;
  path?: string;
  fallbackPath?: string;
  error?: string;
  errorCode?: string;
  mode?: ObsidianBridgeMode;
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

const sourceForArtifact = (artifact: Artifact) => {
  const source = typeof artifact.metadata?.source === 'string' ? artifact.metadata.source : '';
  if (source) return source;
  if (artifact.kind === 'review-notes') return 'review';
  if (artifact.kind === 'action-log') return 'actions';
  if (artifact.kind === 'automation-run') return 'automation';
  if (artifact.kind.includes('browser') || artifact.kind.includes('visual')) return 'browser';
  return 'review';
};

type ArtifactSourceFilter = 'all' | 'review' | 'actions' | 'browser' | 'obsidian';

const SOURCE_FILTERS: Array<{ id: ArtifactSourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Changes' },
  { id: 'actions', label: 'Run' },
  { id: 'browser', label: 'Preview' },
  { id: 'obsidian', label: 'Obsidian Inbox' },
];

const OBSIDIAN_MODES: Array<{ value: ObsidianBridgeMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'project-knowledge', label: '项目知识库' },
  { value: 'second-brain', label: '第二大脑' },
  { value: 'ai-memory', label: 'AI 记忆' },
];

const getObsidianModeLabel = (mode?: string) => (
  OBSIDIAN_MODES.find((entry) => entry.value === mode)?.label || mode || ''
);

const formatRoutingReason = (reason = '') => {
  const trimmed = reason.trim();
  if (!trimmed) return '';
  if (/No assistant content to route\./i.test(trimmed)) {
    return '没有可写入的 assistant 内容。';
  }
  const matched = trimmed.match(/^Matched (.+); routed to ([\w-]+)\.$/i);
  if (matched) {
    const signals = matched[1] === 'default mode' ? '默认规则' : matched[1];
    return `命中 ${signals}，路由到 ${getObsidianModeLabel(matched[2])}。`;
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
      label: '已写入 Obsidian',
      tone: 'text-emerald-700 dark:text-emerald-300',
      detail: bridge?.path || String(metadata.obsidianPath || ''),
    };
  }
  if (status === 'fallback') {
    return {
      label: '已回退到 docs/knowledge',
      tone: 'text-amber-700 dark:text-amber-300',
      detail: bridge?.fallbackPath || String(metadata.obsidianFallbackPath || ''),
    };
  }
  if (status === 'failed') {
    return {
      label: '同步失败',
      tone: 'text-destructive',
      detail: bridge?.error || String(metadata.obsidianLastError || ''),
    };
  }
  if (status === 'skipped') {
    return {
      label: '已跳过',
      tone: 'text-muted-foreground',
      detail: formatRoutingReason(String(metadata.routingReason || metadata.obsidianLastError || '')),
    };
  }
  if (status === 'candidate') {
    return {
      label: '待确认记忆',
      tone: 'text-sky-700 dark:text-sky-300',
      detail: formatRoutingReason(String(metadata.routingReason || '')),
    };
  }
  if (status === 'duplicate') {
    return {
      label: '已保存过',
      tone: 'text-muted-foreground',
      detail: bridge?.path || String(metadata.obsidianPath || ''),
    };
  }
  return {
    label: '未发送',
    tone: 'text-muted-foreground',
    detail: '',
  };
};

export default function ArtifactsPanel({ selectedProject, sessionId }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [sourceFilter, setSourceFilter] = useState<ArtifactSourceFilter>('all');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [obsidianMode, setObsidianMode] = useState<ObsidianBridgeMode>('auto');
  const [wikiUploadStatus, setWikiUploadStatus] = useState('');
  const wikiUploadInputRef = useRef<HTMLInputElement>(null);

  const filteredArtifacts = useMemo(() => (
    sourceFilter === 'all'
      ? artifacts
      : artifacts.filter((artifact) => sourceForArtifact(artifact) === sourceFilter)
  ), [artifacts, sourceFilter]);

  const activeArtifact = useMemo(
    () => selectedArtifact || filteredArtifacts.find((artifact) => artifact.id === selectedId) || filteredArtifacts[0] || null,
    [filteredArtifacts, selectedArtifact, selectedId],
  );

  const load = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
      const params = new URLSearchParams({ projectName: selectedProject.name });
	      if (sessionId) params.set('sessionId', sessionId);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
	      const data = await parseJson<{ artifacts: Artifact[] }>(await apiFetch(`/api/artifacts?${params.toString()}`));
      setArtifacts(data.artifacts || []);
      if (!selectedId && data.artifacts?.[0]) {
        setSelectedId(data.artifacts[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load artifacts');
    } finally {
      setBusy('');
    }
	  }, [selectedId, selectedProject.name, sessionId, sourceFilter]);

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
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load artifact');
      }
    };
    void loadArtifact();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

	  const deleteArtifact = async (artifact: Artifact) => {
    if (!window.confirm(`Delete artifact "${artifact.title}"?`)) {
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
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete artifact');
    } finally {
      setBusy('');
    }
	  };

  const attachArtifactToChat = async (artifact: Artifact) => {
    if (!sessionId) {
      setError('Open or create a chat session before attaching artifacts.');
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
      setError(attachError instanceof Error ? attachError.message : 'Failed to attach artifact');
    }
  };

  const copySummary = async (artifact: Artifact) => {
    const summary = [
      `Result: ${artifact.title}`,
      `Kind: ${artifact.kind}`,
      artifact.content || artifact.filePath || '',
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
          body: JSON.stringify({ mode: obsidianMode }),
        }),
      );
      setSelectedArtifact(data.artifact);
      setArtifacts((previous) => previous.map((entry) => (
        entry.id === data.artifact.id ? data.artifact : entry
      )));
      if (data.obsidianBridge?.destination === 'fallback') {
        setError(`Obsidian 不可达；已回退保存到 ${data.obsidianBridge.fallbackPath}。`);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送到 Obsidian 失败');
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
      if (sessionId) formData.append('sessionId', sessionId);
      const data = await parseJson<{ imported?: Array<{ wikiStatus?: string; wikiPath?: string; rawPath?: string }> }>(
        await apiFetch('/api/obsidian-bridge/wiki/upload', {
          method: 'POST',
          headers: {},
          body: formData,
        }),
      );
      const imported = Array.isArray(data.imported) ? data.imported : [];
      const compiled = imported.filter((entry) => entry.wikiStatus === 'compiled').length;
      setWikiUploadStatus(`自主落库完成：${imported.length} 个文件进入 Raw，${compiled} 个已编译 Wiki。`);
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传到知识库失败');
    } finally {
      setBusy('');
      if (wikiUploadInputRef.current) wikiUploadInputRef.current.value = '';
    }
  };

  const obsidianStatus = activeArtifact?.metadata?.obsidianBridge as ObsidianBridgeStatus | undefined;
  const obsidianStatusView = useMemo(() => getObsidianStatus(activeArtifact), [activeArtifact]);
  const routingReason = typeof activeArtifact?.metadata?.routingReason === 'string'
    ? activeArtifact.metadata.routingReason
    : '';
  const routingReasonText = formatRoutingReason(routingReason);
  const obsidianModeLabel = getObsidianModeLabel(obsidianStatus?.mode || String(activeArtifact?.metadata?.routingMode || ''));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-[64px] items-center justify-between border-b border-border/70 px-5 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>Results</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">Project results</h2>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={busy === 'load'}>
          <RefreshCw className={cn('h-4 w-4', busy === 'load' && 'animate-spin')} />
          Refresh
        </Button>
        <input
          ref={wikiUploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void uploadFilesToWiki(event.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => wikiUploadInputRef.current?.click()}
          disabled={busy === 'wiki-upload'}
        >
          <UploadCloud className={cn('h-4 w-4', busy === 'wiki-upload' && 'animate-pulse')} />
          上传到知识库
        </Button>
      </div>

      {error && <div className="border-b border-border/70 px-5 py-2 text-sm text-destructive">{error}</div>}
      {wikiUploadStatus && <div className="border-b border-border/70 px-5 py-2 text-sm text-emerald-700 dark:text-emerald-300">{wikiUploadStatus}</div>}

      <div className="flex gap-2 border-b border-border/70 px-5 py-2">
        {SOURCE_FILTERS.map((source) => (
          <button
            key={source.id}
            type="button"
            onClick={() => setSourceFilter(source.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition',
              sourceFilter === source.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {source.label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-r border-border/70">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-3">
              {filteredArtifacts.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">No results yet. Run commands, save review notes, or capture a preview screenshot to create results.</p>
              ) : filteredArtifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => setSelectedId(artifact.id)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left transition',
                    activeArtifact?.id === artifact.id ? 'border-primary/40 bg-primary/5' : 'border-border/70 hover:bg-accent/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{artifact.title}</span>
                    <Badge variant="outline">{artifact.kind}</Badge>
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
              Select a result to preview.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{activeArtifact.title}</h3>
                  <p className="text-xs text-muted-foreground">{activeArtifact.kind}</p>
                  <p className={cn('mt-1 truncate text-xs', obsidianStatusView.tone)} title={obsidianStatusView.detail}>
                    {obsidianStatusView.label}
                    {obsidianModeLabel ? ` · ${obsidianModeLabel}` : ''}
                    {obsidianStatusView.detail ? ` · ${obsidianStatusView.detail}` : ''}
                  </p>
                  {routingReasonText && (
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={routingReasonText}>
                      路由原因：{routingReasonText}
                    </p>
                  )}
                </div>
	                <div className="flex items-center gap-1">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                    value={obsidianMode}
                    onChange={(event) => setObsidianMode(event.target.value as ObsidianBridgeMode)}
                    aria-label="Obsidian 写入形态"
                  >
                    {OBSIDIAN_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => sendArtifactToObsidian(activeArtifact)}
                    disabled={busy === `obsidian:${activeArtifact.id}`}
                    title="发送到 Obsidian"
                  >
                    <BookOpen className="h-4 w-4" />
                    <span className="sr-only">发送到 Obsidian</span>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => copySummary(activeArtifact)}>
                    <Clipboard className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => attachArtifactToChat(activeArtifact)} disabled={!sessionId}>
                    <MessageSquarePlus className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteArtifact(activeArtifact)} disabled={busy === activeArtifact.id}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1 bg-muted/20">
                {activeArtifact.content?.startsWith('data:image/') ? (
                  <img src={activeArtifact.content} alt={activeArtifact.title} className="m-4 max-w-[calc(100%-2rem)] rounded-md border border-border/70 bg-background" />
                ) : (
                  <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground">
                    {activeArtifact.content || activeArtifact.filePath || 'No preview content available.'}
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
