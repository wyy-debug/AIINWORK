import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

describe('legacy orchestration removal', () => {
  test('server no longer mounts retired orchestration routes', () => {
    const source = readFileSync(resolve(root, 'server/index.js'), 'utf8');

    expect(source.includes("from './routes/" + "swarms.js'")).toBe(false);
    expect(source.includes("app.use('/api/" + "swarms'")).toBe(false);
  });

  test('client API no longer exposes retired orchestration endpoints', () => {
    const source = readFileSync(resolve(root, 'src/utils/api.js'), 'utf8');

    expect(source.includes('/api/' + 'swarms')).toBe(false);
    expect(source.includes('validate' + 'SwarmTemplate')).toBe(false);
    expect(source.includes('start' + 'SwarmRun')).toBe(false);
  });
});
