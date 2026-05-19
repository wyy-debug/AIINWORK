import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('runtime diagnostics panel exposes Brain Workbench layers and controls', async () => {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../src/components/chat/view/subcomponents/AgentRuntimeDiagnosticsPanel.tsx',
  );
  const source = await fs.readFile(sourcePath, 'utf8');

  for (const requiredText of [
    'Brain Workbench',
    'Raw refs',
    'Atoms',
    'Scenarios',
    'Project profile',
    'Recall reasons',
    'Recall hit details',
    'No compaction canvas yet. Showing recalled project memory instead.',
    'hit.summary',
    'hit.reasons',
    'Pin',
    'Archive',
    'Mark stale',
    'Merge',
    'Export report',
    'Show raw preview',
    'hidden unless expanded through safe evidence drill-down',
  ]) {
    assert.match(source, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
