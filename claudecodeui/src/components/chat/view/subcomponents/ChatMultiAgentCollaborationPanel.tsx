import React, { memo, useMemo } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Code2,
  Database,
  FileText,
  MoreVertical,
  Rocket,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import type { ChatMessage } from '../../types/types';
import type { Project, LLMProvider } from '../../../../types/app';
import type { SubagentControlAction } from '../../utils/subagentControlRequest';
import {
  buildChatMultiAgentCollaborationView,
  type ChatMultiAgentCard,
  type ChatMultiAgentTimelineItem,
} from '../../utils/chatMultiAgentCollaboration';

import MessageComponent from './MessageComponent';

type ChatMultiAgentCollaborationPanelProps = {
  messages: ChatMessage[];
  onControlSubagent?: (action: SubagentControlAction, taskId: string, content?: string) => void;
  createDiff?: (oldStr: string, newStr: string) => Array<{ type: string; content: string; lineNum: number }>;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: { entry: string; toolName: string }) => { success: boolean } | null | undefined;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  sessionId?: string | null;
  provider?: LLMProvider | string;
  getMessageKey?: (message: ChatMessage) => string;
};

const emptyDiff = () => [];

function buildChildToolMessages(dialog: ChatMultiAgentCard): ChatMessage[] {
  const childTools = dialog.sourceMessage.subagentState?.childTools || [];
  return childTools.map((tool, index) => ({
    id: tool.toolId,
    type: 'assistant',
    timestamp: tool.timestamp || dialog.sourceMessage.timestamp,
    isToolUse: true,
    toolName: tool.toolName,
    toolInput: tool.toolInput,
    toolResult: tool.toolResult || null,
    toolId: tool.toolId,
    content: '',
    parentToolUseId: dialog.sourceMessage.toolId,
    taskId: dialog.taskId,
    childToolIndex: index,
  }));
}

function statusClassName(status?: string) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'DONE' || normalized === 'COMPLETED') {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900';
  }
  if (normalized === 'FAILED' || normalized === 'BLOCKED' || normalized === 'NEED_PARENT_INPUT') {
    return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900';
  }
  return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900';
}

function statusTone(status?: string) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'DONE' || normalized === 'COMPLETED') return 'done';
  if (normalized === 'FAILED' || normalized === 'BLOCKED' || normalized === 'NEED_PARENT_INPUT' || normalized === 'CANCELLED') return 'blocked';
  return 'running';
}

function statusDataValue(status?: string) {
  return statusTone(status);
}

function resultToneClassName(status?: string) {
  const tone = statusTone(status);
  if (tone === 'blocked') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200';
  }
  if (tone === 'running') {
    return 'border-blue-100 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200';
  }
  return 'border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200';
}

function AgentStatus({ status }: { status?: string }) {
  const normalized = String(status || 'RUNNING').toUpperCase();
  const tone = statusTone(normalized);
  const label = tone === 'blocked' ? '已阻塞' : tone === 'done' ? '已完成' : '在线';
  const className = tone === 'blocked'
    ? 'text-amber-600 dark:text-amber-300'
    : tone === 'done'
      ? 'text-slate-500 dark:text-slate-300'
      : 'text-emerald-600 dark:text-emerald-300';
  const dotClassName = tone === 'blocked'
    ? 'bg-amber-500'
    : tone === 'done'
      ? 'bg-slate-400'
      : 'bg-emerald-500';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${className}`}>
      <span className={`h-2 w-2 rounded-full ${dotClassName}`} />
      {label}
    </span>
  );
}

function agentIcon(dialog: ChatMultiAgentCard) {
  const key = `${dialog.agentType} ${dialog.taskName} ${dialog.title}`.toLowerCase();
  if (key.includes('security') || key.includes('safe') || key.includes('risk')) return ShieldCheck;
  if (key.includes('test') || key.includes('quality')) return CheckCircle2;
  if (key.includes('deploy') || key.includes('release')) return Rocket;
  if (key.includes('doc') || key.includes('readme')) return FileText;
  if (key.includes('data') || key.includes('sql')) return Database;
  if (key.includes('monitor') || key.includes('perf')) return Activity;
  if (key.includes('front') || key.includes('back') || key.includes('code')) return Code2;
  return Bot;
}

function toneClassName(dialog: ChatMultiAgentCard) {
  const key = `${dialog.agentType} ${dialog.taskName} ${dialog.title}`.toLowerCase();
  if (key.includes('security') || key.includes('test') || key.includes('quality')) return 'from-emerald-500 to-teal-500';
  if (key.includes('deploy')) return 'from-sky-500 to-blue-500';
  if (key.includes('doc')) return 'from-rose-500 to-red-500';
  if (key.includes('data')) return 'from-blue-500 to-indigo-500';
  if (key.includes('monitor')) return 'from-cyan-500 to-sky-500';
  return 'from-violet-500 to-blue-500';
}

function TimelineItem({ item }: { item: ChatMultiAgentTimelineItem }) {
  const isUser = item.kind === 'user_request';
  return (
    <div className="flex gap-2.5">
      <span className={`mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${isUser ? 'bg-gradient-to-br from-cyan-500 to-blue-600' : 'bg-blue-600'} text-white`}>
        {isUser ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-900 dark:text-foreground">{item.title}</div>
        <div className={`mt-1 max-w-full whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-5 ${isUser ? 'bg-slate-100 text-slate-700 dark:bg-muted dark:text-foreground' : item.kind === 'summary' ? 'border border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'text-slate-700 dark:text-foreground'}`}>
          {item.content}
        </div>
      </div>
    </div>
  );
}

export const ChatMultiAgentCollaborationPanel = memo(function ChatMultiAgentCollaborationPanel({
  messages,
  onControlSubagent,
  createDiff = emptyDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools = false,
  showRawParameters = false,
  showThinking = false,
  selectedProject = null,
  sessionId = null,
  provider = 'claude',
  getMessageKey,
}: ChatMultiAgentCollaborationPanelProps) {
  const view = useMemo(() => buildChatMultiAgentCollaborationView(messages), [messages]);

  if (!view) return null;

  return (
    <section
      className="my-2 overflow-hidden rounded-xl border border-slate-200 bg-[#f6f8fb] shadow-sm dark:border-border dark:bg-background"
      data-subagent-dispatch-plan-id={view.dispatchPlanId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950 dark:text-foreground">多 Agent 对话协作</div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
              {view.dialogs.length} 个子Agent · {view.orchestrator.status}
            </div>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusClassName(view.orchestrator.status)}`}>
          {view.orchestrator.status}
        </span>
      </div>

      <div className="grid min-w-0 gap-3 p-3 xl:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-border dark:bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-border/70">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950 dark:text-foreground">Main Agent / Orchestrator</div>
                <AgentStatus status={view.orchestrator.status} />
              </div>
            </div>
            <MoreVertical className="h-4 w-4 text-slate-400" />
          </div>
          <div className="space-y-4 p-4">
            {view.orchestrator.timeline.map((item, index) => (
              <TimelineItem key={`${item.kind}-${index}`} item={item} />
            ))}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-2">
          {view.dialogs.map((dialog) => {
            const Icon = agentIcon(dialog);
            const childToolMessages = buildChildToolMessages(dialog);
            return (
              <article
                key={dialog.dialogId}
                className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
                data-subagent-child-dialog={dialog.dialogId}
                data-subagent-child-status={statusDataValue(dialog.status)}
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-border/70">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${toneClassName(dialog)} text-white`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold leading-5 text-slate-950 dark:text-foreground">{dialog.title}</div>
                      <AgentStatus status={dialog.status} />
                    </div>
                  </div>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${statusClassName(dialog.status)}`}>
                    {dialog.status}
                  </span>
                </div>

                <div className="space-y-3 p-3">
                  <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-slate-700 dark:bg-blue-950/30 dark:text-blue-100">
                    <span className="font-medium text-blue-700 dark:text-blue-200">收到任务：</span>
                    <span className="break-words">{dialog.taskText}</span>
                  </div>
                  {childToolMessages.length > 0 ? (
                    <>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-border dark:bg-background/60">
                        {childToolMessages.map((childMessage, childIndex) => {
                          const messageKey = getMessageKey?.(childMessage) || childMessage.toolId || `${dialog.dialogId}-${childIndex}`;
                          return (
                            <MessageComponent
                              key={messageKey}
                              message={childMessage}
                              messageKey={`subagent-child-tool-${messageKey}`}
                              prevMessage={childIndex > 0 ? childToolMessages[childIndex - 1] : null}
                              createDiff={createDiff}
                              onFileOpen={onFileOpen}
                              onShowSettings={onShowSettings}
                              onGrantToolPermission={onGrantToolPermission as any}
                              autoExpandTools={autoExpandTools}
                              showRawParameters={showRawParameters}
                              showThinking={showThinking}
                              selectedProject={selectedProject}
                              sessionId={sessionId}
                              provider={provider}
                              isLatestAssistantReply={false}
                              onControlSubagent={onControlSubagent}
                            />
                          );
                        })}
                      </div>
                      {dialog.resultText && (
                        <div
                          className={`rounded-lg border px-3 py-2 text-xs leading-5 ${resultToneClassName(dialog.status)}`}
                          data-subagent-result-tone={statusDataValue(dialog.status)}
                        >
                          {dialog.resultText}
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs leading-5 ${resultToneClassName(dialog.status)}`}
                      data-subagent-result-tone={statusDataValue(dialog.status)}
                    >
                      {dialog.resultText}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
});

ChatMultiAgentCollaborationPanel.displayName = 'ChatMultiAgentCollaborationPanel';
