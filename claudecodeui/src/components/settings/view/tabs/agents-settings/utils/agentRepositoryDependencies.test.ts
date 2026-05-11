import { describe, expect, it } from 'vitest';

import { resolveAgentTemplateDependencyState } from './agentRepositoryDependencies';

describe('agentRepositoryDependencies', () => {
  it('marks agents with missing required dependencies as draft-only', () => {
    const state = resolveAgentTemplateDependencyState({
      dependencies: {
        skills: [{ kind: 'skill', name: 'security-review' }],
        mcpServers: [{ kind: 'mcp-server', name: 'linear' }],
      },
      installedSkills: ['security-review'],
      installedMcpServers: [],
      installedModelProfiles: [],
    });

    expect(state.hasBlockingRequiredMissing).toBe(true);
    expect(state.agentStatus).toBe('draft');
    expect(state.requiredMissing.map((dependency) => dependency.name)).toEqual(['linear']);
  });

  it('preserves selected optional dependencies for session runtime injection', () => {
    const state = resolveAgentTemplateDependencyState({
      dependencies: {
        skills: [{ kind: 'skill', name: 'security-review' }],
        mcpServers: [{ kind: 'mcp-server', name: 'linear', optional: true }],
        modelProfiles: [{ kind: 'model-profile', name: 'sonnet-large', optional: true }],
      },
      installedSkills: ['security-review'],
      installedMcpServers: ['linear'],
      installedModelProfiles: ['sonnet-large'],
      selectedOptionalDependencyIds: ['mcp-server:linear', 'model-profile:sonnet-large'],
    });

    expect(state.hasBlockingRequiredMissing).toBe(false);
    expect(state.agentStatus).toBe('enabled');
    expect(state.selectedDependencies).toEqual({
      skills: ['security-review'],
      mcpServers: ['linear'],
      modelProfiles: ['sonnet-large'],
    });
  });
});
