import type { ChatMessage } from '../types/types';

import { getIntrinsicMessageKey } from './messageKeys';

const readKeyPart = (value: unknown) => (
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
);

export const getStableChatAutoCaptureMessageKey = (message: ChatMessage) => {
  const intrinsicKey = getIntrinsicMessageKey(message);
  if (intrinsicKey) {
    return intrinsicKey;
  }

  const timestamp = new Date(message.timestamp || Date.now()).getTime();
  const safeTimestamp = Number.isFinite(timestamp) ? String(timestamp) : 'no-time';
  const content = typeof message.content === 'string' ? message.content.slice(0, 120) : '';
  return [
    'message',
    readKeyPart(message.type) || 'assistant',
    safeTimestamp,
    content,
  ].join('-');
};

export const buildChatAutoCaptureSourceId = ({
  sessionId = '',
  message,
}: {
  sessionId?: string | null;
  message: ChatMessage;
}) => [
  'chat',
  readKeyPart(sessionId) || 'no-session',
  getStableChatAutoCaptureMessageKey(message),
].join(':');
