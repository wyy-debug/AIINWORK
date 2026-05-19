import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Circle, History, LibraryBig, Play, RefreshCw, Square } from 'lucide-react';

import { api } from '../../../utils/api';
import { cn } from '../../../lib/utils';
import type { Project } from '../../../types/app';
import type { AgentConfig } from '../../../types/agent';
import type { SubagentRun } from '../../../types/subagent';

type SubagentsWorkspaceProps = {
  selectedProject: Project;
  sessionId?: string | null;
};

type ViewKind = 'Running' | 'Library' | 'History';

const views: ViewKind[] = ['Running', 'Library', 'History'];

function statusTone(status: string) {
  if (status === 'running') return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (status === 'failed') return 'text-red-600 bg-red-50 border-red-200';
  if (status === 'stopped') return 'text-slate-600 bg-slate-50 border-slate-200';
  return 'text-blue-600 bg-blue-50 border-blue-200';
}

function formatTime(value?: number) {
  if (!value) return 'n/a';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function SubagentsWorkspace({ selectedProject, sessionId = null }: SubagentsWorkspaceProps) {
  const [activeView, setActiveView] = useState<ViewKind>('Running');
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [runs, setRuns] = useState<SubagentRun[]>([]);
  const [objective, setObjective] = useState('Explore this project and return concise findings.');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const runningRuns = useMemo(() => runs.filter((run) => run.status === 'running'), [runs]);
  const historyRuns = useMemo(() => runs.filter((run) => run.status !== 'running'), [runs]);

  const loadData = useCallback(async () => {
    setError('');
    const [agentsResponse, runsResponse] = await Promise.all([
      api.get('/agents?mode=subagent&includePaused=false'),
      api.subagentRuns({ limit: 50 }),
    ]);
    const [agentsData, runsData] = await Promise.all([agentsResponse.json(), runsResponse.json()]);
    if (!agentsResponse.ok) throw new Error(agentsData?.error || 'Failed to load subagents');
    if (!runsResponse.ok) throw new Error(runsData?.error || 'Failed to load subagent runs');
    setAgents((agentsData.agents || []).filter((agent: AgentConfig & { hidden?: boolean }) => !agent.hidden));
    setRuns(runsData.runs || []);
  }, []);

  useEffect(() => {
    void loadData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load subagents');
    });
  }, [loadData]);

  const invokeAgent = useCallback(async (agent: AgentConfig) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await api.invokeAgent(agent.id, {
        objective,
        projectPath: selectedProject.path,
        sessionId: sessionId || '',
        source: 'manual',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to run subagent');
      await loadData();
      setActiveView('Running');
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Failed to run subagent');
    } finally {
      setIsLoading(false);
    }
  }, [loadData, objective, selectedProject.path, sessionId]);

  const stopRun = useCallback(async (run: SubagentRun) => {
    setError('');
    try {
      const response = await api.controlSubagentRun(run.id, { action: 'stop' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to stop subagent');
      await loadData();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Failed to stop subagent');
    }
  }, [loadData]);

  const visibleRuns = activeView === 'Running' ? runningRuns : historyRuns;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Subagents</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Run focused assistants with scoped permissions and separate context.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to refresh'))}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {views.map((view) => {
            const Icon = view === 'Running' ? Circle : view === 'Library' ? LibraryBig : History;
            return (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
                  activeView === view ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" />
                {view}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {activeView === 'Library' ? (
          <div className="space-y-4" data-testid="subagents-library">
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              className="min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {agents.map((agent) => (
                <div key={agent.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-foreground">{agent.name}</h3>
                      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{agent.description}</p>
                    </div>
                    <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">{agent.mode || 'subagent'}</span>
                  </div>
                  <button
                    type="button"
                    data-testid="subagent-library-run"
                    data-agent-id={agent.id}
                    onClick={() => void invokeAgent(agent)}
                    disabled={isLoading || !objective.trim()}
                    className="mt-4 inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run
                  </button>
                </div>
              ))}
              {agents.length === 0 && <p className="text-sm text-muted-foreground">No subagents available.</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRuns.map((run) => (
              <div key={run.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{run.agentName}</h3>
                      <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusTone(run.status))}>{run.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{run.objective || 'No objective provided.'}</p>
                    <p className="mt-2 text-xs text-muted-foreground">Started {formatTime(run.createdAt)} · {run.source || 'manual'}</p>
                    {run.result && <p className="mt-3 rounded-md bg-muted p-3 text-xs text-foreground">{run.result}</p>}
                    {run.error && <p className="mt-3 rounded-md bg-red-50 p-3 text-xs text-red-700">{run.error}</p>}
                  </div>
                  {run.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => void stopRun(run)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-muted"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </button>
                  )}
                </div>
              </div>
            ))}
            {visibleRuns.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {activeView === 'Running' ? 'No running subagents.' : 'No completed subagent runs yet.'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
