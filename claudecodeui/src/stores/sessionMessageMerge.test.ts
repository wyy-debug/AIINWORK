import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from './useSessionStore';
import {
  appendRealtimeMessage,
  computeMergedMessages,
  retainRealtimeAfterServerRefresh,
} from './sessionMessageMerge';

function userMessage(id: string, content: string, timestamp: string): NormalizedMessage {
  return {
    id,
    sessionId: 'session-1',
    timestamp,
    provider: 'claude',
    kind: 'text',
    role: 'user',
    content,
  };
}

function assistantMessage(id: string, content: string, timestamp: string): NormalizedMessage {
  return {
    id,
    sessionId: 'session-1',
    timestamp,
    provider: 'claude',
    kind: 'text',
    role: 'assistant',
    content,
  };
}

function statusMessage(id: string, timestamp = '2026-05-06T10:00:00.000Z'): NormalizedMessage {
  return {
    id,
    sessionId: 'session-1',
    timestamp,
    provider: 'claude',
    kind: 'permission_request',
    requestId: id,
  };
}

describe('session message merge helpers', () => {
  it('keeps repeated optimistic user messages instead of collapsing by text', () => {
    const first = userMessage('local_1', '继续', '2026-05-06T10:00:00.000Z');
    const second = userMessage('local_2', '继续', '2026-05-06T10:00:01.000Z');

    const realtime = appendRealtimeMessage(
      appendRealtimeMessage([], first),
      second,
    );

    expect(realtime.map((message) => message.id)).toEqual(['local_1', 'local_2']);
  });

  it('replaces an optimistic user message when the later server echo arrives', () => {
    const optimistic = userMessage('local_1', '继续', '2026-05-06T10:00:00.000Z');
    const echo = userMessage('server_1', '继续', '2026-05-06T10:00:02.000Z');

    const realtime = appendRealtimeMessage([optimistic], echo);

    expect(realtime.map((message) => message.id)).toEqual(['server_1']);
  });

  it('matches a server echo to only the first repeated optimistic user message', () => {
    const first = userMessage('local_1', '继续', '2026-05-06T10:00:00.000Z');
    const second = userMessage('local_2', '继续', '2026-05-06T10:00:01.000Z');
    const echo = userMessage('server_1', '继续', '2026-05-06T10:00:02.000Z');

    const realtime = appendRealtimeMessage([first, second], echo);

    expect(realtime.map((message) => message.id)).toEqual(['server_1', 'local_2']);
  });

  it('does not hide a new repeated optimistic message behind an older server message', () => {
    const server = [userMessage('server_1', '继续', '2026-05-06T10:00:00.000Z')];
    const realtime = [userMessage('local_2', '继续', '2026-05-06T10:00:02.000Z')];

    const merged = computeMergedMessages(server, realtime);

    expect(merged.map((message) => message.id)).toEqual(['server_1', 'local_2']);
  });

  it('retains realtime messages that a server refresh has not covered yet', () => {
    const server = [
      userMessage('server_1', '继续', '2026-05-06T10:00:02.000Z'),
      statusMessage('persisted_permission'),
    ];
    const realtime = [
      userMessage('local_1', '继续', '2026-05-06T10:00:00.000Z'),
      statusMessage('persisted_permission'),
      statusMessage('pending_permission'),
      userMessage('local_2', '继续', '2026-05-06T10:00:04.000Z'),
    ];

    const retained = retainRealtimeAfterServerRefresh(server, realtime);

    expect(retained.map((message) => message.id)).toEqual(['pending_permission', 'local_2']);
  });

  it('does not let one server echo cover multiple repeated optimistic messages', () => {
    const server = [userMessage('server_1', '继续', '2026-05-06T10:00:02.000Z')];
    const realtime = [
      userMessage('local_1', '继续', '2026-05-06T10:00:00.000Z'),
      userMessage('local_2', '继续', '2026-05-06T10:00:01.000Z'),
    ];

    expect(retainRealtimeAfterServerRefresh(server, realtime).map((message) => message.id))
      .toEqual(['local_2']);
    expect(computeMergedMessages(server, realtime).map((message) => message.id))
      .toEqual(['server_1', 'local_2']);
  });
  it('replaces an optimistic user message even when earlier non-control messages exist', () => {
    const previousAssistant = assistantMessage('assistant_1', 'Done', '2026-05-06T09:59:00.000Z');
    const optimistic = userMessage('local_1', 'continue', '2026-05-06T10:00:00.000Z');
    const echo = userMessage('server_1', 'continue', '2026-05-06T10:00:02.000Z');

    const realtime = appendRealtimeMessage([previousAssistant, optimistic], echo);

    expect(realtime.map((message) => message.id)).toEqual(['assistant_1', 'server_1']);
  });

  it('covers finalized local assistant replies once the server snapshot contains the same reply', () => {
    const server = [assistantMessage('server_assistant_1', 'Final answer', '2026-05-06T10:00:05.000Z')];
    const realtime = [assistantMessage('text_local_1', 'Final answer', '2026-05-06T10:00:06.000Z')];

    expect(computeMergedMessages(server, realtime).map((message) => message.id))
      .toEqual(['server_assistant_1']);
    expect(retainRealtimeAfterServerRefresh(server, realtime)).toEqual([]);
  });

  it('keeps uncovered realtime messages in chronological order instead of appending them at the end', () => {
    const server = [
      userMessage('server_1', 'First', '2026-05-06T10:00:00.000Z'),
      assistantMessage('server_2', 'Third', '2026-05-06T10:00:03.000Z'),
    ];
    const realtime = [
      userMessage('local_2', 'Second', '2026-05-06T10:00:02.000Z'),
    ];

    const merged = computeMergedMessages(server, realtime);

    expect(merged.map((message) => message.id)).toEqual(['server_1', 'local_2', 'server_2']);
  });

  it('deduplicates repeated realtime assistant text events with different ids', () => {
    const first = assistantMessage('assistant_rt_1', 'Investigating the config path.', '2026-05-06T10:00:00.000Z');
    const duplicate = assistantMessage('assistant_rt_2', 'Investigating the config path.', '2026-05-06T10:00:01.000Z');

    const realtime = appendRealtimeMessage([first], duplicate);

    expect(realtime.map((message) => message.id)).toEqual(['assistant_rt_2']);
  });
});
