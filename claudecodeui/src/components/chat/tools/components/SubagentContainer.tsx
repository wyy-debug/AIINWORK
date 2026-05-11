import React from 'react';

import type { ChatMessage } from '../../types/types';
import type { SubagentControlAction } from '../../utils/subagentControlRequest';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../../shared/view/ui';
import { getSubagentBlockerGuidance } from '../../utils/subagentGuidance';

import { CollapsibleSection } from './CollapsibleSection';

interface SubagentContainerProps {
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  subagentState: NonNullable<ChatMessage['subagentState']>;
  onControlSubagent?: (action: SubagentControlAction, taskId: string, content?: string) => void;
}

type PlainObject = Record<string, unknown>;

const STATUS_LABELS: Record<string, string> = {
  RUNNING: '运行中',
  DONE: '已完成',
  BLOCKED: '已阻塞',
  NEED_PARENT_INPUT: '等待输入',
};

const parseObject = (value: unknown): PlainObject => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as PlainObject)
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {};
};

const stringifyValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const extractTextContent = (value: unknown): string => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return extractTextContent(parsed) || value;
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        const record = parseObject(item);
        if (record.type === 'text') return stringifyValue(record.text);
        return extractTextContent(item);
      })
      .filter(Boolean)
      .join('\n');
  }

  const record = parseObject(value);
  if (record.content) return extractTextContent(record.content);
  if (record.text) return stringifyValue(record.text);
  if (record.message) return stringifyValue(record.message);
  return '';
};

const isAsyncLaunchNoise = (text: string): boolean =>
  /Async agent launched successfully|agentId: .*internal ID|The agent is working in the background|output_file/i.test(text);

const getCompactToolDisplay = (toolName: string, toolInput: unknown): string => {
  const input = parseObject(toolInput);
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = stringifyValue(input[key]);
      if (value) return value;
    }
    return '';
  };

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'ApplyPatch': {
      const filePath = pick('file_path', 'path');
      return filePath.split(/[\\/]/).pop() || filePath;
    }
    case 'Grep':
    case 'Glob':
      return pick('pattern');
    case 'Bash': {
      const command = pick('command');
      return command.length > 56 ? `${command.slice(0, 56)}...` : command;
    }
    case 'Agent':
    case 'Task':
    case 'spawn_agent':
      return pick('task_name', 'description', 'agent_type', 'message');
    case 'send_message':
    case 'send_input':
    case 'SendMessage':
      return pick('summary', 'message', 'content');
    case 'WebFetch':
    case 'WebSearch':
      return pick('url', 'query');
    default:
      return pick('description', 'summary', 'query', 'url');
  }
};

const getStatusClassName = (status: string): string => {
  if (status === 'BLOCKED') {
    return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900';
  }
  if (status === 'NEED_PARENT_INPUT') {
    return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900';
  }
  if (status === 'DONE') {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900';
  }
  return 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:ring-purple-900';
};

export const SubagentContainer: React.FC<SubagentContainerProps> = React.memo(({
  toolInput,
  toolResult,
  subagentState,
  onControlSubagent,
}) => {
  const parsedInput = parseObject(toolInput);
  const subagentType = stringifyValue(parsedInput.agent_type) || 'Agent';
  const description = stringifyValue(parsedInput.task_name)
    || stringifyValue(parsedInput.description)
    || stringifyValue(parsedInput.message)
    || '后台任务';
  const prompt = stringifyValue(parsedInput.prompt) || stringifyValue(parsedInput.message);
  const {
    childTools,
    currentToolIndex,
    isComplete,
    isAsyncLaunch,
    objective,
    currentStep,
    maxSteps,
    remainingSteps,
    elapsedMs,
    lastTool,
    lastToolSummary,
    resultSummary,
    runtimeStatus,
    stopReason,
    subagentEvents = [],
  } = subagentState;
  const [eventQuery, setEventQuery] = React.useState('');
  const [controlDraft, setControlDraft] = React.useState<'send' | 'followup' | null>(null);
  const [controlText, setControlText] = React.useState('');
  const filteredEvents = React.useMemo(() => {
    const query = eventQuery.trim().toLowerCase();
    if (!query) return subagentEvents.slice(-100);
    return subagentEvents
      .filter((event) => JSON.stringify(event).toLowerCase().includes(query))
      .slice(-100);
  }, [eventQuery, subagentEvents]);
  const exportEvents = React.useCallback(() => {
    if (typeof document === 'undefined') return;
    const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `subagent-events-${subagentState.taskId || 'run'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [filteredEvents, subagentState.taskId]);

  const currentTool = currentToolIndex >= 0 ? childTools[currentToolIndex] : null;
  const status = runtimeStatus || (isComplete ? 'DONE' : 'RUNNING');
  const taskId = subagentState.taskId || subagentState.registryRecord?.taskId || '';
  const swarmRunId = stringifyValue((subagentState.registryRecord as Record<string, unknown> | undefined)?.swarmRunId);
  const swarmRoleId = stringifyValue((subagentState.registryRecord as Record<string, unknown> | undefined)?.swarmRoleId);
  const readToolCount = childTools.filter(child =>
    /^(Read|FileRead|View)$/i.test(child.toolName)
  ).length;
  const toolHistorySummary = childTools.length > 0
    ? [
      `运行 ${childTools.length} 个工具`,
      readToolCount > 0 ? `读取 ${readToolCount} 个文件` : null,
    ].filter(Boolean).join(' · ')
    : '';
  const finalText = toolResult ? extractTextContent(toolResult.content) : '';
  const displayResultText = resultSummary || finalText;
  const shouldShowFinalText = Boolean(displayResultText && !isAsyncLaunchNoise(displayResultText));
  const blockerGuidance = (status === 'BLOCKED' || status === 'NEED_PARENT_INPUT' || stopReason)
    ? getSubagentBlockerGuidance({
      status,
      stopReason,
      objective: objective || description,
      lastTool,
    })
    : null;

  return (
    <div className="my-1 border-l-2 border-l-purple-500 py-0.5 pl-3 dark:border-l-purple-400">
      <CollapsibleSection
        title={`${subagentType}: ${description}${toolHistorySummary ? ` · ${toolHistorySummary}` : ''}`}
        toolName="Subagent"
        open={!isComplete}
        badge={
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${getStatusClassName(status)}`}>
            {STATUS_LABELS[status] || status}
          </span>
        }
      >
        {prompt && (
          <div className="mb-2 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {prompt}
          </div>
        )}

        <div className="mb-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {typeof currentStep === 'number' && typeof maxSteps === 'number' && (
              <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground ring-1 ring-border">
                步骤 {currentStep}/{maxSteps}
                {typeof remainingSteps === 'number' ? ` · 剩余 ${remainingSteps}` : ''}
              </span>
            )}
            {typeof elapsedMs === 'number' && (
              <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground ring-1 ring-border">
                {Math.floor(elapsedMs / 1000)}s
              </span>
            )}
            {(lastTool || currentTool) && (
              <span className="min-w-0 truncate text-muted-foreground">
                最近工具：
                <span className="font-medium text-foreground">
                  {lastTool || currentTool?.toolName}
                </span>
              </span>
            )}
            {isAsyncLaunch && !isComplete && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900">
                后台运行
              </span>
            )}
            {swarmRunId && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('argus-open-panel', { detail: { panel: 'chat' } }))}
                className="max-w-full rounded-full bg-cyan-50 px-2 py-0.5 text-cyan-700 ring-1 ring-cyan-200 transition-colors hover:bg-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-300 dark:ring-cyan-900"
                title={swarmRunId}
              >
                <span className="block truncate">Swarm{swarmRoleId ? `: ${swarmRoleId}` : ''}</span>
              </button>
            )}
          </div>

          {(objective || resultSummary || lastToolSummary || stopReason || blockerGuidance) && (
            <div className="mt-1.5 space-y-0.5 text-muted-foreground">
              {objective && <div className="line-clamp-1">目标：{objective}</div>}
              {resultSummary && <div className="line-clamp-2">结果：{resultSummary}</div>}
              {lastToolSummary && <div className="line-clamp-1">最近输出：{lastToolSummary}</div>}
              {blockerGuidance && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="font-medium">{blockerGuidance.title}</div>
                  <div className="mt-0.5 line-clamp-2">{blockerGuidance.description}</div>
                  <div className="mt-0.5 line-clamp-2">{blockerGuidance.nextAction}</div>
                </div>
              )}
              {stopReason && !blockerGuidance && (
                <div className="line-clamp-2 text-amber-700 dark:text-amber-300">
                  停止原因：{stopReason}
                </div>
              )}
            </div>
          )}
        </div>

        {taskId && onControlSubagent && (
          <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => onControlSubagent('wait', taskId)}
              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              Wait
            </button>
            <button
              type="button"
              onClick={() => {
                setControlDraft('send');
                setControlText('');
              }}
              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setControlDraft('followup');
                setControlText('');
              }}
              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              Follow
            </button>
          </div>
        )}

        {taskId && onControlSubagent && controlDraft && (
          <div className="mb-2 grid gap-1.5 rounded-md border border-border bg-background p-2 text-xs">
            <input
              type="text"
              value={controlText}
              onChange={(event) => setControlText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && controlText.trim()) {
                  onControlSubagent(controlDraft, taskId, controlText);
                  setControlDraft(null);
                  setControlText('');
                }
                if (event.key === 'Escape') {
                  setControlDraft(null);
                  setControlText('');
                }
              }}
              placeholder={controlDraft === 'send' ? 'Message' : 'Follow-up objective'}
              className="h-8 min-w-0 rounded border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setControlDraft(null);
                  setControlText('');
                }}
                className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!controlText.trim()}
                onClick={() => {
                  onControlSubagent(controlDraft, taskId, controlText);
                  setControlDraft(null);
                  setControlText('');
                }}
                className="h-6 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:opacity-60"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {currentTool && !isComplete && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
            <span className="text-muted-foreground/60">当前：</span>
            <span className="font-medium text-foreground">{currentTool.toolName}</span>
            {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput) && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="truncate font-mono text-muted-foreground">
                  {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput)}
                </span>
              </>
            )}
          </div>
        )}

        {!currentTool && !isComplete && isAsyncLaunch && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-300">
            <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-blue-500 dark:bg-blue-300" />
            <span>Agent 已启动，等待后台结果返回。</span>
          </div>
        )}

        {childTools.length > 0 && (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <svg className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>查看工具历史（{childTools.length}）</span>
            </CollapsibleTrigger>
            <CollapsibleContent lazy>
              <div className="mt-1 space-y-0.5 border-l border-border pl-3">
                {childTools.map((child, index) => {
                  const display = getCompactToolDisplay(child.toolName, child.toolInput);
                  return (
                    <div key={child.toolId} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="w-4 flex-shrink-0 text-right text-muted-foreground/60">{index + 1}.</span>
                      <span className="font-medium text-foreground">{child.toolName}</span>
                      {display && (
                        <span className="truncate font-mono text-muted-foreground/70">
                          {display}
                        </span>
                      )}
                      {child.toolResult?.isError && (
                        <span className="flex-shrink-0 text-red-500">错误</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {subagentEvents.length > 0 && (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <svg className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>Event log ({subagentEvents.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent lazy>
              <div className="mt-2 rounded-md border border-border bg-background/70 p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    value={eventQuery}
                    onChange={(event) => setEventQuery(event.target.value)}
                    placeholder="Search events"
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={exportEvents}
                    className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    Export
                  </button>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto font-mono text-[11px]">
                  {filteredEvents.map((event) => (
                    <div key={`${event.seq}:${event.type}:${event.timestamp}`} className="rounded border border-border/70 bg-muted/20 px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{event.type}</span>
                        <span className="text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</span>
                      </div>
                      {typeof event.payload?.message === 'string' && (
                        <div className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{event.payload.message}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {isComplete && (
          <div className={`mt-1 flex items-center gap-1.5 text-xs ${
            status === 'BLOCKED'
              ? 'text-amber-700 dark:text-amber-300'
              : status === 'DONE'
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-blue-700 dark:text-blue-300'
          }`}>
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current" />
            <span>{STATUS_LABELS[status] || '已结束'}（{childTools.length} 个工具）</span>
          </div>
        )}

        {isComplete && shouldShowFinalText && (
          <div className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {displayResultText}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
});

SubagentContainer.displayName = 'SubagentContainer';
