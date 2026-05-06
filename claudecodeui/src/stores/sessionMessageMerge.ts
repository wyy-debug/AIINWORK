import type { NormalizedMessage } from './useSessionStore';

const MAX_REALTIME_MESSAGES = 500;
const USER_ECHO_DEDUPE_WINDOW_MS = 5_000;

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

function isOptimisticUserMessage(message: NormalizedMessage): boolean {
  return isUserTextMessage(message)
    && (message.id.startsWith('client_user_') || message.id.startsWith('local_'));
}

function isControlMessage(message: NormalizedMessage): boolean {
  return message.kind === 'session_created'
    || message.kind === 'status'
    || message.kind === 'complete'
    || message.kind === 'permission_request'
    || message.kind === 'permission_cancelled'
    || message.kind === 'stream_end';
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

function findOptimisticUserEchoIndex(
  messages: NormalizedMessage[],
  incoming: NormalizedMessage,
): number {
  if (!isUserTextMessage(incoming) || isOptimisticUserMessage(incoming)) return -1;

  for (let index = 0; index < messages.length; index += 1) {
    const existing = messages[index];
    if (
      isOptimisticUserMessage(existing)
      && isUserTextMessage(existing)
      && isLaterServerEcho(incoming, existing)
    ) {
      return index;
    }

    if (!isControlMessage(existing)) {
      return -1;
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
    if (!isUserTextMessage(serverMessage) || isOptimisticUserMessage(serverMessage)) continue;

    for (let index = 0; index < realtimeMessages.length; index += 1) {
      if (covered.has(index)) continue;
      const realtimeMessage = realtimeMessages[index];
      if (isOptimisticUserMessage(realtimeMessage) && isLaterServerEcho(serverMessage, realtimeMessage)) {
        covered.add(index);
        break;
      }
    }
  }

  return covered;
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

  return extra.length === 0 ? serverMessages : [...serverMessages, ...extra];
}

export function retainRealtimeAfterServerRefresh(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0 || serverMessages.length === 0) return realtimeMessages;

  const covered = getCoveredRealtimeIndexes(serverMessages, realtimeMessages);
  return realtimeMessages.filter((_, index) => !covered.has(index));
}
