import type { Provider } from '../types/types';

export type SubagentControlAction = 'wait' | 'send' | 'followup';

type ResumeOptions = Record<string, unknown>;

export interface SubagentControlRequestInput {
  action: SubagentControlAction;
  taskId?: string | null;
  content?: string;
  sessionId?: string | null;
  provider: Provider | string;
  clientMessageId?: string;
  sessionActive: boolean;
  resumeOptions?: ResumeOptions;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildSubagentControlPrompt({
  action,
  taskId,
  content = '',
}: {
  action: SubagentControlAction;
  taskId?: string | null;
  content?: string;
}): string {
  const normalizedTaskId = normalizeText(taskId);
  const normalizedContent = normalizeText(content);
  if (action === 'send') {
    return [
      `Call send_message for background task ${normalizedTaskId}.`,
      'Use this message exactly as parent guidance for that task:',
      normalizedContent,
    ].filter(Boolean).join('\n\n');
  }
  if (action === 'followup') {
    return [
      `Call followup_task for background task ${normalizedTaskId}.`,
      'Create the follow-up with this objective:',
      normalizedContent,
    ].filter(Boolean).join('\n\n');
  }
  return `Call wait_agent for background task ${normalizedTaskId} and summarize the latest status, blockers, result, and next action.`;
}

export function buildSubagentControlRequest(input: SubagentControlRequestInput) {
  const sessionId = normalizeText(input.sessionId);
  const taskId = normalizeText(input.taskId);
  if (input.provider !== 'claude' || !sessionId || !taskId) {
    return null;
  }

  const command = buildSubagentControlPrompt({
    action: input.action,
    taskId,
    content: input.content,
  });

  if (input.sessionActive) {
    return {
      type: 'claude-subagent-control',
      sessionId,
      taskId,
      action: input.action,
      content: normalizeText(input.content),
      clientMessageId: input.clientMessageId,
      subagentControl: {
        action: input.action,
        taskId,
      },
      fallback: {
        type: 'claude-guidance',
        sessionId,
        command,
        clientMessageId: input.clientMessageId,
        subagentControl: {
          action: input.action,
          taskId,
        },
      },
    };
  }

  return {
    type: 'claude-command',
    command,
    sessionId,
    options: {
      ...(input.resumeOptions || {}),
      sessionId,
      resume: true,
      clientMessageId: input.clientMessageId,
      subagentControl: {
        action: input.action,
        taskId,
      },
    },
  };
}
