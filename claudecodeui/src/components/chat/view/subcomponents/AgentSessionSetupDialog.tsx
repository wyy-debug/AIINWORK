import { Bot, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { AgentAppBinding, AgentConfig } from '../../../../types/agent';
import { cn } from '../../../../lib/utils';

type AgentSessionSetupDialogProps = {
  agent: AgentConfig;
  initialBindings?: AgentAppBinding[];
  isLoading?: boolean;
  onCancel: () => void;
  onConfirm: (bindings: AgentAppBinding[]) => void;
};

type SlotDraft = {
  slot: string;
  app: string;
  status: AgentAppBinding['status'];
};

const COMMON_APPS_BY_SLOT: Array<{ match: RegExp; apps: string[] }> = [
  { match: /高级|工具|mcp|tool/i, apps: ['自定义 MCP'] },
];

function getSlotOptions(slot: string, currentApp: string, allBindings: AgentAppBinding[]) {
  const options = new Set<string>();
  if (currentApp) options.add(currentApp);
  for (const binding of allBindings) {
    if (binding.slot === slot && binding.app) {
      options.add(binding.app);
    }
  }
  for (const group of COMMON_APPS_BY_SLOT) {
    if (group.match.test(slot)) {
      for (const app of group.apps) options.add(app);
    }
  }
  return Array.from(options);
}

function createSlotDrafts(agent: AgentConfig, initialBindings?: AgentAppBinding[]): SlotDraft[] {
  const source = initialBindings && initialBindings.length > 0 ? initialBindings : agent.appBindings;
  const bySlot = new Map<string, SlotDraft>();
  for (const binding of source) {
    if (!binding.slot || bySlot.has(binding.slot)) continue;
    bySlot.set(binding.slot, {
      slot: binding.slot,
      app: binding.app || '',
      status: binding.status || 'optional',
    });
  }
  return Array.from(bySlot.values());
}

export default function AgentSessionSetupDialog({
  agent,
  initialBindings,
  isLoading,
  onCancel,
  onConfirm,
}: AgentSessionSetupDialogProps) {
  const initialDrafts = useMemo(() => createSlotDrafts(agent, initialBindings), [agent, initialBindings]);
  const [drafts, setDrafts] = useState<SlotDraft[]>(initialDrafts);
  const canConfirm = drafts.every((draft) => draft.app.trim());

  const updateDraft = (slot: string, app: string) => {
    setDrafts((previous) => previous.map((draft) => (
      draft.slot === slot ? { ...draft, app } : draft
    )));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[520px] rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-foreground">{agent.name} 设置</h3>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                选择这个 Agent 在当前对话中使用的应用槽位。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          {drafts.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
              这个 Agent 没有需要配置的槽位，可以直接使用。
            </div>
          ) : (
            drafts.map((draft) => {
              const options = getSlotOptions(draft.slot, draft.app, agent.appBindings);
              return (
                <label key={draft.slot} className="grid gap-2 sm:grid-cols-[132px_1fr] sm:items-center">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{draft.slot}</span>
                  <select
                    value={draft.app}
                    onChange={(event) => updateDraft(draft.slot, event.target.value)}
                    className={cn(
                      'h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary',
                      !draft.app && 'text-muted-foreground',
                    )}
                  >
                    <option value="">选择应用</option>
                    {options.map((app) => (
                      <option key={`${draft.slot}:${app}`} value={app}>
                        {app}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canConfirm || isLoading}
            onClick={() => onConfirm(drafts.map((draft) => ({
              slot: draft.slot,
              app: draft.app,
              status: draft.status,
            })))}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            启用 Agent
          </button>
        </div>
      </div>
    </div>
  );
}
