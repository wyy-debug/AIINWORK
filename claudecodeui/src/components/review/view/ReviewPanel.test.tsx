import { describe, expect, it } from 'vitest';

import { getRenderedDiffRows, MAX_RENDERED_DIFF_ROWS } from './ReviewPanel';

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
});
