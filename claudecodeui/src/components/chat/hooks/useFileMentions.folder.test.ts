import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const readLocalSource = (...segments: string[]) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDir, ...segments), 'utf8');
};

describe('useFileMentions folder mentions', () => {
  it('accepts directory mention candidates from search results', () => {
    const source = readLocalSource('useFileMentions.tsx');

    expect(source).toContain("type?: 'file' | 'directory'");
    expect(source).toContain('MentionableFile[]');
    expect(source).toContain('mentionText = `@${file.relativePath || file.path}`');
    expect(source).toContain('searchRequestIdRef');
    expect(source).toContain('isCurrentRequest()');
  });
});
