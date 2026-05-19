import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('WebSocket Obsidian wiring keeps templates and Wiki separate from Claude native memory', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /syncInstructionFile: syncObsidianInstructionFile/);
  assert.match(source, /syncProjectInstructionFiles: syncObsidianProjectInstructionFiles/);
  assert.match(source, /applyObsidianContextToChatCommand/);
  assert.match(source, /applyExplicitWikiIntentToChatCommand/);
  assert.match(source, /void syncObsidianProjectInstructionFiles\(/);
  assert.doesNotMatch(source, /syncNativeMemoryFiles/);
  assert.doesNotMatch(source, /obsidianNativeMemorySync/);
  assert.doesNotMatch(source, /isNativeAutoMemorySyncEnabled/);
  assert.doesNotMatch(source, /applyObsidianWikiPolicyPromptToChatCommand/);
  assert.doesNotMatch(source, /runObsidianAutoCaptureBackfill/);
  assert.doesNotMatch(source, /scheduleObsidianAutoCaptureBackfill/);
  assert.doesNotMatch(source, /captureObsidianAutoMemory/);
  assert.doesNotMatch(source, /autoCaptureTurnMemory:/);
});
