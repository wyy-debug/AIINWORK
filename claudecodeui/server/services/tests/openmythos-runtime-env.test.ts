import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import {
  ANTHROPIC_MODEL_ENV_KEYS,
  MTL_CODE_MODEL_ENV_KEYS,
  OPENMYTHOS_RUNTIME_ENV_KEYS,
  OPENMYTHOS_RUNTIME_SETTINGS_KEY,
  SMALL_MODEL_RUNTIME_SETTINGS_KEY,
  applyAnthropicRuntimeModelDefaults,
  applyGoalRuntimeToEnv,
  applyOpenMythosRuntimeToEnv,
  applySubagentRuntimeToEnv,
  normalizeGoalRuntimeConfig,
  normalizeSmallModelRuntimeConfig,
  normalizeSubagentRuntimeConfig,
  readOpenMythosRuntimeConfig,
  readSmallModelRuntimeConfig,
  repairAnthropicRuntimeModelEnv,
  resolveMtlCodeModelRuntime,
} from '../mtl-code-model-service.js';

test('OpenMythos runtime settings are normalized and written to MTL_CODE_OPENMYTHOS env keys', async () => {
  const env: Record<string, string> = {};
  applyOpenMythosRuntimeToEnv(env, {
    enabled: true,
    adaptiveEffort: false,
    taskCard: true,
    routingHints: false,
    loopControl: 'advisory',
    stableReinjection: false,
    phaseAdapter: true,
    expertRouting: false,
    contextCacheDiagnostics: true,
    minEffort: 'medium',
    maxEffort: 'high',
  });

  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.enabled]).toBe('1');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.adaptiveEffort]).toBe('0');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.taskCard]).toBe('1');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.routingHints]).toBe('0');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.loopControl]).toBe('advisory');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.stableReinjection]).toBe('0');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.phaseAdapter]).toBe('1');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.expertRouting]).toBe('0');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.contextCacheDiagnostics]).toBe('1');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.minEffort]).toBe('medium');
  expect(env[OPENMYTHOS_RUNTIME_ENV_KEYS.maxEffort]).toBe('high');
  expect('MTL_CODE_OPENMYTHOS_AUTO_DISPATCH' in env).toBe(false);
});

test('Subagent runtime settings are normalized and written to Codex-style env keys', async () => {
  const env: Record<string, string> = {};
  const config = normalizeSubagentRuntimeConfig({
    enabled: true,
    maxConcurrentThreadsPerSession: 5,
    maxDepth: 2,
  });
  applySubagentRuntimeToEnv(env, config);

  expect(config.enabled).toBe(true);
  expect(env[MTL_CODE_MODEL_ENV_KEYS.subagentsEnabled]).toBe('1');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.subagentMaxConcurrentThreadsPerSession]).toBe('5');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.subagentMaxDepth]).toBe('2');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.allowNestedSubagents]).toBe('1');
});

test('Goal runtime settings are normalized and written to Codex-style env keys', async () => {
  const env: Record<string, string> = {};
  const config = normalizeGoalRuntimeConfig({ enabled: true });
  applyGoalRuntimeToEnv(env, config);

  expect(config.enabled).toBe(true);
  expect(env[MTL_CODE_MODEL_ENV_KEYS.goalsEnabled]).toBe('1');
});


test('Small model runtime settings are normalized and read from model settings', async () => {
  const settings = {
    [SMALL_MODEL_RUNTIME_SETTINGS_KEY]: {
      enabled: true,
      profileId: ' mimo-flash ',
      requestModel: ' relay-small ',
      timeoutMs: 999999,
      useForWikiRouting: false,
      useForWikiReadback: true,
    },
  };

  expect(readSmallModelRuntimeConfig(settings)).toEqual({
    enabled: true,
    profileId: 'mimo-flash',
    protocol: 'anthropic',
    requestModel: 'relay-small',
    timeoutMs: 15000,
    useForWikiRouting: false,
    useForWikiReadback: true,
  });
  expect(normalizeSmallModelRuntimeConfig({ timeoutMs: 100 })).toMatchObject({
    timeoutMs: 1000,
  });
});

test('Model profile requestModel overrides the runtime Anthropic model request name', async () => {
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
        requestModel: 'obsidian-small-anthropic',
        authToken: 'test-token',
        contextWindowTokens: 200000,
      },
    ],
    activeMtlCodeModelProfileId: 'relay-gpt-mini',
  }, null, 2), 'utf8');

  const previousConfigRoot = process.env.MTL_CODE_CONFIG_DIR;
  process.env.MTL_CODE_CONFIG_DIR = configRoot;
  try {
    const runtime = await resolveMtlCodeModelRuntime('relay-gpt-mini');

    expect(runtime?.profile.model).toBe('gpt-5.4-mini');
    expect(runtime?.profile.requestModel).toBe('obsidian-small-anthropic');
    expect(runtime?.env.ANTHROPIC_MODEL).toBe('obsidian-small-anthropic');
    expect(runtime?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('obsidian-small-anthropic');
    expect(runtime?.env.MTL_CODE_SUBAGENT_MODEL).toBe('obsidian-small-anthropic');
  } finally {
    if (previousConfigRoot === undefined) {
      delete process.env.MTL_CODE_CONFIG_DIR;
    } else {
      process.env.MTL_CODE_CONFIG_DIR = previousConfigRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('OpenAI-compatible model profiles build OpenAI runtime env', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-model-runtime-'));
  const configRoot = path.join(tempRoot, '.mtl-code');
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, 'settings.json'), JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: 'http://stale.example.com',
      ANTHROPIC_MODEL: 'stale-anthropic-model',
    },
    mtlCodeModelProfiles: [
      {
        id: 'wd-openai',
        name: 'WD OpenAI',
        protocol: 'openai-compatible',
        baseUrl: 'http://token.wd.com',
        model: 'gpt-5.4-mini',
        authToken: 'test-token',
        contextWindowTokens: 200000,
      },
    ],
    activeMtlCodeModelProfileId: 'wd-openai',
  }, null, 2), 'utf8');

  const previousConfigRoot = process.env.MTL_CODE_CONFIG_DIR;
  process.env.MTL_CODE_CONFIG_DIR = configRoot;
  try {
    const runtime = await resolveMtlCodeModelRuntime('wd-openai');

    expect(runtime?.env.MTL_CODE_USE_OPENAI).toBe('1');
    expect(runtime?.env.OPENAI_BASE_URL).toBe('http://token.wd.com/v1');
    expect(runtime?.env.OPENAI_MODEL).toBe('gpt-5.4-mini');
    expect(runtime?.env.OPENAI_API_KEY).toBe('test-token');
    expect(runtime?.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(runtime?.env.ANTHROPIC_MODEL).toBeUndefined();
  } finally {
    if (previousConfigRoot === undefined) {
      delete process.env.MTL_CODE_CONFIG_DIR;
    } else {
      process.env.MTL_CODE_CONFIG_DIR = previousConfigRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('Anthropic model profiles normalize gateway base URLs and disable stale OpenAI routing', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-model-runtime-'));
  const configRoot = path.join(tempRoot, '.mtl-code');
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, 'settings.json'), JSON.stringify({
    env: {
      MTL_CODE_USE_OPENAI: '1',
    },
    mtlCodeModelProfiles: [
      {
        id: 'wd-anthropic',
        name: 'WD Anthropic',
        protocol: 'anthropic',
        baseUrl: 'http://token.wd.com/v1/',
        model: 'gpt-5.4',
        authToken: 'test-token',
        contextWindowTokens: 200000,
      },
    ],
    activeMtlCodeModelProfileId: 'wd-anthropic',
  }, null, 2), 'utf8');

  const previousConfigRoot = process.env.MTL_CODE_CONFIG_DIR;
  process.env.MTL_CODE_CONFIG_DIR = configRoot;
  try {
    const runtime = await resolveMtlCodeModelRuntime('wd-anthropic');

    expect(runtime?.env.MTL_CODE_USE_OPENAI).toBe('0');
    expect(runtime?.env.ANTHROPIC_BASE_URL).toBe('http://token.wd.com');
    expect(runtime?.env.ANTHROPIC_MODEL).toBe('gpt-5.4');
    expect(runtime?.env.ANTHROPIC_AUTH_TOKEN).toBe('test-token');
  } finally {
    if (previousConfigRoot === undefined) {
      delete process.env.MTL_CODE_CONFIG_DIR;
    } else {
      process.env.MTL_CODE_CONFIG_DIR = previousConfigRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('OpenMythos runtime settings override stale env values when read back', async () => {
  const env = {
    MTL_CODE_OPENMYTHOS_RUNTIME: '0',
    MTL_CODE_OPENMYTHOS_LOOP_CONTROL: 'advisory',
    MTL_CODE_OPENMYTHOS_MIN_EFFORT: 'low',
    MTL_CODE_OPENMYTHOS_MAX_EFFORT: 'medium',
  };
  const settings = {
    [OPENMYTHOS_RUNTIME_SETTINGS_KEY]: {
      enabled: true,
      loopControl: 'enforced',
      minEffort: 'high',
      maxEffort: 'xhigh',
    },
  };

  const config = readOpenMythosRuntimeConfig(settings, env);

  expect(config.enabled).toBe(true);
  expect('autoDispatchSubagents' in config).toBe(false);
  expect(config.loopControl).toBe('enforced');
  expect(config.minEffort).toBe('high');
  expect(config.maxEffort).toBe('xhigh');
});

test('Anthropic runtime defaults force subagents to the active model instead of stale small-model env', async () => {
  const env: Record<string, string> = {
    [ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel]: 'deepseek-v4-flash',
    [MTL_CODE_MODEL_ENV_KEYS.subagentModel]: 'deepseek-v4-flash',
    [MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel]: 'deepseek-v4-flash',
  };

  applyAnthropicRuntimeModelDefaults(env, {
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-pro',
  });

  expect(env[ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel]).toBe('deepseek-v4-pro');
  expect(env[ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel]).toBe('deepseek-v4-pro');
  expect(env[ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel]).toBe('deepseek-v4-pro');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.subagentModel]).toBe('deepseek-v4-pro');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel]).toBe('deepseek-v4-pro');
});

test('Anthropic runtime defaults clear stale DeepSeek subagent model when switching to MiMo', async () => {
  const env: Record<string, string> = {
    [MTL_CODE_MODEL_ENV_KEYS.subagentModel]: 'deepseek-v4-flash',
    [MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel]: 'deepseek-v4-flash',
    [MTL_CODE_MODEL_ENV_KEYS.effortLevel]: 'high',
    [MTL_CODE_MODEL_ENV_KEYS.legacyEffortLevel]: 'high',
  };

  applyAnthropicRuntimeModelDefaults(env, {
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    model: 'mimo-v2.5',
  });

  expect(env[MTL_CODE_MODEL_ENV_KEYS.subagentModel]).toBe('mimo-v2.5');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel]).toBe('mimo-v2.5');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.effortLevel]).toBe(undefined);
  expect(env[MTL_CODE_MODEL_ENV_KEYS.legacyEffortLevel]).toBe(undefined);
});

test('runtime env repair derives subagent model from active Anthropic env values', async () => {
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    ANTHROPIC_MODEL: 'mimo-v2.5-pro',
    MTL_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
    CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
  };

  repairAnthropicRuntimeModelEnv(env);

  expect(env[MTL_CODE_MODEL_ENV_KEYS.subagentModel]).toBe('mimo-v2.5-pro');
  expect(env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel]).toBe('mimo-v2.5-pro');
});
