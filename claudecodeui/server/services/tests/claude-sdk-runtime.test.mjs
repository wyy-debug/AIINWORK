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
