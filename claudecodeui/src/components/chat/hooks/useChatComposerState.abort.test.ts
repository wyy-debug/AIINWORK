import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('useChatComposerState abort reconciliation', () => {
  it('re-checks session status after sending an abort request', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');
    const abortStart = source.indexOf('const handleAbortSession = useCallback(() => {');
    const abortEnd = source.indexOf('const handleGrantToolPermission = useCallback(', abortStart);
    const abortBlock = source.slice(abortStart, abortEnd);

    expect(abortBlock).toContain("type: 'abort-session'");
    expect(abortBlock).toContain("type: 'check-session-status'");
    expect(abortBlock).toContain('window.setTimeout(() => {');
  });
});
