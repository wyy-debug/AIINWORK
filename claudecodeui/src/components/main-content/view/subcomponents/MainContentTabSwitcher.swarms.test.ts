import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('MainContentTabSwitcher subagents page entry', () => {
  it('exposes Subagents as a standalone top-level page tab', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MainContentTabSwitcher.tsx'), 'utf8');

    expect(source).toContain("id: 'subagents'");
    expect(source).toContain("label: 'Subagents'");
  });
});
