import assert from 'node:assert/strict';
import test from 'node:test';

test('OpenMythos runtime settings are normalized and written to MTL_CODE_OPENMYTHOS env keys', async () => {
  const {
    applyOpenMythosRuntimeToEnv,
    OPENMYTHOS_RUNTIME_ENV_KEYS,
  } = await import(`../mtl-code-model-service.js?openmythosEnv=${Date.now()}`);

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
    autoDispatchSubagents: true,
    autoDispatchMinEffort: 'xhigh',
    autoDispatchMaxWorkers: 6,
    minEffort: 'medium',
    maxEffort: 'high',
  });

  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.enabled], '1');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.adaptiveEffort], '0');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.taskCard], '1');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.routingHints], '0');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.loopControl], 'advisory');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.stableReinjection], '0');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.phaseAdapter], '1');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.expertRouting], '0');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.contextCacheDiagnostics], '1');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.autoDispatchSubagents], '0');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.autoDispatchMinEffort], 'xhigh');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.autoDispatchMaxWorkers], '6');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.minEffort], 'medium');
  assert.equal(env[OPENMYTHOS_RUNTIME_ENV_KEYS.maxEffort], 'high');
});

test('OpenMythos runtime settings override stale env values when read back', async () => {
  const {
    OPENMYTHOS_RUNTIME_SETTINGS_KEY,
    readOpenMythosRuntimeConfig,
  } = await import(`../mtl-code-model-service.js?openmythosRead=${Date.now()}`);

  const env = {
    MTL_CODE_OPENMYTHOS_RUNTIME: '0',
    MTL_CODE_OPENMYTHOS_AUTO_DISPATCH: '0',
    MTL_CODE_OPENMYTHOS_LOOP_CONTROL: 'advisory',
    MTL_CODE_OPENMYTHOS_MIN_EFFORT: 'low',
    MTL_CODE_OPENMYTHOS_MAX_EFFORT: 'medium',
  };
  const settings = {
    [OPENMYTHOS_RUNTIME_SETTINGS_KEY]: {
      enabled: true,
      autoDispatchSubagents: true,
      loopControl: 'enforced',
      minEffort: 'high',
      maxEffort: 'xhigh',
    },
  };

  const config = readOpenMythosRuntimeConfig(settings, env);

  assert.equal(config.enabled, true);
  assert.equal(config.autoDispatchSubagents, false);
  assert.equal(config.loopControl, 'enforced');
  assert.equal(config.minEffort, 'high');
  assert.equal(config.maxEffort, 'xhigh');
});

test('Anthropic runtime defaults force subagents to the active model instead of stale small-model env', async () => {
  const {
    ANTHROPIC_MODEL_ENV_KEYS,
    MTL_CODE_MODEL_ENV_KEYS,
    applyAnthropicRuntimeModelDefaults,
  } = await import(`../mtl-code-model-service.js?activeSubagentModel=${Date.now()}`);

  const env: Record<string, string> = {
    [ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel]: 'deepseek-v4-flash',
    [MTL_CODE_MODEL_ENV_KEYS.subagentModel]: 'deepseek-v4-flash',
    [MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel]: 'deepseek-v4-flash',
  };

  applyAnthropicRuntimeModelDefaults(env, {
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-pro',
  });

  assert.equal(env[ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel], 'deepseek-v4-pro');
  assert.equal(env[ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel], 'deepseek-v4-pro');
  assert.equal(env[ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel], 'deepseek-v4-pro');
  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.subagentModel], 'deepseek-v4-pro');
  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel], 'deepseek-v4-pro');
});

test('Anthropic runtime defaults clear stale DeepSeek subagent model when switching to MiMo', async () => {
  const {
    MTL_CODE_MODEL_ENV_KEYS,
    applyAnthropicRuntimeModelDefaults,
  } = await import(`../mtl-code-model-service.js?mimoSubagentModel=${Date.now()}`);

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

  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.subagentModel], 'mimo-v2.5');
  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel], 'mimo-v2.5');
  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.effortLevel], undefined);
  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.legacyEffortLevel], undefined);
});

test('runtime env repair derives subagent model from active Anthropic env values', async () => {
  const {
    MTL_CODE_MODEL_ENV_KEYS,
    repairAnthropicRuntimeModelEnv,
  } = await import(`../mtl-code-model-service.js?repairSubagentModel=${Date.now()}`);

  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    ANTHROPIC_MODEL: 'mimo-v2.5-pro',
    MTL_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
    CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
  };

  repairAnthropicRuntimeModelEnv(env);

  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.subagentModel], 'mimo-v2.5-pro');
  assert.equal(env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel], 'mimo-v2.5-pro');
});
