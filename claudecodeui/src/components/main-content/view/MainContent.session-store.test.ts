import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('MainContent session store wiring', () => {
  it('creates one session store above the keyed chat view and passes it down', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MainContent.tsx'), 'utf8');

    expect(source).toContain("import { useSessionStore }");
    expect(source).toContain('const sessionStore = useSessionStore();');
    expect(source).toContain('sessionStore={sessionStore}');
  });
});
