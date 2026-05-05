import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { resolvePackagedSmokeConfig } from './packaged-smoke.mjs';

describe('resolvePackagedSmokeConfig', () => {
  it('resolves a debug portable package into a smoke target', () => {
    const root = join(tmpdir(), `argus-debug-smoke-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'Argus-Debug.exe'), '');
    writeFileSync(join(root, 'build-manifest.json'), JSON.stringify({
      channel: 'debug',
      debug: true,
      version: '1.30.4',
    }));

    const config = resolvePackagedSmokeConfig({
      packageRoot: root,
      port: 3999,
    });

    expect(config.exePath).toBe(join(root, 'Argus-Debug.exe'));
    expect(config.baseUrl).toBe('http://127.0.0.1:3999');
    expect(config.channel).toBe('debug');
    expect(config.env.SERVER_PORT).toBe('3999');
    expect(config.env.MTL_CODE_NO_OPEN).toBe('1');
  });
});
