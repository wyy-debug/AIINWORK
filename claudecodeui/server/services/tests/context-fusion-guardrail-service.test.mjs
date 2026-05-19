import { describe, expect, it } from 'vitest';

import {
  applyContextFusionGuardrailsToChatCommand,
  buildContextFusionDiagnostics,
} from '../context-fusion-guardrail-service.js';

describe('context fusion guardrails', () => {
  it('adds Brain and MCP source boundaries without retired built-in source diagnostics', () => {
    const result = applyContextFusionGuardrailsToChatCommand({
      type: 'claude-command',
      command: 'Review checkout runtime.',
      options: {
        appendSystemPrompt: [
          '## Argus Brain Recall Pack',
          'Argus Brain is task state.',
        ].join('\n'),
        brainRuntime: { enabled: false },
        brainRecall: { enabled: false, used: false, recallHits: [] },
      },
    });

    expect(result.options.contextFusion.sourceOrder).toEqual([
      'system/profile/runtime',
      'argus-brain-context',
      'mcp-and-profile-tools',
      'user-task',
    ]);
    expect(result.options.contextFusion.boundaries).toEqual(expect.arrayContaining([
      'Argus Brain is historical task state, not a live code index.',
      'MCP and Agent Profile tools own external knowledge, code search, and impact analysis.',
    ]));
    expect(result.options.contextFusion.sources).toEqual({
      brain: expect.objectContaining({ enabled: false, used: true }),
    });
    expect(result.options.contextFusion.sources).not.toHaveProperty('codegraph');
    expect(result.options.contextFusion.sources).not.toHaveProperty('obsidian');
  });

  it('builds Brain contribution diagnostics with token accounting', () => {
    const diagnostics = buildContextFusionDiagnostics({
      appendSystemPrompt: [
        '## Argus Brain Recall Pack',
        'brain text',
      ].join('\n'),
      brainRuntime: { enabled: true },
      brainRecall: { enabled: true, used: true, recallHits: [{ id: 'atom-1' }] },
    });

    expect(diagnostics.sources.brain.injectedTokens).toBeGreaterThan(0);
    expect(diagnostics.sources.brain.sourceCount).toBe(1);
    expect(diagnostics.totalInjectedTokens).toBe(diagnostics.sources.brain.injectedTokens);
  });
});
