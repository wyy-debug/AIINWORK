import { useEffect, useMemo, useState } from 'react';
import {
  BotIcon,
  BrainCircuitIcon,
  BracesIcon,
  ClipboardIcon,
  GaugeIcon,
  SparklesIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';

import { apiFetch } from '../../../../utils/api';
import type { AgentAppBinding } from '../../../../types/agent';
import type { AgentRuntimeDiagnostics } from '../../types/types';
import {
  formatTokenCount,
  type ContextBudget,
} from '../../utils/contextBudget';

type AgentRuntimeDiagnosticsPanelProps = {
  diagnostics: AgentRuntimeDiagnostics | null;
  contextBudget?: ContextBudget | null;
  onClose: () => void;
};

type RuntimeTimelineEvent = {
  id: string;
  type: string;
  title: string;
  timestamp?: string;
  severity?: string;
  payload?: Record<string, unknown>;
};

type BrainDiagnostics = {
  enabled?: boolean;
  status?: string;
  latestCompaction?: {
    id?: string;
    mermaid?: string;
    summary?: string;
    currentGoal?: string;
    activeDecisions?: string[];
    openRisks?: string[];
    nextAction?: string;
    sourceEventCount?: number;
    tokenEstimate?: number;
    refs?: string[];
  } | null;
  compactedEventCount?: number;
  tokenReductionEstimate?: number;
  refs?: Array<{
    id: string;
    refType?: string;
    refId?: string;
    label?: string;
    checkpointId?: string;
    artifactId?: string;
    sizeBytes?: number;
  }>;
};

const EMPTY_TEXT = 'None';

function formatNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString();
  }
  return EMPTY_TEXT;
}

function formatText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : EMPTY_TEXT;
}

function formatBoolean(value: unknown) {
  return typeof value === 'boolean' ? String(value) : EMPTY_TEXT;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}
function StringBadges({
  values,
  emptyText = EMPTY_TEXT,
}: {
  values?: string[];
  emptyText?: string;
}) {
  if (!values || values.length === 0) {
    return <span className="text-muted-foreground">{emptyText}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className="inline-flex max-w-[260px] truncate rounded-md border border-border bg-muted/45 px-2 py-1 text-xs text-foreground">
          {value}
        </span>
      ))}
    </div>
  );
}

function BindingBadges({ bindings }: { bindings?: AgentAppBinding[] }) {
  if (!bindings || bindings.length === 0) {
    return <span className="text-muted-foreground">{EMPTY_TEXT}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {bindings.map((binding) => (
        <span
          key={`${binding.slot}:${binding.app}:${binding.status}`}
          className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-border bg-muted/45 px-2 py-1 text-xs"
          title={`${binding.slot}: ${binding.app} (${binding.status})`}
        >
          <span className="truncate font-medium text-foreground">{binding.app}</span>
          <span className="shrink-0 text-muted-foreground">/ {binding.slot}</span>
        </span>
      ))}
    </div>
  );
}

function BrainRuntimeSection({
  diagnostics,
  brain,
}: {
  diagnostics: AgentRuntimeDiagnostics | null;
  brain: BrainDiagnostics | null;
}) {
  const runtime = diagnostics?.brainRuntime;
  const compaction = brain?.latestCompaction;
  const recall = runtime?.recall;
  const activeDecisions = compaction?.activeDecisions || recall?.activeDecisions || [];
  const openRisks = compaction?.openRisks || recall?.openRisks || [];
  const summary = compaction?.summary || [
    compaction?.currentGoal || recall?.currentGoal,
    activeDecisions.join('\n'),
    openRisks.join('\n'),
    compaction?.nextAction || recall?.nextAction,
  ].filter(Boolean).join('\n');

  const copySummary = () => {
    if (summary) {
      void navigator.clipboard?.writeText(summary);
    }
  };

  return (
    <section className="mt-4 rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BrainCircuitIcon className="h-4 w-4 text-primary" />
          Argus Brain
        </div>
        <button
          type="button"
          onClick={copySummary}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Copy Brain summary"
        >
          <ClipboardIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Enabled" value={formatBoolean(runtime?.enabled ?? brain?.enabled)} />
        <Field label="Recall status" value={formatText(recall?.status || brain?.status)} />
        <Field label="Recall hits" value={formatNumber(recall?.recallHits?.length)} />
        <Field label="Raw refs" value={formatBoolean(runtime?.captureRawRefs)} />
        <Field label="Compacted events" value={formatNumber(brain?.compactedEventCount || compaction?.sourceEventCount)} />
        <Field label="Token reduction" value={formatNumber(brain?.tokenReductionEstimate)} />
        <Field label="Max injected tokens" value={formatNumber(runtime?.maxInjectedTokens)} />
        <Field label="Recall timeout ms" value={formatNumber(runtime?.recallTimeoutMs)} />
      </div>

      {runtime?.enabled === false || brain?.enabled === false ? (
        <div className="mt-3 rounded-md border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground">
          Argus Brain is disabled. Chat will skip capture, compaction, recall, and Brain diagnostics.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card/70 p-3">
            <div className="text-[11px] font-medium uppercase text-muted-foreground">Current goal</div>
            <p className="mt-2 text-xs leading-5 text-foreground">
              {formatText(compaction?.currentGoal || recall?.currentGoal)}
            </p>
            <div className="mt-3 text-[11px] font-medium uppercase text-muted-foreground">Next suggested action</div>
            <p className="mt-2 text-xs leading-5 text-foreground">
              {formatText(compaction?.nextAction || recall?.nextAction)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card/70 p-3">
            <div className="text-[11px] font-medium uppercase text-muted-foreground">Canvas</div>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/45 p-2 text-[11px] leading-4 text-foreground">
              {compaction?.mermaid || 'No compacted canvas yet.'}
            </pre>
          </div>
          <div className="rounded-lg border border-border bg-card/70 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">Active decisions</div>
            <StringBadges values={activeDecisions} />
          </div>
          <div className="rounded-lg border border-border bg-card/70 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">Open risks</div>
            <StringBadges values={openRisks} />
          </div>
          <div className="rounded-lg border border-border bg-card/70 p-3 lg:col-span-2">
            <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">Refs</div>
            {brain?.refs && brain.refs.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {brain.refs.slice(0, 12).map((ref) => (
                  <div key={ref.id} className="rounded-md border border-border bg-background/70 px-2 py-1.5 text-xs">
                    <div className="truncate font-medium text-foreground" title={ref.label || ref.refId || ref.id}>
                      {ref.label || ref.refId || ref.id}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {ref.refType || 'ref'} / {ref.checkpointId || ref.artifactId || ref.refId || ref.id}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">No raw refs captured yet.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SubagentRuntimeSection({
  subagents,
}: {
  subagents?: AgentRuntimeDiagnostics['subagents'];
}) {
  return (
    <section className="mt-4 rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <BotIcon className="h-4 w-4 text-primary" />
        Subagents
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Enabled" value={subagents?.enabled ? 'true' : 'false'} />
        <Field label="Max concurrent" value={formatNumber(subagents?.maxConcurrentThreadsPerSession)} />
        <Field label="Max depth" value={formatNumber(subagents?.maxDepth)} />
      </div>
    </section>
  );
}

export default function AgentRuntimeDiagnosticsPanel({
  diagnostics,
  contextBudget,
  onClose,
}: AgentRuntimeDiagnosticsPanelProps) {
  const hasDiagnostics = Boolean(diagnostics);
  const contextWindow = contextBudget?.window.tokens ?? diagnostics?.contextWindowTokens;
  const [timelineEvents, setTimelineEvents] = useState<RuntimeTimelineEvent[]>([]);
  const [brain, setBrain] = useState<BrainDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sessionId = diagnostics?.sessionId;
    if (!sessionId) {
      setTimelineEvents([]);
      setBrain(null);
      return;
    }
    const projectName = typeof diagnostics?.projectName === 'string' ? diagnostics.projectName : '';
    const params = new URLSearchParams({
      provider: diagnostics?.provider || 'claude',
      projectName,
    });
    void apiFetch(`/api/session-timeline/${encodeURIComponent(sessionId)}?${params.toString()}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled) {
          setTimelineEvents(Array.isArray(data?.timeline?.events) ? data.timeline.events : []);
        }
      })
      .catch(() => {
        if (!cancelled) setTimelineEvents([]);
      });
    void apiFetch(`/api/brain/session/${encodeURIComponent(sessionId)}?${params.toString()}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled) {
          setBrain(data?.brain || null);
        }
      })
      .catch(() => {
        if (!cancelled) setBrain(null);
      });
    return () => {
      cancelled = true;
    };
  }, [diagnostics?.provider, diagnostics?.projectName, diagnostics?.sessionId]);

  const brainTimelineCount = useMemo(
    () => timelineEvents.filter((event) => event.type === 'brain').length,
    [timelineEvents],
  );

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BracesIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Runtime Diagnostics</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Shows the last runtime payload, Argus Brain state, Subagents, permissions, and runtime timeline.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Close diagnostics"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {!hasDiagnostics ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No runtime diagnostics yet. Send a message first.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Agent ID" value={formatText(diagnostics?.agentId)} />
            <Field label="Agent Profile" value={formatText(diagnostics?.agentProfileKind || diagnostics?.agentProfile?.profileKind)} />
            <Field label="Agent name" value={formatText(diagnostics?.agentName)} />
            <Field label="Model" value={formatText(diagnostics?.model)} />
            <Field label="Model profile" value={formatText(diagnostics?.modelProfileId)} />
            <Field label="Context window" value={contextWindow ? formatTokenCount(contextWindow) : EMPTY_TEXT} />
            <Field label="Current context" value={contextBudget ? `${formatTokenCount(contextBudget.current.used)} (${contextBudget.current.percent.toFixed(2)}%)` : EMPTY_TEXT} />
            <Field label="Cumulative tokens" value={contextBudget ? formatTokenCount(contextBudget.cumulative.used) : EMPTY_TEXT} />
            <Field label="Provider" value={formatText(diagnostics?.provider)} />
            <Field label="Session ID" value={formatText(diagnostics?.sessionId)} />
            <Field label="Project Path" value={formatText(diagnostics?.projectPath)} />
            <Field label="Append prompt length" value={formatNumber(diagnostics?.appendSystemPromptLength)} />
          </div>

          <BrainRuntimeSection diagnostics={diagnostics} brain={brain} />
          <SubagentRuntimeSection subagents={diagnostics?.subagents} />

          <section className="mt-4 rounded-lg border border-border bg-background/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <GaugeIcon className="h-4 w-4 text-primary" />
              Runtime Timeline
            </div>
            <div className="mb-2 text-xs text-muted-foreground">
              Brain events in timeline: {brainTimelineCount}
            </div>
            {timelineEvents.length === 0 ? (
              <div className="text-xs text-muted-foreground">No runtime timeline events captured yet.</div>
            ) : (
              <div className="space-y-2">
                {timelineEvents.slice(-12).map((item) => (
                  <div key={item.id} className="rounded-md border border-border bg-card/70 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{item.title}</span>
                      <span className="shrink-0 text-muted-foreground">{item.type}</span>
                    </div>
                    {item.timestamp && <div className="mt-0.5 text-[11px] text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-background/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <BotIcon className="h-4 w-4 text-primary" />
                Agent and App Bindings
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">appBindings</div>
                  <BindingBadges bindings={diagnostics?.appBindings} />
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <WrenchIcon className="h-3 w-3" />
                    mcpBindings
                  </div>
                  <BindingBadges bindings={diagnostics?.mcpBindings} />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-background/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <SparklesIcon className="h-4 w-4 text-primary" />
                Skills
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">sessionSkills</div>
                  <StringBadges values={diagnostics?.sessionSkills} />
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">effectiveSkills</div>
                  <StringBadges values={diagnostics?.effectiveSkills} />
                </div>
                <Field label="Skill prompt length" value={formatNumber(diagnostics?.skillPromptLength)} />
              </div>
            </section>
          </div>

          <section className="mt-3 rounded-lg border border-border bg-background/60 p-3">
            <div className="mb-2 text-sm font-semibold text-foreground">Permissions</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Permission mode" value={formatText(diagnostics?.permissions?.permissionMode)} />
              <Field label="Skip permissions" value={formatBoolean(diagnostics?.permissions?.skipPermissions)} />
              <Field label="Bypass" value={formatBoolean(diagnostics?.permissions?.bypassPermissions)} />
              <Field label="Allowed tools" value={formatNumber(diagnostics?.permissions?.allowedTools?.length)} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}