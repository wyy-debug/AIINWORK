import { describe, expect, it } from 'vitest';

import { resolveAgentTemplateDependencies } from '../agent-repository-dependency-resolver-service.js';

describe('agent-repository-dependency-resolver-service', () => {
  it('resolves required, optional, and model-profile dependencies with blocking status', () => {
    const result = resolveAgentTemplateDependencies({
      dependencies: {
        skills: [{ kind: 'skill', name: 'security-review' }],
        mcpServers: [
          { kind: 'mcp-server', name: 'linear', optional: true },
          { kind: 'mcp-server', name: 'missing-mcp' },
        ],
        modelProfiles: [{ kind: 'model-profile', name: 'sonnet-large' }],
      },
      installed: {
        skills: ['security-review'],
        mcpServers: ['linear'],
        modelProfiles: [],
      },
      selectedDependencies: {
        mcpServers: ['linear'],
      },
    });

    expect(result.required.map((dependency) => ({
      kind: dependency.kind,
      name: dependency.name,
      status: dependency.status,
    }))).toEqual([
      { kind: 'skill', name: 'security-review', status: 'available' },
      { kind: 'mcp-server', name: 'missing-mcp', status: 'missing' },
      { kind: 'model-profile', name: 'sonnet-large', status: 'needs-configuration' },
    ]);
    expect(result.optional).toEqual([
      expect.objectContaining({ kind: 'mcp-server', name: 'linear', status: 'selected' }),
    ]);
    expect(result.blockingMissing.map((dependency) => dependency.name)).toEqual(['missing-mcp', 'sonnet-large']);
    expect(result.selectedDependencies).toEqual({
      skills: ['security-review'],
      mcpServers: ['linear'],
      modelProfiles: [],
    });
  });

  it('treats repository catalog matches as available before install', () => {
    const result = resolveAgentTemplateDependencies({
      dependencies: {
        skills: [{ kind: 'skill', name: 'perf-review' }],
        mcpServers: [{ kind: 'mcp-server', name: 'redmine', optional: true }],
      },
      catalogItems: [
        { kind: 'skill', name: 'perf-review', id: 'skill-perf-review', repoId: 'local' },
        { kind: 'mcp-server', name: 'redmine', id: 'mcp-server-redmine', repoId: 'local' },
      ],
    });

    expect(result.required).toEqual([
      expect.objectContaining({ kind: 'skill', name: 'perf-review', status: 'available' }),
    ]);
    expect(result.optional).toEqual([
      expect.objectContaining({ kind: 'mcp-server', name: 'redmine', status: 'available' }),
    ]);
    expect(result.blockingMissing).toEqual([]);
  });
});
