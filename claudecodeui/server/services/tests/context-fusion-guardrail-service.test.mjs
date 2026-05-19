import { describe, expect, it } from 'vitest';

import {
  applyContextFusionGuardrailsToChatCommand,
  buildContextFusionDiagnostics,
  filterBrainRecallHitsAgainstObsidian,
} from '../context-fusion-guardrail-service.js';

describe('context fusion guardrails', () => {
  it('deduplicates Brain recall hits against Obsidian sources by path, artifact/checkpoint id, and source text hash', () => {
    const result = filterBrainRecallHitsAgainstObsidian([
      {
        id: 'atom-path',
        title: 'Wiki checkout note',
        summary: 'Same source via path.',
        entities: ['Argus/Wiki/App/Checkout.md'],
      },
      {
        id: 'atom-artifact',
        title: 'Artifact decision',
        summary: 'Same source via artifact.',
        artifactId: 'artifact-7',
      },
      {
        id: 'atom-text',
        title: 'Retry behavior',
        summary: 'Payment retries must be idempotent.',
      },
      {
        id: 'atom-keep',
        title: 'Keep deployment lesson',
        summary: 'A separate Brain-only task state.',
      },
    ], [
      { path: 'argus/wiki/app/checkout.md', title: 'Checkout' },
      { artifactId: 'artifact-7', path: 'Argus/Wiki/App/Artifact.md' },
      { title: 'Retry behavior', snippet: 'Payment retries must be idempotent.' },
    ]);

    expect(result.hits.map((hit) => hit.id)).toEqual(['atom-keep']);
    expect(result.removed.map((entry) => entry.id)).toEqual(['atom-path', 'atom-artifact', 'atom-text']);
    expect(result.removed.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'duplicate-path',
      'duplicate-artifact',
      'duplicate-text',
    ]));
  });

  it('adds source boundaries and diagnostics without breaking independent source disable paths', () => {
    const result = applyContextFusionGuardrailsToChatCommand({
      type: 'claude-command',
      command: 'Review checkout runtime.',
      options: {
        appendSystemPrompt: [
          'Argus Wiki Context',
          'Obsidian Wiki Context is source material.',
          '',
          'CodeGraph Runtime',
          'Use raw file search if stale.',
          '',
          '## Argus Brain Recall Pack',
          'Argus Brain is task state.',
        ].join('\n'),
        obsidianContext: { used: true, sources: [{ path: 'Argus/Wiki/App/Checkout.md', snippet: 'checkout note' }] },
        codegraphContext: { enabled: false, mcpConfigured: false },
        brainRuntime: { enabled: false },
        brainRecall: { enabled: false, used: false, recallHits: [] },
      },
    });

    expect(result.options.contextFusion.sourceOrder).toEqual([
      'system/profile/runtime',
      'obsidian-wiki-context',
      'codegraph-runtime',
      'argus-brain-context',
      'user-task',
    ]);
    expect(result.options.contextFusion.boundaries).toEqual(expect.arrayContaining([
      'Obsidian Wiki Context is source material, not task state.',
      'Argus Brain is task state, not source material.',
      'Current code, settings, and runtime results must be verified before acting on historical context.',
    ]));
    expect(result.options.contextFusion.sources.obsidian.enabled).toBe(true);
    expect(result.options.contextFusion.sources.codegraph.enabled).toBe(false);
    expect(result.options.contextFusion.sources.brain.enabled).toBe(false);
    expect(result.options.runtimeDiagnostics.contextFusion.totalInjectedTokens).toBeGreaterThan(0);
  });

  it('builds combined contribution diagnostics with token accounting per source', () => {
    const diagnostics = buildContextFusionDiagnostics({
      appendSystemPrompt: [
        'Argus Wiki Context',
        'wiki text',
        '',
        'CodeGraph Runtime',
        'codegraph text',
        '',
        '## Argus Brain Recall Pack',
        'brain text',
      ].join('\n'),
      obsidianContext: { used: true, sources: [{ path: 'Argus/Wiki/App.md' }] },
      codegraphContext: { enabled: true, projectRoot: 'E:/work/app' },
      brainRuntime: { enabled: true },
      brainRecall: { enabled: true, used: true, recallHits: [{ id: 'atom-1' }] },
      dedupedBrainHits: [{ id: 'atom-2', reason: 'duplicate-path' }],
    });

    expect(diagnostics.sources.obsidian.injectedTokens).toBeGreaterThan(0);
    expect(diagnostics.sources.codegraph.injectedTokens).toBeGreaterThan(0);
    expect(diagnostics.sources.brain.injectedTokens).toBeGreaterThan(0);
    expect(diagnostics.deduped.brainAgainstObsidian).toEqual([{ id: 'atom-2', reason: 'duplicate-path' }]);
    expect(diagnostics.totalInjectedTokens).toBe(
      diagnostics.sources.obsidian.injectedTokens
      + diagnostics.sources.codegraph.injectedTokens
      + diagnostics.sources.brain.injectedTokens
    );
  });
});
