import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('MainContent swarm page rendering', () => {
  it('does not mount a standalone SwarmDashboard page', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MainContent.tsx'), 'utf8');

    expect(source).not.toContain('SwarmDashboard');
    expect(source).not.toContain("visibleActiveTab === 'swarms'");
  });
});
