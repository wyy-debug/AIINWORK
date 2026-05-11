/**
 * Message normalization utilities.
 * Converts NormalizedMessage[] from the session store into ChatMessage[] for the UI.
 */

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type {
  ChatMessage,
  SubagentChildTool,
  SubagentEventEnvelope,
  SubagentRegistryRecord,
  SubagentRegistryStatus,
  SubagentRuntimeSnapshot,
  SubagentRuntimeStatus,
  ToolResult,
} from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection, formatUsageLimitText } from '../utils/chatFormatting';
import { extractProposedPlanBlocks } from '../utils/proposedPlan';
import { buildSubagentEventEnvelopes } from '../utils/subagentEvents';

function isTaskNotificationContent(content: string): boolean {
  const trimmed = decodeHtmlEntities(content).trimStart();
  return /^<task-notification\b/i.test(trimmed)
    || /^&lt;task-notification\b/i.test(trimmed);
}

function isInternalAgentFailureNarration(content: string): boolean {
  const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized.includes('i literally cannot stop myself')
    || normalized.includes('pathological at this point')
    || normalized.includes('every single agent i launch')
    || normalized.includes('provide the user with the complete updated code')
    || normalized.includes('they can replace their existing file with the new version');
}

function isSubagentToolName(toolName?: string): boolean {
  const normalized = (toolName || '').trim().toLowerCase();
  return normalized === 'agent'
    || normalized === 'task'
    || normalized === 'agentspawn'
    || normalized === 'agent_spawn'
    || normalized === 'spawn_agent'
    || normalized === 'delegate_to_agent';
}

function isAgentOrchestrationChatter(content: string): boolean {
  const text = content.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 1200) return false;
  if (/```|###\s*status|结论|原因分析|修复建议|完整报告|analysis report|root cause/i.test(text)) {
    return false;
  }

  const mentionsAgent = /\b(agent|worker|subagent|background task|browser-based|chrome-based)\b/i.test(text)
    || /(智能体|子代理|后台任务|代理)/.test(text);
  const mentionsWaiting = /\b(waiting|wait|launched|launch|check(?:ing)?|monitoring|sent messages|please wait|running|complete|completed|output file)\b/i.test(text)
    || /(等待|已启动|启动了|检查|运行中|后台|完成|稍候)/.test(text);

  if (/\b(agentid|agent id|internal id|output_file|output file)\b/i.test(text)) {
    return true;
  }

  if (mentionsAgent && mentionsWaiting) return true;

  if (
    /\b(i'?m ready|ready and waiting|once you provide|as soon as you provide|please paste|still waiting|provide the exported|exported crash data|crash report content|paste the crash|waiting for you to paste|waiting for .*results)\b/i.test(text)
    || /(等待您提供|请将.*粘贴|请.*粘贴|粘贴.*崩溃|我准备好分析|一旦.*粘贴|导出.*内容|崩溃内容粘贴|等待.*结果)/.test(text)
  ) {
    return true;
  }

  return [
    /^let me (?:wait|check|take stock|launch|try|stop|send|just wait|get|first read)\b/i,
    /^understood\. all agents have confirmed\b/i,
    /^i'?m ready\b/i,
    /^i'?m trying a new approach\b/i,
    /^i'?ve launched\b/i,
    /^i'?m waiting\b/i,
    /^waiting for\b/i,
    /^please wait\b/i,
    /^the .* agent .* running\b/i,
    /^a .* agent is now running\b/i,
  ].some((pattern) => pattern.test(text));
}

function normalizeToolTimestamp(value: unknown): Date {
  const date = value ? new Date(value as string | number | Date) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toToolResult(value: NormalizedMessage | ToolResult | null | undefined): ToolResult | null {
  if (!value) return null;
  const record = value as Record<string, unknown>;
  const result = record.toolResult && typeof record.toolResult === 'object'
    ? record.toolResult as Record<string, unknown>
    : record;
  return {
    content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    isError: Boolean(result.isError),
    toolUseResult: result.toolUseResult,
  };
}

function getToolResultText(value: ToolResult | null | undefined): string {
  if (!value) return '';
  const content = value.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text || '');
        }
        return typeof item === 'string' ? item : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function isAsyncSubagentLaunchResult(value: ToolResult | null | undefined): boolean {
  const text = getToolResultText(value).replace(/\s+/g, ' ').trim().toLowerCase();
  return text.includes('<subagent-control>')
    || (
      text.includes('async agent launched successfully')
      && text.includes('the agent is working in the background')
      && text.includes('agentid:')
    );
}

function toSubagentRuntimeSnapshot(value: unknown): SubagentRuntimeSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const status = typeof record.runtimeStatus === 'string'
    && ['RUNNING', 'DONE', 'BLOCKED', 'NEED_PARENT_INPUT'].includes(record.runtimeStatus)
    ? record.runtimeStatus as SubagentRuntimeStatus
    : undefined;
  return {
    objective: typeof record.objective === 'string' ? record.objective : undefined,
    currentStep: typeof record.currentStep === 'number' ? record.currentStep : undefined,
    maxSteps: typeof record.maxSteps === 'number' ? record.maxSteps : undefined,
    remainingSteps: typeof record.remainingSteps === 'number' ? record.remainingSteps : undefined,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : undefined,
    elapsedMs: typeof record.elapsedMs === 'number' ? record.elapsedMs : undefined,
    runtimeStatus: status,
    stopReason: typeof record.stopReason === 'string' ? record.stopReason : undefined,
    lastTool: typeof record.lastTool === 'string' ? record.lastTool : undefined,
    lastInput: typeof record.lastInput === 'string' ? record.lastInput : undefined,
    lastToolSummary: typeof record.lastToolSummary === 'string' ? record.lastToolSummary : undefined,
    recentActions: Array.isArray(record.recentActions)
      ? record.recentActions.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

function toSubagentRegistryRecord(value: unknown): SubagentRegistryRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const status = typeof record.status === 'string'
    && ['running', 'completed', 'failed', 'cancelled', 'blocked', 'need_parent_input', 'interrupted'].includes(record.status)
    ? record.status as SubagentRegistryStatus
    : undefined;
  const runtimeStatus = typeof record.runtimeStatus === 'string'
    && ['RUNNING', 'DONE', 'BLOCKED', 'NEED_PARENT_INPUT'].includes(record.runtimeStatus)
    ? record.runtimeStatus as SubagentRuntimeStatus
    : undefined;
  return {
    taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
    agentId: typeof record.agentId === 'string' ? record.agentId : undefined,
    parentToolUseId: typeof record.parentToolUseId === 'string' ? record.parentToolUseId : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    parentSessionId: typeof record.parentSessionId === 'string' ? record.parentSessionId : undefined,
    userTurnId: typeof record.userTurnId === 'string' ? record.userTurnId : undefined,
    objective: typeof record.objective === 'string' ? record.objective : undefined,
    role: typeof record.role === 'string' ? record.role : undefined,
    agentType: typeof record.agentType === 'string' ? record.agentType : undefined,
    status,
    runtimeStatus,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : undefined,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : undefined,
    endedAt: typeof record.endedAt === 'number' ? record.endedAt : undefined,
    currentStep: typeof record.currentStep === 'number' ? record.currentStep : undefined,
    maxSteps: typeof record.maxSteps === 'number' ? record.maxSteps : undefined,
    remainingSteps: typeof record.remainingSteps === 'number' ? record.remainingSteps : undefined,
    lastTool: typeof record.lastTool === 'string' ? record.lastTool : undefined,
    lastInput: typeof record.lastInput === 'string' ? record.lastInput : undefined,
    lastToolSummary: typeof record.lastToolSummary === 'string' ? record.lastToolSummary : undefined,
    stopReason: typeof record.stopReason === 'string' ? record.stopReason : undefined,
    resultSummary: typeof record.resultSummary === 'string' ? record.resultSummary : undefined,
    evidence: typeof record.evidence === 'string' ? record.evidence : undefined,
    nextAction: typeof record.nextAction === 'string' ? record.nextAction : undefined,
    changes: typeof record.changes === 'string' ? record.changes : undefined,
    blockers: typeof record.blockers === 'string' ? record.blockers : undefined,
    recentActions: Array.isArray(record.recentActions)
      ? record.recentActions.filter((item): item is string => typeof item === 'string')
      : undefined,
    events: Array.isArray(record.events)
      ? record.events.filter((item): item is any => Boolean(item && typeof item === 'object'))
      : undefined,
  };
}

function runtimeStatusFromRegistry(record: SubagentRegistryRecord | undefined): SubagentRuntimeStatus | undefined {
  if (!record) return undefined;
  if (record.runtimeStatus) return record.runtimeStatus;
  switch (record.status) {
    case 'running':
      return 'RUNNING';
    case 'completed':
      return 'DONE';
    case 'need_parent_input':
      return 'NEED_PARENT_INPUT';
    case 'blocked':
    case 'cancelled':
    case 'failed':
    case 'interrupted':
      return 'BLOCKED';
    default:
      return undefined;
  }
}

function isTerminalRegistryStatus(record: SubagentRegistryRecord | undefined): boolean {
  return Boolean(record?.status && record.status !== 'running');
}

function parseProtocolStatus(value: ToolResult | null | undefined): SubagentRuntimeStatus | undefined {
  const text = getToolResultText(value);
  const match = text.match(/###\s*STATUS\s*\n\s*(DONE|BLOCKED|NEED_PARENT_INPUT)\b/i);
  return match ? match[1]!.toUpperCase() as SubagentRuntimeStatus : undefined;
}

function taskNotificationRuntimeStatus(status: unknown): SubagentRuntimeStatus {
  const normalized = typeof status === 'string' ? status.toLowerCase() : '';
  return normalized === 'completed' ? 'DONE' : 'BLOCKED';
}

function toSubagentControlEvent(value: unknown): Pick<SubagentEventEnvelope, 'type' | 'timestamp' | 'payload'> & { taskId?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  if (!type) return null;
  const taskId = typeof record.taskId === 'string'
    ? record.taskId
    : record.payload && typeof record.payload === 'object' && typeof (record.payload as Record<string, unknown>).taskId === 'string'
      ? String((record.payload as Record<string, unknown>).taskId)
      : '';
  const timestamp = typeof record.timestamp === 'number' || typeof record.timestamp === 'string' || record.timestamp instanceof Date
    ? record.timestamp
    : Date.now();
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : {};
  return {
    type: type as SubagentEventEnvelope['type'],
    timestamp: typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime(),
    payload,
    ...(taskId ? { taskId } : {}),
  };
}

function isObsidianAutoCaptureStatus(message: NormalizedMessage): boolean {
  const event = (message as any).event;
  return message.kind === 'status'
    && (message.text === 'obsidian_auto_capture_result' || event === 'obsidian_auto_capture_result');
}

function isObsidianContextStatus(message: NormalizedMessage): boolean {
  const event = (message as any).event;
  return message.kind === 'status'
    && (message.text === 'obsidian_context_result' || event === 'obsidian_context_result');
}

function statusPayloadForObsidianCapture(message: NormalizedMessage): Record<string, unknown> {
  const record = message as any;
  return {
    status: record.status,
    captured: record.captured,
    mode: record.mode,
    routingMode: record.routingMode,
    routingModes: record.routingModes,
    routingReason: record.routingReason,
    routingSignals: record.routingSignals,
    confidence: record.confidence,
    artifactId: record.artifactId,
    obsidianPath: record.obsidianPath,
    obsidianTargets: record.obsidianTargets,
    obsidianPaths: record.obsidianPaths,
    fallbackPath: record.fallbackPath,
    error: record.error,
  };
}

function statusPayloadForObsidianContext(message: NormalizedMessage): Record<string, unknown> {
  const record = message as any;
  const context = record.obsidianContext && typeof record.obsidianContext === 'object'
    ? record.obsidianContext
    : record;
  return {
    used: context.used,
    resultCount: context.resultCount,
    projectName: context.projectName,
    source: context.source,
    refined: context.refined,
    refinementModel: context.refinementModel,
    reranked: context.reranked,
    rerankModel: context.rerankModel,
    tokenBudgetUsed: context.tokenBudgetUsed,
    sources: context.sources,
    error: context.error,
  };
}

function nearestAssistantMessageId(messages: NormalizedMessage[], beforeIndex: number): string {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.kind === 'text' && candidate.role === 'assistant' && candidate.id) {
      return candidate.id;
    }
  }
  return '';
}

function nearestUserMessageId(messages: NormalizedMessage[], beforeIndex: number): string {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.kind === 'text' && candidate.role === 'user' && candidate.id) {
      return candidate.id;
    }
  }
  return '';
}

/**
 * Convert NormalizedMessage[] from the session store into ChatMessage[]
 * that the existing UI components expect.
 *
 * Internal/system content (e.g. <system-reminder>, <command-name>) is already
 * filtered server-side by the Claude provider module.
 */
export function normalizedToChatMessages(messages: NormalizedMessage[]): ChatMessage[] {
  const converted: ChatMessage[] = [];
  const obsidianCaptureStatusByMessageId = new Map<string, Record<string, unknown>>();
  const obsidianContextStatusByMessageId = new Map<string, Record<string, unknown>>();

  messages.forEach((msg, index) => {
    if (!isObsidianAutoCaptureStatus(msg)) return;
    const record = msg as any;
    const payload = statusPayloadForObsidianCapture(msg);
    const explicitMessageId = typeof record.messageId === 'string' ? record.messageId : '';
    const targetMessageId = explicitMessageId && explicitMessageId !== 'stream'
      ? explicitMessageId
      : nearestAssistantMessageId(messages, index);
    if (targetMessageId) {
      obsidianCaptureStatusByMessageId.set(targetMessageId, payload);
    }
  });

  messages.forEach((msg, index) => {
    if (!isObsidianContextStatus(msg)) return;
    const record = msg as any;
    const payload = statusPayloadForObsidianContext(msg);
    const explicitMessageId = typeof record.messageId === 'string' ? record.messageId : '';
    const targetMessageId = explicitMessageId && explicitMessageId !== 'stream'
      ? explicitMessageId
      : nearestUserMessageId(messages, index);
    if (targetMessageId) {
      obsidianContextStatusByMessageId.set(targetMessageId, payload);
    }
  });

  // First pass: collect tool results for attachment
  const toolResultMap = new Map<string, NormalizedMessage>();
  for (const msg of messages) {
    if (msg.kind === 'tool_result' && msg.toolId) {
      toolResultMap.set(msg.toolId, msg);
    }
  }

  const subagentChildToolMap = new Map<string, SubagentChildTool[]>();
  const subagentProgressMap = new Map<string, SubagentRuntimeSnapshot>();
  const subagentRecordMap = new Map<string, SubagentRegistryRecord>();
  const subagentControlEventsByTaskId = new Map<string, Array<Pick<SubagentEventEnvelope, 'type' | 'timestamp' | 'payload'>>>();
  const subagentTaskIdByToolId = new Map<string, string>();
  const subagentToolIdByTaskId = new Map<string, string>();
  const taskNotificationByToolId = new Map<string, {
    taskId?: string;
    runtimeStatus: SubagentRuntimeStatus;
    summary?: string;
  }>();
  const taskNotificationByTaskId = new Map<string, {
    taskId?: string;
    runtimeStatus: SubagentRuntimeStatus;
    summary?: string;
  }>();
  for (const msg of messages) {
    if (msg.kind === 'status' && (msg as any).subagentControlEvent) {
      const event = toSubagentControlEvent((msg as any).subagentControlEvent);
      if (event?.taskId) {
        const existing = subagentControlEventsByTaskId.get(event.taskId) || [];
        subagentControlEventsByTaskId.set(event.taskId, [...existing, event]);
      }
      continue;
    }
    if (msg.kind === 'tool_use' && msg.toolId && msg.taskId && isSubagentToolName(msg.toolName)) {
      subagentToolIdByTaskId.set(msg.taskId, msg.toolId);
    }
    if (msg.kind === 'task_notification' && msg.toolId) {
      const notification = {
        taskId: msg.taskId,
        runtimeStatus: taskNotificationRuntimeStatus(msg.status),
        summary: msg.summary || msg.content,
      };
      taskNotificationByToolId.set(msg.toolId, notification);
      if (msg.taskId) {
        taskNotificationByTaskId.set(msg.taskId, notification);
      }
      continue;
    }
    if (msg.kind === 'task_notification' && msg.taskId) {
      taskNotificationByTaskId.set(msg.taskId, {
        taskId: msg.taskId,
        runtimeStatus: taskNotificationRuntimeStatus(msg.status),
        summary: msg.summary || msg.content,
      });
      continue;
    }
    if (msg.kind === 'status' && msg.status === 'subagent_progress' && msg.toolId) {
      const snapshot = toSubagentRuntimeSnapshot(msg.subagentRuntime);
      if (snapshot) {
        subagentProgressMap.set(msg.toolId, snapshot);
      }
      const registryRecord = toSubagentRegistryRecord(msg.subagentRecord);
      const snapshotRecord = toSubagentRegistryRecord(msg.subagentSnapshot);
      if (registryRecord) {
        subagentRecordMap.set(msg.toolId, registryRecord);
      }
      if (snapshotRecord) {
        subagentRecordMap.set(msg.toolId, snapshotRecord);
      }
      if (msg.taskId) {
        subagentTaskIdByToolId.set(msg.toolId, msg.taskId);
        subagentToolIdByTaskId.set(msg.taskId, msg.toolId);
      }
      continue;
    }
    if (msg.kind !== 'tool_use') continue;
    const parentSubagentToolId = msg.parentToolUseId || (msg.taskId ? subagentToolIdByTaskId.get(msg.taskId) : undefined);
    if (!parentSubagentToolId || parentSubagentToolId === msg.toolId) continue;
    const childToolId = msg.toolId || msg.id;
    const childTool: SubagentChildTool = {
      toolId: childToolId,
      toolName: msg.toolName || 'Tool',
      toolInput: msg.toolInput ?? '',
      toolResult: toToolResult(msg.toolResult || (childToolId ? toolResultMap.get(childToolId) : null)),
      timestamp: normalizeToolTimestamp(msg.timestamp),
    };
    const existing = subagentChildToolMap.get(parentSubagentToolId) || [];
    subagentChildToolMap.set(parentSubagentToolId, [...existing, childTool]);
  }

  for (const msg of messages) {
    if (msg.parentToolUseId && msg.kind !== 'tool_result') {
      continue;
    }

    switch (msg.kind) {
      case 'text': {
        const content = msg.content || '';
        if (!content.trim()) continue;

        if (msg.role === 'user') {
          if (isTaskNotificationContent(content)) {
            continue;
          }
          converted.push({
            id: msg.id,
            type: 'user',
            content: unescapeWithMathProtection(decodeHtmlEntities(content)),
            timestamp: msg.timestamp,
            obsidianContextStatus: msg.id ? obsidianContextStatusByMessageId.get(msg.id) : undefined,
          });
        } else {
          let text = decodeHtmlEntities(content);
          text = unescapeWithMathProtection(text);
          text = formatUsageLimitText(text);
          if (isInternalAgentFailureNarration(text) || isAgentOrchestrationChatter(text)) {
            continue;
          }
          const proposedPlan = extractProposedPlanBlocks(text);
          if (proposedPlan.text.trim()) {
            converted.push({
              id: msg.id,
              type: 'assistant',
              content: proposedPlan.text,
              timestamp: msg.timestamp,
              obsidianCaptureStatus: msg.id ? obsidianCaptureStatusByMessageId.get(msg.id) : undefined,
            });
          }
          proposedPlan.plans.forEach((plan, index) => {
            converted.push({
              id: `${msg.id}-proposed-plan-${index}`,
              type: 'assistant',
              content: '',
              timestamp: msg.timestamp,
              isToolUse: true,
              toolName: 'proposed_plan',
              toolInput: JSON.stringify({ plan }, null, 2),
              toolId: `${msg.id}-proposed-plan-${index}`,
              toolResult: null,
            });
          });
        }
        break;
      }

      case 'tool_use': {
        const tr = msg.toolResult || (msg.toolId ? toolResultMap.get(msg.toolId) : null);
        const isSubagentContainer = isSubagentToolName(msg.toolName);

        // Build child tools from subagentTools
        const childTools: SubagentChildTool[] = [];
        if (isSubagentContainer && msg.subagentTools && Array.isArray(msg.subagentTools)) {
          for (const tool of msg.subagentTools as any[]) {
            childTools.push({
              toolId: tool.toolId,
              toolName: tool.toolName,
              toolInput: tool.toolInput,
              toolResult: tool.toolResult || null,
              timestamp: normalizeToolTimestamp(tool.timestamp),
            });
          }
        }
        const realtimeChildTools = msg.toolId ? subagentChildToolMap.get(msg.toolId) || [] : [];
        for (const childTool of realtimeChildTools) {
          if (!childTools.some((tool) => tool.toolId === childTool.toolId)) {
            childTools.push(childTool);
          }
        }

        const toolResult = toToolResult(tr);
        const isAsyncLaunch = isSubagentContainer && isAsyncSubagentLaunchResult(toolResult);
        const registryRecord = isSubagentContainer && msg.toolId
          ? subagentRecordMap.get(msg.toolId)
            || toSubagentRegistryRecord(msg.subagentSnapshot)
            || toSubagentRegistryRecord(msg.subagentRecord)
            || toSubagentRegistryRecord((tr as NormalizedMessage | undefined)?.subagentSnapshot)
            || toSubagentRegistryRecord((tr as NormalizedMessage | undefined)?.subagentRecord)
          : undefined;
        const runtimeSnapshot = isSubagentContainer && msg.toolId
          ? subagentProgressMap.get(msg.toolId)
            || toSubagentRuntimeSnapshot(msg.subagentRuntime)
            || toSubagentRuntimeSnapshot((tr as NormalizedMessage | undefined)?.subagentRuntime)
          : undefined;
        const terminalNotification = isSubagentContainer
          ? (msg.toolId ? taskNotificationByToolId.get(msg.toolId) : undefined)
            || (registryRecord?.taskId ? taskNotificationByTaskId.get(registryRecord.taskId) : undefined)
            || (msg.taskId ? taskNotificationByTaskId.get(msg.taskId) : undefined)
          : undefined;
        const protocolStatus = isSubagentContainer ? parseProtocolStatus(toolResult) : undefined;
        const runtimeStatus = terminalNotification?.runtimeStatus
          || runtimeStatusFromRegistry(registryRecord)
          || runtimeSnapshot?.runtimeStatus
          || protocolStatus
          || (toolResult && !isAsyncLaunch ? 'DONE' : 'RUNNING');
        const isTerminalRuntimeStatus = runtimeStatus === 'DONE'
          || runtimeStatus === 'BLOCKED'
          || runtimeStatus === 'NEED_PARENT_INPUT';
        const terminalStopReason = runtimeStatus === 'BLOCKED' || runtimeStatus === 'NEED_PARENT_INPUT'
          ? (registryRecord?.stopReason || terminalNotification?.summary || runtimeSnapshot?.stopReason)
          : (registryRecord?.stopReason || runtimeSnapshot?.stopReason);
        const resultSummary = registryRecord?.resultSummary
          || terminalNotification?.summary
          || runtimeSnapshot?.lastToolSummary;
        const subagentEvents = isSubagentContainer
          ? buildSubagentEventEnvelopes({
              controlEvents: subagentControlEventsByTaskId.get(
                registryRecord?.taskId || msg.taskId || (msg.toolId ? subagentTaskIdByToolId.get(msg.toolId) : undefined) || terminalNotification?.taskId || '',
              ) || [],
              sessionId: String((msg as any).sessionId || registryRecord?.parentSessionId || ''),
              parentToolUseId: msg.toolId || registryRecord?.parentToolUseId || '',
              taskId: registryRecord?.taskId || msg.taskId || (msg.toolId ? subagentTaskIdByToolId.get(msg.toolId) : undefined) || terminalNotification?.taskId || '',
              threadId: registryRecord?.sessionId || registryRecord?.agentId || '',
              packageId: String((msg as any).packageId || ''),
              packageVersion: String((msg as any).packageVersion || ''),
              dialogInstanceId: String((msg as any).dialogInstanceId || ''),
              registryRecord,
              childTools,
            })
          : [];

        converted.push({
          id: msg.id,
          type: 'assistant',
          content: '',
          timestamp: msg.timestamp,
          isToolUse: true,
          toolName: msg.toolName,
          toolInput: typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput ?? '', null, 2),
          toolId: msg.toolId,
          toolResult: isAsyncLaunch ? null : toolResult,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? {
                taskId: registryRecord?.taskId || msg.taskId || (msg.toolId ? subagentTaskIdByToolId.get(msg.toolId) : undefined) || terminalNotification?.taskId,
                childTools,
                currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                isComplete: isTerminalRegistryStatus(registryRecord) || (Boolean(toolResult) && !isAsyncLaunch) || isTerminalRuntimeStatus,
                isAsyncLaunch,
                objective: registryRecord?.objective || runtimeSnapshot?.objective,
                currentStep: registryRecord?.currentStep ?? runtimeSnapshot?.currentStep,
                maxSteps: registryRecord?.maxSteps ?? runtimeSnapshot?.maxSteps,
                remainingSteps: registryRecord?.remainingSteps ?? runtimeSnapshot?.remainingSteps,
                startedAt: registryRecord?.startedAt ?? runtimeSnapshot?.startedAt,
                elapsedMs: runtimeSnapshot?.elapsedMs
                  ?? (registryRecord?.startedAt
                    ? (registryRecord.endedAt ?? registryRecord.updatedAt ?? Date.now()) - registryRecord.startedAt
                    : undefined),
                lastTool: registryRecord?.lastTool || runtimeSnapshot?.lastTool,
                lastToolSummary: registryRecord?.lastToolSummary || runtimeSnapshot?.lastToolSummary,
                resultSummary,
                evidence: registryRecord?.evidence,
                nextAction: registryRecord?.nextAction,
                changes: registryRecord?.changes,
                blockers: registryRecord?.blockers,
                runtimeStatus,
                stopReason: terminalStopReason,
                registryRecord,
                subagentEvents,
              }
            : undefined,
        });
        break;
      }

      case 'thinking':
        if (msg.content?.trim()) {
          converted.push({
            id: msg.id,
            type: 'assistant',
            content: unescapeWithMathProtection(msg.content),
            timestamp: msg.timestamp,
            isThinking: true,
          });
        }
        break;

      case 'error':
        converted.push({
          id: msg.id,
          type: 'error',
          content: msg.content || 'Unknown error',
          timestamp: msg.timestamp,
        });
        break;

      case 'interactive_prompt':
        converted.push({
          id: msg.id,
          type: 'assistant',
          content: msg.content || '',
          timestamp: msg.timestamp,
          isInteractivePrompt: true,
        });
        break;

      case 'task_notification':
        if (msg.toolId) {
          break;
        }
        converted.push({
          id: msg.id,
          type: 'assistant',
          content: msg.summary || 'Background task update',
          timestamp: msg.timestamp,
          isTaskNotification: true,
          taskStatus: msg.status || 'completed',
        });
        break;

      case 'context_compaction':
        converted.push({
          id: msg.id,
          type: 'system',
          content: msg.content || 'Conversation compacted',
          timestamp: msg.timestamp,
          isContextCompaction: true,
          compactType: msg.compactType,
          compactTrigger: msg.compactTrigger,
          compactSummary: msg.compactSummary || msg.summary,
          preTokens: msg.preTokens,
          tokensSaved: msg.tokensSaved,
          compactedToolIds: msg.compactedToolIds,
        });
        break;

      case 'stream_delta':
        if (msg.content) {
          converted.push({
            id: msg.id,
            type: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            isStreaming: true,
          });
        }
        break;

      // stream_end, complete, status, permission_*, session_created
      // are control events — not rendered as messages
      case 'stream_end':
      case 'complete':
      case 'status':
      case 'permission_request':
      case 'permission_cancelled':
      case 'session_created':
        // Skip — these are handled by useChatRealtimeHandlers
        break;

      // tool_result is handled via attachment to tool_use above
      case 'tool_result':
        break;

      default:
        break;
    }
  }

  return converted;
}
