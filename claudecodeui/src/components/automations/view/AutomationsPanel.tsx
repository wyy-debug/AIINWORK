import { useCallback, useEffect, useState } from 'react';
import { Clock, Inbox, Pause, Play, Plus, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-react';

import type { Project } from '../../../types/app';
import { apiFetch } from '../../../utils/api';
import { Badge, Button, Input, ScrollArea } from '../../../shared/view/ui';

type Automation = {
  id: string;
  name: string;
  projectName: string;
  projectPath: string;
  prompt: string;
  targetMode: 'triage-only' | 'local-argus' | 'worktree-argus';
  scheduleType: 'manual' | 'interval';
  intervalMinutes: number | null;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

type TriageItem = {
  id: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
};

type AutomationRun = {
  id: string;
  automationId: string;
  status: string;
  triggerType?: string;
  sessionId?: string | null;
  worktreeId?: string | null;
  metadata?: Record<string, unknown>;
  output: string;
  error: string;
  startedAt: string;
  finishedAt?: string | null;
};

type AutomationsPanelProps = {
  selectedProject: Project;
};

const parseJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

export default function AutomationsPanel({ selectedProject }: AutomationsPanelProps) {
	  const [automations, setAutomations] = useState<Automation[]>([]);
	  const [triageItems, setTriageItems] = useState<TriageItem[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [triageStatus, setTriageStatus] = useState<'open' | 'closed'>('open');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [targetMode, setTargetMode] = useState<Automation['targetMode']>('triage-only');
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
	      const [automationData, triageData] = await Promise.all([
	        parseJson<{ automations: Automation[] }>(await apiFetch('/api/automations')),
	        parseJson<{ items: TriageItem[] }>(await apiFetch(`/api/triage?status=${triageStatus}`)),
	      ]);
        const runData = await parseJson<{ runs: AutomationRun[] }>(await apiFetch('/api/automations/runs'));
	      setAutomations(automationData.automations || []);
	      setTriageItems(triageData.items || []);
        setRuns(runData.runs || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load automations');
    } finally {
      setBusy('');
    }
	  }, [triageStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const createAutomation = async () => {
    if (!name.trim()) {
      setError('Automation name is required.');
      return;
    }
    setBusy('create');
    try {
      await parseJson(await apiFetch('/api/automations', {
        method: 'POST',
        body: JSON.stringify({
          name,
          prompt,
          targetMode,
          projectName: selectedProject.name,
          projectPath: selectedProject.fullPath || selectedProject.path,
          scheduleType: Number(intervalMinutes) > 0 ? 'interval' : 'manual',
          intervalMinutes: Number(intervalMinutes) || null,
          enabled: true,
        }),
      }));
      setName('');
      setPrompt('');
      setTargetMode('triage-only');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create automation');
    } finally {
      setBusy('');
    }
  };

  const updateAutomation = async (automation: Automation, patch: Partial<Automation>) => {
    setBusy(automation.id);
    try {
      await parseJson(await apiFetch(`/api/automations/${encodeURIComponent(automation.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...automation, ...patch }),
      }));
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update automation');
    } finally {
      setBusy('');
    }
  };

	  const runAutomation = async (automation: Automation) => {
    setBusy(automation.id);
    try {
	      const data = await parseJson<{ run: AutomationRun }>(await apiFetch(`/api/automations/${encodeURIComponent(automation.id)}/run`, { method: 'POST' }));
        setRuns((previous) => [data.run, ...previous]);
	      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run automation');
    } finally {
      setBusy('');
    }
	  };

  const updateTriageItem = async (item: TriageItem, status: 'open' | 'closed') => {
    setBusy(item.id);
    try {
      await parseJson(await apiFetch(`/api/triage/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }));
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update triage item');
    } finally {
      setBusy('');
    }
  };

  const cancelRun = async (run: AutomationRun) => {
    setBusy(run.id);
    try {
      await parseJson(await apiFetch(`/api/automations/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' }));
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel automation run');
    } finally {
      setBusy('');
    }
  };

  const retryRun = async (run: AutomationRun) => {
    setBusy(run.id);
    try {
      const data = await parseJson<{ run: AutomationRun }>(await apiFetch(`/api/automations/runs/${encodeURIComponent(run.id)}/retry`, { method: 'POST' }));
      setRuns((previous) => [data.run, ...previous]);
      await load();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Failed to retry automation run');
    } finally {
      setBusy('');
    }
  };

  const openRunSession = (run: AutomationRun) => {
    const sessionId = run.sessionId || (typeof run.metadata?.sessionId === 'string' ? run.metadata.sessionId : '');
    const projectName = typeof run.metadata?.projectName === 'string' ? run.metadata.projectName : selectedProject.name;
    if (!sessionId) return;
    window.dispatchEvent(new CustomEvent('argus-open-session', {
      detail: { projectName, sessionId },
    }));
  };

  const deleteAutomation = async (automation: Automation) => {
    if (!window.confirm(`Delete automation "${automation.name}"?`)) {
      return;
    }
    setBusy(automation.id);
    try {
      await parseJson(await apiFetch(`/api/automations/${encodeURIComponent(automation.id)}`, { method: 'DELETE' }));
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete automation');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-[64px] items-center justify-between border-b border-border/70 px-5 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Automations</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">Triage and scheduled local tasks</h2>
        </div>
	        <Button variant="outline" size="sm" onClick={load} disabled={busy === 'load'}>
            <RefreshCw className="h-4 w-4" />
	          Refresh
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
        <ScrollArea className="min-h-0 border-r border-border/70">
          <div className="space-y-4 p-5">
            {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

            <div className="rounded-lg border border-border/70 bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Plus className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">New automation</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem]">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
                <Input value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} placeholder="Minutes" />
              </div>
              <select
                className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={targetMode}
                onChange={(event) => setTargetMode(event.target.value as Automation['targetMode'])}
              >
                <option value="triage-only">Triage only</option>
                <option value="local-argus">Local Argus</option>
                <option value="worktree-argus">Worktree Argus</option>
              </select>
              <textarea
                className="mt-3 min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Prompt or run note for this automation..."
              />
              <Button className="mt-3" onClick={createAutomation} disabled={busy === 'create'}>
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </div>

            <div className="space-y-2">
              {automations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No automations yet.</p>
              ) : automations.map((automation) => (
                <div key={automation.id} className="rounded-lg border border-border/70 bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{automation.name}</h3>
                        <Badge variant={automation.enabled ? 'secondary' : 'outline'}>
                          {automation.enabled ? 'enabled' : 'paused'}
                        </Badge>
                        <Badge variant="outline">{automation.targetMode || 'triage-only'}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{automation.prompt || 'No prompt configured.'}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {automation.scheduleType === 'interval'
                          ? `Every ${automation.intervalMinutes} minutes`
                          : 'Manual'}
                        {automation.nextRunAt ? ` - next ${new Date(automation.nextRunAt).toLocaleString()}` : ''}
                      </p>
                    </div>
	                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => runAutomation(automation)} disabled={busy === automation.id}>
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => updateAutomation(automation, { enabled: !automation.enabled })}
                        disabled={busy === automation.id}
                      >
                        <Pause className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteAutomation(automation)} disabled={busy === automation.id}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
	                    </div>
                  </div>
                </div>
              ))}
	            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Recent runs</h3>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No automation runs yet.</p>
              ) : runs.slice(0, 12).map((run) => (
                <div key={run.id} className="rounded-lg border border-border/70 bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{run.id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{run.triggerType || 'manual'} / {run.status}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {run.status === 'running' && (
                        <Button variant="ghost" size="icon" onClick={() => cancelRun(run)} disabled={busy === run.id}>
                          <Square className="h-4 w-4" />
                        </Button>
                      )}
                      {run.status === 'failed' && (
                        <Button variant="ghost" size="icon" onClick={() => retryRun(run)} disabled={busy === run.id}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                      {(run.sessionId || typeof run.metadata?.sessionId === 'string') && (
                        <Button variant="ghost" size="sm" onClick={() => openRunSession(run)}>
                          Open session
                        </Button>
                      )}
                    </div>
                  </div>
                  {(run.output || run.error) && (
                    <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/35 p-2 text-xs">
                      {run.error || run.output}
                    </pre>
                  )}
                </div>
              ))}
            </div>
	          </div>
	        </ScrollArea>

        <aside className="flex min-h-0 flex-col">
          <div className="border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
	              <h3 className="text-sm font-semibold text-foreground">Triage inbox</h3>
                <select
                  className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={triageStatus}
                  onChange={(event) => setTriageStatus(event.target.value as 'open' | 'closed')}
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {triageItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Inbox is clear.</p>
              ) : triageItems.map((item) => (
	                <div key={item.id} className="rounded-md border border-border/70 bg-card p-3">
	                  <div className="text-sm font-medium text-foreground">{item.title}</div>
	                  <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{item.body}</div>
                    <Button
                      className="mt-2"
                      variant="outline"
                      size="sm"
                      onClick={() => updateTriageItem(item, item.status === 'closed' ? 'open' : 'closed')}
                    >
                      {item.status === 'closed' ? 'Reopen' : 'Mark read'}
                    </Button>
	                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
