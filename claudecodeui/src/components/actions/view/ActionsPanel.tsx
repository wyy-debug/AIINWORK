import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, ExternalLink, Play, RefreshCw, Save, Square, TestTube2 } from 'lucide-react';

import type { Project } from '../../../types/app';
import { api, apiFetch } from '../../../utils/api';
import { Badge, Button, Input, ScrollArea } from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';

type ActionType = 'setup' | 'run' | 'test' | 'build';

type ProjectAction = {
  command: string;
  enabled: boolean;
  name?: string;
  icon?: string;
  platforms?: {
    windows?: string;
    mac?: string;
    linux?: string;
  };
};

type ActionRun = {
  id: string;
  actionType: ActionType;
  command: string;
  status: string;
  output: string;
  startedAt: string;
  finishedAt?: string | null;
};

type DetectedScript = {
  name: string;
  command: string;
  script?: string;
};

type ActionsPanelProps = {
  selectedProject: Project;
  sessionId?: string | null;
};

const ACTION_LABELS: Record<ActionType, string> = {
  setup: 'Setup',
  run: 'Run',
  test: 'Test',
  build: 'Build',
};

const ACTION_TYPES: ActionType[] = ['setup', 'run', 'test', 'build'];
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d+)?[^\s'"<>)]*/ig;

const parseJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

const emptyActions = (): Record<ActionType, ProjectAction> => ({
  setup: { command: '', enabled: false },
  run: { command: '', enabled: false },
  test: { command: '', enabled: false },
  build: { command: '', enabled: false },
});

export default function ActionsPanel({ selectedProject, sessionId }: ActionsPanelProps) {
  const [actions, setActions] = useState<Record<ActionType, ProjectAction>>(emptyActions);
  const [detectedScripts, setDetectedScripts] = useState<DetectedScript[]>([]);
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [mode, setMode] = useState<'local' | 'worktree'>('local');
  const [worktreePrompt, setWorktreePrompt] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId],
  );
  const previewUrl = useMemo(() => {
    const outputMatch = selectedRun?.output?.match(LOCAL_URL_PATTERN)?.[0];
    return outputMatch || '';
  }, [selectedRun?.output]);

  const load = useCallback(async () => {
    setBusy('load');
    setMessage('');
    try {
      const configParams = new URLSearchParams({ project: selectedProject.name });
      const configResponse = await apiFetch(`/api/project-actions/config?${configParams.toString()}`);
      const configData = await parseJson<{
        actions: Record<ActionType, ProjectAction>;
        detectedScripts?: DetectedScript[];
      }>(configResponse);
      setActions({ ...emptyActions(), ...configData.actions });
      setDetectedScripts(Array.isArray(configData.detectedScripts) ? configData.detectedScripts : []);

      const runsParams = new URLSearchParams({ project: selectedProject.name });
      const runsResponse = await apiFetch(`/api/project-actions/runs/list?${runsParams.toString()}`);
      const runsData = await parseJson<{ runs: ActionRun[] }>(runsResponse);
      setRuns(runsData.runs || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load actions');
    } finally {
      setBusy('');
    }
  }, [selectedProject.name]);

	  useEffect(() => {
	    void load();
	  }, [load]);

  useEffect(() => {
    if (!selectedRun || selectedRun.status !== 'running') return undefined;
    const events = new EventSource(`/api/project-actions/${encodeURIComponent(selectedRun.id)}/events`);
    events.addEventListener('output', (event) => {
      const data = JSON.parse((event as MessageEvent).data || '{}');
      const text = typeof data?.payload?.text === 'string' ? data.payload.text : '';
      if (!text) return;
      setRuns((previous) => previous.map((run) => (
        run.id === selectedRun.id
          ? { ...run, output: `${run.output || ''}${text}` }
          : run
      )));
    });
    events.addEventListener('status', (event) => {
      const data = JSON.parse((event as MessageEvent).data || '{}');
      const status = typeof data?.payload?.status === 'string' ? data.payload.status : '';
      if (!status) return;
      setRuns((previous) => previous.map((run) => (
        run.id === selectedRun.id
          ? { ...run, status, finishedAt: data?.payload?.finishedAt || run.finishedAt }
          : run
      )));
      if (status !== 'running') {
        window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
        void load();
      }
    });
    events.onerror = () => {
      events.close();
    };
    return () => events.close();
  }, [load, selectedRun]);

  useEffect(() => {
    const handleOpenTab = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string; mode?: string }>).detail;
      if (detail?.tab === 'actions' && detail.mode === 'worktree') {
        setMode('worktree');
      }
    };

    window.addEventListener('argus-open-tab', handleOpenTab);
    return () => window.removeEventListener('argus-open-tab', handleOpenTab);
  }, []);

  const saveConfig = async () => {
    setBusy('save');
    setMessage('');
    try {
      await parseJson(await apiFetch('/api/project-actions/config', {
        method: 'PUT',
        body: JSON.stringify({
          project: selectedProject.name,
          projectPath: selectedProject.fullPath || selectedProject.path,
          actions,
        }),
      }));
      setMessage('Actions saved to .mtl-code/actions.json');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save actions');
    } finally {
      setBusy('');
    }
  };

  const runAction = async (actionType: ActionType, commandOverride = '') => {
    setBusy(actionType);
    setMessage('');
    try {
      const submitRun = async (confirmationId = '') => {
        const response = await apiFetch('/api/project-actions/run', {
          method: 'POST',
          body: JSON.stringify({
            project: selectedProject.name,
            projectPath: selectedProject.fullPath || selectedProject.path,
            actionType,
            command: commandOverride || undefined,
            sessionId,
            confirmationId,
          }),
        });
        return parseJson<{
          run?: ActionRun;
          requiresConfirmation?: boolean;
          confirmationId?: string;
          reason?: string;
        }>(response);
      };

      let data = await submitRun();
      if (data.requiresConfirmation) {
        const confirmed = window.confirm(data.reason || 'This command needs confirmation before Argus runs it.');
        if (!confirmed) {
          setMessage('Action cancelled before execution.');
          return;
        }
        data = await submitRun(data.confirmationId || '');
      }
      if (!data.run) {
        throw new Error('Action did not return a run id');
      }
      setRuns((previous) => [data.run!, ...previous]);
      setSelectedRunId(data.run.id);
      window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to run ${ACTION_LABELS[actionType]}`);
    } finally {
      setBusy('');
    }
  };

  const openPreview = (targetUrl: string) => {
    sessionStorage.setItem('argus-preview-url', targetUrl);
    window.dispatchEvent(new CustomEvent('argus-open-panel', {
      detail: { panel: 'preview', url: targetUrl },
    }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('argus-open-preview', {
        detail: { url: targetUrl },
      }));
    }, 0);
  };

  const stopRun = async (runId: string) => {
    setBusy('stop');
    try {
      await parseJson(await apiFetch(`/api/project-actions/${encodeURIComponent(runId)}/stop`, { method: 'POST' }));
      window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to stop action');
    } finally {
      setBusy('');
    }
  };

  const createWorktreeTask = async () => {
    if (!worktreePrompt.trim()) {
      setMessage('Add a worktree task prompt first.');
      return;
    }
    setBusy('worktree');
    try {
      const response = await api.createProjectWorktree(selectedProject.name, {
        taskPrompt: worktreePrompt.trim(),
        displayName: worktreePrompt.trim().slice(0, 80),
        mode: 'managed',
        provider: 'claude',
        createNewSession: true,
      });
	      const data = await parseJson<{ project?: Project }>(response);
	      setMessage(`Worktree created${data.project?.displayName ? `: ${data.project.displayName}` : ''}`);
	      setWorktreePrompt('');
	      window.refreshProjects?.();
        const project = data.project;
        const sessionId = project?.worktree?.sessionId;
        if (project && sessionId) {
          window.dispatchEvent(new CustomEvent('argus-open-session', {
            detail: { projectName: project.name, sessionId },
          }));
        }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create worktree');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-[64px] items-center justify-between border-b border-border/70 px-5 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Play className="h-4 w-4" />
            <span>Run</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">Project commands</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={busy === 'load'}>
            <RefreshCw className={cn('h-4 w-4', busy === 'load' && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={saveConfig} disabled={busy === 'save'}>
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_380px]">
        <ScrollArea className="min-h-0 border-r border-border/70">
          <div className="space-y-5 p-5">
            <div className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-1">
              {(['local', 'worktree'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition',
                    mode === item ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item === 'local' ? 'Local' : 'Worktree'}
                </button>
              ))}
            </div>

            {message && (
              <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                {message}
              </div>
            )}

            {mode === 'local' ? (
              <div className="space-y-4">
                {detectedScripts.length > 0 && (
                  <div className="rounded-lg border border-border/70 bg-card p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-foreground">Detected package scripts</h3>
                      <p className="text-xs text-muted-foreground">Run the commands Argus found in package.json directly.</p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {detectedScripts.map((script) => (
                        <button
                          key={script.name}
                          type="button"
                          className="rounded-md border border-border/70 bg-background px-3 py-2 text-left transition hover:bg-accent/50 disabled:opacity-50"
                          disabled={Boolean(busy)}
                          onClick={() => runAction('run', script.command)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{script.name}</span>
                            <Play className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{script.command}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {ACTION_TYPES.map((actionType) => (
                  <div key={actionType} className="rounded-lg border border-border/70 bg-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{ACTION_LABELS[actionType]}</h3>
                        <p className="text-xs text-muted-foreground">Project command stored in .mtl-code/actions.json</p>
                      </div>
                      <Button
                        size="sm"
                        variant={actions[actionType]?.command ? 'default' : 'outline'}
                        disabled={!actions[actionType]?.command || Boolean(busy)}
                        onClick={() => runAction(actionType)}
                      >
                        {actionType === 'test' ? <TestTube2 className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        Run
                      </Button>
                    </div>
                    <Input
                      value={actions[actionType]?.command || ''}
                      placeholder={`Command for ${ACTION_LABELS[actionType]}`}
                      onChange={(event) => {
                        const command = event.target.value;
                        setActions((previous) => ({
                          ...previous,
                          [actionType]: { command, enabled: Boolean(command.trim()) },
                        }));
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border/70 bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Create isolated worktree task</h3>
                </div>
                <textarea
                  className="min-h-32 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={worktreePrompt}
                  onChange={(event) => setWorktreePrompt(event.target.value)}
                  placeholder="Describe the task Argus should run in an isolated worktree..."
                />
                <Button className="mt-3" onClick={createWorktreeTask} disabled={busy === 'worktree'}>
                  <Boxes className="h-4 w-4" />
                  Create Worktree Task
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        <aside className="flex min-h-0 flex-col">
          <div className="border-b border-border/70 px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Runs</h3>
            <p className="text-xs text-muted-foreground">Action logs persist locally.</p>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No action runs yet.</p>
              ) : runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left text-sm transition',
                    selectedRun?.id === run.id ? 'border-primary/40 bg-primary/5' : 'border-border/70 hover:bg-accent/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{ACTION_LABELS[run.actionType] || run.actionType}</span>
                    <Badge variant={run.status === 'completed' ? 'secondary' : run.status === 'running' ? 'default' : 'outline'}>
                      {run.status}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{run.command}</div>
                </button>
              ))}
            </div>
          </ScrollArea>
          {selectedRun && (
            <div className="max-h-72 border-t border-border/70">
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">{selectedRun.id}</span>
                <div className="flex items-center gap-2">
                  {previewUrl && (
                    <Button size="sm" variant="outline" onClick={() => openPreview(previewUrl)}>
                      <ExternalLink className="h-4 w-4" />
                      Preview
                    </Button>
                  )}
                  {selectedRun.status === 'running' && (
                    <Button size="sm" variant="outline" onClick={() => stopRun(selectedRun.id)} disabled={busy === 'stop'}>
                      <Square className="h-4 w-4" />
                      Stop
                    </Button>
                  )}
                </div>
              </div>
              <pre className="max-h-56 overflow-auto bg-muted/25 p-3 font-mono text-xs text-foreground">
                {selectedRun.output || 'Waiting for output...'}
              </pre>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
