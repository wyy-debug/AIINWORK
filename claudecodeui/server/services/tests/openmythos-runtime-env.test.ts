import { expect, test } from 'vitest';
import {
  ANTHROPIC_MODEL_ENV_KEYS,
  MTL_CODE_MODEL_ENV_KEYS,
  OPENMYTHOS_RUNTIME_ENV_KEYS,
  OPENMYTHOS_RUNTIME_SETTINGS_KEY,
  applyAnthropicRuntimeModelDefaults,
  applyGoalRuntimeToEnv,
  applyOpenMythosRuntimeToEnv,
  applySubagentRuntimeToEnv,
  normalizeGoalRuntimeConfig,
  normalizeSubagentRuntimeConfig,
  readOpenMythosRuntimeConfig,
  repairAnthropicRuntimeModelEnv,
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
