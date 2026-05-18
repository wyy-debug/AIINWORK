import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, RefreshCcw, RotateCcw, Trash2 } from 'lucide-react';

import type { LLMProvider } from '../../../../types/app';
import { api } from '../../../../utils/api';

type Checkpoint = {
  id: string;
  sessionId: string;
  provider: string;
  phase: 'before' | 'after';
  beforeCheckpointId?: string | null;
  profileKind?: string | null;
  permissionPreset?: string | null;
  branch?: string;
  headSha?: string;
  rollbackAvailable?: boolean;
  hasChanges?: boolean;
  status?: string;
  diff?: string;
  createdAt?: string;
};

type CheckpointPanelProps = {
  sessionId?: string | null;
  provider: LLMProvider;
  projectPath?: string;
  isSessionRunning?: boolean;
};

const formatTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const compactSha = (value?: string) => value ? value.slice(0, 7) : '';

export default function CheckpointPanel({
  sessionId,
  provider,
  projectPath = '',
  isSessionRunning = false,
}: CheckpointPanelProps) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [diffById, setDiffById] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const canLoad = Boolean(sessionId && projectPath);
  const afterCheckpoints = useMemo(
    () => checkpoints.filter((checkpoint) => checkpoint.phase === 'after'),
    [checkpoints],
  );

  const loadCheckpoints = useCallback(async () => {
    if (!canLoad || !sessionId) {
      setCheckpoints([]);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const response = await api.checkpoints({ sessionId, provider, projectPath, limit: 40 });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load checkpoints');
      }
      setCheckpoints(Array.isArray(payload.checkpoints) ? payload.checkpoints : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load checkpoints');
    } finally {
      setIsLoading(false);
    }
  }, [canLoad, projectPath, provider, sessionId]);

  useEffect(() => {
    void loadCheckpoints();
  }, [loadCheckpoints, isSessionRunning]);

  const toggleDiff = useCallback(async (checkpoint: Checkpoint) => {
    if (expandedId === checkpoint.id) {
      setExpandedId('');
      return;
    }
    setExpandedId(checkpoint.id);
    if (diffById[checkpoint.id]) return;
    setActionId(checkpoint.id);
    setError('');
    try {
      const response = await api.checkpointDiff(checkpoint.id);
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load checkpoint diff');
      }
      setDiffById((previous) => ({ ...previous, [checkpoint.id]: payload.diff || '' }));
    } catch (diffError) {
      setError(diffError instanceof Error ? diffError.message : 'Failed to load checkpoint diff');
    } finally {
      setActionId('');
    }
  }, [diffById, expandedId]);

  const rollbackCheckpoint = useCallback(async (checkpoint: Checkpoint) => {
    setActionId(checkpoint.id);
    setError('');
    try {
      const response = await api.rollbackCheckpoint(checkpoint.id);
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.reason || payload?.error || 'Rollback failed');
      }
      await loadCheckpoints();
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : 'Rollback failed');
    } finally {
      setActionId('');
    }
  }, [loadCheckpoints]);

  const deleteCheckpoint = useCallback(async (checkpoint: Checkpoint) => {
    setActionId(checkpoint.id);
    setError('');
    try {
      const response = await api.deleteCheckpoint(checkpoint.id);
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to discard checkpoint');
      }
      setCheckpoints((previous) => previous.filter((item) => item.id !== checkpoint.id));
      setExpandedId((previous) => previous === checkpoint.id ? '' : previous);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to discard checkpoint');
    } finally {
      setActionId('');
    }
  }, []);

  return (
    <aside className="hidden w-80 shrink-0 border-l border-border bg-background/95 lg:flex lg:min-h-0 lg:flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">Checkpoints</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {sessionId ? `${provider} session` : 'No active session'}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          onClick={() => void loadCheckpoints()}
          disabled={!canLoad || isLoading}
          title="Refresh checkpoints"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!canLoad ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            Checkpoints appear after this session runs in a project.
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : afterCheckpoints.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No checkpoints captured yet.
          </div>
        ) : (
          <div className="space-y-2">
            {afterCheckpoints.map((checkpoint) => {
              const isBusy = actionId === checkpoint.id;
              const isExpanded = expandedId === checkpoint.id;
              const diff = diffById[checkpoint.id] ?? checkpoint.diff ?? '';
              return (
                <div key={checkpoint.id} className="rounded-md border border-border bg-card">
                  <div className="space-y-2 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">
                          {formatTime(checkpoint.createdAt) || 'Checkpoint'}
                          {checkpoint.hasChanges ? ' · changed' : ' · clean'}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {checkpoint.profileKind || 'agent'} · {checkpoint.permissionPreset || 'permissions'} · {checkpoint.branch || 'branch'} {compactSha(checkpoint.headSha)}
                        </div>
                      </div>
                      {isBusy && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => void toggleDiff(checkpoint)}
                        title="View diff"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        onClick={() => void rollbackCheckpoint(checkpoint)}
                        disabled={isBusy || !checkpoint.rollbackAvailable}
                        title="Restore checkpoint"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        onClick={() => void deleteCheckpoint(checkpoint)}
                        disabled={isBusy}
                        title="Discard checkpoint"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <pre className="max-h-72 overflow-auto border-t border-border bg-muted/30 p-2 text-[11px] leading-5 text-foreground">
                      {diff.trim() || 'No diff captured.'}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
