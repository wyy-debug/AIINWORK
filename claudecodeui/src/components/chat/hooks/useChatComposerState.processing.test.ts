import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('useChatComposerState processing session tracking', () => {
  it('marks the active session placeholder as processing before a real session id exists', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('onSessionActive?.(sessionToActivate);');
    expect(source).toContain('onSessionProcessing?.(sessionToActivate);');
    expect(source).not.toContain('onSessionProcessing?.(backendSessionId);');
  });
});
