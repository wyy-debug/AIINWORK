import type { NormalizedMessage } from './useSessionStore';

const MAX_REALTIME_MESSAGES = 500;
const USER_ECHO_DEDUPE_WINDOW_MS = 5_000;
const ASSISTANT_ECHO_DEDUPE_WINDOW_MS = 15_000;
const ASSISTANT_DUPLICATE_WINDOW_MS = 5_000;

function normalizeUserContent(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return normalized.length > 0 ? normalized : null;
}

function timestampMs(message: NormalizedMessage): number | null {
  const value = new Date(message.timestamp).getTime();
  return Number.isFinite(value) ? value : null;
}

function isUserTextMessage(message: NormalizedMessage): boolean {
  return message.kind === 'text' && message.role === 'user' && Boolean(normalizeUserContent(message.content));
}

function isAssistantTextMessage(message: NormalizedMessage): boolean {
  return message.kind === 'text' && message.role === 'assistant' && Boolean(normalizeUserContent(message.content));
}

function isOptimisticUserMessage(message: NormalizedMessage): boolean {
  return isUserTextMessage(message)
    && (message.id.startsWith('client_user_') || message.id.startsWith('local_'));
}

function isOptimisticAssistantMessage(message: NormalizedMessage): boolean {
  return isAssistantTextMessage(message)
    && (
      message.id.startsWith('text_')
      || message.id.startsWith('local_')
      || message.id.startsWith('client_assistant_')
    );
}

function isLaterServerEcho(serverMessage: NormalizedMessage, optimisticMessage: NormalizedMessage): boolean {
  const serverContent = normalizeUserContent(serverMessage.content);
  const optimisticContent = normalizeUserContent(optimisticMessage.content);
  if (!serverContent || !optimisticContent || serverContent !== optimisticContent) return false;

  const serverTimestamp = timestampMs(serverMessage);
  const optimisticTimestamp = timestampMs(optimisticMessage);
  if (serverTimestamp === null || optimisticTimestamp === null) return false;
  if (serverTimestamp < optimisticTimestamp) return false;

  return serverTimestamp - optimisticTimestamp <= USER_ECHO_DEDUPE_WINDOW_MS;
}

function isAssistantServerEcho(serverMessage: NormalizedMessage, optimisticMessage: NormalizedMessage): boolean {
  const serverContent = normalizeUserContent(serverMessage.content);
  const optimisticContent = normalizeUserContent(optimisticMessage.content);
  if (!serverContent || !optimisticContent || serverContent !== optimisticContent) return false;

  const serverTimestamp = timestampMs(serverMessage);
  const optimisticTimestamp = timestampMs(optimisticMessage);
  if (serverTimestamp === null || optimisticTimestamp === null) return false;

  return Math.abs(serverTimestamp - optimisticTimestamp) <= ASSISTANT_ECHO_DEDUPE_WINDOW_MS;
}

function isAssistantRealtimeDuplicate(
  existingMessage: NormalizedMessage,
  incomingMessage: NormalizedMessage,
): boolean {
  if (!isAssistantTextMessage(existingMessage) || !isAssistantTextMessage(incomingMessage)) {
    return false;
  }

  const existingContent = normalizeUserContent(existingMessage.content);
  const incomingContent = normalizeUserContent(incomingMessage.content);
  if (!existingContent || !incomingContent || existingContent !== incomingContent) {
    return false;
  }

  const existingTimestamp = timestampMs(existingMessage);
  const incomingTimestamp = timestampMs(incomingMessage);
  if (existingTimestamp === null || incomingTimestamp === null) {
    return false;
  }

  return Math.abs(incomingTimestamp - existingTimestamp) <= ASSISTANT_DUPLICATE_WINDOW_MS;
}

function isCoveredByServerEcho(serverMessage: NormalizedMessage, realtimeMessage: NormalizedMessage): boolean {
  if (isOptimisticUserMessage(realtimeMessage) && isUserTextMessage(serverMessage)) {
    return isLaterServerEcho(serverMessage, realtimeMessage);
  }

  if (isAssistantTextMessage(realtimeMessage) && isAssistantTextMessage(serverMessage)) {
    return isAssistantServerEcho(serverMessage, realtimeMessage);
  }

  return false;
}

function findOptimisticUserEchoIndex(
  messages: NormalizedMessage[],
  incoming: NormalizedMessage,
): number {
  if (isAssistantTextMessage(incoming)) {
    for (let index = 0; index < messages.length; index += 1) {
      if (isAssistantRealtimeDuplicate(messages[index], incoming)) {
        return index;
      }
    }
  }

  if (
    (!isUserTextMessage(incoming) || isOptimisticUserMessage(incoming))
    && (!isAssistantTextMessage(incoming) || isOptimisticAssistantMessage(incoming))
  ) {
    return -1;
  }

  for (let index = 0; index < messages.length; index += 1) {
    const existing = messages[index];
    if (isCoveredByServerEcho(incoming, existing)) {
      return index;
    }
  }

  return -1;
}

function getCoveredRealtimeIndexes(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): Set<number> {
  const covered = new Set<number>();
  const serverIds = new Set(serverMessages.map((message) => message.id));

  realtimeMessages.forEach((message, index) => {
    if (serverIds.has(message.id)) {
      covered.add(index);
    }
  });

  for (const serverMessage of serverMessages) {
    for (let index = 0; index < realtimeMessages.length; index += 1) {
      if (covered.has(index)) continue;
      const realtimeMessage = realtimeMessages[index];
      if (isCoveredByServerEcho(serverMessage, realtimeMessage)) {
        covered.add(index);
        break;
      }
    }
  }

  return covered;
}

function mergeRealtimeIntoServerTimeline(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  const merged = [...serverMessages];

  for (const realtimeMessage of realtimeMessages) {
    const realtimeTime = timestampMs(realtimeMessage);
    if (realtimeTime === null || merged.length === 0) {
      merged.push(realtimeMessage);
      continue;
    }

    let insertionIndex = merged.length;
    for (let index = 0; index < merged.length; index += 1) {
      const candidateTime = timestampMs(merged[index]);
      if (candidateTime !== null && candidateTime > realtimeTime) {
        insertionIndex = Math.max(1, index);
        break;
      }
    }

    merged.splice(insertionIndex, 0, realtimeMessage);
  }

  return merged;
}

export function appendRealtimeMessage(
  realtimeMessages: NormalizedMessage[],
  message: NormalizedMessage,
): NormalizedMessage[] {
  const existingIndex = realtimeMessages.findIndex((candidate) => candidate.id === message.id);
  const optimisticEchoIndex = existingIndex >= 0
    ? existingIndex
    : findOptimisticUserEchoIndex(realtimeMessages, message);

  let updated: NormalizedMessage[];
  if (optimisticEchoIndex >= 0) {
    updated = [...realtimeMessages];
    updated[optimisticEchoIndex] = message;
  } else {
    updated = [...realtimeMessages, message];
  }

  return updated.length > MAX_REALTIME_MESSAGES
    ? updated.slice(-MAX_REALTIME_MESSAGES)
    : updated;
}

export function computeMergedMessages(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0) return serverMessages;
  if (serverMessages.length === 0) return realtimeMessages;

  const covered = getCoveredRealtimeIndexes(serverMessages, realtimeMessages);
  const extra = realtimeMessages.filter((_, index) => !covered.has(index));

  return extra.length === 0 ? serverMessages : mergeRealtimeIntoServerTimeline(serverMessages, extra);
}

export function retainRealtimeAfterServerRefresh(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0 || serverMessages.length === 0) return realtimeMessages;

  const covered = getCoveredRealtimeIndexes(serverMessages, realtimeMessages);
  return realtimeMessages.filter((_, index) => !covered.has(index));
}
