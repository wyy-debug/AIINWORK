import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

test('test:unit includes server service and route regression tests', async () => {
  const source = await readFile(resolve(process.cwd(), 'vitest.config.ts'), 'utf8');

  expect(source).toContain('server/services/tests/**/*.{test,spec}.{ts,mjs}');
  expect(source).toContain('server/routes/tests/**/*.{test,spec}.{ts,mjs}');
});

test('test:unit includes React component regression tests', async () => {
  const source = await readFile(resolve(process.cwd(), 'vitest.config.ts'), 'utf8');

  expect(source).toContain('src/**/*.{test,spec}.{ts,tsx}');
});
