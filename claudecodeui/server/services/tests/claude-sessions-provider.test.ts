import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ClaudeSessionsProvider } from '../../modules/providers/list/claude/claude-sessions.provider.js';

test('Claude session provider hides Argus synthetic fallback user messages', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'user',
    isSynthetic: true,
    uuid: 'synthetic-1',
    message: {
      role: 'user',
      content: '<argus-internal-fallback>\nThe previous response did not inspect the repository.',
    },
  }, 'session-1');

  assert.deepEqual(messages, []);
});

test('Claude session provider hides persisted Argus internal fallback prefixes', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'user',
    uuid: 'synthetic-2',
    message: {
      role: 'user',
      content: '<argus-internal-fallback>\nArgus performed a read-only repository preflight.',
    },
  }, 'session-1');

  assert.deepEqual(messages, []);
});
