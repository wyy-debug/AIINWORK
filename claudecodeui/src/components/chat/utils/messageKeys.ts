import type { ChatMessage } from '../types/types';

const toMessageKeyPart = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const getIntrinsicMessageKey = (message: ChatMessage): string | null => {
  const candidates = [
    message.id,
    message.messageId,
    message.toolId,
    message.toolCallId,
    message.blobId,
    message.rowid,
    message.sequence,
  ];

  for (const candidate of candidates) {
    const keyPart = toMessageKeyPart(candidate);
    if (keyPart) {
      return `message-${message.type}-${keyPart}`;
    }
  }

  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const contentPreview = typeof message.content === 'string' ? message.content.slice(0, 48) : '';
  const toolName = typeof message.toolName === 'string' ? message.toolName : '';
  return `message-${message.type}-${timestamp}-${toolName}-${contentPreview}`;
};

export type MessageRenderKeyLookup = {
  getKey: (message: ChatMessage) => string;
};

export const createMessageRenderKeyLookup = (
  messages: readonly ChatMessage[],
): MessageRenderKeyLookup => {
  const keyByMessage = new Map<ChatMessage, string>();
  const seenKeys = new Map<string, number>();

  messages.forEach((message, index) => {
    const baseKey = getIntrinsicMessageKey(message) || `message-generated-${index}`;
    const seenCount = seenKeys.get(baseKey) || 0;
    seenKeys.set(baseKey, seenCount + 1);
    keyByMessage.set(message, seenCount === 0 ? baseKey : `${baseKey}-${seenCount}`);
  });

  return {
    getKey(message) {
      return keyByMessage.get(message)
        || getIntrinsicMessageKey(message)
        || 'message-generated-unmapped';
    },
  };
};
