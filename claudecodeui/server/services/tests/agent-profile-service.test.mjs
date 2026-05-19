import { describe, expect, it } from 'vitest';

import {
  AGENT_PROFILE_IDS,
  getBuiltInAgentProfiles,
  resolveAgentProfileRuntimeOptions,
} from '../agent-profile-service.js';
import { buildAgentSystemPrompt, findAgentMention, normalizeAgentConfig } from '../agent-config-service.js';

describe('agent profile service', () => {
  it('provides the six built-in work profiles with runtime metadata', () => {
    const profiles = getBuiltInAgentProfiles();

    expect(profiles.map((profile) => profile.id)).toEqual(AGENT_PROFILE_IDS);
    expect(profiles.map((profile) => profile.profileKind)).toEqual([
      'plan',
      'build',
      'explore',
      'review',
      'debug',
      'docs',
    ]);
    expect(profiles.every((profile) => profile.status === 'enabled')).toBe(true);
    expect(profiles.every((profile) => profile.permissionPreset)).toBe(true);
    expect(profiles.every((profile) => profile.systemPrompt.includes('Profile contract'))).toBe(true);
  });

  it('normalizes profile fields through the existing AgentConfig shape', () => {
    const plan = normalizeAgentConfig(getBuiltInAgentProfiles()[0]);

    expect(plan.id).toBe('profile-plan');
    expect(plan.profileKind).toBe('plan');
    expect(plan.permissionPreset).toBe('suggest');
    expect(plan.defaultSkills).toContain('senior-architect');
    expect(plan.mcpServers).toContain('kanban');
    expect(plan.appBindings).toContainEqual({
      slot: 'kanban',
      app: 'MCP: kanban',
      status: 'optional',
    });
    expect(plan.templateRuntime.permissionMode).toBe('plan');
    expect(plan.templateRuntime.tools).toContain('Read');
  });

  it('includes profile MCP bindings in the generated agent prompt', async () => {
    const plan = normalizeAgentConfig(getBuiltInAgentProfiles()[0]);

    const prompt = await buildAgentSystemPrompt(plan);

    expect(prompt).toContain('Configured applications:');
    expect(prompt).toContain('- kanban: MCP: kanban (optional)');
  });

  it('lets @debug and @docs target profiles by shortName for one request', () => {
    const profiles = getBuiltInAgentProfiles().map((profile) => normalizeAgentConfig(profile));

    expect(findAgentMention('@debug inspect the failure', profiles)).toEqual({
      agentId: 'profile-debug',
      content: 'inspect the failure',
    });
    expect(findAgentMention('@docs update usage notes', profiles)).toEqual({
      agentId: 'profile-docs',
      content: 'update usage notes',
    });
  });

  it('merges profile runtime options without granting bypass permissions', () => {
    const [plan, build] = getBuiltInAgentProfiles().map((profile) => normalizeAgentConfig(profile));

    const planOptions = resolveAgentProfileRuntimeOptions(plan, {
      permissionMode: 'acceptEdits',
      toolsSettings: {
        allowedTools: ['ExistingTool'],
        disallowedTools: [],
        skipPermissions: false,
      },
    });
    expect(planOptions.permissionMode).toBe('plan');
    expect(planOptions.toolsSettings.allowedTools).toContain('ExistingTool');
    expect(planOptions.toolsSettings.allowedTools).toContain('Read');
    expect(planOptions.toolsSettings.disallowedTools).toContain('Edit');
    expect(planOptions.toolsSettings.skipPermissions).toBe(false);

    const buildOptions = resolveAgentProfileRuntimeOptions(build, {
      permissionMode: 'plan',
      toolsSettings: {
        allowedTools: [],
        disallowedTools: ['Bash(rm *)'],
        skipPermissions: true,
      },
    });
    expect(buildOptions.permissionMode).toBe('acceptEdits');
    expect(buildOptions.toolsSettings.disallowedTools).toContain('Bash(rm *)');
    expect(buildOptions.toolsSettings.skipPermissions).toBe(false);
  });
});
