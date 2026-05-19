import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const writeSettings = async (settings) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'argus-brain-runtime-'));
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  return dir;
};

describe('Argus Brain runtime settings', () => {
  it('normalizes Brain settings and ignores legacy strategy config', async () => {
    const service = await import('../mtl-code-model-service.js');
    const config = service.normalizeBrainRuntimeConfig({
      enabled: 'true',
      captureRawRefs: 'false',
      compactEventThreshold: 0,
      compactTextThreshold: 500,
      maxInjectedTokens: 999999,
      recallTimeoutMs: 50,
      retention: {
        perSessionMaxEvents: 5,
        perProjectMaxCompactions: 999999,
        rawRefsMaxSizeBytes: 1,
      },
    });

    expect(config).toMatchObject({
      enabled: true,
      captureRawRefs: false,
      compactEventThreshold: 1,
      compactTextThreshold: 1000,
      maxInjectedTokens: 12000,
      recallTimeoutMs: 100,
      retention: {
        perSessionMaxEvents: 100,
        perProjectMaxCompactions: 10000,
        rawRefsMaxSizeBytes: 100000,
      },
    });
    expect('OPENMYTHOS_RUNTIME_ENV_KEYS' in service).toBe(false);
    expect('applyOpenMythosRuntimeToEnv' in service).toBe(false);
    expect('buildOpenMythosRuntimePreview' in service).toBe(false);
  });

  it('resolves Brain config into model runtime without writing legacy env keys', async () => {
    const service = await import('../mtl-code-model-service.js');
    const dir = await writeSettings({
      activeMtlCodeModelProfileId: 'main',
      openMythosRuntime: {
        enabled: true,
        adaptiveEffort: true,
      },
      argusBrain: {
        enabled: true,
        captureRawRefs: false,
        maxInjectedTokens: 640,
      },
      mtlCodeModelProfiles: [{
        id: 'main',
        name: 'Main',
        provider: 'anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://example.test/anthropic',
        model: 'claude-sonnet-4',
      }],
    });

    try {
      const runtime = await service.resolveMtlCodeModelRuntime('main', { MTL_CODE_CONFIG_DIR: dir });
      expect(runtime.brainRuntime).toMatchObject({
        enabled: true,
        captureRawRefs: false,
        maxInjectedTokens: 640,
      });
      expect(Object.keys(runtime.env).some((key) => key.includes('OPENMYTHOS'))).toBe(false);
      expect(runtime.env.MTL_CODE_UI_BARE).toBe('0');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
