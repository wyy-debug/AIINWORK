import { describe, expect, it, vi } from 'vitest';

import { buildReviewFlowArtifactContent, createReviewFlowService } from '../review-flow-service.js';

const SAMPLE_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1 +1,2 @@',
  ' export const name = "app";',
  '+export const enabled = true;',
  '',
].join('\n');

describe('git-native review flow service', () => {
  it('builds a review artifact body with summary, risks, tests, commit message, and PR body', () => {
    const built = buildReviewFlowArtifactContent({ diff: SAMPLE_DIFF, source: 'current-diff' });

    expect(built.empty).toBe(false);
    expect(built.content).toContain('## Summary');
    expect(built.content).toContain('## Risks');
    expect(built.content).toContain('## Tests');
    expect(built.content).toContain('## Commit Message');
    expect(built.content).toContain('## PR Body');
    expect(built.content).toContain('src/app.ts');
  });

  it('returns an empty state without creating artifacts for clean diffs', async () => {
    const createArtifact = vi.fn();
    const service = createReviewFlowService({
      createArtifact,
      getCurrentDiff: async () => ({ diff: '', source: 'current-diff' }),
    });

    const result = await service.createReviewArtifact({ projectName: 'App', projectPath: '/tmp/app' });

    expect(result.empty).toBe(true);
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it('prefers the latest checkpoint diff and never performs git writes', async () => {
    const createArtifact = vi.fn(async (artifact) => ({ artifact: { id: 'artifact-1', ...artifact } }));
    const service = createReviewFlowService({
      createArtifact,
      listSessionCheckpoints: () => [{ id: 'checkpoint-1', patch: SAMPLE_DIFF }],
      getCurrentDiff: vi.fn(),
    });

    const result = await service.createReviewArtifact({
      projectName: 'App',
      projectPath: '/tmp/app',
      sessionId: 'session-1',
      provider: 'claude',
    });

    expect(result.empty).toBe(false);
    expect(result.source).toBe('checkpoint:checkpoint-1');
    expect(createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'review-flow',
        metadata: expect.objectContaining({ source: 'review-flow', provider: 'claude' }),
      }),
      { autoExport: false },
    );
  });
});
