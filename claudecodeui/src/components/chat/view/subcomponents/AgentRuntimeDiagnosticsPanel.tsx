import {
  BotIcon,
  BracesIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';

import type { AgentAppBinding } from '../../../../types/agent';
import type { AgentRuntimeDiagnostics } from '../../types/types';

type AgentRuntimeDiagnosticsPanelProps = {
  diagnostics: AgentRuntimeDiagnostics | null;
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

function StringBadges({ values, emptyText = EMPTY_TEXT, tone = 'neutral' }: {
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

export default function AgentRuntimeDiagnosticsPanel({
  diagnostics,
  onClose,
}: AgentRuntimeDiagnosticsPanelProps) {
  const permissions = diagnostics?.permissions;
  const hasDiagnostics = Boolean(diagnostics);

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BracesIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Agent 运行诊断</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              只显示最近一次发送给后端的 Agent / Skill / MCP 运行配置。
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
          还没有运行诊断。发送第一条 Agent 或 Skill 消息后，这里会显示后端实际收到的配置。
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Agent ID" value={formatText(diagnostics?.agentId)} />
            <Field label="Agent 名称" value={formatText(diagnostics?.agentName)} />
            <Field label="模型" value={formatText(diagnostics?.model)} />
            <Field label="上下文 tokens" value={formatNumber(diagnostics?.contextWindowTokens)} />
            <Field label="Provider" value={formatText(diagnostics?.provider)} />
            <Field label="Session ID" value={formatText(diagnostics?.sessionId)} />
            <Field label="Project Path" value={formatText(diagnostics?.projectPath)} />
            <Field label="追加 Prompt 长度" value={formatNumber(diagnostics?.appendSystemPromptLength)} />
          </div>

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
                    MCP 工具列表由 MTL-Code 原生 runtime 在会话启动后发现；这里显示的是已绑定的配置引用。
                  </p>
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
          </section>
        </div>
      )}
    </div>
  );
}
