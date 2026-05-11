import { describe, expect, it } from 'vitest';

import { buildSubagentControlPrompt, buildSubagentControlRequest } from './subagentControlRequest';

describe('subagentControlRequest', () => {
  it('builds tool-specific control prompts for wait, send, and followup', () => {
    expect(buildSubagentControlPrompt({ action: 'wait', taskId: 'task-1' })).toContain('wait_agent');
    expect(buildSubagentControlPrompt({ action: 'send', taskId: 'task-1', content: 'use the uploaded crash id' })).toContain('send_message');
    expect(buildSubagentControlPrompt({ action: 'followup', taskId: 'task-1', content: 'write regression tests' })).toContain('followup_task');
  });

  it('uses direct subagent control for active Claude sessions and resume command for idle sessions', () => {
    const active = buildSubagentControlRequest({
      action: 'send',
      taskId: 'task-1',
      content: 'continue',
      sessionId: 'session-1',
      provider: 'claude',
      clientMessageId: 'client-1',
      sessionActive: true,
    });
    expect(active).toMatchObject({
      type: 'claude-subagent-control',
      sessionId: 'session-1',
      clientMessageId: 'client-1',
      taskId: 'task-1',
      action: 'send',
      content: 'continue',
      fallback: {
        type: 'claude-guidance',
      },
    });

    const idle = buildSubagentControlRequest({
      action: 'wait',
      taskId: 'task-1',
      sessionId: 'session-1',
      provider: 'claude',
      clientMessageId: 'client-2',
      sessionActive: false,
      resumeOptions: {
        projectPath: 'E:/repo',
        cwd: 'E:/repo',
        projectName: 'repo',
        sessionId: 'session-1',
        resume: true,
      },
    });
    expect(idle).toMatchObject({
      type: 'claude-command',
      sessionId: 'session-1',
      options: {
        sessionId: 'session-1',
        resume: true,
        subagentControl: {
          action: 'wait',
          taskId: 'task-1',
        },
      },
    });
  });

  it('returns null when the provider or target is not controllable', () => {
    expect(buildSubagentControlRequest({
      action: 'wait',
      taskId: 'task-1',
      sessionId: 'session-1',
      provider: 'codex',
      sessionActive: true,
    })).toBeNull();

    expect(buildSubagentControlRequest({
      action: 'wait',
      taskId: '',
      sessionId: 'session-1',
      provider: 'claude',
      sessionActive: true,
    })).toBeNull();
  });
});
