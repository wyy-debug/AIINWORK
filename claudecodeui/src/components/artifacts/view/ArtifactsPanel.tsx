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

const getArtifactPreview = (artifact: Artifact) => (
  artifact.content || artifact.filePath || 'No preview content.'
);

export default function ArtifactsPanel({ selectedProject, sessionId }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

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
      setError(loadError instanceof Error ? loadError.message : 'Failed to load results.');
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
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load result details.');
      }
    };
    void loadArtifact();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const deleteArtifact = async (artifact: Artifact) => {
    if (!window.confirm(`Delete result "${artifact.title}"?`)) {
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
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete result.');
    } finally {
      setBusy('');
    }
  };

  const attachArtifactToChat = async (artifact: Artifact) => {
    if (!sessionId) {
      setError('Open or create a chat before attaching a result.');
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
      setError(attachError instanceof Error ? attachError.message : 'Failed to attach result to chat.');
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

  const artifactCountText = `${artifacts.length} result${artifacts.length === 1 ? '' : 's'}`;

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
          <h2 className="mt-1 text-lg font-semibold text-foreground">Project Results</h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={busy === 'load'}>
            <RefreshCw className={cn('h-4 w-4', busy === 'load' && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {error && <div className="border-b border-border/70 px-5 py-2 text-sm text-destructive">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-border/70 lg:border-b-0 lg:border-r">
          <div className="flex h-11 items-center justify-between border-b border-border/70 px-4 text-sm text-muted-foreground">
            <span>{artifactCountText}</span>
          </div>
          <ScrollArea className="h-[calc(100%-44px)]">
            {artifacts.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No results yet. Run a review, summary, workflow, or analysis to create results here.
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {artifacts.map((artifact) => {
                  const selected = activeArtifact?.id === artifact.id;
                  return (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => setSelectedId(artifact.id)}
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left transition-colors',
                        selected
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-transparent hover:border-border hover:bg-muted/60',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{artifact.title}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
                          {artifact.kind}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{artifact.createdAt}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </aside>

        <section className="min-h-0">
          {activeArtifact ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-foreground">{activeArtifact.title}</h3>
                    <Badge variant="outline">{activeArtifact.kind}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {activeArtifact.sessionId || 'No session'} · {activeArtifact.createdAt}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void attachArtifactToChat(activeArtifact)}>
                    <MessageSquarePlus className="h-4 w-4" />
                    Add to Chat
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copySummary(activeArtifact)}>
                    <Clipboard className="h-4 w-4" />
                    Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void deleteArtifact(activeArtifact)} disabled={busy === activeArtifact.id}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <pre className="whitespace-pre-wrap break-words p-5 text-sm leading-6 text-foreground">
                  {getArtifactPreview(activeArtifact)}
                </pre>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              Select a result to inspect it.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
