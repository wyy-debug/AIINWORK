import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('Windows release packaging rebuilds the paired Argus backend before staging resources', async () => {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../scripts/package-electron-win.mjs',
  );
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /const ensureMtlCodeBackendBuilt = \(\) => \{/);
  assert.match(source, /run\(bunExe,\s*\['run',\s*'build'\],\s*\{\s*cwd:\s*claudeCodeRoot\s*\}\)/);
  assert.doesNotMatch(source, /if \(existsSync\(nodeEntry\)\) \{\s*return;\s*\}/);
});
