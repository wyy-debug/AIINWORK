import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const readLocalSource = (...segments: string[]) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDir, ...segments), 'utf8');
};

describe('SidebarProjectItem CodeGraph action', () => {
  it('opens a native script scope picker before queueing CodeGraph and shows progress from status polling', () => {
    const source = readLocalSource('SidebarProjectItem.tsx');

    expect(source).toContain('selectCodeGraphScope');
    expect(source).toContain('scopePaths');
    expect(source).toContain('/api/codegraph/build-obsidian');
    expect(source).toContain('/api/codegraph/cancel');
    expect(source).toContain('cancelCodeGraphBuild');
    expect(source).toContain('/api/codegraph/status');
    expect(source).toContain('codeGraphBuildStatus');
    expect(source).toContain('codeGraphProgressPercent');
    expect(source).toContain('CodeGraphProgress');
    expect(source).toContain('style={{ width: `${codeGraphProgressPercent}%` }}');
    expect(source).toContain('const token = codeGraphPollTokenRef.current + 1;');
    expect(source).toContain('codeGraphPollTokenRef.current = token;');
    expect(source).not.toContain("isBuildingCodeGraph && 'pointer-events-none opacity-60'");
  });
});
