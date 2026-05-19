import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, vi } from 'vitest';

test('resolveMtlCodeModelRuntime does not inject dedicated subagent model env', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-model-runtime-'));
  const configRoot = path.join(tempRoot, '.mtl-code');
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, 'settings.json'), JSON.stringify({
    env: {
      MTL_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
    },
    mtlCodeModelProfiles: [
      {
        id: 'mimo-v2-5',
        name: 'MiMo V2.5',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
        model: 'mimo-v2.5',
        authToken: 'test-token',
        contextWindowTokens: 1000000,
      },
    ],
    activeMtlCodeModelProfileId: 'mimo-v2-5',
  }, null, 2), 'utf8');

  const previousConfigRoot = process.env.MTL_CODE_CONFIG_DIR;
  process.env.MTL_CODE_CONFIG_DIR = configRoot;
  try {
    vi.resetModules();
    const { resolveMtlCodeModelRuntime } = await import('../mtl-code-model-service.js');
    const runtime = await resolveMtlCodeModelRuntime('mimo-v2-5');

    assert.equal(runtime?.env.ANTHROPIC_MODEL, 'mimo-v2.5');
    assert.equal(runtime?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'mimo-v2.5');
    assert.equal(runtime?.env.MTL_CODE_SUBAGENT_MODEL, undefined);
    assert.equal(runtime?.env.CLAUDE_CODE_SUBAGENT_MODEL, undefined);
  } finally {
    if (previousConfigRoot === undefined) {
      delete process.env.MTL_CODE_CONFIG_DIR;
    } else {
      process.env.MTL_CODE_CONFIG_DIR = previousConfigRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('resolveMtlCodeModelRuntime uses request model override for Anthropic relay routing', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-model-runtime-'));
  const configRoot = path.join(tempRoot, '.mtl-code');
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, 'settings.json'), JSON.stringify({
    env: {},
    mtlCodeModelProfiles: [
      {
        id: 'relay-gpt-mini',
        name: 'Relay GPT Mini',
        baseUrl: 'http://token.wd.com',
        model: 'gpt-5.4-mini',
        requestModel: 'relay-anthropic-model',
        authToken: 'test-token',
        contextWindowTokens: 200000,
      },
    ],
    activeMtlCodeModelProfileId: 'relay-gpt-mini',
  }, null, 2), 'utf8');

  const previousConfigRoot = process.env.MTL_CODE_CONFIG_DIR;
  process.env.MTL_CODE_CONFIG_DIR = configRoot;
  try {
    vi.resetModules();
    const { resolveMtlCodeModelRuntime } = await import('../mtl-code-model-service.js');
    const runtime = await resolveMtlCodeModelRuntime('relay-gpt-mini');

    assert.equal(runtime?.profile.model, 'gpt-5.4-mini');
    assert.equal(runtime?.profile.requestModel, 'relay-anthropic-model');
    assert.equal(runtime?.env.ANTHROPIC_MODEL, 'relay-anthropic-model');
    assert.equal(runtime?.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'relay-anthropic-model');
    assert.equal(runtime?.env.MTL_CODE_SUBAGENT_MODEL, undefined);
    assert.equal(runtime?.env.CLAUDE_CODE_SUBAGENT_MODEL, undefined);
  } finally {
    if (previousConfigRoot === undefined) {
      delete process.env.MTL_CODE_CONFIG_DIR;
    } else {
      process.env.MTL_CODE_CONFIG_DIR = previousConfigRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
