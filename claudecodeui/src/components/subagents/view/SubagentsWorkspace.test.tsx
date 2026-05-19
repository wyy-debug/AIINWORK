import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('SubagentsWorkspace', () => {
  it('uses OpenCode-style Running, Library, and History views without legacy Swarm concepts', () => {
    const source = readFileSync(resolve(currentDir, 'SubagentsWorkspace.tsx'), 'utf8');

    expect(source).toContain('Running');
    expect(source).toContain('Library');
    expect(source).toContain('History');
    expect(source).toContain('invokeAgent');
    expect(source).toContain('data-testid="subagents-library"');
    expect(source).toContain('data-testid="subagent-library-run"');
    expect(source).not.toContain('Swarm');
    expect(source).not.toContain('topology');
    expect(source).not.toContain('message bus');
    expect(source).not.toContain('manifest editor');
  });
});
