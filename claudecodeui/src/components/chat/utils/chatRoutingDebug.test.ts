import { describe, expect, it, vi } from 'vitest';

import {
  buildChatRoutingDebugPayload,
  emitChatRoutingDebug,
} from './chatRoutingDebug';

describe('chat routing debug helpers', () => {
  it('sends structured routing events without the full command text', () => {
    const payload = buildChatRoutingDebugPayload('client.send.route_resolved', {
      clientMessageId: 'client-user-1',
      command: 'optimize this project with token=secret',
      provider: 'claude',
      selectedProjectName: 'unity-profiler-rs',
      selectedSessionId: 'session-a',
      currentSessionId: 'session-b',
      backendSessionId: 'session-a',
    });

    expect(payload.type).toBe('argus-routing-debug');
    expect(payload.event).toBe('client.send.route_resolved');
    expect(payload.details.clientMessageId).toBe('client-user-1');
    expect(payload.details.commandLength).toBe('optimize this project with token=secret'.length);
    expect(payload.details.command).toBeUndefined();
    expect(payload.details.backendSessionId).toBe('session-a');
  });

  it('never lets routing debug emission break chat sending', () => {
    const sendMessage = vi.fn(() => {
      throw new Error('socket closed');
    });

    expect(() => emitChatRoutingDebug(sendMessage, 'client.send.dispatch', {
      clientMessageId: 'client-user-2',
    })).not.toThrow();
  });
});
