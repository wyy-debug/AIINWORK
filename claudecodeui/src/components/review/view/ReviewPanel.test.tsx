import { describe, expect, it } from 'vitest';

import { getDiffHunks, getRenderedDiffRows, MAX_DIFF_HUNKS, MAX_RENDERED_DIFF_ROWS } from './ReviewPanel';

describe('ReviewPanel diff rendering performance', () => {
  it('caps rendered diff rows while reporting hidden rows', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2000 +1,2000 @@',
      ...Array.from({ length: MAX_RENDERED_DIFF_ROWS + 25 }, (_, index) => `+line ${index}`),
    ].join('\n');

    const result = getRenderedDiffRows(diff, MAX_RENDERED_DIFF_ROWS);

    expect(result.rows).toHaveLength(MAX_RENDERED_DIFF_ROWS);
    expect(result.totalRows).toBe(MAX_RENDERED_DIFF_ROWS + 29);
    expect(result.hiddenRows).toBe(29);
  });

  it('keeps line comments addressable for rendered rows', () => {
    const diff = [
      '@@ -10,2 +10,2 @@',
      ' unchanged',
      '-old',
      '+new',
    ].join('\n');

    const result = getRenderedDiffRows(diff, MAX_RENDERED_DIFF_ROWS);

    expect(result.rows.map((row) => row.lineNumber)).toEqual([null, 10, 11, 11]);
  });

  it('caps diff hunk previews for very large diffs', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      ...Array.from({ length: MAX_DIFF_HUNKS + 25 }, (_, index) => [
        `@@ -${index + 1},1 +${index + 1},1 @@`,
        `-old ${index}`,
        `+new ${index}`,
      ]).flat(),
    ].join('\n');

    const result = getDiffHunks(diff, MAX_DIFF_HUNKS);

    expect(result).toHaveLength(MAX_DIFF_HUNKS);
    expect(result[0].title).toContain('@@ -1,1 +1,1 @@');
    expect(result.at(-1)?.title).toContain(`@@ -${MAX_DIFF_HUNKS},1 +${MAX_DIFF_HUNKS},1 @@`);
  });
});
