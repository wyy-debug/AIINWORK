import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('ProjectLauncherMenu', () => {
  it('is wired into the main content header', () => {
    const currentFile = fileURLToPath(import.meta.url);
    const header = readFileSync(resolve(dirname(currentFile), 'MainContentHeader.tsx'), 'utf8');

    expect(header).toContain('ProjectLauncherMenu');
    expect(header).toContain('selectedProject={selectedProject}');
  });

  it('shows the expected local launch actions', () => {
    const currentFile = fileURLToPath(import.meta.url);
    const source = readFileSync(resolve(dirname(currentFile), 'ProjectLauncherMenu.tsx'), 'utf8');

    expect(source).toContain('VS Code');
    expect(source).toContain('Visual Studio');
    expect(source).toContain('Cursor');
    expect(source).toContain('Antigravity');
    expect(source).toContain('File Explorer');
    expect(source).toContain('Git Bash');
    expect(source).toContain('openLocalToolFile');
    expect(source).toContain('openLocalTerminal');
    expect(source).toContain('openLocalPath');
  });
});
