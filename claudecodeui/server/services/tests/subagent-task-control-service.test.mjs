import { describe, expect, it, vi } from 'vitest';

import {
  buildSubagentControlFallbackPrompt,
  buildSubagentDirectControlPayload,
  dispatchSubagentTaskControl,
} from '../subagent-task-control-service.js';

describe('subagent-task-control-service', () => {
  it('builds direct control payloads for supported subagent actions', () => {
    expect(buildSubagentDirectControlPayload({
      action: 'send',
      sessionId: 'session-1',
      taskId: 'agent-1',
      content: 'use the uploaded crash id',
    }, 'req-1', { supportedDirectActions: ['send'] })).toEqual({
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'send_message',
        task_id: 'agent-1',
        message: 'use the uploaded crash id',
      },
    });

    expect(buildSubagentDirectControlPayload({
      action: 'followup',
      sessionId: 'session-1',
      taskId: 'agent-1',
      content: 'write regression tests',
    }, 'req-2', { supportedDirectActions: ['followup'] })).toEqual({
      type: 'control_request',
      request_id: 'req-2',
      request: {
        subtype: 'followup_task',
        task_id: 'agent-1',
        message: 'write regression tests',
      },
    });
  });

  it('builds stable fallback prompts for wait/send/followup/stop', () => {
    expect(buildSubagentControlFallbackPrompt({ action: 'wait', taskId: 'agent-1' }))
      .toContain('wait_agent');
    expect(buildSubagentControlFallbackPrompt({ action: 'send', taskId: 'agent-1', content: 'continue' }))
      .toContain('send_message');
    expect(buildSubagentControlFallbackPrompt({ action: 'followup', taskId: 'agent-1', content: 'finish docs' }))
      .toContain('followup_task');
    expect(buildSubagentControlFallbackPrompt({ action: 'stop', taskId: 'agent-1' }))
      .toContain('close_agent');
  });

  it('falls back to guidance when direct control is unsupported and records control events', async () => {
    const events = [];
    const result = await dispatchSubagentTaskControl({
      action: 'send',
      sessionId: 'session-1',
      taskId: 'agent-1',
      content: 'continue',
      sendDirectControl: vi.fn(() => ({ success: false, unsupported: true, error: 'unsupported action' })),
      sendGuidance: vi.fn(() => ({ success: true })),
      emitEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      success: true,
      mode: 'fallback-guidance',
      fallbackUsed: true,
    });
    expect(events.map((event) => event.type)).toEqual(['control_requested', 'control_accepted']);
    expect(events[1].payload).toMatchObject({
      action: 'send',
      mode: 'fallback-guidance',
      fallbackUsed: true,
    });
  });

  it('falls back to coordinator guidance for stop when direct control fails', async () => {
    const events = [];
    const result = await dispatchSubagentTaskControl({
      action: 'stop',
      sessionId: 'session-1',
      taskId: 'agent-1',
      sendDirectControl: vi.fn(() => ({ success: false, error: 'not running' })),
      sendGuidance: vi.fn(() => ({ success: true })),
      emitEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      success: true,
      mode: 'fallback-guidance',
      fallbackUsed: true,
    });
    expect(events.map((event) => event.type)).toEqual(['control_requested', 'control_accepted']);
  });
});
