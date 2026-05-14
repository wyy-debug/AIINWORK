import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('useChatComposerState custom command display handling', () => {
  it('keeps expanded command text out of the visible user bubble', () => {
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('displayText?: string;');
    expect(source).toContain("displayText: typeof rawInput === 'string' ? rawInput.trim() : ''");
    expect(source).toContain('const displayUserText = oneShotDisplayTextRef.current;');
    expect(source).toContain('content: displayUserText || (currentInput.trim() ? currentInput : messageContent)');
  });
});
