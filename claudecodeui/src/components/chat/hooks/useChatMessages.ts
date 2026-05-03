/**
 * Message normalization utilities.
 * Converts NormalizedMessage[] from the session store into ChatMessage[] for the UI.
 */

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage, SubagentChildTool, ToolResult } from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection, formatUsageLimitText } from '../utils/chatFormatting';

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

/**
 * Convert NormalizedMessage[] from the session store into ChatMessage[]
 * that the existing UI components expect.
 *
 * Internal/system content (e.g. <system-reminder>, <command-name>) is already
 * filtered server-side by the Claude provider module.
 */
export function normalizedToChatMessages(messages: NormalizedMessage[]): ChatMessage[] {
  const converted: ChatMessage[] = [];

  // First pass: collect tool results for attachment
  const toolResultMap = new Map<string, NormalizedMessage>();
  for (const msg of messages) {
    if (msg.kind === 'tool_result' && msg.toolId) {
      toolResultMap.set(msg.toolId, msg);
    }
  }

  const subagentChildToolMap = new Map<string, SubagentChildTool[]>();
  for (const msg of messages) {
    if (msg.kind !== 'tool_use' || !msg.parentToolUseId) continue;
    const childToolId = msg.toolId || msg.id;
    const childTool: SubagentChildTool = {
      toolId: childToolId,
      toolName: msg.toolName || 'Tool',
      toolInput: msg.toolInput ?? '',
      toolResult: toToolResult(msg.toolResult || (childToolId ? toolResultMap.get(childToolId) : null)),
      timestamp: normalizeToolTimestamp(msg.timestamp),
    };
    const existing = subagentChildToolMap.get(msg.parentToolUseId) || [];
    subagentChildToolMap.set(msg.parentToolUseId, [...existing, childTool]);
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
          });
        } else {
          let text = decodeHtmlEntities(content);
          text = unescapeWithMathProtection(text);
          text = formatUsageLimitText(text);
          if (isInternalAgentFailureNarration(text)) {
            continue;
          }
          converted.push({
            id: msg.id,
            type: 'assistant',
            content: text,
            timestamp: msg.timestamp,
          });
        }
        break;
      }

      case 'tool_use': {
        const tr = msg.toolResult || (msg.toolId ? toolResultMap.get(msg.toolId) : null);
        const isSubagentContainer = msg.toolName === 'Task' || msg.toolName === 'Agent';

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

        converted.push({
          id: msg.id,
          type: 'assistant',
          content: '',
          timestamp: msg.timestamp,
          isToolUse: true,
          toolName: msg.toolName,
          toolInput: typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput ?? '', null, 2),
          toolId: msg.toolId,
          toolResult,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? {
                childTools,
                currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                isComplete: Boolean(toolResult),
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
