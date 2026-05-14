import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionMessages: vi.fn(),
  getGeminiCliSessionMessages: vi.fn(),
}));

vi.mock('@/sessionManager.js', () => ({
  default: {
    getSessionMessages: mocks.getSessionMessages,
  },
}));

vi.mock('@/projects.js', () => ({
  getGeminiCliSessionMessages: mocks.getGeminiCliSessionMessages,
}));

import { CursorSessionsProvider } from '../../modules/providers/list/cursor/cursor-sessions.provider.js';
import { GeminiSessionsProvider } from '../../modules/providers/list/gemini/gemini-sessions.provider.js';

const geminiMessage = (index: number) => ({
  uuid: `gemini-${index}`,
  timestamp: `2024-01-01T00:00:0${index}.000Z`,
  role: index % 2 === 0 ? 'assistant' : 'user',
  content: `message-${index}`,
});

const cursorBlob = (index: number) => ({
  id: `cursor-${index}`,
  sequence: index,
  rowid: index,
  content: {
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `message-${index}`,
  },
});

describe('provider history pagination', () => {
  beforeEach(() => {
    mocks.getSessionMessages.mockReset();
    mocks.getGeminiCliSessionMessages.mockReset();
  });

  it('paginates Gemini history from the newest messages while preserving chronological page order', async () => {
    mocks.getSessionMessages.mockReturnValue([1, 2, 3, 4, 5].map(geminiMessage));

    const provider = new GeminiSessionsProvider();

    const firstPage = await provider.fetchHistory('gemini-session', { limit: 2, offset: 0 });
    expect(firstPage.messages.map((message) => message.content)).toEqual(['message-4', 'message-5']);
    expect(firstPage).toMatchObject({
      total: 5,
      hasMore: true,
      nextOffset: 2,
      offset: 0,
      limit: 2,
    });

    const secondPage = await provider.fetchHistory('gemini-session', { limit: 2, offset: 2 });
    expect(secondPage.messages.map((message) => message.content)).toEqual(['message-2', 'message-3']);
    expect(secondPage).toMatchObject({
      total: 5,
      hasMore: true,
      nextOffset: 4,
      offset: 2,
      limit: 2,
    });

    const finalPage = await provider.fetchHistory('gemini-session', { limit: 2, offset: 4 });
    expect(finalPage.messages.map((message) => message.content)).toEqual(['message-1']);
    expect(finalPage).toMatchObject({
      total: 5,
      hasMore: false,
      nextOffset: 5,
      offset: 4,
      limit: 2,
    });
  });

  it('paginates Cursor history from the newest messages while preserving chronological page order', async () => {
    const provider = new CursorSessionsProvider();
    vi.spyOn(provider as any, 'loadCursorBlobs').mockResolvedValue([1, 2, 3, 4, 5].map(cursorBlob));

    const firstPage = await provider.fetchHistory('cursor-session', {
      projectPath: 'E:/workspace',
      limit: 2,
      offset: 0,
    });
    expect(firstPage.messages.map((message) => message.content)).toEqual(['message-4', 'message-5']);
    expect(firstPage).toMatchObject({
      total: 5,
      hasMore: true,
      nextOffset: 2,
      offset: 0,
      limit: 2,
    });

    const secondPage = await provider.fetchHistory('cursor-session', {
      projectPath: 'E:/workspace',
      limit: 2,
      offset: 2,
    });
    expect(secondPage.messages.map((message) => message.content)).toEqual(['message-2', 'message-3']);
    expect(secondPage).toMatchObject({
      total: 5,
      hasMore: true,
      nextOffset: 4,
      offset: 2,
      limit: 2,
    });

    const finalPage = await provider.fetchHistory('cursor-session', {
      projectPath: 'E:/workspace',
      limit: 2,
      offset: 4,
    });
    expect(finalPage.messages.map((message) => message.content)).toEqual(['message-1']);
    expect(finalPage).toMatchObject({
      total: 5,
      hasMore: false,
      nextOffset: 5,
      offset: 4,
      limit: 2,
    });
  });
});
