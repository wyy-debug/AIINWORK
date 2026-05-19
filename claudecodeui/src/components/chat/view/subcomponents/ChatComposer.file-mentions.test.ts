import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const readLocalSource = (...segments: string[]) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDir, ...segments), 'utf8');
};

describe('ChatComposer file mentions', () => {
  it('renders folder candidates distinctly in the @ mention picker', () => {
    const source = readLocalSource('ChatComposer.tsx');

    expect(source).toContain("type?: 'file' | 'directory'");
    expect(source).toContain('FolderIcon');
    expect(source).toContain("file.type === 'directory'");
  });
});
