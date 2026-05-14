import { describe, expect, it } from 'vitest';

import type { PendingPermissionRequest } from '../types/types';

import {
  buildFreeformRequestUserInputAnswer,
  findAutoAnswerableRequestUserInput,
} from './requestUserInput';

function request(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
  return {
    requestId: overrides.requestId || 'req-1',
    toolName: overrides.toolName || 'request_user_input',
    input: overrides.input || {
      questions: [
        {
          id: 'design_material',
          header: '方案材料',
          question: '请问你的现有 UI 方案具体以什么形式提供？',
          options: [
            { label: '页面稿', description: 'Figma / 原型图 / 截图' },
          ],
        },
      ],
    },
    context: overrides.context,
    sessionId: overrides.sessionId || 'session-1',
    receivedAt: overrides.receivedAt,
  };
}

describe('requestUserInput helpers', () => {
  it('builds a freeform answer payload for a single request_user_input question', () => {
    const updatedInput = buildFreeformRequestUserInputAnswer(
      request(),
      '我会直接发截图和页面路径。',
    );

    expect(updatedInput).toEqual({
      questions: [
        {
          id: 'design_material',
          header: '方案材料',
          question: '请问你的现有 UI 方案具体以什么形式提供？',
          options: [
            { label: '页面稿', description: 'Figma / 原型图 / 截图' },
          ],
        },
      ],
      answers: {
        design_material: '我会直接发截图和页面路径。',
      },
    });
  });

  it('does not auto-answer when multiple pending question panels exist', () => {
    const first = request({ requestId: 'req-1' });
    const second = request({ requestId: 'req-2' });

    expect(findAutoAnswerableRequestUserInput([first, second], '直接发截图')).toBeNull();
  });
});
