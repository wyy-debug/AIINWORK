import { getSessionMessages } from '@/projects.js';
import { sessionAgentBindingsDb } from '@/database/db.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'claude';

type ClaudeToolResult = {
  content: unknown;
  isError: boolean;
  subagentTools?: unknown;
  subagentRuntime?: unknown;
  toolUseResult?: unknown;
};

type ClaudeHistoryResult =
  | AnyRecord[]
  | {
      messages?: AnyRecord[];
      total?: number;
      hasMore?: boolean;
      tokenUsage?: unknown;
    };

const loadClaudeSessionMessages = getSessionMessages as unknown as (
  projectName: string,
  sessionId: string,
  limit: number | null,
  offset: number,
  options?: { modelProfileId?: string | null },
) => Promise<ClaudeHistoryResult>;

/**
 * Claude writes internal command and system reminder entries into history.
 * Those are useful for the CLI but should not appear in the user-facing chat.
 */
const INTERNAL_CONTENT_PREFIXES = [
  '<argus-internal-fallback>',
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<system-reminder>',
  'Caveat:',
  'This session is being continued from a previous',
  '[Request interrupted',
] as const;

function isInternalContent(content: string): boolean {
  const trimmed = content.trimStart();
  return INTERNAL_CONTENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
    || isInjectedSkillInstructionContent(trimmed)
    || isTaskNotificationContent(trimmed);
}

function stripHiddenUserContext(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n?\s*\[Images provided at the following paths:\][\s\S]*?(?=\n\s*\n|$)/i, '')
    .replace(/\n?\s*\[Images given:[\s\S]*?images are located at the following paths:\][\s\S]*?(?=\n\s*\n|$)/i, '')
    .replace(/\n?\s*## Screenshot analysis[\s\S]*$/i, '')
    .trim();
}

function isInjectedSkillInstructionContent(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('Base directory for this skill:')) {
    return false;
  }

  return /\n\s*#\s+.+Skill\b/i.test(trimmed)
    || /\n\s*##\s+(When To Use|Required Runtime|Preferred Workflow|Output Rules)\b/i.test(trimmed);
}

function getUserTextContent(raw: AnyRecord): string {
  const content = raw.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part: AnyRecord) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: AnyRecord) => part.text)
      .join('\n');
  }
  return '';
}

function isSyntheticInternalUserRecord(raw: AnyRecord): boolean {
  return raw.message?.role === 'user'
    && raw.isSynthetic === true
    && isInternalContent(getUserTextContent(raw));
}

function isTaskNotificationContent(content: string): boolean {
  const trimmed = content.trimStart();
  return /^<task-notification\b/i.test(trimmed)
    || /^&lt;task-notification\b/i.test(trimmed);
}

function decodeBasicEntities(content: string): string {
  return content
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getXmlTag(content: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = content.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function normalizeTaskStatus(value: unknown): string {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (status === 'completed' || status === 'failed' || status === 'killed') {
    return status;
  }
  return 'completed';
}

function taskNotificationFromContent(content: string): {
  taskId?: string;
  toolId?: string;
  status: string;
  summary?: string;
} | null {
  if (!isTaskNotificationContent(content)) return null;
  const decoded = decodeBasicEntities(content);
  return {
    taskId: getXmlTag(decoded, 'task-id'),
    toolId: getXmlTag(decoded, 'tool-use-id'),
    status: normalizeTaskStatus(getXmlTag(decoded, 'status')),
    summary: getXmlTag(decoded, 'summary') || getXmlTag(decoded, 'result'),
  };
}

function isInternalAgentFailureNarration(content: string): boolean {
  const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized.includes('i literally cannot stop myself')
    || normalized.includes('pathological at this point')
    || normalized.includes('every single agent i launch')
    || normalized.includes('provide the user with the complete updated code')
    || normalized.includes('they can replace their existing file with the new version');
}

function isCompactBoundaryRecord(raw: AnyRecord): boolean {
  return raw.type === 'system'
    && (raw.subtype === 'compact_boundary' || raw.subtype === 'microcompact_boundary');
}

function getStableCompactRecordId(raw: AnyRecord, sessionId: string, index: number): string {
  return typeof raw.uuid === 'string' && raw.uuid
    ? raw.uuid
    : `claude_compaction_${sessionId}_${index}`;
}

function getCompactSummaryContent(raw: AnyRecord | undefined): string | null {
  if (!raw || raw.message?.role !== 'user' || typeof raw.message?.content !== 'string') {
    return null;
  }

  const content = raw.message.content;
  const looksLikeCompactSummary = raw.isCompactSummary === true
    || content.startsWith('This session is being continued from a previous conversation that ran out of context.');

  if (!looksLikeCompactSummary) {
    return null;
  }

  const summaryMarker = '\n\nSummary:';
  const summaryStart = content.indexOf(summaryMarker);
  let summary = summaryStart >= 0
    ? content.slice(summaryStart + summaryMarker.length)
    : content;

  const detailsMarker = '\n\nIf you need specific details from before compaction';
  const detailsStart = summary.indexOf(detailsMarker);
  if (detailsStart >= 0) {
    summary = summary.slice(0, detailsStart);
  }

  return summary.trim() || null;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getCompactTrigger(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const trigger = (metadata as AnyRecord).trigger;
  return typeof trigger === 'string' && trigger.trim() ? trigger.trim() : undefined;
}

export class ClaudeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes one Claude JSONL entry or live SDK stream event into the shared
   * message shape consumed by REST and WebSocket clients.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    const messages: NormalizedMessage[] = [];
    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('claude');

    if (raw.type === 'content_block_delta' && raw.delta?.text) {
      return [createNormalizedMessage({ kind: 'stream_delta', content: raw.delta.text, sessionId, provider: PROVIDER })];
    }
    if (raw.type === 'content_block_stop') {
      return [createNormalizedMessage({ kind: 'stream_end', sessionId, provider: PROVIDER })];
    }

    if (raw.type === 'system' && raw.subtype === 'task_started') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'status',
        status: 'subagent_started',
        toolId: typeof raw.tool_use_id === 'string' ? raw.tool_use_id : undefined,
        taskId: typeof raw.task_id === 'string' ? raw.task_id : undefined,
        content: typeof raw.description === 'string' ? raw.description : undefined,
        summary: typeof raw.description === 'string' ? raw.description : undefined,
        taskType: raw.task_type,
        workflowName: raw.workflow_name,
        prompt: raw.prompt,
      })];
    }

    if (raw.type === 'system' && raw.subtype === 'task_progress') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'status',
        status: 'subagent_progress',
        toolId: typeof raw.tool_use_id === 'string' ? raw.tool_use_id : undefined,
        taskId: raw.task_id,
        content: raw.description,
        summary: raw.summary,
        usage: raw.usage,
        lastToolName: raw.last_tool_name,
        subagentRuntime: raw.subagent_runtime,
        subagentRecord: raw.subagent_record,
        subagentSnapshot: raw.subagent_snapshot,
        subagentEvents: raw.subagent_events,
      })];
    }

    if (raw.type === 'system' && raw.subtype === 'task_notification') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'task_notification',
        taskId: typeof raw.task_id === 'string' ? raw.task_id : undefined,
        toolId: typeof raw.tool_use_id === 'string' ? raw.tool_use_id : undefined,
        status: normalizeTaskStatus(raw.status),
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        usage: raw.usage,
        subagentRecord: raw.subagent_record,
        subagentEvents: raw.subagent_events,
      })];
    }

    if (
      raw.type === 'system' &&
      (
        raw.subtype === 'thread_goal_updated' ||
        raw.subtype === 'thread_goal_cleared' ||
        raw.subtype === 'thread_goal_lifecycle'
      )
    ) {
      const eventType = raw.subtype;
      return [createNormalizedMessage({
        id: baseId,
        sessionId: typeof raw.session_id === 'string' ? raw.session_id : sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'status',
        type: eventType,
        event: eventType,
        eventId: typeof raw.event_id === 'number' ? raw.event_id : undefined,
        goalId: typeof raw.goal_id === 'string' ? raw.goal_id : null,
        goal: raw.goal ?? null,
        lifecycleType: typeof raw.lifecycle_type === 'string' ? raw.lifecycle_type : null,
        payload: raw.payload ?? null,
      })];
    }

    if (isCompactBoundaryRecord(raw)) {
      const compactMetadata = raw.compactMetadata || raw.compact_metadata || {};
      const microcompactMetadata = raw.microcompactMetadata || raw.microcompact_metadata || {};
      const isMicrocompact = raw.subtype === 'microcompact_boundary';
      const metadata = isMicrocompact ? microcompactMetadata : compactMetadata;

      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'context_compaction',
        compactType: isMicrocompact ? 'micro' : 'full',
        content: typeof raw.content === 'string'
          ? raw.content
          : (isMicrocompact ? 'Context microcompacted' : 'Conversation compacted'),
        compactTrigger: getCompactTrigger(metadata),
        compactMetadata,
        microcompactMetadata,
        preTokens: getNumber((metadata as AnyRecord).preTokens ?? (metadata as AnyRecord).pre_tokens),
        tokensSaved: getNumber((metadata as AnyRecord).tokensSaved ?? (metadata as AnyRecord).tokens_saved),
        compactedToolIds: (metadata as AnyRecord).compactedToolIds ?? (metadata as AnyRecord).compacted_tool_ids,
      })];
    }

    if (isSyntheticInternalUserRecord(raw)) {
      return [];
    }

    const compactSummary = getCompactSummaryContent(raw);
    if (compactSummary) {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'context_compaction',
        compactType: 'summary',
        content: 'Compaction summary',
        compactSummaryAvailable: true,
      })];
    }

    if (raw.message?.role === 'user' && raw.message?.content) {
      if (Array.isArray(raw.message.content)) {
        for (let partIndex = 0; partIndex < raw.message.content.length; partIndex++) {
          const part = raw.message.content[partIndex];
          if (part.type === 'tool_result') {
            messages.push(createNormalizedMessage({
              id: `${baseId}_tr_${part.tool_use_id}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: part.tool_use_id,
              content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
              isError: Boolean(part.is_error),
              subagentTools: raw.subagentTools,
              subagentRuntime: raw.subagentRuntime,
              toolUseResult: raw.toolUseResult,
            }));
          } else if (part.type === 'text') {
            const text = stripHiddenUserContext(part.text || '');
            const taskNotification = taskNotificationFromContent(text);
            if (taskNotification) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_task_notification_${partIndex}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'task_notification',
                taskId: taskNotification.taskId,
                toolId: taskNotification.toolId,
                status: taskNotification.status,
                summary: taskNotification.summary,
              }));
            } else if (text && !isInternalContent(text)) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_text_${partIndex}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role: 'user',
                content: text,
              }));
            }
          }
        }

        if (messages.length === 0) {
          const textParts = raw.message.content
            .filter((part: AnyRecord) => part.type === 'text')
            .map((part: AnyRecord) => part.text)
            .filter(Boolean)
            .join('\n');
          const visibleTextParts = stripHiddenUserContext(textParts);
          if (visibleTextParts && !isInternalContent(visibleTextParts)) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_text`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'user',
              content: visibleTextParts,
            }));
          }
        }
      } else if (typeof raw.message.content === 'string') {
        const text = stripHiddenUserContext(raw.message.content);
        const taskNotification = taskNotificationFromContent(text);
        if (taskNotification) {
          messages.push(createNormalizedMessage({
            id: `${baseId}_task_notification`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'task_notification',
            taskId: taskNotification.taskId,
            toolId: taskNotification.toolId,
            status: taskNotification.status,
            summary: taskNotification.summary,
          }));
        } else if (text && !isInternalContent(text)) {
          messages.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'user',
            content: text,
          }));
        }
      }
      return messages;
    }

    if (raw.type === 'thinking' && raw.message?.content) {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'thinking',
        content: raw.message.content,
      }));
      return messages;
    }

    if (raw.type === 'tool_use' && raw.toolName) {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName,
        toolInput: raw.toolInput,
        toolId: raw.toolCallId || baseId,
        subagentTools: raw.subagentTools,
        subagentRuntime: raw.subagentRuntime,
      }));
      return messages;
    }

    if (raw.type === 'tool_result') {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.toolCallId || '',
        content: raw.output || '',
        isError: false,
      }));
      return messages;
    }

    if (raw.message?.role === 'assistant' && raw.message?.content) {
      if (Array.isArray(raw.message.content)) {
        let partIndex = 0;
        for (const part of raw.message.content) {
          if (part.type === 'text' && part.text) {
            if (isInternalAgentFailureNarration(part.text)) {
              partIndex++;
              continue;
            }
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'assistant',
              content: part.text,
            }));
          } else if (part.type === 'tool_use') {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_use',
              toolName: part.name,
              toolInput: part.input,
              toolId: part.id,
              subagentTools: raw.subagentTools,
              subagentRuntime: raw.subagentRuntime,
            }));
          } else if (part.type === 'thinking' && part.thinking) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'thinking',
              content: part.thinking,
            }));
          }
          partIndex++;
        }
      } else if (typeof raw.message.content === 'string') {
        if (isInternalAgentFailureNarration(raw.message.content)) {
          return messages;
        }
        messages.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: raw.message.content,
        }));
      }
      return messages;
    }

    return messages;
  }

  /**
   * Loads Claude JSONL history for a project/session and returns normalized
   * messages, preserving the existing pagination behavior from projects.js.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { projectName, limit = null, offset = 0 } = options;
    if (!projectName) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    let result: ClaudeHistoryResult;
    try {
      const modelProfileId = sessionAgentBindingsDb
        .getBinding(sessionId, PROVIDER)
        ?.configuration
        ?.modelProfileId || null;
      result = await loadClaudeSessionMessages(projectName, sessionId, limit, offset, { modelProfileId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ClaudeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const rawMessages = Array.isArray(result) ? result : (result.messages || []);
    const total = Array.isArray(result) ? rawMessages.length : (result.total || 0);
    const hasMore = Array.isArray(result) ? false : Boolean(result.hasMore);

    const toolResultMap = new Map<string, ClaudeToolResult>();
    for (const raw of rawMessages) {
      if (raw.message?.role === 'user' && Array.isArray(raw.message?.content)) {
        for (const part of raw.message.content) {
          if (part.type === 'tool_result' && part.tool_use_id) {
            toolResultMap.set(part.tool_use_id, {
              content: part.content,
              isError: Boolean(part.is_error),
              subagentTools: raw.subagentTools,
              subagentRuntime: raw.subagentRuntime,
              toolUseResult: raw.toolUseResult,
            });
          }
        }
      }
    }

    const normalized: NormalizedMessage[] = [];
    for (let index = 0; index < rawMessages.length; index++) {
      const raw = rawMessages[index];
      if (isCompactBoundaryRecord(raw)) {
        const events = this.normalizeMessage(raw, sessionId);
        const compactId = getStableCompactRecordId(raw, sessionId, offset + index);
        const compactSummary = getCompactSummaryContent(rawMessages[index + 1]);
        for (const event of events) {
          if (event.kind === 'context_compaction') {
            event.id = compactId;
          }
        }
        if (compactSummary) {
          for (const event of events) {
            if (event.kind === 'context_compaction') {
              event.compactSummaryAvailable = true;
            }
          }
          index++;
        }
        normalized.push(...events);
        continue;
      }

      const events = this.normalizeMessage(raw, sessionId);
      if (getCompactSummaryContent(raw)) {
        const compactId = getStableCompactRecordId(raw, sessionId, offset + index);
        for (const event of events) {
          if (event.kind === 'context_compaction') {
            event.id = compactId;
          }
        }
      }
      normalized.push(...events);
    }

    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (!toolResult) {
          continue;
        }

        msg.toolResult = {
          content: typeof toolResult.content === 'string'
            ? toolResult.content
            : JSON.stringify(toolResult.content),
          isError: toolResult.isError,
          toolUseResult: toolResult.toolUseResult,
        };
        msg.subagentTools = toolResult.subagentTools;
        msg.subagentRuntime = toolResult.subagentRuntime;
      }
    }

    return {
      messages: normalized,
      total,
      hasMore,
      nextOffset: limit === null ? total : offset + rawMessages.length,
      offset,
      limit,
      tokenUsage: Array.isArray(result) ? undefined : result.tokenUsage,
    };
  }

  async fetchCompactionSummary(
    sessionId: string,
    options: FetchHistoryOptions & { messageId?: string } = {},
  ): Promise<{ summary: string | null; found: boolean }> {
    const { projectName, messageId = '' } = options;
    if (!projectName || !messageId) {
      return { summary: null, found: false };
    }

    let result: ClaudeHistoryResult;
    try {
      const modelProfileId = sessionAgentBindingsDb
        .getBinding(sessionId, PROVIDER)
        ?.configuration
        ?.modelProfileId || null;
      result = await loadClaudeSessionMessages(projectName, sessionId, null, 0, { modelProfileId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ClaudeProvider] Failed to load compaction summary ${sessionId}:`, message);
      return { summary: null, found: false };
    }

    const rawMessages = Array.isArray(result) ? result : (result.messages || []);
    for (let index = 0; index < rawMessages.length; index += 1) {
      const raw = rawMessages[index];
      const summary = getCompactSummaryContent(raw);
      if (!isCompactBoundaryRecord(raw) && !summary) {
        continue;
      }

      const compactId = getStableCompactRecordId(raw, sessionId, index);
      if (compactId !== messageId) {
        continue;
      }

      if (isCompactBoundaryRecord(raw)) {
        const nextSummary = getCompactSummaryContent(rawMessages[index + 1]);
        return { summary: nextSummary, found: Boolean(nextSummary) };
      }

      return { summary, found: Boolean(summary) };
    }

    return { summary: null, found: false };
  }
}
