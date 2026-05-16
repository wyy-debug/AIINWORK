import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const readSource = (fileName: string) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDir, fileName), 'utf8');
};

describe('WorkspacePathField native picker', () => {
  it('uses the desktop Windows-native project root picker instead of the web folder browser', () => {
    const source = readSource('WorkspacePathField.tsx');

    expect(source).toContain('window.argusDesktop?.selectProjectRoot');
    expect(source).toContain('Windows 原生目录选择窗口');
    expect(source).toContain('buttonLabel');
    expect(source).not.toContain('FolderBrowserModal');
    expect(source).not.toContain('setShowFolderBrowser');
    expect(source).not.toContain('showFolderBrowser');
  });
});
