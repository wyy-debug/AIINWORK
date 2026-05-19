import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('MainContent subagents page rendering', () => {
  it('mounts the OpenCode-style Subagents workspace', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MainContent.tsx'), 'utf8');

    expect(source).toContain('SubagentsWorkspace');
    expect(source).toContain("visibleActiveTab === 'subagents'");
  });
});
