import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('chat finalization materializes Brain L1/L2/L3 layers after post-turn capture', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /brainLayeredMemoryService/);
  assert.match(source, /materializeSessionLayers\(/);
  assert.match(source, /layered\.atoms\.length/);
  assert.match(source, /brainPostTurnExtractionService/);
  assert.match(source, /extractPostTurn\(/);
  assert.match(source, /brain_post_turn_extraction/);
});
