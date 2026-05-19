import { describe, expect, it } from 'vitest';

import { buildGitNativeReviewFlow } from '../git-native-review-flow-service.js';

describe('git-native-review-flow-service', () => {
  it('builds a review package with summary, risks, tests, commit message, and PR body', () => {
    const review = buildGitNativeReviewFlow({
      projectName: 'AIINWORK',
      branch: 'codex/review-flow',
      files: [
        { path: 'server/routes/auth.js', kind: 'modified', status: 'M' },
        { path: 'src/components/review/view/ReviewPanel.tsx', kind: 'modified', status: 'M' },
      ],
      diff: 'diff --git a/server/routes/auth.js b/server/routes/auth.js\n+const token = readToken();\n',
    });

    expect(review.hasChanges).toBe(true);
    expect(review.summary.join('\n')).toContain('Changed files: 2');
    expect(review.risks.some((risk) => risk.title.includes('Security'))).toBe(true);
    expect(review.tests).toContain('npm run typecheck');
    expect(review.commitMessage).toMatch(/^(fix|feat|chore|test|docs)\(/);
    expect(review.prBody).toContain('## Summary');
    expect(review.content).toContain('## Diff Preview');
  });

  it('returns a clear empty state when there is no diff', () => {
    const review = buildGitNativeReviewFlow({ projectName: 'Clean', files: [], diff: '' });
    expect(review.hasChanges).toBe(false);
    expect(review.content).toContain('nothing to review');
    expect(review.commitMessage).toBe('');
  });
});
