import type { NormalizedMessage } from './useSessionStore';

type UpdateToolInputArgs = {
  toolId?: string | null;
  toolName?: string | null;
  originalInput?: unknown;
  updatedInput: unknown;
};

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

export function buildToolInputOverrideKey({
  toolId,
  toolName,
  originalInput,
}: {
  toolId?: string | null;
  toolName?: string | null;
  originalInput?: unknown;
}): string {
  const normalizedToolId = typeof toolId === 'string' ? toolId.trim() : '';
  if (normalizedToolId) {
    return `toolId:${normalizedToolId}`;
  }

  const normalizedToolName = typeof toolName === 'string' ? toolName.trim() : '';
  const originalInputKey = stableStringify(originalInput);
  return `toolName:${normalizedToolName}|input:${originalInputKey}`;
}

export function updateToolInputInMessages(
  messages: NormalizedMessage[],
  { toolId, toolName, originalInput, updatedInput }: UpdateToolInputArgs,
): NormalizedMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const normalizedToolId = typeof toolId === 'string' ? toolId.trim() : '';
  const normalizedToolName = typeof toolName === 'string' ? toolName.trim() : '';
  const originalInputKey = stableStringify(originalInput);

  let matchIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.kind !== 'tool_use') {
      continue;
    }
    if (normalizedToolId && message.toolId !== normalizedToolId) {
      continue;
    }
    if (!normalizedToolId && normalizedToolName && message.toolName !== normalizedToolName) {
      continue;
    }
    if (!normalizedToolId && originalInputKey && stableStringify(message.toolInput) !== originalInputKey) {
      continue;
    }
    matchIndex = index;
    break;
  }

  if (matchIndex < 0) {
    return messages;
  }

  const next = [...messages];
  next[matchIndex] = {
    ...next[matchIndex],
    toolInput: updatedInput,
  };
  return next;
}

export function applyToolInputOverrides(
  messages: NormalizedMessage[],
  overrides: Iterable<UpdateToolInputArgs>,
): NormalizedMessage[] {
  let nextMessages = messages;
  for (const override of overrides) {
    nextMessages = updateToolInputInMessages(nextMessages, override);
  }
  return nextMessages;
}
