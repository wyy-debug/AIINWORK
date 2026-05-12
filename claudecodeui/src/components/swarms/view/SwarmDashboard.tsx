import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Code2,
  Database,
  Download,
  FileText,
  MoreVertical,
  Network,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Square,
  Star,
  UserRound,
} from 'lucide-react';

import type { Project } from '../../../types/app';
import type {
  SwarmDeliveryTrace,
  SwarmEvent,
  SwarmMessage,
  SwarmRunAgent,
  SwarmRunMemory,
  SwarmRunSnapshot,
  SwarmTemplateManifest,
} from '../../../types/swarm';
import { api } from '../../../utils/api';
import {
  buildSwarmCollaborationView,
  filterSwarmEvents,
  summarizeMessageTrace,
  summarizeSwarmRun,
} from '../utils/swarmDashboard';
import { SAMPLE_SWARM_ROLES, SAMPLE_SWARM_TOPOLOGY } from '../constants/sampleSwarmManifest';

type SwarmDashboardProps = {
  selectedProject: Project;
  sessionId?: string | null;
  latestMessage?: unknown;
};

const SAMPLE_MANIFEST: SwarmTemplateManifest = {
  schemaVersion: 1,
  id: 'review-swarm-pack',
  version: '1.0.0',
  kind: 'swarm-template',
  topology: {
    type: 'queen',
    coordinatorRoleId: 'queen',
    edges: [
      { from: 'queen', to: 'security-reviewer', topic: 'review.assignments' },
      { from: 'queen', to: 'test-writer', topic: 'test.assignments' },
      { from: 'security-reviewer', to: 'summarizer', topic: 'review.findings' },
      { from: 'test-writer', to: 'summarizer', topic: 'test.findings' },
    ],
  },
  roles: [
    { id: 'queen', label: '主Agent / Orchestrator', agentTemplateId: 'review-coordinator', count: 1 },
    { id: 'code-agent', label: '代码Agent', agentTemplateId: 'code-reviewer', count: 1 },
    { id: 'test-agent', label: '测试Agent', agentTemplateId: 'test-writer', count: 1 },
    { id: 'deploy-agent', label: '部署Agent', agentTemplateId: 'deployment-reviewer', count: 1 },
    { id: 'docs-agent', label: '文档Agent', agentTemplateId: 'docs-writer', count: 1 },
    { id: 'monitor-agent', label: '监控Agent', agentTemplateId: 'monitoring-reviewer', count: 1 },
    { id: 'data-agent', label: '数据Agent', agentTemplateId: 'data-analyst', count: 1 },
  ],
  bus: { provider: 'local-sqlite', ackPolicy: 'at_least_once', retryLimit: 2, ttlMs: 600000 },
  memory: { enabled: true, promotion: 'manual', scopes: ['facts', 'decisions', 'artifacts', 'role-notes'] },
  policies: { maxAgents: 8, maxDepth: 3, tokenBudget: 240000, timeoutMs: 3600000, messageSizeLimit: 32768 },
  dialogs: {
    launch: {
      fields: [
        { id: 'objective', label: 'Objective', type: 'textarea', required: true },
      ],
      presets: [
        {
          id: 'payment-timeout',
          label: '支付接口排查',
          answers: { objective: '请排查支付接口超时问题，并优化系统稳定性。' },
        },
      ],
      defaultPresetId: 'payment-timeout',
    },
  },
};

function getSampleSwarmManifest(): SwarmTemplateManifest {
  return {
    ...SAMPLE_MANIFEST,
    topology: SAMPLE_SWARM_TOPOLOGY,
    roles: SAMPLE_SWARM_ROLES,
  };
}

function formatTime(value?: number) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusClassName(status?: string) {
  if (status === 'running') return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900';
  if (status === 'completed' || status === 'acknowledged') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900';
  if (status === 'failed' || status === 'dead_lettered' || status === 'control_failed') return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900';
  if (status === 'paused' || status === 'expired' || status === 'degraded' || status === 'retry_scheduled') return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900';
  return 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-muted dark:text-muted-foreground dark:ring-border';
}

function StatusPill({ status }: { status?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusClassName(status)}`}>
      <span className="truncate">{status || 'unknown'}</span>
    </span>
  );
}

function formatLastControl(control?: Record<string, unknown> | null) {
  if (!control) return '';
  const action = typeof control.action === 'string' ? control.action : 'control';
  const mode = typeof control.mode === 'string' ? control.mode : '';
  const success = control.success === false ? 'failed' : 'ok';
  const error = typeof control.error === 'string' ? control.error : '';
  return [action, success, mode, error].filter(Boolean).join(' / ');
}

function payloadPreview(payload?: Record<string, unknown>) {
  if (!payload) return '';
  const message = payload.message || payload.content || payload.objective || payload.summary;
  if (typeof message === 'string') return message;
  return JSON.stringify(payload, null, 2);
}

function agentIcon(roleId = '', label = '') {
  const key = `${roleId} ${label}`.toLowerCase();
  if (key.includes('security') || key.includes('review')) return ShieldCheck;
  if (key.includes('test')) return CheckCircle2;
  if (key.includes('deploy')) return Rocket;
  if (key.includes('doc')) return FileText;
  if (key.includes('data')) return Database;
  if (key.includes('monitor')) return Activity;
  if (key.includes('code')) return Code2;
  return Bot;
}

function agentTone(roleId = '', label = '') {
  const key = `${roleId} ${label}`.toLowerCase();
  if (key.includes('security') || key.includes('test')) return 'from-emerald-500 to-teal-500';
  if (key.includes('deploy')) return 'from-sky-500 to-blue-500';
  if (key.includes('doc')) return 'from-rose-500 to-red-500';
  if (key.includes('data')) return 'from-blue-500 to-indigo-500';
  if (key.includes('monitor')) return 'from-cyan-500 to-sky-500';
  if (key.includes('code')) return 'from-violet-500 to-blue-500';
  return 'from-blue-500 to-cyan-500';
}

function isOnlineStatus(status?: string) {
  return !['failed', 'cancelled', 'dead_lettered', 'expired'].includes(String(status || '').toLowerCase());
}

export default function SwarmDashboard({ selectedProject, sessionId, latestMessage }: SwarmDashboardProps) {
  const [manifestText, setManifestText] = useState(() => JSON.stringify(getSampleSwarmManifest(), null, 2));
  const [objective, setObjective] = useState('请排查支付接口超时问题，并优化系统稳定性。');
  const [runtimeMode, setRuntimeMode] = useState<'coordinator-subagents' | 'local-control-plane'>('coordinator-subagents');
  const [run, setRun] = useState<SwarmRunSnapshot | null>(null);
  const [runs, setRuns] = useState<SwarmRunSnapshot[]>([]);
  const [eventQuery, setEventQuery] = useState('');
  const [messageDraft, setMessageDraft] = useState('请同步当前执行进展。');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState('');
  const [messageTrace, setMessageTrace] = useState<SwarmDeliveryTrace[]>([]);
  const [memoryDraft, setMemoryDraft] = useState({ scope: 'facts', title: '', content: '' });
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  const summary = useMemo(() => summarizeSwarmRun(run || {}), [run]);
  const collaboration = useMemo(
    () => buildSwarmCollaborationView(run || {
      objective,
      topology: SAMPLE_SWARM_TOPOLOGY,
      agents: [],
      messages: [],
      events: [],
      runtimeStatus: 'ready',
    }),
    [objective, run],
  );
  const selectedMessage = useMemo(
    () => (run?.messages || []).find((message) => message.id === selectedMessageId) || null,
    [run?.messages, selectedMessageId],
  );
  const selectedAgent = useMemo(
    () => (run?.agents || []).find((agent) => agent.id === selectedAgentId) || null,
    [run?.agents, selectedAgentId],
  );
  const traceSummary = useMemo(() => summarizeMessageTrace(messageTrace), [messageTrace]);
  const memoryItems = useMemo(() => (run?.memory || []) as SwarmRunMemory[], [run?.memory]);
  const filteredEvents = useMemo(
    () => filterSwarmEvents((run?.events || []) as SwarmEvent[], eventQuery).slice(-120),
    [eventQuery, run?.events],
  );

  const applyPendingSwarmTemplate = useCallback((payload: unknown) => {
    const data = payload && typeof payload === 'object' ? payload as { manifest?: unknown; title?: string } : {};
    if (!data.manifest || typeof data.manifest !== 'object') return;
    setManifestText(JSON.stringify(data.manifest, null, 2));
    if (data.title) {
      setObjective(`Dispatch ${data.title}`);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleDispatch = (event: Event) => {
      applyPendingSwarmTemplate((event as CustomEvent).detail);
    };
    window.addEventListener('argus:dispatch-swarm-template', handleDispatch);
    try {
      const pending = window.localStorage.getItem('argus:pending-swarm-template');
      if (pending) {
        applyPendingSwarmTemplate(JSON.parse(pending));
        window.localStorage.removeItem('argus:pending-swarm-template');
      }
    } catch {
      // Ignore malformed local UI handoff state.
    }
    return () => window.removeEventListener('argus:dispatch-swarm-template', handleDispatch);
  }, [applyPendingSwarmTemplate]);

  const loadRuns = useCallback(async () => {
    const response = await api.swarmRuns({ limit: 20 });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to load swarm runs');
    setRuns(Array.isArray(data.runs) ? data.runs : []);
    return data.runs as SwarmRunSnapshot[];
  }, []);

  useEffect(() => {
    void loadRuns().catch(() => undefined);
  }, [loadRuns]);

  const refreshRun = useCallback(async (runId: string) => {
    const response = await api.swarmRun(runId);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to refresh swarm run');
    setRun(data.run);
    if (data.run?.agents?.length && !selectedAgentId) {
      setSelectedAgentId(data.run.agents[0].id);
    }
    if (data.run?.messages?.length && !selectedMessageId) {
      setSelectedMessageId(data.run.messages[0].id);
    }
    return data.run as SwarmRunSnapshot;
  }, [selectedAgentId, selectedMessageId]);

  const loadMessageTrace = useCallback(async (messageId: string) => {
    if (!run?.id || !messageId) {
      setMessageTrace([]);
      return [];
    }
    const response = await api.swarmMessageTrace(run.id, messageId);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to load swarm message trace');
    const trace = Array.isArray(data.trace) ? data.trace : [];
    setMessageTrace(trace);
    return trace as SwarmDeliveryTrace[];
  }, [run?.id]);

  useEffect(() => {
    void loadMessageTrace(selectedMessageId).catch(() => undefined);
  }, [loadMessageTrace, selectedMessageId]);

  const resumeRun = useCallback(async (runId: string) => {
    setIsBusy(true);
    setError('');
    try {
      const snapshot = await refreshRun(runId);
      setSelectedAgentId(snapshot.agents?.[0]?.id || '');
      setSelectedMessageId(snapshot.messages?.[0]?.id || '');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to resume swarm run');
    } finally {
      setIsBusy(false);
    }
  }, [refreshRun]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const openRun = (runId: string) => {
      const trimmedRunId = runId.trim();
      if (!trimmedRunId) return;
      try {
        window.localStorage.removeItem('argus:pending-swarm-run-id');
      } catch {
        // Ignore storage cleanup failures.
      }
      void resumeRun(trimmedRunId);
    };

    const handleOpenRun = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: unknown }>).detail || {};
      if (typeof detail.runId === 'string') {
        openRun(detail.runId);
      }
    };

    window.addEventListener('argus:open-swarm-run', handleOpenRun);
    try {
      const pendingRunId = window.localStorage.getItem('argus:pending-swarm-run-id');
      if (pendingRunId) {
        openRun(pendingRunId);
      }
    } catch {
      // Ignore unavailable localStorage.
    }

    return () => window.removeEventListener('argus:open-swarm-run', handleOpenRun);
  }, [resumeRun]);

  useEffect(() => {
    if (!run?.id || !latestMessage || typeof latestMessage !== 'object') return;
    const message = latestMessage as { type?: string; runId?: string };
    if (message.type === 'swarm_event' && message.runId === run.id) {
      void refreshRun(run.id).catch(() => undefined);
    }
  }, [latestMessage, refreshRun, run?.id]);

  const startRun = useCallback(async () => {
    setIsBusy(true);
    setError('');
    try {
      const manifest = JSON.parse(manifestText);
      const validateResponse = await api.validateSwarmTemplate(manifest);
      const validateData = await validateResponse.json();
      if (!validateResponse.ok) {
        throw new Error(validateData?.details || validateData?.error || 'Invalid swarm template');
      }
      const response = await api.startSwarmRun({
        template: validateData.manifest,
        objective,
        sessionId: sessionId || '',
        projectPath: selectedProject.fullPath || selectedProject.path || '',
        launchAnswers: { objective },
        runtimeMode,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to start swarm run');
      setRun(data.run);
      setSelectedAgentId(data.run?.agents?.[0]?.id || '');
      setSelectedMessageId(data.run?.messages?.[0]?.id || '');
      void loadRuns().catch(() => undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to start swarm run');
    } finally {
      setIsBusy(false);
    }
  }, [loadRuns, manifestText, objective, runtimeMode, selectedProject.fullPath, selectedProject.path, sessionId]);

  const controlRun = useCallback(async (action: string, agent?: SwarmRunAgent, payload: Record<string, unknown> = {}) => {
    if (!run?.id) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.controlSwarmRun(run.id, {
        action,
        ...(agent ? { agentId: agent.id } : {}),
        ...payload,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to control swarm run');
      await refreshRun(run.id);
      void loadRuns().catch(() => undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to control swarm run');
    } finally {
      setIsBusy(false);
    }
  }, [loadRuns, refreshRun, run?.id]);

  const publishMessage = useCallback(async () => {
    if (!run?.id || !messageDraft.trim()) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.publishSwarmMessage(run.id, {
        fromAgentId: 'operator',
        toAgentId: selectedAgentId,
        topic: selectedAgentId ? '' : '*',
        type: 'operator_message',
        payload: { message: messageDraft.trim() },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to publish message');
      setMessageDraft('');
      await refreshRun(run.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to publish message');
    } finally {
      setIsBusy(false);
    }
  }, [messageDraft, refreshRun, run?.id, selectedAgentId]);

  const replayMessage = useCallback(async (message?: SwarmMessage | null) => {
    if (!run?.id) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.replaySwarmMessages(run.id, {
        messageIds: message?.id ? [message.id] : [],
        statusFilter: message?.id ? undefined : 'dead_lettered',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to replay swarm message');
      await refreshRun(run.id);
      if (message?.id) await loadMessageTrace(message.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to replay swarm message');
    } finally {
      setIsBusy(false);
    }
  }, [loadMessageTrace, refreshRun, run?.id]);

  const createMemory = useCallback(async () => {
    if (!run?.id || !memoryDraft.content.trim()) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.createSwarmMemory(run.id, {
        scope: memoryDraft.scope,
        title: memoryDraft.title.trim() || memoryDraft.scope,
        content: memoryDraft.content.trim(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to save swarm memory');
      setMemoryDraft({ scope: 'facts', title: '', content: '' });
      await refreshRun(run.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save swarm memory');
    } finally {
      setIsBusy(false);
    }
  }, [memoryDraft.content, memoryDraft.scope, memoryDraft.title, refreshRun, run?.id]);

  const deleteMemory = useCallback(async (memoryId: string) => {
    if (!run?.id) return;
    setIsBusy(true);
    setError('');
    try {
      const response = await api.deleteSwarmMemory(run.id, memoryId);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.details || data?.error || 'Failed to delete swarm memory');
      await refreshRun(run.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete swarm memory');
    } finally {
      setIsBusy(false);
    }
  }, [refreshRun, run?.id]);

  const exportRun = useCallback(() => {
    if (!run || typeof document === 'undefined') return;
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `swarm-run-${run.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [run]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f6f8fb] text-slate-950 dark:bg-background dark:text-foreground">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-3 shadow-sm dark:border-border dark:bg-card">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Network className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">多 Agent 对话协作</h2>
              <p className="truncate text-xs text-slate-500 dark:text-muted-foreground">{selectedProject.displayName || 'AIWork'}</p>
            </div>
            {run?.status && <StatusPill status={run.status} />}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <input
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            className="h-9 min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none transition focus:border-blue-400 focus:bg-white dark:border-border dark:bg-background dark:focus:border-primary"
          />
          <select
            value={runtimeMode}
            onChange={(event) => setRuntimeMode(event.target.value as 'coordinator-subagents' | 'local-control-plane')}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 dark:border-border dark:bg-background"
          >
            <option value="coordinator-subagents">真实 Subagent</option>
            <option value="local-control-plane">Local Stub</option>
          </select>
          <button type="button" onClick={startRun} disabled={isBusy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60">
            <Play className="h-3.5 w-3.5" />
            Dispatch
          </button>
          {run?.id && (
            <>
              <button type="button" onClick={() => void refreshRun(run.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-border dark:bg-background dark:text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
              <button type="button" disabled={isBusy} onClick={() => void controlRun('reconcile-run')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-border dark:bg-background dark:text-muted-foreground">
                Reconcile
              </button>
              <button type="button" onClick={exportRun} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-border dark:bg-background dark:text-muted-foreground">
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 lg:p-5">
        {error && (
          <div className="mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(360px,520px)_110px_minmax(520px,1fr)]">
          <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-border/70">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold">{collaboration.orchestrator.label}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-600">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    {isOnlineStatus(collaboration.orchestrator.status) ? '在线' : '离线'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <Star className="h-4 w-4 text-amber-400" />
                <MoreVertical className="h-4 w-4" />
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {collaboration.orchestrator.timeline.map((item, index) => {
                const isUser = item.kind === 'user_request';
                return (
                  <div key={`${item.kind}-${index}`} className="flex gap-3">
                    <span className={`mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${isUser ? 'bg-gradient-to-br from-cyan-500 to-blue-600' : 'bg-blue-600'} text-white`}>
                      {isUser ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        <span>{item.title}</span>
                        {run?.events?.[index]?.createdAt && (
                          <span className="text-xs font-normal text-slate-400">{formatTime(run.events[index].createdAt)}</span>
                        )}
                      </div>
                      <div className={`mt-2 max-w-full whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-6 ${isUser ? 'bg-slate-100 text-slate-800 dark:bg-muted dark:text-foreground' : item.kind === 'summary' ? 'border border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'text-slate-800 dark:text-foreground'}`}>
                        {item.content}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 p-4 dark:border-border/70">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-border dark:bg-background">
                <select
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  className="h-9 max-w-[150px] rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 dark:border-border dark:bg-card"
                >
                  <option value="">主Agent</option>
                  {(run?.agents || []).map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.label || agent.roleId}</option>
                  ))}
                </select>
                <input
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  placeholder="输入消息给主Agent，或 @ 提及子Agent"
                  className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                />
                <button type="button" disabled={!run?.id || !messageDraft.trim() || isBusy} onClick={publishMessage} className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-60">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          <div className="hidden min-w-0 flex-col gap-3 pt-16 xl:flex">
            {(collaboration.agentCards.length ? collaboration.agentCards : Array.from({ length: 3 }, (_unused, index) => ({ id: `placeholder-${index}`, lane: { index, dispatchLabel: '任务分发', returnLabel: '结果回传' } }))).map((card) => (
              <div key={card.id} className="flex min-h-[170px] flex-col justify-center gap-6">
                <div className="relative flex items-center justify-center">
                  <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-blue-500" />
                  <span className="relative bg-[#f6f8fb] px-2 text-xs font-medium text-blue-600 dark:bg-background">{card.lane.dispatchLabel}</span>
                  <span className="absolute -right-1 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent border-l-blue-500" />
                </div>
                <div className="relative flex items-center justify-center">
                  <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-emerald-500" />
                  <span className="relative bg-[#f6f8fb] px-2 text-xs font-medium text-emerald-600 dark:bg-background">{card.lane.returnLabel}</span>
                  <span className="absolute -left-1 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-r-[8px] border-y-transparent border-r-emerald-500" />
                </div>
              </div>
            ))}
          </div>

          <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
            {collaboration.agentCards.map((card) => {
              const Icon = agentIcon(card.roleId, card.label);
              const agent = (run?.agents || []).find((candidate) => candidate.id === card.id);
              return (
                <article key={card.id} className="min-h-[170px] min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-border dark:bg-card">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${agentTone(card.roleId, card.label)} text-white`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold">{card.label}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-600">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          {isOnlineStatus(card.status) ? '在线' : '离线'}
                        </div>
                      </div>
                    </div>
                    <MoreVertical className="h-4 w-4 text-slate-400" />
                  </div>

                  <div className="mt-4 grid gap-3 text-sm">
                    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                      <div className="text-xs text-slate-500">{formatTime(card.receivedAt) || '--:--'}</div>
                      <div className="min-w-0 rounded-lg bg-blue-50 px-3 py-2 text-slate-700 dark:bg-blue-950/30 dark:text-blue-100">
                        <span className="break-words">{card.taskText}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                      <div className="text-xs text-slate-500">{formatTime(card.resultAt) || '--:--'}</div>
                      <div className="min-w-0">
                        <div className="mb-1 text-xs font-semibold text-emerald-600">{card.resultTitle}</div>
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                          <div className="flex gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span className="break-words">{card.resultText}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-border/70">
                    <div className="min-w-0 font-mono text-[11px] text-slate-400">
                      <span className="block truncate">{card.taskId || card.threadId || card.status}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" disabled={isBusy || !agent?.taskId} onClick={() => agent && void controlRun('wait-agent', agent)} className="h-7 rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-border dark:text-muted-foreground">Wait</button>
                      <button type="button" disabled={isBusy || !agent?.taskId || !messageDraft.trim()} onClick={() => agent && void controlRun('send-agent', agent, { content: messageDraft.trim() })} className="h-7 rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-border dark:text-muted-foreground">Send</button>
                      <button type="button" disabled={isBusy || !agent?.taskId || !messageDraft.trim()} onClick={() => agent && void controlRun('followup-agent', agent, { objective: messageDraft.trim() })} className="h-7 rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-border dark:text-muted-foreground">Followup</button>
                      <button type="button" disabled={isBusy || !agent?.taskId} onClick={() => agent && void controlRun('stop-agent', agent)} className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-border dark:text-muted-foreground">
                        <Square className="h-3 w-3" />
                        Stop
                      </button>
                    </div>
                    {agent?.lastControl && (
                      <div className="basis-full break-words text-[11px] text-slate-500">last control: {formatLastControl(agent.lastControl)}</div>
                    )}
                  </div>
                </article>
              );
            })}
            {collaboration.agentCards.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-16 text-center text-sm text-slate-500 dark:border-border dark:bg-card dark:text-muted-foreground">
                Dispatch a swarm to see child Agent work cards.
              </div>
            )}
          </section>
        </div>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(320px,420px)]">
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-border/70">
              <h3 className="text-sm font-semibold">Recent runs</h3>
              <button type="button" onClick={() => void loadRuns().catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Failed to load swarm runs'))} className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 dark:border-border dark:text-muted-foreground">
                <RefreshCw className="h-3 w-3" />
                Reload
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {runs.map((item) => (
                <button key={item.id} type="button" onClick={() => void resumeRun(item.id)} className={`mb-1.5 block w-full rounded-lg border px-2 py-2 text-left text-xs transition hover:bg-slate-50 dark:hover:bg-muted ${run?.id === item.id ? 'border-blue-300 bg-blue-50 dark:border-primary dark:bg-primary/10' : 'border-slate-200 bg-white dark:border-border dark:bg-background'}`}>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{item.templateId || item.id}</span>
                    <StatusPill status={item.runtimeStatus || item.status} />
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-slate-500">{item.id}</div>
                </button>
              ))}
              {runs.length === 0 && <div className="px-2 py-8 text-center text-xs text-slate-500">No persisted runs yet.</div>}
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-border/70">
              <h3 className="text-sm font-semibold">Message inspector</h3>
              <div className="flex flex-wrap items-center gap-2">
                <select value={selectedMessageId} onChange={(event) => setSelectedMessageId(event.target.value)} className="h-7 max-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 dark:border-border dark:bg-background">
                  <option value="">Select message</option>
                  {(run?.messages || []).map((message) => (
                    <option key={message.id} value={message.id}>{message.type} / {message.status}</option>
                  ))}
                </select>
                <button type="button" disabled={!run?.id || isBusy} onClick={() => void replayMessage(null)} className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-border dark:text-muted-foreground">Replay dead letters</button>
              </div>
            </div>
            <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
              <div className="min-w-0">
                {selectedMessage ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-border dark:bg-background">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{selectedMessage.type}</span>
                      <StatusPill status={selectedMessage.status} />
                    </div>
                    <div className="mt-2 grid gap-1 text-[11px] text-slate-500">
                      <div className="break-all font-mono">{selectedMessage.id}</div>
                      <div>attempts {selectedMessage.deliveryAttempts || selectedMessage.attempts || 0} / failures {traceSummary.attemptCount}</div>
                      <div>last status {traceSummary.lastStatus}</div>
                      {selectedMessage.correlationId && <div className="break-all">correlation {selectedMessage.correlationId}</div>}
                      {selectedMessage.causationId && <div className="break-all">causation {selectedMessage.causationId}</div>}
                      {traceSummary.lastError && <div className="break-words text-red-600">last error {traceSummary.lastError}</div>}
                    </div>
                    <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-2 text-[11px] text-slate-600 dark:bg-card dark:text-muted-foreground">
                      {payloadPreview(selectedMessage.payload)}
                    </pre>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-10 text-center text-xs text-slate-500 dark:border-border">Select a message.</div>
                )}
              </div>
              <div className="max-h-64 min-w-0 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-border dark:bg-background">
                {messageTrace.map((entry) => (
                  <div key={entry.id} className="mb-1.5 rounded-md bg-white px-2 py-1.5 text-[11px] text-slate-600 shadow-sm dark:bg-card dark:text-muted-foreground">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{formatTime(Number(entry.createdAt) || undefined)}</span>
                      <span>{entry.status}</span>
                    </div>
                    {entry.agentId && <div className="mt-1 break-all font-mono">{entry.agentId}</div>}
                    {entry.error && <div className="mt-1 break-words text-red-600">{entry.error}</div>}
                  </div>
                ))}
                {messageTrace.length === 0 && <div className="px-2 py-8 text-center text-xs text-slate-500">No trace records.</div>}
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-border/70">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Search events" className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none" />
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {filteredEvents.map((event) => (
                <div key={event.id} className="mb-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-border dark:bg-background">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{event.type}</span>
                    <span className="text-[11px] text-slate-500">{formatTime(Number(event.createdAt) || undefined)}</span>
                  </div>
                  <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-500">
                    {JSON.stringify((event.payload || {}) as Record<string, unknown>, null, 2)}
                  </pre>
                </div>
              ))}
              {filteredEvents.length === 0 && (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-slate-500">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  No matching events.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-border/70">
              <h3 className="text-sm font-semibold">Run control</h3>
            </div>
            <div className="grid gap-3 p-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!run?.id || isBusy} onClick={() => void controlRun('pause')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-border dark:text-muted-foreground"><Pause className="h-3.5 w-3.5" />Pause</button>
                <button type="button" disabled={!run?.id || isBusy} onClick={() => void controlRun('resume')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-border dark:text-muted-foreground"><Play className="h-3.5 w-3.5" />Resume</button>
                <button type="button" disabled={!run?.id || isBusy} onClick={() => void controlRun('cancel')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-border dark:text-muted-foreground"><Square className="h-3.5 w-3.5" />Cancel</button>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-background dark:text-muted-foreground">
                <div>{summary.agentCount} agents / {summary.runningAgents} running / {summary.degradedAgents} degraded</div>
                <div className="mt-1">{summary.messageCount} messages / {summary.pendingMessages} pending / {summary.deadLetteredMessages} dead letters</div>
                <div className="mt-1 break-all font-mono">{summary.runtimeMode} / {summary.runtimeStatus}{summary.coordinatorSessionId ? ` / ${summary.coordinatorSessionId}` : ''}</div>
                {selectedAgent && <div className="mt-2 break-words">Selected: {selectedAgent.label || selectedAgent.roleId}</div>}
              </div>
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-border dark:bg-background">
                <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-muted-foreground">Template JSON</summary>
                <textarea value={manifestText} onChange={(event) => setManifestText(event.target.value)} spellCheck={false} className="mt-2 h-56 w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-2 font-mono text-[11px] outline-none focus:border-blue-400 dark:border-border dark:bg-card" />
              </details>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-border/70">
              <h3 className="text-sm font-semibold">Run memory</h3>
            </div>
            <div className="grid gap-3 p-3 lg:grid-cols-[minmax(240px,340px)_minmax(0,1fr)]">
              <div className="grid gap-2">
                <select value={memoryDraft.scope} onChange={(event) => setMemoryDraft((current) => ({ ...current, scope: event.target.value }))} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 dark:border-border dark:bg-background">
                  <option value="facts">facts</option>
                  <option value="decisions">decisions</option>
                  <option value="artifacts">artifacts</option>
                  <option value="role-notes">role-notes</option>
                </select>
                <input value={memoryDraft.title} onChange={(event) => setMemoryDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Title" className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 dark:border-border dark:bg-background" />
                <textarea value={memoryDraft.content} onChange={(event) => setMemoryDraft((current) => ({ ...current, content: event.target.value }))} placeholder="Fact, decision, artifact, or role note" className="min-h-20 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-blue-400 dark:border-border dark:bg-background" />
                <button type="button" disabled={!run?.id || !memoryDraft.content.trim() || isBusy} onClick={createMemory} className="inline-flex h-8 items-center justify-center rounded-md bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-60">Save memory</button>
              </div>
              <div className="grid max-h-64 gap-2 overflow-y-auto">
                {memoryItems.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-border dark:bg-background">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="break-words font-medium">{entry.title}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">{entry.scope}</div>
                      </div>
                      <button type="button" disabled={isBusy} onClick={() => void deleteMemory(entry.id)} className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-border dark:bg-card dark:text-muted-foreground">Delete</button>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-600 dark:text-muted-foreground">{entry.content}</div>
                  </div>
                ))}
                {memoryItems.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 px-3 py-8 text-center text-xs text-slate-500 dark:border-border">No run memory yet.</div>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
