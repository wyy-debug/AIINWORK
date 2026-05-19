import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('chat UI exposes explicit Wiki candidate review language and actions', async () => {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../src/components/chat/view/subcomponents/MessageComponent.tsx',
  );
  const source = await fs.readFile(sourcePath, 'utf8');

  for (const requiredText of [
    'Wiki candidate review',
    'target path',
    'duplicate warnings',
    'Edit candidate',
    'Commit candidate',
    'Discard candidate',
  ]) {
    assert.match(source, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});
