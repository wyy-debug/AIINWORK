import { describe, expect, it } from 'vitest';

import {
  allocateRecallSectionBudgets,
  buildBrainRecallPack,
  detectRecallPackMode,
} from '../brain-recall-pack-service.js';
import { createBrainRecallService } from '../brain-recall-service.js';
import { createMemoryBrainStore } from './brain-test-store.mjs';

const baseCompaction = {
  id: 'compaction-1',
  currentGoal: 'Finish Brain recall pack builder',
  summary: 'Status: implementing deterministic recall sections.',
  activeDecisions: ['Use compact recall packs with diagnostics.'],
  openRisks: ['Historical state can be stale.'],
  nextAction: 'Run targeted Brain tests.',
  mermaid: 'flowchart TD\n  brain_goal_pack["Recall pack"]',
  refs: ['ref-compaction'],
};

const hits = [
  {
    id: 'atom-old',
    kind: 'atom',
    title: 'Old inactive decision',
    summary: 'Old decision should rank lower.',
    score: 0.6,
    status: 'stale',
    confidence: 0.4,
    updatedAtMs: 100,
    reasons: [{ signal: 'bm25', rank: 2, score: 0.5 }],
  },
  {
    id: 'atom-pinned',
    kind: 'atom',
    title: 'Pinned active decision',
    summary: 'Pinned decision should rank first for recall pack ordering.',
    score: 0.5,
    status: 'active',
    confidence: 0.9,
    pinned: true,
    updatedAtMs: 200,
    reasons: [{ signal: 'entity', rank: 1, score: 1 }],
  },
  {
    id: 'atom-lesson',
    kind: 'atom',
    title: 'Lesson learned: Vitest failed on raw refs',
    summary: 'When tests fail around prompt leaks, keep raw refs behind drill-down.',
    atomType: 'lesson',
    score: 0.55,
    status: 'active',
    confidence: 0.88,
    updatedAtMs: 300,
    reasons: [{ signal: 'lesson-fit', rank: 1, score: 1 }],
  },
];

describe('Brain recall pack builder', () => {
  it('allocates hard section budgets and truncates oversized sections gracefully', () => {
    const budgets = allocateRecallSectionBudgets({ maxTokens: 180, mode: 'resume' });

    expect(Object.values(budgets).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(180);
    expect(budgets.canvas).toBeLessThanOrEqual(45);

    const pack = buildBrainRecallPack({
      command: 'resume the Brain work',
      maxTokens: 90,
      compaction: {
        ...baseCompaction,
        activeDecisions: Array.from({ length: 12 }, (_, index) => `Decision ${index} ${'x'.repeat(60)}`),
      },
      retrievalHits: hits,
    });

    expect(pack.tokenEstimate).toBeLessThanOrEqual(90);
    expect(pack.prompt).toContain('[truncated]');
  });

  it('produces deterministic section ordering for the same data', () => {
    const first = buildBrainRecallPack({
      command: 'resume recall pack work',
      maxTokens: 500,
      compaction: baseCompaction,
      retrievalHits: hits,
    });
    const second = buildBrainRecallPack({
      command: 'resume recall pack work',
      maxTokens: 500,
      compaction: baseCompaction,
      retrievalHits: [...hits].reverse(),
    });

    expect(first.prompt).toBe(second.prompt);
    expect(first.sections.map((section) => section.id)).toEqual([
      'stale-warning',
      'current-goal',
      'status',
      'active-decisions',
      'open-risks',
      'next-action',
      'canvas',
      'relevant-memory',
      'refs',
    ]);
    expect(first.diagnostics.includedItems[0]).toMatchObject({
      id: 'atom-pinned',
      reasons: expect.arrayContaining(['explicit-pin']),
    });
  });

  it('uses command-aware modes so fix-test prompts prioritize lessons and risks', () => {
    expect(detectRecallPackMode('fix failing vitest tests')).toBe('fix-tests');

    const pack = buildBrainRecallPack({
      command: 'fix failing vitest tests',
      maxTokens: 500,
      compaction: baseCompaction,
      retrievalHits: hits,
    });

    expect(pack.mode).toBe('fix-tests');
    expect(pack.prompt.indexOf('Lessons for similar failures')).toBeLessThan(pack.prompt.indexOf('Active decisions'));
    expect(pack.prompt).toContain('Lesson learned: Vitest failed on raw refs');
  });

  it('keeps raw refs as ids and labels only while diagnostics explain inclusion reasons', () => {
    const pack = buildBrainRecallPack({
      command: 'review recall refs',
      maxTokens: 500,
      compaction: baseCompaction,
      refs: [
        {
          id: 'ref-raw',
          refType: 'raw_text',
          label: 'Raw tool output',
          content: 'RAW_SECRET_REF_CONTENT must not enter prompt',
        },
      ],
      retrievalHits: hits,
    });

    expect(pack.prompt).toContain('Verify historical Brain state against current files and runtime before acting.');
    expect(pack.prompt).toContain('ref-raw raw_text Raw tool output');
    expect(pack.prompt).not.toContain('RAW_SECRET_REF_CONTENT');
    expect(pack.diagnostics.includedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'atom-pinned',
        reasons: expect.arrayContaining(['active-status', 'source-confidence', 'explicit-pin']),
      }),
    ]));
  });

  it('is used by Brain recall runtime with pack diagnostics', async () => {
    const { store } = createMemoryBrainStore();
    store.addCompaction({
      sessionId: 'pack-runtime-1',
      projectName: 'Argus',
      currentGoal: 'Resume pack runtime',
      summary: 'Status: pack runtime test.',
      nextAction: 'Continue with recall pack.',
      refs: ['ref-runtime'],
    });
    store.upsertAtom({
      sessionId: 'pack-runtime-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Pinned pack decision',
      summary: 'Use recall pack builder for runtime injection.',
      stableKey: 'decision:pack-runtime',
      pinned: true,
    });
    const recall = createBrainRecallService({
      store,
      readConfig: async () => ({ enabled: true, maxInjectedTokens: 500 }),
    });

    const result = await recall.applyToChatCommand({
      command: 'resume pack runtime',
      options: { sessionId: 'pack-runtime-1', projectName: 'Argus' },
    }, 'claude');

    expect(result.options.appendSystemPrompt).toContain('## Argus Brain Recall Pack');
    expect(result.options.appendSystemPrompt).toContain('Mode: resume');
    expect(result.options.runtimeDiagnostics.brainRuntime.recall.recallPack.mode).toBe('resume');
    expect(result.options.runtimeDiagnostics.brainRuntime.recall.recallPack.includedItems[0].reasons).toContain('explicit-pin');
  });
});
