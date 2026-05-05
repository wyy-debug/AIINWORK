import { describe, expect, it } from 'vitest';

import { buildWorktreeDispatchPayload } from './WorktreeDispatchModal';

describe('buildWorktreeDispatchPayload', () => {
  it('uses sourceSessionId and createNewSession for conversation-first worktree dispatch', () => {
    const payload = buildWorktreeDispatchPayload({
      taskPrompt: '继续处理：CrashSight 分析',
      baseRef: '',
      sourceSessionTitle: 'CrashSight 分析',
      sourceSession: {
        id: 'source-session',
        __provider: 'claude',
        title: 'CrashSight 分析',
      },
      isSessionDispatch: true,
      selectedAgent: {
        id: 'ignored-agent',
        appBindings: [{ slot: 'Search', app: 'MCP: ainwork-code-search', status: 'connected' }],
      },
      selectedSkills: ['ignored-skill'],
      createSession: true,
    });

    expect(payload).toEqual({
      taskPrompt: '继续处理：CrashSight 分析',
      baseRef: '',
      title: 'CrashSight 分析',
      agentId: '',
      appBindings: [],
      skills: [],
      provider: 'claude',
      sourceSessionId: 'source-session',
      createNewSession: true,
    });
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload).not.toHaveProperty('createSession');
  });
});
