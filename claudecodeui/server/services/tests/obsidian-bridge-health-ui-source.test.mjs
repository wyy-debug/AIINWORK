import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('Obsidian settings exposes health states and recovery actions', async () => {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../src/components/settings/view/tabs/runtime-settings/ObsidianBridgeSettingsContent.tsx',
  );
  const source = await fs.readFile(sourcePath, 'utf8');

  for (const requiredText of [
    'Obsidian Health',
    'not installed',
    'not paired',
    'wrong vault',
    'stale token',
    'indexing missing',
    'no Wiki notes',
    'read-only mode',
    'write failed',
    'Reconnect',
    'Reinstall plugin',
    'Select vault',
    'Refresh folders',
    'Run test query',
    'Run test write',
    'Safe issue logs',
  ]) {
    assert.match(source, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});
