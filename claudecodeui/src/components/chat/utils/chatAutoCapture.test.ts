import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';

import {
  buildChatAutoCaptureSourceId,
  getStableChatAutoCaptureMessageKey,
} from './chatAutoCapture';

describe('chat auto-capture source ids', () => {
  it('uses the intrinsic message id instead of unstable render suffixes', () => {
    const message: ChatMessage = {
      type: 'assistant',
      id: 'assistant-b77f2922-f8cd-46dc-834b-8eeeea568440_0',
      content: '# GPUDrivenStreaming 代码审查总结\n\n- 决策: 保留自动捕获。',
      timestamp: '2026-05-07T11:21:46.862Z',
    };

    expect(getStableChatAutoCaptureMessageKey(message)).toBe(
      'message-assistant-assistant-b77f2922-f8cd-46dc-834b-8eeeea568440_0',
    );
    expect(buildChatAutoCaptureSourceId({
      sessionId: '2001c532-daf9-4392-a33b-080c2c650d89',
      message,
    })).toBe(
      'chat:2001c532-daf9-4392-a33b-080c2c650d89:message-assistant-assistant-b77f2922-f8cd-46dc-834b-8eeeea568440_0',
    );
  });
});
