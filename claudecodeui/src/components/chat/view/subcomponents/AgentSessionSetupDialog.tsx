import { Bot, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { AgentAppBinding, AgentConfig } from '../../../../types/agent';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';

type AgentSessionSetupDialogProps = {
  agent: AgentConfig;
  initialBindings?: AgentAppBinding[];
  workspacePath?: string;
  isLoading?: boolean;
  onCancel: () => void;
  onConfirm: (bindings: AgentAppBinding[]) => void;
};

type SlotDraft = {
  slot: string;
  app: string;
  status: AgentAppBinding['status'];
};

type McpServerOption = {
  key: string;
  value: string;
  label: string;
};

const MCP_SLOT_PATTERN = /高级|工具|mcp|tool/i;
const CUSTOM_MCP_PLACEHOLDER_PATTERN = /自定义\s*MCP|custom\s*MCP/i;

function isMcpSlot(slot: string) {
  return MCP_SLOT_PATTERN.test(slot);
}

function isCustomMcpPlaceholder(app: string) {
  return CUSTOM_MCP_PLACEHOLDER_PATTERN.test(app);
}

function getMcpBindingAppName(serverName: string) {
  return `MCP: ${serverName}`;
}

function readMcpServersFromResponse(data: unknown) {
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const nestedData = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
  const servers = Array.isArray(nestedData.servers)
    ? nestedData.servers
    : Array.isArray(payload.servers)
      ? payload.servers
      : [];

  return servers
    .map((server) => (server && typeof server === 'object' ? server as Record<string, unknown> : null))
    .filter((server): server is Record<string, unknown> => Boolean(server && typeof server.name === 'string' && server.name.trim()));
}

function createMcpServerOption(server: Record<string, unknown>, fallbackScope: 'user' | 'project'): McpServerOption {
  const name = String(server.name || '').trim();
  const scope = server.scope === 'project' ? 'project' : fallbackScope;
  const transport = typeof server.transport === 'string' ? server.transport : 'stdio';
  const target = typeof server.command === 'string'
    ? server.command
    : typeof server.url === 'string'
      ? server.url
      : transport;
  const value = getMcpBindingAppName(name);
  return {
    key: `${scope}:${server.workspacePath || 'user'}:${name}`,
    value,
    label: `${value} · ${scope} · ${transport}${target ? ` · ${target}` : ''}`,
  };
}

function getSlotOptions(
  slot: string,
  currentApp: string,
  allBindings: AgentAppBinding[],
  mcpOptions: McpServerOption[],
) {
  const options = new Set<string>();
  if (currentApp && !isCustomMcpPlaceholder(currentApp)) options.add(currentApp);
  for (const binding of allBindings) {
    if (binding.slot === slot && binding.app && !isCustomMcpPlaceholder(binding.app)) {
      options.add(binding.app);
    }
  }
  if (isMcpSlot(slot)) {
    for (const option of mcpOptions) options.add(option.value);
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
      app: isCustomMcpPlaceholder(binding.app || '') ? '' : binding.app || '',
      status: binding.status || 'optional',
    });
  }
  return Array.from(bySlot.values());
}

export default function AgentSessionSetupDialog({
  agent,
  initialBindings,
  workspacePath = '',
  isLoading,
  onCancel,
  onConfirm,
}: AgentSessionSetupDialogProps) {
  const initialDrafts = useMemo(() => createSlotDrafts(agent, initialBindings), [agent, initialBindings]);
  const [drafts, setDrafts] = useState<SlotDraft[]>(initialDrafts);
  const [mcpOptions, setMcpOptions] = useState<McpServerOption[]>([]);
  const [isLoadingMcpOptions, setIsLoadingMcpOptions] = useState(false);
  const [mcpOptionsError, setMcpOptionsError] = useState('');
  const needsMcpOptions = useMemo(() => drafts.some((draft) => isMcpSlot(draft.slot)), [drafts]);
  const canConfirm = drafts.every((draft) => {
    const app = draft.app.trim();
    if (!app) return false;
    return !(isMcpSlot(draft.slot) && isCustomMcpPlaceholder(app));
  });

  useEffect(() => {
    setDrafts(initialDrafts);
  }, [initialDrafts]);

  useEffect(() => {
    if (!needsMcpOptions) {
      setMcpOptions([]);
      setMcpOptionsError('');
      return undefined;
    }

    let cancelled = false;
    const loadMcpOptions = async () => {
      setIsLoadingMcpOptions(true);
      setMcpOptionsError('');
      try {
        const requests: Array<Promise<McpServerOption[]>> = [
          api.mcpServers('claude', 'user').then(async (response) => {
            const data = await response.json();
            if (!response.ok || data?.success === false) {
              throw new Error(data?.error?.message || data?.error || data?.details || 'Failed to load user MCP servers');
            }
            return readMcpServersFromResponse(data).map((server) => createMcpServerOption(server, 'user'));
          }),
        ];

        if (workspacePath) {
          requests.push(api.mcpServers('claude', 'project', workspacePath).then(async (response) => {
            const data = await response.json();
            if (!response.ok || data?.success === false) {
              throw new Error(data?.error?.message || data?.error || data?.details || 'Failed to load project MCP servers');
            }
            return readMcpServersFromResponse(data).map((server) => createMcpServerOption(server, 'project'));
          }));
        }

        const batches = await Promise.all(requests);
        if (cancelled) return;

        const seen = new Set<string>();
        const nextOptions = batches.flat().filter((option) => {
          const key = option.value.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setMcpOptions(nextOptions);
      } catch (error) {
        if (cancelled) return;
        setMcpOptions([]);
        setMcpOptionsError(error instanceof Error ? error.message : 'Failed to load MCP servers');
      } finally {
        if (!cancelled) setIsLoadingMcpOptions(false);
      }
    };

    void loadMcpOptions();
    return () => {
      cancelled = true;
    };
  }, [needsMcpOptions, workspacePath]);

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
              const options = getSlotOptions(draft.slot, draft.app, agent.appBindings, mcpOptions);
              const optionLabels = new Map(mcpOptions.map((option) => [option.value, option.label]));
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
                        {optionLabels.get(app) || app}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })
          )}
        </div>

        {needsMcpOptions && (
          <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <p>
              {isLoadingMcpOptions
                ? 'Loading configured MCP servers...'
                : mcpOptionsError
                  ? mcpOptionsError
                  : mcpOptions.length === 0
                    ? 'No configured MCP server was found. Add one in Agent Builder > Browse App > Custom MCP first.'
                    : 'MCP slots use configured MCP servers from your provider settings.'}
            </p>
            <p className="mt-1">
              工具列表会在会话启动后由 MTL-Code 原生 runtime 发现；这里绑定的是具体 MCP Server 配置。
            </p>
          </div>
        )}

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
