import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('useChatComposerState Obsidian auto-capture context', () => {
  it('sends selected project name with provider commands so auto-capture does not fall back to General', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    for (const commandType of ['cursor-command', 'codex-command', 'gemini-command', 'claude-command']) {
      const pattern = new RegExp(`type: '${commandType}'[\\s\\S]*?options: \\{[\\s\\S]*?projectName: selectedProject\\.name`);
      expect(source, `${commandType} should include projectName in options`).toMatch(pattern);
    }
  });
});
