import { describe, expect, it } from 'vitest';

import { parseInlineFileReference } from './markdownFileReferences';

describe('parseInlineFileReference', () => {
  it('detects project-relative file references with line and column', () => {
    expect(parseInlineFileReference('src/utils/queryContext.ts:61:7')).toEqual({
      path: 'src/utils/queryContext.ts',
      line: 61,
      column: 7,
    });
  });

  it('detects Windows absolute file references', () => {
    expect(parseInlineFileReference('E:/AIINWORK/workspace/vendor/electron-dist/build-manifest.json')).toEqual({
      path: 'E:/AIINWORK/workspace/vendor/electron-dist/build-manifest.json',
      line: null,
      column: null,
    });
  });

  it('detects plain filename references with known source/document extensions', () => {
    expect(parseInlineFileReference('build-manifest.json')).toEqual({
      path: 'build-manifest.json',
      line: null,
      column: null,
    });
  });

  it('does not treat function calls or identifiers as file references', () => {
    expect(parseInlineFileReference('getSystemPrompt()')).toBeNull();
    expect(parseInlineFileReference('systemPrompt')).toBeNull();
    expect(parseInlineFileReference('cache_control')).toBeNull();
  });
});
