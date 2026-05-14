import type { ChatMessage } from '../types/types';

type PlainObject = Record<string, unknown>;

export type ChatMultiAgentTimelineItem = {
  kind: 'user_request' | 'dispatch_plan' | 'dispatch_started' | 'summary';
  title: string;
  content: string;
};

export type ChatMultiAgentCard = {
  id: string;
  dialogId: string;
  title: string;
  agentType: string;
  taskName: string;
  status: string;
  taskId: string;
  taskText: string;
  resultTitle: string;
  resultText: string;
  toolSummary: string;
  currentTool: string;
  elapsedMs?: number;
  sourceMessage: ChatMessage;
};

export type ChatMultiAgentCollaborationView = {
  dispatchPlanId: string;
  orchestrator: {
    title: string;
    status: string;
    timeline: ChatMultiAgentTimelineItem[];
  };
  cards: ChatMultiAgentCard[];
  dialogs: ChatMultiAgentCard[];
};

function parseObject(value: unknown): PlainObject {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as PlainObject
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PlainObject
    : {};
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function statusLabel(status = '') {
  const normalized = status.toUpperCase();
  if (normalized === 'DONE' || normalized === 'COMPLETED') return 'DONE';
  if (normalized === 'FAILED' || normalized === 'CANCELLED' || normalized === 'BLOCKED') return normalized;
  if (normalized === 'NEED_PARENT_INPUT') return normalized;
  return normalized || 'RUNNING';
}

function latestTerminalEvent(message: ChatMessage) {
  const events = message.subagentState?.subagentEvents || [];
  return [...events]
    .filter((event) => ['blocked', 'failed', 'cancelled'].includes(event.type))
    .sort((left, right) => right.timestamp - left.timestamp)[0];
}

function eventStatus(message: ChatMessage): string {
  const event = latestTerminalEvent(message);
  if (!event) return '';
  if (event.type === 'cancelled') return 'CANCELLED';
  if (event.type === 'failed') return 'FAILED';
  return 'BLOCKED';
}

function canonicalTaskPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function latestSubagentEvent(message: ChatMessage) {
  const events = message.subagentState?.subagentEvents || [];
  return [...events].sort((left, right) => right.timestamp - left.timestamp)[0];
}

function identityPart(prefix: string, value: unknown): string {
  const text = stringifyValue(value);
  return text ? `${prefix}:${text}` : '';
}

function subagentIdentity(message: ChatMessage, index: number): string {
  const input = parseObject(message.toolInput);
  const state = message.subagentState;
  const record = state?.registryRecord;
  const latestEvent = latestSubagentEvent(message);
  const stableIdentity = [
    identityPart('task', state?.taskId),
    identityPart('task', record?.taskId),
    identityPart('task', latestEvent?.taskId),
    identityPart('dialog', latestEvent?.dialogInstanceId),
    identityPart('agent', record?.agentId),
    identityPart('session', record?.sessionId),
    identityPart('thread', latestEvent?.threadId),
    identityPart('parent-tool', record?.parentToolUseId),
    identityPart('tool', message.toolId),
    identityPart('tool', message.toolCallId),
  ].find(Boolean);

  if (stableIdentity) {
    return stableIdentity;
  }

  const agentType = canonicalTaskPart(
    stringifyValue(input.agent_type)
    || stringifyValue(record?.agentType)
    || 'agent',
  );
  const taskName = canonicalTaskPart(
    stringifyValue(input.task_name)
    || stringifyValue(input.description)
    || stringifyValue(record?.role)
    || stringifyValue(state?.objective)
    || `agent_${index + 1}`,
  );
  return `${agentType}:${taskName}`;
}

function statusRank(message: ChatMessage): number {
  const state = message.subagentState;
  const record = state?.registryRecord;
  const status = statusLabel(
    eventStatus(message)
    || stringifyValue(state?.runtimeStatus)
    || stringifyValue(record?.runtimeStatus)
    || stringifyValue(record?.status),
  );
  if (status === 'DONE' || status === 'COMPLETED') return 5;
  if (status === 'FAILED' || status === 'CANCELLED') return 4;
  if (status === 'NEED_PARENT_INPUT' || status === 'BLOCKED') return 4;
  if (status === 'RUNNING') return 3;
  return 1;
}

function messageInfoScore(message: ChatMessage): number {
  const state = message.subagentState;
  const record = state?.registryRecord;
  return [
    statusRank(message) * 1000,
    state?.taskId ? 30 : 0,
    record?.taskId ? 20 : 0,
    state?.resultSummary || record?.resultSummary ? 30 : 0,
    state?.lastToolSummary || record?.lastToolSummary ? 15 : 0,
    state?.isComplete ? 10 : 0,
    (state?.childTools?.length || 0) * 2,
    message.toolResult ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function dedupeSubagents(messages: ChatMessage[]): ChatMessage[] {
  const byIdentity = new Map<string, { message: ChatMessage; score: number; order: number }>();
  messages.forEach((message, index) => {
    const identity = subagentIdentity(message, index);
    const score = messageInfoScore(message);
    const current = byIdentity.get(identity);
    if (!current || score >= current.score) {
      byIdentity.set(identity, { message, score, order: current?.order ?? index });
    }
  });
  return Array.from(byIdentity.values())
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.message);
}

function resultText(message: ChatMessage, fallbackStatus: string): string {
  const state = message.subagentState;
  const record = state?.registryRecord;
  const terminalEvent = latestTerminalEvent(message);
  const terminalMessage = stringifyValue(terminalEvent?.payload?.message || terminalEvent?.payload?.error);
  const duplicateCount = Number(terminalEvent?.payload?.duplicateCount || 0);
  if (terminalMessage) {
    return duplicateCount > 1 ? `${terminalMessage} (repeated ${duplicateCount} times)` : terminalMessage;
  }
  return stringifyValue(state?.resultSummary)
    || stringifyValue(record?.resultSummary)
    || stringifyValue(state?.changes)
    || stringifyValue(record?.changes)
    || stringifyValue(state?.evidence)
    || stringifyValue(record?.evidence)
    || stringifyValue(state?.lastToolSummary)
    || stringifyValue(record?.lastToolSummary)
    || (fallbackStatus === 'DONE'
      ? '任务执行完成，结果已回传。'
      : fallbackStatus === 'FAILED' || fallbackStatus === 'BLOCKED' || fallbackStatus === 'NEED_PARENT_INPUT'
        ? '执行遇到阻塞，请查看事件日志。'
        : '正在执行任务，等待结果回传。');
}

function toolSummary(message: ChatMessage): string {
  const count = message.subagentState?.childTools?.length || 0;
  if (!count) return '';
  return `${count} tools`;
}

function buildDialog(message: ChatMessage, index: number): ChatMultiAgentCard {
  const input = parseObject(message.toolInput);
  const state = message.subagentState;
  const record = state?.registryRecord;
  const agentType = stringifyValue(input.agent_type) || stringifyValue(record?.agentType) || 'Agent';
  const taskName = stringifyValue(input.task_name)
    || stringifyValue(input.description)
    || stringifyValue(record?.role)
    || `agent_${index + 1}`;
  const taskText = stringifyValue(input.message)
    || stringifyValue(input.prompt)
    || stringifyValue(input.description)
    || stringifyValue(record?.objective)
    || stringifyValue(state?.objective)
    || '执行分配的子任务。';
  const status = statusLabel(
    eventStatus(message)
    || stringifyValue(state?.runtimeStatus)
    || stringifyValue(record?.runtimeStatus)
    || stringifyValue(record?.status),
  );
  const currentTool = stringifyValue(state?.lastTool)
    || (typeof state?.currentToolIndex === 'number' && state.childTools?.[state.currentToolIndex]?.toolName)
    || '';
  const id = stringifyValue(message.toolId) || stringifyValue(state?.taskId) || `${taskName}-${index}`;

  return {
    id,
    dialogId: id,
    title: `${agentType} / ${taskName}`,
    agentType,
    taskName,
    status,
    taskId: stringifyValue(state?.taskId) || stringifyValue(record?.taskId),
    taskText,
    resultTitle: status === 'DONE' ? '结果输出' : status === 'RUNNING' ? '执行中' : '需要处理',
    resultText: resultText(message, status),
    toolSummary: toolSummary(message),
    currentTool,
    elapsedMs: typeof state?.elapsedMs === 'number' ? state.elapsedMs : undefined,
    sourceMessage: message,
  };
}

export function buildChatMultiAgentCollaborationView(messages: ChatMessage[]): ChatMultiAgentCollaborationView | null {
  const subagents = dedupeSubagents(messages.filter((message) => message.isSubagentContainer && message.subagentState));
  if (subagents.length < 2) return null;

  const dialogs = subagents.map(buildDialog);
  const completed = dialogs.filter((dialog) => dialog.status === 'DONE' || dialog.status === 'COMPLETED').length;
  const running = dialogs.filter((dialog) => dialog.status === 'RUNNING').length;
  const blocked = dialogs.length - completed - running;
  const dispatchLines = dialogs.map((dialog, index) => `${index + 1}. ${dialog.title}: ${dialog.taskText}`);
  const firstTask = dialogs[0]?.taskText || '用户请求';
  const dispatchPlanId = `multi-agent:${subagents.map((message, index) => subagentIdentity(message, index)).join('|')}`;

  return {
    dispatchPlanId,
    orchestrator: {
      title: '主Agent / Orchestrator',
      status: blocked > 0 ? 'BLOCKED' : running > 0 ? 'RUNNING' : 'DONE',
      timeline: [
        {
          kind: 'user_request',
          title: '用户请求',
          content: firstTask,
        },
        {
          kind: 'dispatch_plan',
          title: '主Agent',
          content: `我将分解任务并分发给各子Agent处理：\n${dispatchLines.join('\n')}`,
        },
        {
          kind: 'dispatch_started',
          title: '主Agent',
          content: '任务已分发给各子Agent，请开始执行。',
        },
        {
          kind: 'summary',
          title: '主Agent',
          content: blocked > 0
            ? `已有 ${blocked} 个子Agent需要处理，${completed} 个已完成，${running} 个仍在执行。`
            : completed > 0
              ? `已汇总子Agent执行结果：${completed} 个任务完成，${running} 个仍在执行。`
              : '正在等待子Agent结果回传。',
        },
      ],
    },
    cards: dialogs,
    dialogs,
  };
}
