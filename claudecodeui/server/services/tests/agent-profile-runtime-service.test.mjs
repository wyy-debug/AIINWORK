import { describe, expect, test } from 'vitest';

import {
  buildAgentProfileRuntimeOptionsSnapshot,
  getAgentProfile,
  normalizeAgentProfileKind,
  resolveAgentProfileInvocation,
} from '../../../shared/agentProfiles.js';
import { applyAgentProfileRuntimeToChatCommand } from '../agent-profile-runtime-service.js';

describe('agent profile runtime service', () => {
  test('normalizes built-in profile names and aliases', () => {
    expect(normalizeAgentProfileKind('PLAN')).toBe('plan');
    expect(normalizeAgentProfileKind('@debug')).toBe('debug');
    expect(normalizeAgentProfileKind('documentation')).toBe('docs');
    expect(normalizeAgentProfileKind('unknown', '')).toBe('');
  });

  test('detects one-shot @profile invocation without treating it as user content', () => {
    const invocation = resolveAgentProfileInvocation('@docs update README', 'build');

    expect(invocation).toMatchObject({
      profileKind: 'docs',
      content: 'update README',
      source: 'mention',
      matched: true,
    });
  });

  test('applies selected profile prompt, permissions, and runtime snapshot before the model call', () => {
    const command = applyAgentProfileRuntimeToChatCommand({
      type: 'claude-command',
      command: 'inspect the auth flow',
      options: {
        agentProfileKind: 'explore',
        permissionMode: 'acceptEdits',
        sessionSkills: ['local-skill'],
      },
    });

    expect(command.command).toBe('inspect the auth flow');
    expect(command.options.permissionMode).toBe('plan');
    expect(command.options.agentProfileKind).toBe('explore');
    expect(command.options.agentProfile).toMatchObject({
      profileKind: 'explore',
      permissionPreset: 'suggest',
    });
    expect(command.options.sessionSkills).toEqual(['local-skill']);
    expect(command.options.appendSystemPrompt).toContain('Agent Profile: Explore.');
  });

  test('applies temporary @debug profile over the selected profile', () => {
    const command = applyAgentProfileRuntimeToChatCommand({
      type: 'claude-command',
      command: '@debug failing test',
      options: {
        agentProfileKind: 'plan',
      },
    });

    expect(command.command).toBe('failing test');
    expect(command.options.agentProfileKind).toBe('debug');
    expect(command.options.permissionMode).toBe('acceptEdits');
    expect(command.options.agentProfileSource).toBe('mention');
  });

  test('runtime snapshot exposes the declared profile contract', () => {
    const snapshot = buildAgentProfileRuntimeOptionsSnapshot(getAgentProfile('review'));

    expect(snapshot).toMatchObject({
      profileKind: 'review',
      name: 'Review',
      permissionPreset: 'suggest',
      allowedTools: expect.arrayContaining(['Read', 'Grep', 'Glob']),
      defaultSkills: [],
      mcpServers: [],
    });
  });
});
