import { describe, expect, it, vi } from 'vitest';

import {
  buildGitNativeReviewFlow,
  buildUntrackedFileDiff,
  MAX_UNTRACKED_FILE_PREVIEW_BYTES,
} from '../git-native-review-flow-service.js';

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

  it('skips large untracked file previews without reading the file body', async () => {
    const readFile = vi.fn();
    const diff = await buildUntrackedFileDiff('/repo', 'large.bin', {
      stat: async () => ({ isDirectory: () => false, size: MAX_UNTRACKED_FILE_PREVIEW_BYTES + 1 }),
      readFile,
    });

    expect(readFile).not.toHaveBeenCalled();
    expect(diff).toContain('Preview skipped');
    expect(diff).toContain('above the');
  });

  it('summarizes binary untracked file previews safely', async () => {
    const diff = await buildUntrackedFileDiff('/repo', 'asset.dat', {
      stat: async () => ({ isDirectory: () => false, size: 4 }),
      readFile: async () => Buffer.from([0, 1, 2, 3]),
    });

    expect(diff).toContain('appears to be binary');
    expect(diff).not.toContain('\u0000');
  });

  it('keeps bounded text previews for normal untracked files', async () => {
    const diff = await buildUntrackedFileDiff('/repo', 'notes.txt', {
      stat: async () => ({ isDirectory: () => false, size: 12 }),
      readFile: async () => Buffer.from('hello\nworld'),
    });

    expect(diff).toContain('+++ b/notes.txt');
    expect(diff).toContain('+hello');
    expect(diff).toContain('+world');
  });
});
