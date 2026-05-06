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
});
