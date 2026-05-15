import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('WebSocket Obsidian wiring keeps templates separate while syncing native auto-memory', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /syncInstructionFile: syncObsidianInstructionFile/);
  assert.match(source, /syncProjectInstructionFiles: syncObsidianProjectInstructionFiles/);
  assert.match(source, /syncNativeMemoryFiles/);
  assert.match(source, /isNativeAutoMemorySyncEnabled/);
  assert.match(source, /applyObsidianContextToChatCommand/);
  assert.doesNotMatch(source, /applyExplicitWikiIntentToChatCommand/);
  assert.doesNotMatch(source, /applyObsidianWikiPolicyPromptToChatCommand/);
  assert.doesNotMatch(source, /runObsidianAutoCaptureBackfill/);
  assert.doesNotMatch(source, /scheduleObsidianAutoCaptureBackfill/);
  assert.doesNotMatch(source, /captureObsidianAutoMemory/);
  assert.doesNotMatch(source, /autoCaptureTurnMemory:/);
});
