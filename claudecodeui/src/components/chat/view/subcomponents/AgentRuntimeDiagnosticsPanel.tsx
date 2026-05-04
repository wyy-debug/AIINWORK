import {
  BotIcon,
  BrainCircuitIcon,
  BracesIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  GaugeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';

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

const EMPTY_TEXT = '暂无';

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

function StringBadges({
  values,
  emptyText = EMPTY_TEXT,
  tone = 'neutral',
}: {
  values?: string[];
  emptyText?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  if (!values || values.length === 0) {
    return <span className="text-muted-foreground">{emptyText}</span>;
  }

  const toneClass = {
    neutral: 'border-border bg-muted/45 text-foreground',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
    danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
  }[tone];

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className={`inline-flex max-w-[220px] truncate rounded-md border px-2 py-1 text-xs ${toneClass}`}>
          {value}
        </span>
      ))}
    </div>
  );
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

function SkillDetails({ details }: { details?: AgentRuntimeDiagnostics['skillDetails'] }) {
  if (!details || details.length === 0) {
    return <span className="text-muted-foreground">{EMPTY_TEXT}</span>;
  }

  return (
    <div className="space-y-2">
      {details.map((detail) => {
        const statusText = detail.callable ? '已可调用' : detail.exists ? '已安装' : '不可用';
        const statusClass = detail.callable
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
          : detail.exists
            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
            : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300';
        return (
          <div key={`${detail.name}:${detail.path || 'missing'}`} className="rounded-lg border border-border bg-card/70 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-foreground" title={detail.label || detail.name}>
                  {detail.label || detail.name}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={detail.path || 'SKILL.md 未找到'}>
                  {detail.path || 'SKILL.md 未找到'}
                </div>
              </div>
              <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusClass}`}>
                {statusText}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              <span>{detail.provider || 'unknown'} / {detail.scope || 'unknown'}</span>
              <span>prompt {formatNumber(detail.promptLength)}</span>
              {detail.unavailableReason && <span className="text-amber-600 dark:text-amber-300">{detail.unavailableReason}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type PermissionSourceMap = NonNullable<NonNullable<AgentRuntimeDiagnostics['permissions']>['sources']>;

function PermissionSources({ sources }: { sources?: PermissionSourceMap }) {
  if (!sources || Object.keys(sources).length === 0) {
    return <span className="text-muted-foreground">{EMPTY_TEXT}</span>;
  }

  return (
    <div className="grid gap-2 lg:grid-cols-3">
      {(['global', 'project', 'session'] as const).map((key) => {
        const value = sources[key];
        if (!value || Object.keys(value).length === 0) return null;
        return (
          <div key={key} className="rounded-lg border border-border bg-card/70 p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{key}</div>
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] leading-4 text-foreground">
              {JSON.stringify(value, null, 2)}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function OpenMythosRuntimeSection({
  runtime,
}: {
  runtime: AgentRuntimeDiagnostics['openMythosRuntime'];
}) {
  const card = runtime?.runtimeCard;
  const contextCache = runtime?.contextCache;
  const expertRoutes = card?.expertRoutes?.map((route) => (
    `${route.label || route.kind || 'expert'}${route.required ? ' (required)' : ''}${route.reason ? `: ${route.reason}` : ''}`
  ));
  const workerAssignments = card?.workerPlan?.assignments?.map((task) => (
    `${task.label || task.role || task.kind || 'worker'}${task.required ? ' (必需)' : ''}${task.description ? `: ${task.description}` : ''}`
  ));
  const configuredAutoDispatchSubagents = runtime
    ? runtime.configuredAutoDispatchSubagents
      ?? (runtime.dispatchConfirmation?.mode === 'single-agent'
        ? true
        : runtime.autoDispatchSubagents !== false)
    : false;
  const effectiveAutoDispatchSubagents = runtime
    ? runtime.effectiveAutoDispatchSubagents
      ?? (runtime.dispatchConfirmation?.mode === 'single-agent'
        ? false
        : configuredAutoDispatchSubagents)
    : false;
  const autoDispatchStatus = !runtime
    ? EMPTY_TEXT
    : configuredAutoDispatchSubagents
      ? effectiveAutoDispatchSubagents
        ? '开启'
        : '设置开启，本轮单 Agent'
      : '关闭';

  return (
    <section className="mt-4 rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <BrainCircuitIcon className="h-4 w-4 text-primary" />
        OpenMythos 运行时
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="已启用" value={formatBoolean(runtime?.enabled)} />
        <Field label="自适应推理" value={formatBoolean(runtime?.adaptiveEffort)} />
        <Field label="冻结任务卡" value={formatBoolean(runtime?.taskCard)} />
        <Field label="路由提示" value={formatBoolean(runtime?.routingHints)} />
        <Field label="循环控制" value={formatText(runtime?.loopControl)} />
        <Field label="稳定重注入" value={formatBoolean(runtime?.stableReinjection)} />
        <Field label="阶段适配" value={formatBoolean(runtime?.phaseAdapter)} />
        <Field label="专家路由" value={formatBoolean(runtime?.expertRouting)} />
        <Field label="缓存诊断" value={formatBoolean(runtime?.contextCacheDiagnostics)} />
        <Field label="自动派发" value={autoDispatchStatus} />
        <Field label="最低派发强度" value={formatText(runtime?.autoDispatchMinEffort)} />
        <Field label="最大 worker 数" value={formatNumber(runtime?.autoDispatchMaxWorkers)} />
        <Field label="最低 effort" value={formatText(runtime?.minEffort)} />
        <Field label="最高 effort" value={formatText(runtime?.maxEffort)} />
        <Field label="来源" value={runtime ? 'settings/env' : EMPTY_TEXT} />
      </div>

      {card && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card/70 p-3">
            <div className="text-[11px] font-medium uppercase text-muted-foreground">运行时卡片</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="effort" value={formatText(card.effort)} />
              <Field label="loopBudget" value={formatNumber(card.loopBudget)} />
              <Field label="remainingBudget" value={formatNumber(card.remainingBudget)} />
              <Field label="riskScore" value={formatNumber(card.riskScore)} />
              <Field label="phase" value={formatText(card.phase)} />
              <Field label="phasePlan" value={card.phasePlan?.join(' → ') || EMPTY_TEXT} />
            </div>
            <div className="mt-3 text-xs leading-5 text-muted-foreground">
              {card.goal || EMPTY_TEXT}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card/70 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">专家 / 上下文账本</div>
            <StringBadges values={expertRoutes} />
            <div className="mt-3 text-[11px] font-medium uppercase text-muted-foreground">自动派发计划</div>
            <div className="mt-2">
              <StringBadges values={workerAssignments} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Field label="compactBoundary" value={formatNumber(contextCache?.compactBoundaryCount)} />
              <Field label="microcompact" value={formatNumber(contextCache?.microcompactBoundaryCount)} />
              <Field label="skill prompt" value={formatNumber(contextCache?.skillPromptLength)} />
              <Field label="append prompt" value={formatNumber(contextCache?.appendSystemPromptLength)} />
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/45 px-2 py-1 text-xs text-foreground">
          <GaugeIcon className="h-3 w-3 text-primary" />
          自适应推理 {runtime?.adaptiveEffort ? '开启' : '关闭'}
        </span>
        <span className="inline-flex rounded-md border border-border bg-muted/45 px-2 py-1 text-xs text-foreground">
          循环 {runtime?.loopControl || 'unknown'}
        </span>
        <span className="inline-flex rounded-md border border-border bg-muted/45 px-2 py-1 text-xs text-foreground">
          稳定重注入 {runtime?.stableReinjection ? '开启' : '关闭'}
        </span>
        <span className="inline-flex rounded-md border border-border bg-muted/45 px-2 py-1 text-xs text-foreground">
          自动派发 {autoDispatchStatus}
        </span>
      </div>
    </section>
  );
}

export default function AgentRuntimeDiagnosticsPanel({
  diagnostics,
  contextBudget,
  onClose,
}: AgentRuntimeDiagnosticsPanelProps) {
  const permissions = diagnostics?.permissions;
  const hasDiagnostics = Boolean(diagnostics);
  const contextWindow = contextBudget?.window.tokens ?? diagnostics?.contextWindowTokens;

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BracesIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">运行诊断</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              只显示最近一次发送给后端的 Argus / Skill / MCP / OpenMythos 运行配置。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="关闭诊断"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {!hasDiagnostics ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          还没有运行诊断。发送第一条消息后，这里会显示后端实际收到的运行配置。
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Agent ID" value={formatText(diagnostics?.agentId)} />
            <Field label="Agent 名称" value={formatText(diagnostics?.agentName)} />
            <Field label="模型" value={formatText(diagnostics?.model)} />
            <Field label="模型 Profile" value={formatText(diagnostics?.modelProfileId)} />
            <Field label="上下文窗口" value={contextWindow ? formatTokenCount(contextWindow) : EMPTY_TEXT} />
            <Field label="当前占用" value={contextBudget ? `${formatTokenCount(contextBudget.current.used)} (${contextBudget.current.percent.toFixed(2)}%)` : EMPTY_TEXT} />
            <Field label="累计消耗" value={contextBudget ? formatTokenCount(contextBudget.cumulative.used) : EMPTY_TEXT} />
            <Field label="窗口来源" value={formatText(contextBudget?.window.source)} />
            <Field label="Provider" value={formatText(diagnostics?.provider)} />
            <Field label="Session ID" value={formatText(diagnostics?.sessionId)} />
            <Field label="Project Path" value={formatText(diagnostics?.projectPath)} />
            <Field label="追加 Prompt 长度" value={formatNumber(diagnostics?.appendSystemPromptLength)} />
          </div>

          <OpenMythosRuntimeSection runtime={diagnostics?.openMythosRuntime} />

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-background/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <BotIcon className="h-4 w-4 text-primary" />
                Agent / 应用绑定
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
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    MCP 工具列表由 Argus 原生 runtime 在会话启动后发现；这里显示的是已绑定的配置引用。
                  </p>
                  {Array.isArray(diagnostics?.mcpDiagnosticsSummary) && diagnostics.mcpDiagnosticsSummary.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {diagnostics.mcpDiagnosticsSummary.map((item) => (
                        <div key={`${item.slot}:${item.serverName}`} className="rounded-md border border-border bg-card/70 px-2 py-1 text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{item.serverName || 'MCP'}</span>
                          <span className="ml-1">/ {item.slot || 'slot'}</span>
                          <span className="ml-1">/ {item.runtimeToolsStatus || 'runtime discovery'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-background/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <SparklesIcon className="h-4 w-4 text-primary" />
                Skill
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">sessionSkills</div>
                  <StringBadges values={diagnostics?.sessionSkills} />
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">effectiveSkills</div>
                  <StringBadges values={diagnostics?.effectiveSkills} tone="success" />
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">skillDetails</div>
                  <SkillDetails details={diagnostics?.skillDetails} />
                </div>
                <Field label="Skill prompt 长度" value={formatNumber(diagnostics?.skillPromptLength)} />
              </div>
            </section>
          </div>

          <section className="mt-3 rounded-lg border border-border bg-background/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheckIcon className="h-4 w-4 text-primary" />
              权限快照
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="permissionMode" value={formatText(permissions?.permissionMode)} />
              <Field label="skipPermissions" value={permissions?.skipPermissions ? 'true' : 'false'} />
              <Field label="bypass" value={permissions?.bypassPermissions ? 'true' : 'false'} />
              <Field label="诊断时间" value={formatText(diagnostics?.receivedAt)} />
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <CheckCircle2Icon className="h-3 w-3" />
                  allowedTools
                </div>
                <StringBadges values={permissions?.allowedTools} tone="success" />
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <DatabaseIcon className="h-3 w-3" />
                  disallowedTools
                </div>
                <StringBadges values={permissions?.disallowedTools} tone="danger" />
              </div>
            </div>
            {permissions?.conflicts && permissions.conflicts.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">权限冲突</div>
                <StringBadges values={permissions.conflicts} tone="warning" />
              </div>
            )}
            {permissions?.matchedRules && permissions.matchedRules.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">命中规则</div>
                <StringBadges values={permissions.matchedRules} tone="success" />
              </div>
            )}
            {permissions?.explanation && (
              <div className="mt-3 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {permissions.explanation}
              </div>
            )}
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">权限来源</div>
              <PermissionSources sources={permissions?.sources} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
