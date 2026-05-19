import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('Obsidian health panel surfaces semantic provider and fallback state', async () => {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../src/components/settings/view/tabs/runtime-settings/ObsidianBridgeSettingsContent.tsx',
  );
  const source = await fs.readFile(sourcePath, 'utf8');

  for (const requiredText of [
    'Semantic index',
    'Smart Connections',
    'Open Connections',
    'keyword-bridge-search',
    'indexed notes',
  ]) {
    assert.match(source, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});
