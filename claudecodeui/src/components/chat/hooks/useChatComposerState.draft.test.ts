import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const readLocalSource = (...segments: string[]) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDir, ...segments), 'utf8');
};

describe('useChatComposerState draft stability', () => {
  it('restores saved draft input only when the project name changes', () => {
    const source = readLocalSource('useChatComposerState.ts');

    expect(source).toContain("const selectedProjectName = selectedProject?.name || ''");
    expect(source).toContain('draftInputProjectNameRef');
    expect(source).toContain('pendingDraftRestoreRef');
    expect(source).toContain('}, [selectedProjectName]);');
    expect(source).toContain('}, [input, selectedProjectName]);');
    expect(source).not.toMatch(/safeLocalStorage\.getItem\(`draft_input_\$\{selectedProject\.name\}`[\s\S]*?\}, \[selectedProject\]\);/);
    expect(source).toContain('if (input !== pendingRestore.input) {');
  });
});
