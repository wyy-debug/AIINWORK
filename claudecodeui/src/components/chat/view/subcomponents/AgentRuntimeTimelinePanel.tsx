import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  FileCode2,
  GitBranch,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Wrench,
} from 'lucide-react';

import type { LLMProvider } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { cn } from '../../../../lib/utils';

type RuntimeTimelineStatus = 'info' | 'running' | 'success' | 'warning' | 'error' | 'blocked';

type RuntimeTimelineEvent = {
  id: string;
  timestamp: string;
  type: string;
  category: 'request' | 'model' | 'tool' | 'permission' | 'checkpoint' | 'subagent' | 'artifact' | 'runtime' | string;
  status: RuntimeTimelineStatus | string;
  severity?: 'info' | 'warning' | 'error' | string;
  title: string;
  summary?: string;
  details?: unknown;
  refs?: { checkpointId?: string };
};

type RuntimeTimeline = {
  summary?: {
    total?: number;
    tools?: number;
    failures?: number;
    permissionBlocks?: number;
    checkpoints?: number;
    subagents?: number;
    workflows?: number;
  };
  events?: RuntimeTimelineEvent[];
};

type AgentRuntimeTimelinePanelProps = {
  sessionId?: string | null;
  provider: LLMProvider;
  projectName?: string;
  projectPath?: string;
  isSessionRunning?: boolean;
};

const formatTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

function eventIcon(category: RuntimeTimelineEvent['category']) {
  if (category === 'tool') return Wrench;
  if (category === 'permission') return ShieldAlert;
  if (category === 'checkpoint') return FileCode2;
  if (category === 'subagent') return Bot;
  if (category === 'workflow') return GitBranch;
  if (category === 'model') return Sparkles;
  return Clock3;
}

export function eventToneClass(event: Pick<RuntimeTimelineEvent, 'status' | 'severity'>) {
  if (event.status === 'blocked' || event.severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300';
  }
  if (event.status === 'error' || event.severity === 'error') {
    return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300';
  }
  if (event.status === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';
  }
  return 'border-border bg-muted/60 text-muted-foreground';
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'danger' }) {
  return (
    <div className={cn(
      'rounded-md border px-2 py-1',
      tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
        : tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
          : 'border-border bg-card text-foreground',
    )}>
      <div className="text-[10px] font-medium uppercase text-current/70">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function AgentRuntimeTimelinePanel({
  sessionId,
  provider,
  projectName = '',
  projectPath = '',
  isSessionRunning = false,
}: AgentRuntimeTimelinePanelProps) {
  const [timeline, setTimeline] = useState<RuntimeTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');

  const canLoad = Boolean(sessionId);
  const events = useMemo(() => timeline?.events || [], [timeline]);
  const summary = timeline?.summary || {};

  const loadTimeline = useCallback(async () => {
    if (!sessionId) {
      setTimeline(null);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const response = await api.runtimeTimeline(sessionId, provider, { projectName, projectPath });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load runtime timeline');
      }
      setTimeline(payload.timeline || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load runtime timeline');
      setTimeline(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectName, projectPath, provider, sessionId]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline, isSessionRunning]);

  return (
    <aside className="hidden w-80 shrink-0 border-l border-border bg-background/95 lg:flex lg:min-h-0 lg:flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">Runtime Timeline</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {sessionId ? `${provider} session` : 'No active session'}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          onClick={() => void loadTimeline()}
          disabled={!canLoad || isLoading}
          title="Refresh runtime timeline"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!canLoad ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            Timeline appears after a session starts.
          </div>
        ) : error ? (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No runtime events captured yet.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-1.5">
              <SummaryPill label="Events" value={summary.total || events.length} />
              <SummaryPill label="Blocks" value={summary.permissionBlocks || 0} tone={(summary.permissionBlocks || 0) > 0 ? 'warning' : undefined} />
              <SummaryPill label={(summary.workflows || 0) > 0 ? 'Workflows' : 'Fails'} value={(summary.workflows || 0) > 0 ? summary.workflows || 0 : summary.failures || 0} tone={(summary.workflows || 0) > 0 ? undefined : (summary.failures || 0) > 0 ? 'danger' : undefined} />
            </div>

            <div className="space-y-2">
              {events.map((event) => {
                const Icon = eventIcon(event.category);
                const isExpanded = expandedId === event.id;
                return (
                  <div key={event.id} className="rounded-md border border-border bg-card p-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId((previous) => previous === event.id ? '' : event.id)}
                      className="flex w-full items-start gap-2 text-left"
                    >
                      <span className={cn('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', eventToneClass(event))}>
                        {event.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-foreground">{event.title}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{formatTime(event.timestamp)}</span>
                        </span>
                        {event.summary && (
                          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-muted-foreground">
                            {event.summary}
                          </span>
                        )}
                      </span>
                    </button>
                    {isExpanded && (
                      <pre className="mt-2 max-h-44 overflow-auto rounded bg-muted/50 p-2 text-[10px] leading-4 text-muted-foreground">
                        {JSON.stringify({ type: event.type, status: event.status, refs: event.refs, details: event.details }, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
