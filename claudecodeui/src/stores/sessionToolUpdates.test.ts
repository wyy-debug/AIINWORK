import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from './useSessionStore';

import {
  applyToolInputOverrides,
  buildToolInputOverrideKey,
  updateToolInputInMessages,
} from './sessionToolUpdates';

function toolUse(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: overrides.id || 'tool-1',
    sessionId: 'session-1',
    timestamp: '2026-05-14T09:00:00.000Z',
    provider: 'claude',
    kind: 'tool_use',
    toolName: overrides.toolName || 'request_user_input',
    toolId: overrides.toolId || 'call_req_1',
    toolInput: overrides.toolInput || {
      questions: [{ id: 'material', question: 'Provide material' }],
    },
    ...overrides,
  };
}

describe('updateToolInputInMessages', () => {
  it('updates the matching tool_use entry by tool id', () => {
    const messages = [
      toolUse(),
      toolUse({ id: 'tool-2', toolId: 'call_req_2' }),
    ];

    const updated = updateToolInputInMessages(messages, {
      toolId: 'call_req_1',
      toolName: 'request_user_input',
      updatedInput: {
        questions: [{ id: 'material', question: 'Provide material' }],
        answers: { material: 'I sent screenshots' },
      },
    });

    expect(updated[0]?.toolInput).toEqual({
      questions: [{ id: 'material', question: 'Provide material' }],
      answers: { material: 'I sent screenshots' },
    });
    expect(updated[1]?.toolInput).toEqual(messages[1]?.toolInput);
  });

  it('builds a stable override key from tool id when present', () => {
    expect(buildToolInputOverrideKey({
      toolId: 'call_req_1',
      toolName: 'request_user_input',
      originalInput: { questions: [] },
    })).toBe('toolId:call_req_1');
  });

  it('reapplies stored overrides to refreshed messages', () => {
    const messages = [toolUse()];

    const updated = applyToolInputOverrides(messages, [{
      toolId: 'call_req_1',
      toolName: 'request_user_input',
      updatedInput: {
        questions: [{ id: 'material', question: 'Provide material' }],
        answers: { material: 'I sent screenshots' },
      },
    }]);

    expect(updated[0]?.toolInput).toEqual({
      questions: [{ id: 'material', question: 'Provide material' }],
      answers: { material: 'I sent screenshots' },
    });
  });
});
