import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clipboard, FileText, MessageSquarePlus, RefreshCw, Trash2 } from 'lucide-react';

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

const SOURCE_FILTERS: Array<{ id: 'all' | 'review' | 'actions' | 'browser'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Changes' },
  { id: 'actions', label: 'Run' },
  { id: 'browser', label: 'Preview' },
];

export default function ArtifactsPanel({ selectedProject, sessionId }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'review' | 'actions' | 'browser'>('all');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

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
      </div>

      {error && <div className="border-b border-border/70 px-5 py-2 text-sm text-destructive">{error}</div>}

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
                </div>
	                <div className="flex items-center gap-1">
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
