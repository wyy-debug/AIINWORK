import { describe, expect, test } from 'vitest';

import { normalizeSessionAgentConfiguration } from '../session-agent-configuration-service.js';

describe('session agent configuration service', () => {
  test('preserves distributable dialog answers and package metadata with existing bindings', () => {
    const configuration = normalizeSessionAgentConfiguration({
      appBindings: [{ slot: 'mcp-linear', app: 'MCP: linear', status: 'connected' }],
      skills: ['security-review', 'security-review'],
      modelProfileId: 'Sonnet Large',
      packageId: 'review-pack',
      packageVersion: '2.1.0',
      setupAnswers: {
        repo: 'frontend',
        review_depth: 'deep',
        extra: { nested: 'ignored' },
      },
      setupPresetId: 'Default Setup',
      launchAnswers: {
        scope: 'src/**',
        includeTests: true,
      },
      launchPresetId: 'Deep Launch',
      resultPresetId: 'Markdown Result',
      selectedDependencies: {
        skills: ['security-review'],
        mcpServers: ['linear'],
        modelProfiles: ['sonnet-large'],
      },
      dialogInstanceId: 'dialog-123',
    });

    expect(configuration).toEqual({
      appBindings: [{ slot: 'mcp-linear', app: 'MCP: linear', status: 'connected' }],
      skills: ['security-review'],
      agentProfileKind: '',
      modelProfileId: 'sonnet-large',
      packageId: 'review-pack',
      packageVersion: '2.1.0',
      setupAnswers: {
        repo: 'frontend',
        review_depth: 'deep',
      },
      setupPresetId: 'default-setup',
      launchAnswers: {
        scope: 'src/**',
        includeTests: true,
      },
      launchPresetId: 'deep-launch',
      resultPresetId: 'markdown-result',
      selectedDependencies: {
        skills: ['security-review'],
        mcpServers: ['linear'],
        modelProfiles: ['sonnet-large'],
      },
      dialogInstanceId: 'dialog-123',
    });
  });

  test('normalizes lightweight Agent Profile session binding', () => {
    const configuration = normalizeSessionAgentConfiguration({
      agentProfileKind: '@debug',
    });

    expect(configuration.agentProfileKind).toBe('debug');
  });
});
