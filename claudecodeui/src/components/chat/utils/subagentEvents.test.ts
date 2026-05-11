import { describe, expect, it } from 'vitest';

import { buildSubagentEventEnvelopes } from './subagentEvents';

describe('buildSubagentEventEnvelopes', () => {
  it('turns registry and child tool updates into stable subagent event envelopes', () => {
    const envelopes = buildSubagentEventEnvelopes({
      sessionId: 'parent-session',
      parentToolUseId: 'tool-parent',
      taskId: 'agent-task',
      threadId: 'agent-thread',
      packageId: 'review-pack',
      packageVersion: '2.1.0',
      dialogInstanceId: 'dialog-1',
      registryRecord: {
        taskId: 'agent-task',
        sessionId: 'agent-thread',
        events: [
          { id: 'e1', type: 'started', timestamp: 10, message: 'Started' },
          { id: 'e2', type: 'tool_started', timestamp: 20, toolName: 'Read', summary: 'Read package.json' },
          { id: 'e3', type: 'completed', timestamp: 30, message: 'Done' },
        ],
      },
      childTools: [
        { toolId: 'read-1', toolName: 'Read', toolInput: { file_path: 'package.json' }, timestamp: new Date(20) },
      ],
    });

    expect(envelopes).toEqual([
      {
        seq: 1,
        sessionId: 'parent-session',
        parentToolUseId: 'tool-parent',
        taskId: 'agent-task',
        threadId: 'agent-thread',
        packageId: 'review-pack',
        packageVersion: '2.1.0',
        dialogInstanceId: 'dialog-1',
        type: 'started',
        timestamp: 10,
        payload: { message: 'Started', sourceEventId: 'e1' },
      },
      {
        seq: 2,
        sessionId: 'parent-session',
        parentToolUseId: 'tool-parent',
        taskId: 'agent-task',
        threadId: 'agent-thread',
        packageId: 'review-pack',
        packageVersion: '2.1.0',
        dialogInstanceId: 'dialog-1',
        type: 'tool_started',
        timestamp: 20,
        payload: { message: 'Read package.json', sourceEventId: 'e2', toolName: 'Read' },
      },
      {
        seq: 3,
        sessionId: 'parent-session',
        parentToolUseId: 'tool-parent',
        taskId: 'agent-task',
        threadId: 'agent-thread',
        packageId: 'review-pack',
        packageVersion: '2.1.0',
        dialogInstanceId: 'dialog-1',
        type: 'completed',
        timestamp: 30,
        payload: { message: 'Done', sourceEventId: 'e3' },
      },
    ]);
  });

  it('preserves control event envelopes and normalizes unknown control types to message', () => {
    const envelopes = buildSubagentEventEnvelopes({
      sessionId: 'parent-session',
      parentToolUseId: 'tool-parent',
      taskId: 'agent-task',
      threadId: 'agent-thread',
      controlEvents: [
        {
          type: 'control_requested',
          timestamp: 40,
          payload: { action: 'send', message: 'continue' },
        },
        {
          type: 'control_acknowledged',
          timestamp: 50,
          payload: { action: 'send' },
        },
      ],
    });

    expect(envelopes).toEqual([
      {
        seq: 1,
        sessionId: 'parent-session',
        parentToolUseId: 'tool-parent',
        taskId: 'agent-task',
        threadId: 'agent-thread',
        packageId: '',
        packageVersion: '',
        dialogInstanceId: '',
        type: 'control_requested',
        timestamp: 40,
        payload: { action: 'send', message: 'continue' },
      },
      {
        seq: 2,
        sessionId: 'parent-session',
        parentToolUseId: 'tool-parent',
        taskId: 'agent-task',
        threadId: 'agent-thread',
        packageId: '',
        packageVersion: '',
        dialogInstanceId: '',
        type: 'message',
        timestamp: 50,
        payload: { action: 'send' },
      },
    ]);
  });

  it('collapses duplicate blocked runtime updates from wait output', () => {
    const envelopes = buildSubagentEventEnvelopes({
      sessionId: 'parent-session',
      parentToolUseId: 'tool-parent',
      taskId: 'agent-task',
      threadId: 'agent-thread',
      registryRecord: {
        taskId: 'agent-task',
        sessionId: 'agent-thread',
        events: [
          { id: 'blocked-1', type: 'blocked', timestamp: 1000, message: 'Received two consecutive empty, no-match, or error-only tool results.' },
          { id: 'blocked-2', type: 'blocked', timestamp: 1011, message: 'Received two consecutive empty, no-match, or error-only tool results.' },
          { id: 'blocked-3', type: 'blocked', timestamp: 1022, message: 'Received two consecutive empty, no-match, or error-only tool results.' },
        ],
      },
    });

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      seq: 1,
      type: 'blocked',
      timestamp: 1022,
      payload: {
        message: 'Received two consecutive empty, no-match, or error-only tool results.',
        duplicateCount: 3,
      },
    });
  });
});
