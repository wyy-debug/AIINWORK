import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const readLocalSource = (...segments: string[]) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDir, ...segments), 'utf8');
};

describe('project delete API client', () => {
  it('encodes project names before calling the delete endpoint', () => {
    const source = readLocalSource('api.js');

    expect(source).toContain('/api/projects/${encodeURIComponent(projectName)}');
  });
});
