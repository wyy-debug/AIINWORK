import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('MainContentTabSwitcher swarm page entry', () => {
  it('does not expose Swarms as a standalone top-level page tab', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MainContentTabSwitcher.tsx'), 'utf8');

    expect(source).not.toContain("id: 'swarms'");
    expect(source).not.toContain("label: 'Swarms'");
  });
});
