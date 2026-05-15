import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('ChatComposer todo status extraction', () => {
  it('parses stringified TodoWrite object payloads for the status strip', () => {
    const composerSource = readFileSync(resolve(currentDir, 'ChatComposer.tsx'), 'utf8');

    expect(composerSource).toContain("trimmed.startsWith('[') || trimmed.startsWith('{')");
    expect(composerSource).toContain('const parsed = JSON.parse(trimmed);');
    expect(composerSource).toContain('return extractTodoItems(parsed);');
  });
});
