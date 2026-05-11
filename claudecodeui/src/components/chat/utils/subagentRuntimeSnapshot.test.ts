import { describe, expect, it } from 'vitest';

import { buildSubagentRuntimeSnapshot, getSubagentRuntimeDispatchPlanId } from './subagentRuntimeSnapshot';

describe('subagentRuntimeSnapshot', () => {
  it('captures the parent runtime model, permissions, tools, skills, MCP, and project path', () => {
    const snapshot = buildSubagentRuntimeSnapshot({
      provider: 'claude',
      model: 'gpt-5.5',
      modelProfileId: 'model-parent',
      projectPath: 'E:\\AIINWORK',
      permissionMode: 'default',
      toolsSettings: {
        allowedTools: ['spawn_agent', 'Read', 'Bash(npm test)'],
        disallowedTools: ['Bash(rm -rf *)'],
        skipPermissions: false,
        permissionMode: 'default',
      },
      sessionSkills: ['review-skill'],
      agentAppBindings: [{ slot: 'repo', app: 'repo-search', status: 'connected' }],
      selectedDependencies: {
        skills: ['review-skill'],
        mcpServers: ['repo-search'],
        modelProfiles: ['model-parent'],
      },
    });

    expect(snapshot).toMatchObject({
      provider: 'claude',
      model: 'gpt-5.5',
      modelProfileId: 'model-parent',
      projectPath: 'E:\\AIINWORK',
      permissionMode: 'default',
      toolsSettings: {
        allowedTools: ['spawn_agent', 'Read', 'Bash(npm test)'],
        disallowedTools: ['Bash(rm -rf *)'],
        skipPermissions: false,
        permissionMode: 'default',
      },
      sessionSkills: ['review-skill'],
      selectedDependencies: {
        skills: ['review-skill'],
        mcpServers: ['repo-search'],
        modelProfiles: ['model-parent'],
      },
    });
  });

  it('creates a stable dispatch plan id from the parent prompt and approved plan', () => {
    expect(getSubagentRuntimeDispatchPlanId({
      prompt: '用多个 agent review 项目',
      agentId: 'review-agent',
      approvedPlan: '# Subagent Dispatch Plan\n\n## Agent Dispatch\n- backend',
    })).toBe(
      'dispatch:review-agent:用多个 agent review 项目:# Subagent Dispatch Plan ## Agent Dispatch - backend',
    );
  });
});
