import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('OpenMythos runtime settings content', () => {
  it('does not render the static runtime preview panel', () => {
    const currentFile = fileURLToPath(import.meta.url);
    const sourcePath = resolve(dirname(currentFile), 'OpenMythosRuntimeContent.tsx');
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('openMythosRuntime.preview');
    expect(source).not.toContain('DEFAULT_PREVIEW_PROMPT');
    expect(source).not.toContain('previewPrompt');
    expect(source).not.toContain('PreviewList');
  });
});
