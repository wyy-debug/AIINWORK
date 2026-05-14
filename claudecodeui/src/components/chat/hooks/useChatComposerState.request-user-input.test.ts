import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('useChatComposerState request_user_input bridging', () => {
  it('auto-resolves a single pending request_user_input from chat input', () => {
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('findAutoAnswerableRequestUserInput');
    expect(source).toContain('pendingPermissionRequests');
    expect(source).toContain('handlePermissionDecision(autoAnsweredRequest.request.requestId');
    expect(source).toContain('updatedInput: autoAnsweredRequest.updatedInput');
  });
});
