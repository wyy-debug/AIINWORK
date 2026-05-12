import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('Argus direct close handling treats only explicit user abort as aborted', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function isMtlCodeUserAbort/);
  assert.match(source, /child\?\._mtlCodeAborted === true|child\._mtlCodeAborted === true/);
  assert.doesNotMatch(source, /Boolean\(child\._mtlCodeAborted \|\| signal\)/);
  assert.match(source, /buildMtlCodeCloseFailureMessage/);
  assert.match(source, /Argus backend exited with signal/);
});

test('Argus coordinator dispatch enables native subagent tools for the spawned runtime', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /options\.coordinatorMode === true/);
  assert.match(source, /spawnEnv\.MTL_CODE_COORDINATOR_MODE = '1'/);
  assert.match(source, /spawnEnv\[MTL_CODE_MODEL_ENV_KEYS\.subagentsEnabled\] = '1'/);
});

test('Claude native memory disables bare mode and clears auto-memory blockers', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function isClaudeNativeMemoryEnabled/);
  assert.match(source, /function applyClaudeNativeMemoryEnv/);
  assert.match(source, /spawnEnv\.MTL_CODE_UI_BARE = '0'/);
  assert.match(source, /delete spawnEnv\.MTL_CODE_SIMPLE/);
  assert.match(source, /delete spawnEnv\.MTL_CODE_DISABLE_AUTO_MEMORY/);
  assert.match(source, /spawnEnv\.MTL_CODE_DISABLE_AUTO_MEMORY = '1'/);
});
