import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const writeSettings = async (settings) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mtl-code-native-memory-'));
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  return dir;
};

describe('MTL-Code native memory runtime settings', () => {
  it('does not enable --bare when Claude native memory is enabled', async () => {
    const service = await import('../mtl-code-model-service.js');
    const dir = await writeSettings({
      activeMtlCodeModelProfileId: 'main',
      mtlCodeModelProfiles: [{
        id: 'main',
        name: 'Main',
        provider: 'anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://example.test/anthropic',
        model: 'claude-sonnet-4',
        claudeNativeMemoryEnabled: true,
        bareMode: true,
      }],
    });

    try {
      const runtime = await service.resolveMtlCodeModelRuntime('main', { MTL_CODE_CONFIG_DIR: dir });
      expect(runtime.env.MTL_CODE_CLAUDE_NATIVE_MEMORY).toBe('1');
      expect(runtime.env.MTL_CODE_UI_BARE).toBe('0');
      expect(runtime.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION).toBe('1');
      expect(runtime.profile).toMatchObject({
        claudeNativeMemoryEnabled: true,
        bareMode: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses --bare-compatible env when Claude native memory is disabled', async () => {
    const service = await import('../mtl-code-model-service.js');
    const dir = await writeSettings({
      activeMtlCodeModelProfileId: 'main',
      mtlCodeModelProfiles: [{
        id: 'main',
        name: 'Main',
        provider: 'anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://example.test/anthropic',
        model: 'claude-sonnet-4',
        claudeNativeMemoryEnabled: false,
        bareMode: true,
      }],
    });

    try {
      const runtime = await service.resolveMtlCodeModelRuntime('main', { MTL_CODE_CONFIG_DIR: dir });
      expect(runtime.env.MTL_CODE_CLAUDE_NATIVE_MEMORY).toBe('0');
      expect(runtime.env.MTL_CODE_UI_BARE).toBe('1');
      expect(runtime.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION).toBeUndefined();
      expect(runtime.profile).toMatchObject({
        claudeNativeMemoryEnabled: false,
        bareMode: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
