import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';
import {
  createMessageRenderKeyLookup,
  getIntrinsicMessageKey,
} from './messageKeys';

const timestamp = new Date('2026-05-09T00:00:00.000Z');

function chatMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    type: 'assistant',
    content: 'hello',
    timestamp,
    ...overrides,
  } as ChatMessage;
}

describe('message render keys', () => {
  it('keeps the same intrinsic key when the same persisted message is rebuilt', () => {
    const first = chatMessage({ id: 'assistant-1' });
    const rebuilt = chatMessage({ id: 'assistant-1' });

    expect(getIntrinsicMessageKey(first)).toBe(getIntrinsicMessageKey(rebuilt));
    expect(createMessageRenderKeyLookup([first]).getKey(first))
      .toBe(createMessageRenderKeyLookup([rebuilt]).getKey(rebuilt));
  });

  it('adds suffixes only for duplicate keys in the current render pass', () => {
    const first = chatMessage({ id: 'assistant-1', content: 'first' });
    const duplicate = chatMessage({ id: 'assistant-1', content: 'duplicate' });
    const rebuiltFirst = chatMessage({ id: 'assistant-1', content: 'rebuilt' });

    const duplicatedLookup = createMessageRenderKeyLookup([first, duplicate]);
    expect(duplicatedLookup.getKey(first)).toBe('message-assistant-assistant-1');
    expect(duplicatedLookup.getKey(duplicate)).toBe('message-assistant-assistant-1-1');

    expect(createMessageRenderKeyLookup([rebuiltFirst]).getKey(rebuiltFirst))
      .toBe('message-assistant-assistant-1');
  });
});
