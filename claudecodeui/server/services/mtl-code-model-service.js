import os from 'os';
import path from 'path';

import {
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
} from '../shared/utils.js';

export const MODEL_PROFILES_KEY = 'mtlCodeModelProfiles';
export const ACTIVE_MODEL_PROFILE_KEY = 'activeMtlCodeModelProfileId';

export const ANTHROPIC_MODEL_ENV_KEYS = {
  authToken: 'ANTHROPIC_AUTH_TOKEN',
  baseUrl: 'ANTHROPIC_BASE_URL',
  model: 'ANTHROPIC_MODEL',
  defaultHaikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  defaultSonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  defaultOpusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
};

export const OPENAI_MODEL_ENV_KEYS = {
  apiKey: 'OPENAI_API_KEY',
  baseUrl: 'OPENAI_BASE_URL',
  model: 'OPENAI_MODEL',
  defaultHaikuModel: 'OPENAI_DEFAULT_HAIKU_MODEL',
  defaultSonnetModel: 'OPENAI_DEFAULT_SONNET_MODEL',
  defaultOpusModel: 'OPENAI_DEFAULT_OPUS_MODEL',
};

export const MTL_CODE_MODEL_ENV_KEYS = {
  uiBareMode: 'MTL_CODE_UI_BARE',
  claudeNativeMemoryEnabled: 'MTL_CODE_CLAUDE_NATIVE_MEMORY',
  maxContextTokens: 'MTL_CODE_MAX_CONTEXT_TOKENS',
  uiContextWindow: 'CONTEXT_WINDOW',
  effortLevel: 'MTL_CODE_EFFORT_LEVEL',
  legacyEffortLevel: 'CLAUDE_CODE_EFFORT_LEVEL',
  subagentModel: 'MTL_CODE_SUBAGENT_MODEL',
  legacySubagentModel: 'CLAUDE_CODE_SUBAGENT_MODEL',
  coordinatorMode: 'MTL_CODE_COORDINATOR_MODE',
  subagentsEnabled: 'MTL_CODE_SUBAGENTS_ENABLED',
  subagentMaxConcurrentThreadsPerSession: 'MTL_CODE_SESSION_SUBAGENT_MAX_ACTIVE',
  subagentMaxDepth: 'MTL_CODE_SUBAGENTS_MAX_DEPTH',
  allowNestedSubagents: 'MTL_CODE_ALLOW_NESTED_SUBAGENTS',
  goalsEnabled: 'MTL_CODE_GOALS_ENABLED',
};

export const OPENMYTHOS_RUNTIME_SETTINGS_KEY = 'openMythosRuntime';
export const SUBAGENT_RUNTIME_SETTINGS_KEY = 'subagents';
export const GOAL_RUNTIME_SETTINGS_KEY = 'goals';
export const SMALL_MODEL_RUNTIME_SETTINGS_KEY = 'smallModelRuntime';

export const OPENMYTHOS_RUNTIME_ENV_KEYS = {
  enabled: 'MTL_CODE_OPENMYTHOS_RUNTIME',
  adaptiveEffort: 'MTL_CODE_OPENMYTHOS_ADAPTIVE_EFFORT',
  taskCard: 'MTL_CODE_OPENMYTHOS_TASK_CARD',
  routingHints: 'MTL_CODE_OPENMYTHOS_ROUTING_HINTS',
  loopControl: 'MTL_CODE_OPENMYTHOS_LOOP_CONTROL',
  stableReinjection: 'MTL_CODE_OPENMYTHOS_STABLE_REINJECTION',
  phaseAdapter: 'MTL_CODE_OPENMYTHOS_PHASE_ADAPTER',
  expertRouting: 'MTL_CODE_OPENMYTHOS_EXPERT_ROUTING',
  contextCacheDiagnostics: 'MTL_CODE_OPENMYTHOS_CONTEXT_CACHE_DIAGNOSTICS',
  minEffort: 'MTL_CODE_OPENMYTHOS_MIN_EFFORT',
  maxEffort: 'MTL_CODE_OPENMYTHOS_MAX_EFFORT',
};

export const DEFAULT_OPENMYTHOS_RUNTIME_CONFIG = Object.freeze({
  enabled: false,
  adaptiveEffort: true,
  taskCard: true,
  routingHints: true,
  loopControl: 'enforced',
  stableReinjection: true,
  phaseAdapter: true,
  expertRouting: true,
  contextCacheDiagnostics: true,
  minEffort: 'low',
  maxEffort: 'max',
});

export const DEFAULT_SUBAGENT_RUNTIME_CONFIG = Object.freeze({
  enabled: false,
  maxConcurrentThreadsPerSession: 3,
  maxDepth: 1,
});

export const DEFAULT_GOAL_RUNTIME_CONFIG = Object.freeze({
  enabled: false,
});

export const DEFAULT_SMALL_MODEL_RUNTIME_CONFIG = Object.freeze({
  enabled: true,
  profileId: 'auto',
  protocol: 'anthropic',
  requestModel: '',
  timeoutMs: 2500,
  useForWikiRouting: true,
  useForWikiReadback: true,
});

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const OPENMYTHOS_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const OPENMYTHOS_LOOP_CONTROLS = ['advisory', 'enforced'];
const MIMO_MODEL_CONTEXT_WINDOWS = {
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'mimo-v2.5-pro': 1_000_000,
  'mimo-v2.5': 1_000_000,
  'mimo-v2-pro': 1_000_000,
  'mimo-v2-omni': 256_000,
  'mimo-v2-flash': 256_000,
};

const readStringEnv = (env, key) => readOptionalString(env?.[key]) || '';

const cleanBaseUrl = (value) => (readOptionalString(value) || '').replace(/\/+$/, '');

const readPositiveIntegerEnv = (env, key) => {
  const value = Number.parseInt(readStringEnv(env, key), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const readBooleanEnv = (env, key, fallback) => {
  const value = readStringEnv(env, key).toLowerCase();
  if (!value) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }
  return fallback;
};

const readBooleanEnvDefaultTrue = (env, key) => readBooleanEnv(env, key, true);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const resolveClaudeNativeMemoryEnabled = (profile = {}) => (
  hasOwn(profile, 'claudeNativeMemoryEnabled')
    ? profile.claudeNativeMemoryEnabled !== false
    : true
);

function normalizeOpenMythosBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeOpenMythosEffort(value, fallback) {
  const normalized = (readOptionalString(value) || '').toLowerCase();
  return OPENMYTHOS_EFFORT_LEVELS.includes(normalized) ? normalized : fallback;
}

function normalizeOpenMythosLoopControl(value, fallback) {
  const normalized = (readOptionalString(value) || '').toLowerCase();
  return OPENMYTHOS_LOOP_CONTROLS.includes(normalized) ? normalized : fallback;
}

function normalizeOpenMythosPositiveInteger(value, fallback, max = 8) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizeSubagentPositiveInteger(value, fallback, max = 16) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizeTimeoutMs(value, fallback, min = 1000, max = 15000) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function normalizeSmallModelProtocol(value, fallback = 'anthropic') {
  const normalized = (readOptionalString(value) || '').toLowerCase();
  if (normalized === 'anthropic' || normalized === 'openai-compatible') {
    return normalized;
  }
  return fallback === 'openai-compatible' ? fallback : 'anthropic';
}

function normalizeOpenMythosEffortBounds(config) {
  const minIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(config.minEffort);
  const maxIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(config.maxEffort);
  if (minIndex <= maxIndex) {
    return config;
  }
  return {
    ...config,
    minEffort: config.maxEffort,
    maxEffort: config.minEffort,
  };
}

export function normalizeOpenMythosRuntimeConfig(value, fallback = DEFAULT_OPENMYTHOS_RUNTIME_CONFIG) {
  const data = readObjectRecord(value) ?? {};
  return normalizeOpenMythosEffortBounds({
    enabled: normalizeOpenMythosBoolean(data.enabled, fallback.enabled),
    adaptiveEffort: normalizeOpenMythosBoolean(data.adaptiveEffort, fallback.adaptiveEffort),
    taskCard: normalizeOpenMythosBoolean(data.taskCard, fallback.taskCard),
    routingHints: normalizeOpenMythosBoolean(data.routingHints, fallback.routingHints),
    loopControl: normalizeOpenMythosLoopControl(data.loopControl, fallback.loopControl),
    stableReinjection: normalizeOpenMythosBoolean(data.stableReinjection, fallback.stableReinjection),
    phaseAdapter: normalizeOpenMythosBoolean(data.phaseAdapter, fallback.phaseAdapter),
    expertRouting: normalizeOpenMythosBoolean(data.expertRouting, fallback.expertRouting),
    contextCacheDiagnostics: normalizeOpenMythosBoolean(data.contextCacheDiagnostics, fallback.contextCacheDiagnostics),
    minEffort: normalizeOpenMythosEffort(data.minEffort, fallback.minEffort),
    maxEffort: normalizeOpenMythosEffort(data.maxEffort, fallback.maxEffort),
  });
}

export function normalizeSubagentRuntimeConfig(value, fallback = DEFAULT_SUBAGENT_RUNTIME_CONFIG) {
  const data = readObjectRecord(value) ?? {};
  return {
    enabled: normalizeOpenMythosBoolean(data.enabled, fallback.enabled),
    maxConcurrentThreadsPerSession: normalizeSubagentPositiveInteger(
      data.maxConcurrentThreadsPerSession,
      fallback.maxConcurrentThreadsPerSession,
    ),
    maxDepth: normalizeSubagentPositiveInteger(data.maxDepth, fallback.maxDepth, 4),
  };
}

export function normalizeGoalRuntimeConfig(value, fallback = DEFAULT_GOAL_RUNTIME_CONFIG) {
  const data = readObjectRecord(value) ?? {};
  return {
    enabled: normalizeOpenMythosBoolean(data.enabled, fallback.enabled),
  };
}

export function normalizeSmallModelRuntimeConfig(value, fallback = DEFAULT_SMALL_MODEL_RUNTIME_CONFIG) {
  const data = readObjectRecord(value) ?? {};
  const profileId = readOptionalString(data.profileId) || fallback.profileId || 'auto';
  const requestModel = Object.prototype.hasOwnProperty.call(data, 'requestModel')
    ? readOptionalString(data.requestModel) || ''
    : fallback.requestModel || '';
  return {
    enabled: normalizeOpenMythosBoolean(data.enabled, fallback.enabled),
    profileId,
    protocol: normalizeSmallModelProtocol(data.protocol, fallback.protocol),
    requestModel,
    timeoutMs: normalizeTimeoutMs(data.timeoutMs, fallback.timeoutMs),
    useForWikiRouting: normalizeOpenMythosBoolean(data.useForWikiRouting, fallback.useForWikiRouting),
    useForWikiReadback: normalizeOpenMythosBoolean(data.useForWikiReadback, fallback.useForWikiReadback),
  };
}

export function readSubagentRuntimeConfig(settings = {}, env = {}) {
  const envConfig = normalizeSubagentRuntimeConfig({
    enabled: readBooleanEnv(env, MTL_CODE_MODEL_ENV_KEYS.subagentsEnabled, DEFAULT_SUBAGENT_RUNTIME_CONFIG.enabled),
    maxConcurrentThreadsPerSession: readPositiveIntegerEnv(
      env,
      MTL_CODE_MODEL_ENV_KEYS.subagentMaxConcurrentThreadsPerSession,
    ) || DEFAULT_SUBAGENT_RUNTIME_CONFIG.maxConcurrentThreadsPerSession,
    maxDepth: readPositiveIntegerEnv(
      env,
      MTL_CODE_MODEL_ENV_KEYS.subagentMaxDepth,
    ) || DEFAULT_SUBAGENT_RUNTIME_CONFIG.maxDepth,
  });
  return normalizeSubagentRuntimeConfig(
    settings?.[SUBAGENT_RUNTIME_SETTINGS_KEY],
    envConfig,
  );
}

export function readGoalRuntimeConfig(settings = {}, env = {}) {
  const envConfig = normalizeGoalRuntimeConfig({
    enabled: readBooleanEnv(
      env,
      MTL_CODE_MODEL_ENV_KEYS.goalsEnabled,
      DEFAULT_GOAL_RUNTIME_CONFIG.enabled,
    ),
  });
  return normalizeGoalRuntimeConfig(
    settings?.[GOAL_RUNTIME_SETTINGS_KEY],
    envConfig,
  );
}

export function readSmallModelRuntimeConfig(settings = {}) {
  return normalizeSmallModelRuntimeConfig(
    settings?.[SMALL_MODEL_RUNTIME_SETTINGS_KEY],
    DEFAULT_SMALL_MODEL_RUNTIME_CONFIG,
  );
}

export function readOpenMythosRuntimeConfig(settings = {}, env = {}) {
  const envConfig = normalizeOpenMythosRuntimeConfig({
    enabled: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.enabled, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.enabled),
    adaptiveEffort: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.adaptiveEffort, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.adaptiveEffort),
    taskCard: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.taskCard, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.taskCard),
    routingHints: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.routingHints, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.routingHints),
    loopControl: readStringEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.loopControl)
      || DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.loopControl,
    stableReinjection: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.stableReinjection, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.stableReinjection),
    phaseAdapter: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.phaseAdapter, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.phaseAdapter),
    expertRouting: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.expertRouting, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.expertRouting),
    contextCacheDiagnostics: readBooleanEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.contextCacheDiagnostics, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.contextCacheDiagnostics),
    minEffort: readStringEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.minEffort)
      || DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.minEffort,
    maxEffort: readStringEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.maxEffort)
      || DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.maxEffort,
  });
  return normalizeOpenMythosRuntimeConfig(
    settings?.[OPENMYTHOS_RUNTIME_SETTINGS_KEY],
    envConfig,
  );
}

export function applyOpenMythosRuntimeToEnv(env, config) {
  const normalized = normalizeOpenMythosRuntimeConfig(config);
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.enabled] = normalized.enabled ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.adaptiveEffort] = normalized.adaptiveEffort ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.taskCard] = normalized.taskCard ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.routingHints] = normalized.routingHints ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.loopControl] = normalized.loopControl;
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.stableReinjection] = normalized.stableReinjection ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.phaseAdapter] = normalized.phaseAdapter ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.expertRouting] = normalized.expertRouting ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.contextCacheDiagnostics] = normalized.contextCacheDiagnostics ? '1' : '0';
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.minEffort] = normalized.minEffort;
  env[OPENMYTHOS_RUNTIME_ENV_KEYS.maxEffort] = normalized.maxEffort;
  return env;
}

export function applySubagentRuntimeToEnv(env, config) {
  const normalized = normalizeSubagentRuntimeConfig(config);
  env[MTL_CODE_MODEL_ENV_KEYS.subagentsEnabled] = normalized.enabled ? '1' : '0';
  env[MTL_CODE_MODEL_ENV_KEYS.subagentMaxConcurrentThreadsPerSession] = String(
    normalized.maxConcurrentThreadsPerSession,
  );
  env[MTL_CODE_MODEL_ENV_KEYS.subagentMaxDepth] = String(normalized.maxDepth);
  env[MTL_CODE_MODEL_ENV_KEYS.allowNestedSubagents] = normalized.maxDepth > 1 ? '1' : '0';
  return env;
}

export function applyGoalRuntimeToEnv(env, config) {
  const normalized = normalizeGoalRuntimeConfig(config);
  env[MTL_CODE_MODEL_ENV_KEYS.goalsEnabled] = normalized.enabled ? '1' : '0';
  return env;
}

export function buildOpenMythosRuntimePreview(input, config, permissionMode = '') {
  const normalizedConfig = normalizeOpenMythosRuntimeConfig(config);
  const prompt = (readOptionalString(input) || '').replace(/\s+/g, ' ').trim();
  if (!normalizedConfig.enabled || !prompt) {
    return null;
  }
  const isTaskNotification = /<task-notification\b/i.test(prompt);

  const signals = [
    {
      pattern: /\b(security|auth|permission|secret|token|credential|privacy|hipaa|soc2)\b/i,
      reason: 'security or privacy sensitive work',
      weight: 5,
      route: {
        kind: 'security',
        label: 'Security reviewer',
        required: true,
      },
    },
    {
      pattern: /\b(migration|schema|database|sql|backfill|rollback|deploy|release|ci|production)\b/i,
      reason: 'deployment, data, or CI risk',
      weight: 4,
      route: {
        kind: 'verification',
        label: 'Verification specialist',
        required: true,
      },
    },
    {
      pattern: /\b(concurrency|async|race|deadlock|performance|memory|latency|benchmark)\b/i,
      reason: 'performance or concurrency-sensitive work',
      weight: 4,
      route: {
        kind: 'performance',
        label: 'Performance specialist',
        required: false,
      },
    },
    {
      pattern: /\b(refactor|architecture|design|redesign|multi[- ]?module|cross[- ]?module)\b/i,
      reason: 'broad architectural change',
      weight: 3,
      route: {
        kind: 'architecture',
        label: 'Architecture reviewer',
        required: false,
      },
    },
    {
      pattern: /\b(implement|build|add|fix|change|update|wire|integrate)\b/i,
      reason: 'implementation requested',
      weight: 2,
    },
    {
      pattern: /\b(test|typecheck|lint|verify|benchmark|coverage)\b/i,
      reason: 'verification requested',
      weight: 2,
      route: {
        kind: 'verification',
        label: 'Verification specialist',
        required: false,
      },
    },
    {
      pattern: /\b(ui|frontend|react|css|layout|responsive|accessibility|visual|figma)\b/i,
      reason: 'frontend or visual quality work',
      weight: 2,
      route: {
        kind: 'frontend',
        label: 'Frontend reviewer',
        required: false,
      },
    },
  ].filter((signal) => signal.pattern.test(prompt));

  const riskScore = signals.reduce((sum, signal) => sum + signal.weight, 0)
    + Math.min(3, Math.floor(prompt.length / 600));
  const inferredEffort = riskScore >= 10 ? 'max' : riskScore >= 8 ? 'xhigh' : riskScore >= 4 ? 'high' : riskScore >= 2 ? 'medium' : 'low';
  const effort = clampOpenMythosEffort(inferredEffort, normalizedConfig.minEffort, normalizedConfig.maxEffort);
  const loopBudget = effort === 'max' ? 6 : effort === 'xhigh' ? 5 : effort === 'high' ? 4 : effort === 'medium' ? 3 : 2;
  const phasePlan = normalizedConfig.phaseAdapter
    ? buildOpenMythosPhasePlan(effort)
    : ['implement', 'finalize'];
  const expertRoutes = normalizedConfig.expertRouting
    ? buildOpenMythosExpertRoutes(signals, effort)
    : [];
  return {
    goal: prompt.length <= 260 ? prompt : `${prompt.slice(0, 259)}...`,
    effort,
    loopBudget,
    riskScore,
    phase: phasePlan[0] || 'implement',
    phasePlan,
    remainingBudget: loopBudget,
    reasons: uniqueStrings(signals.map((signal) => signal.reason)).slice(0, 4),
    constraints: [
      'Keep the frozen user goal visible before each major action.',
      permissionMode === 'plan'
        ? 'Plan mode is active: explore and plan only; do not mutate tracked files.'
        : 'Use the smallest safe change and keep verification visible.',
    ],
    expertRoutes,
  };
}

function clampOpenMythosEffort(effort, minEffort, maxEffort) {
  const minIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(minEffort);
  const maxIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(maxEffort);
  const effortIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(effort);
  return OPENMYTHOS_EFFORT_LEVELS[Math.min(Math.max(effortIndex, minIndex), maxIndex)] || effort;
}

function buildOpenMythosPhasePlan(effort) {
  if (effort === 'low') {
    return ['orient', 'finalize'];
  }
  if (effort === 'medium') {
    return ['orient', 'plan', 'implement', 'finalize'];
  }
  return ['orient', 'plan', 'implement', 'verify', 'finalize'];
}

function buildOpenMythosExpertRoutes(signals, effort) {
  const routes = new Map();
  for (const signal of signals) {
    if (!signal.route) {
      continue;
    }
    const existing = routes.get(signal.route.kind);
    routes.set(signal.route.kind, {
      ...signal.route,
      reason: signal.reason,
      required: Boolean(existing?.required || signal.route.required),
    });
  }
  if (routes.size === 0 || effort === 'low') {
    routes.set('local', {
      kind: 'local',
      label: 'Local execution',
      reason: 'small or conversational task',
      required: true,
    });
  }
  return [...routes.values()].slice(0, 5);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

export function canonicalizeAnthropicModel(value) {
  const model = readOptionalString(value) || '';
  const normalized = model.toLowerCase();
  if (normalized.startsWith('mimo-')) {
    return normalized;
  }
  return model;
}

export function isDeepSeekAnthropicRuntime(baseUrl, model) {
  const normalizedBaseUrl = (readOptionalString(baseUrl) || '').toLowerCase();
  const normalizedModel = (readOptionalString(model) || '').toLowerCase();
  return normalizedBaseUrl.includes('api.deepseek.com') || normalizedModel.includes('deepseek');
}

export function isMimoAnthropicRuntime(baseUrl, model) {
  const normalizedBaseUrl = (readOptionalString(baseUrl) || '').toLowerCase();
  const normalizedModel = canonicalizeAnthropicModel(model).toLowerCase();
  return normalizedBaseUrl.includes('xiaomimimo.com') || normalizedModel.startsWith('mimo-');
}

export function applyAnthropicRuntimeModelDefaults(env, { baseUrl = '', model = '' } = {}) {
  const configuredModel = canonicalizeAnthropicModel(model);
  if (!configuredModel) {
    return env;
  }

  env[ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel] = configuredModel;
  env[ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel] = configuredModel;
  env[ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel] = configuredModel;
  env[MTL_CODE_MODEL_ENV_KEYS.subagentModel] = configuredModel;
  env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel] = configuredModel;

  if (isDeepSeekAnthropicRuntime(baseUrl, configuredModel)) {
    const effortLevel = env[MTL_CODE_MODEL_ENV_KEYS.effortLevel]
      || env[MTL_CODE_MODEL_ENV_KEYS.legacyEffortLevel]
      || 'high';
    env[MTL_CODE_MODEL_ENV_KEYS.effortLevel] = effortLevel;
    env[MTL_CODE_MODEL_ENV_KEYS.legacyEffortLevel] = effortLevel;
  } else if (isMimoAnthropicRuntime(baseUrl, configuredModel)) {
    delete env[MTL_CODE_MODEL_ENV_KEYS.effortLevel];
    delete env[MTL_CODE_MODEL_ENV_KEYS.legacyEffortLevel];
  }

  return env;
}

export function applyOpenAIRuntimeModelDefaults(env, { model = '' } = {}) {
  const configuredModel = readOptionalString(model) || '';
  if (!configuredModel) {
    return env;
  }

  env[OPENAI_MODEL_ENV_KEYS.defaultHaikuModel] = configuredModel;
  env[OPENAI_MODEL_ENV_KEYS.defaultSonnetModel] = configuredModel;
  env[OPENAI_MODEL_ENV_KEYS.defaultOpusModel] = configuredModel;
  env[MTL_CODE_MODEL_ENV_KEYS.subagentModel] = configuredModel;
  env[MTL_CODE_MODEL_ENV_KEYS.legacySubagentModel] = configuredModel;
  return env;
}

export function repairAnthropicRuntimeModelEnv(env) {
  const model = canonicalizeAnthropicModel(
    readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.model)
      || readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel)
      || readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel)
      || readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel),
  );
  if (!model) {
    return env;
  }

  return applyAnthropicRuntimeModelDefaults(env, {
    baseUrl: readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.baseUrl),
    model,
  });
}

function normalizeProfileId(value) {
  return (readOptionalString(value) || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readModelProtocol(value) {
  const normalized = readOptionalString(value);
  return normalized === 'openai-compatible' || normalized === 'openai-responses' || normalized === 'anthropic'
    ? normalized
    : undefined;
}

function normalizeModelProtocol(value) {
  return readModelProtocol(value) || 'anthropic';
}

export function isOpenAIModelProtocol(value) {
  const protocol = normalizeModelProtocol(value);
  return protocol === 'openai-compatible' || protocol === 'openai-responses';
}

export function normalizeAnthropicBaseUrl(value) {
  let normalized = cleanBaseUrl(value);
  const suffixes = ['/v1/chat/completions', '/chat/completions', '/v1/messages', '/messages', '/v1'];
  for (const suffix of suffixes) {
    if (normalized.toLowerCase().endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length).replace(/\/+$/, '');
      break;
    }
  }
  return normalized;
}

export function normalizeOpenAIBaseUrl(value) {
  let normalized = cleanBaseUrl(value);
  const lower = normalized.toLowerCase();
  if (lower.endsWith('/v1/chat/completions')) {
    return normalized.slice(0, -'/chat/completions'.length);
  }
  if (lower.endsWith('/chat/completions')) {
    normalized = normalized.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
  } else if (lower.endsWith('/v1/responses')) {
    return normalized.slice(0, -'/responses'.length);
  } else if (lower.endsWith('/responses')) {
    normalized = normalized.slice(0, -'/responses'.length).replace(/\/+$/, '');
  }

  if (!normalized || normalized.toLowerCase().endsWith('/v1')) {
    return normalized;
  }
  return `${normalized}/v1`;
}

function getMimoContextWindow(model) {
  return MIMO_MODEL_CONTEXT_WINDOWS[canonicalizeAnthropicModel(model)] || null;
}

function resolveProfileContextWindow(profile, env) {
  const explicit = Number.parseInt(String(profile?.contextWindowTokens ?? ''), 10);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  return getMimoContextWindow(profile?.model)
    || readPositiveIntegerEnv(env, MTL_CODE_MODEL_ENV_KEYS.maxContextTokens)
    || readPositiveIntegerEnv(env, MTL_CODE_MODEL_ENV_KEYS.uiContextWindow)
    || DEFAULT_CONTEXT_WINDOW_TOKENS;
}

function createProfileFromEnv(settings, env) {
  const modelType = readOptionalString(settings?.modelType);
  const useOpenAI = modelType === 'openai' || readStringEnv(env, 'MTL_CODE_USE_OPENAI') === '1';
  const anthropicBaseUrl = readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.baseUrl);
  const anthropicModel = canonicalizeAnthropicModel(readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.model));
  const anthropicAuthToken = readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.authToken);
  const legacyOpenAIBaseUrl = readStringEnv(env, OPENAI_MODEL_ENV_KEYS.baseUrl);
  const legacyOpenAIModel = canonicalizeAnthropicModel(readStringEnv(env, OPENAI_MODEL_ENV_KEYS.model));
  const legacyOpenAIKey = readStringEnv(env, OPENAI_MODEL_ENV_KEYS.apiKey);
  const baseUrl = useOpenAI
    ? legacyOpenAIBaseUrl || anthropicBaseUrl
    : anthropicBaseUrl || legacyOpenAIBaseUrl;
  const model = useOpenAI
    ? legacyOpenAIModel || canonicalizeAnthropicModel(settings?.model) || anthropicModel || ''
    : anthropicModel || canonicalizeAnthropicModel(settings?.model) || legacyOpenAIModel || '';
  const authToken = useOpenAI
    ? legacyOpenAIKey || anthropicAuthToken
    : anthropicAuthToken || legacyOpenAIKey;
  const claudeNativeMemoryEnabled = readBooleanEnv(
    env,
    MTL_CODE_MODEL_ENV_KEYS.claudeNativeMemoryEnabled,
    true,
  );

  return {
    id: 'default',
    name: model ? `Default (${model})` : 'Default model',
    provider: 'anthropic',
    protocol: useOpenAI ? 'openai-compatible' : 'anthropic',
    baseUrl,
    model,
    requestModel: '',
    authToken,
    contextWindowTokens: resolveProfileContextWindow({ model }, env),
    claudeNativeMemoryEnabled,
    bareMode: !claudeNativeMemoryEnabled,
  };
}

export function readStoredModelProfiles(settings, env = {}) {
  const rawProfiles = Array.isArray(settings?.[MODEL_PROFILES_KEY])
    ? settings[MODEL_PROFILES_KEY]
    : [];
  const profiles = rawProfiles
    .map((entry, index) => {
      const profile = readObjectRecord(entry);
      if (!profile) return null;
      const model = canonicalizeAnthropicModel(profile.model);
      const baseUrl = readOptionalString(profile.baseUrl) || '';
      const name = readOptionalString(profile.name) || model || `Model ${index + 1}`;
      const id = normalizeProfileId(profile.id || name || `model-${index + 1}`) || `model-${index + 1}`;
      const claudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(profile);
      return {
        id,
        name,
        provider: 'anthropic',
        protocol: normalizeModelProtocol(profile.protocol),
        baseUrl,
        model,
        requestModel: readOptionalString(profile.requestModel) || '',
        authToken: readOptionalString(profile.authToken) || '',
        contextWindowTokens: resolveProfileContextWindow(profile, env),
        claudeNativeMemoryEnabled,
        bareMode: !claudeNativeMemoryEnabled,
      };
    })
    .filter(Boolean);

  return profiles.length > 0 ? profiles : [createProfileFromEnv(settings || {}, env)];
}

export function resolveActiveModelProfile(settings, profiles) {
  const activeId = normalizeProfileId(settings?.[ACTIVE_MODEL_PROFILE_KEY] || '');
  return profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
}

export function getMtlCodeModelConfigDir(env = process.env) {
  return env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
}

export async function readMtlCodeModelSettings(env = process.env) {
  const settingsPath = path.join(getMtlCodeModelConfigDir(env), 'settings.json');
  return readJsonConfig(settingsPath);
}

export async function readResolvedOpenMythosRuntimeConfig(env = process.env) {
  const settings = await readMtlCodeModelSettings(env);
  const settingsEnv = readObjectRecord(settings.env) ?? {};
  repairAnthropicRuntimeModelEnv(settingsEnv);
  return readOpenMythosRuntimeConfig(settings, settingsEnv);
}

export async function readResolvedSubagentRuntimeConfig(env = process.env) {
  const settings = await readMtlCodeModelSettings(env);
  const settingsEnv = readObjectRecord(settings.env) ?? {};
  return readSubagentRuntimeConfig(settings, settingsEnv);
}

export async function readResolvedGoalRuntimeConfig(env = process.env) {
  const settings = await readMtlCodeModelSettings(env);
  const settingsEnv = readObjectRecord(settings.env) ?? {};
  return readGoalRuntimeConfig(settings, settingsEnv);
}

export async function resolveMtlCodeModelRuntime(profileId, env = process.env) {
  const normalizedProfileId = normalizeProfileId(profileId);
  if (!normalizedProfileId) {
    return null;
  }

  const settings = await readMtlCodeModelSettings(env);
  const settingsEnv = readObjectRecord(settings.env) ?? {};
  repairAnthropicRuntimeModelEnv(settingsEnv);
  const profiles = readStoredModelProfiles(settings, settingsEnv);
  const profile = profiles.find((entry) => entry.id === normalizedProfileId);
  if (!profile) {
    return null;
  }

  const model = canonicalizeAnthropicModel(profile.model);
  const requestModel = readOptionalString(profile.requestModel) || model;
  const protocol = normalizeModelProtocol(profile.protocol);
  const usesOpenAI = isOpenAIModelProtocol(protocol);
  const normalizedBaseUrl = usesOpenAI
    ? normalizeOpenAIBaseUrl(profile.baseUrl)
    : normalizeAnthropicBaseUrl(profile.baseUrl);
  const contextWindowTokens = resolveProfileContextWindow({ ...profile, model }, settingsEnv);
  const openMythosRuntime = readOpenMythosRuntimeConfig(settings, settingsEnv);
  const subagents = readSubagentRuntimeConfig(settings, settingsEnv);
  const goals = readGoalRuntimeConfig(settings, settingsEnv);
  const coordinatorModeEnabled = false;
  const claudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(profile);
  const runtimeEnv = {
    MTL_CODE_USE_OPENAI: usesOpenAI ? '1' : '0',
    [MTL_CODE_MODEL_ENV_KEYS.claudeNativeMemoryEnabled]: claudeNativeMemoryEnabled ? '1' : '0',
    [MTL_CODE_MODEL_ENV_KEYS.uiBareMode]: claudeNativeMemoryEnabled ? '0' : '1',
    [MTL_CODE_MODEL_ENV_KEYS.maxContextTokens]: String(contextWindowTokens),
    [MTL_CODE_MODEL_ENV_KEYS.uiContextWindow]: String(contextWindowTokens),
    [MTL_CODE_MODEL_ENV_KEYS.coordinatorMode]: coordinatorModeEnabled ? '1' : '0',
  };
  if (usesOpenAI) {
    runtimeEnv[OPENAI_MODEL_ENV_KEYS.baseUrl] = normalizedBaseUrl;
    runtimeEnv[OPENAI_MODEL_ENV_KEYS.model] = requestModel;
    applyOpenAIRuntimeModelDefaults(runtimeEnv, { model: requestModel });
  } else {
    runtimeEnv[ANTHROPIC_MODEL_ENV_KEYS.baseUrl] = normalizedBaseUrl;
    runtimeEnv[ANTHROPIC_MODEL_ENV_KEYS.model] = requestModel;
    applyAnthropicRuntimeModelDefaults(runtimeEnv, {
      baseUrl: normalizedBaseUrl,
      model: requestModel,
    });
  }
  applyOpenMythosRuntimeToEnv(runtimeEnv, openMythosRuntime);
  applySubagentRuntimeToEnv(runtimeEnv, subagents);
  applyGoalRuntimeToEnv(runtimeEnv, goals);

  if (profile.authToken) {
    runtimeEnv[usesOpenAI ? OPENAI_MODEL_ENV_KEYS.apiKey : ANTHROPIC_MODEL_ENV_KEYS.authToken] = profile.authToken;
  }

  return {
    profile: {
      ...profile,
      protocol,
      baseUrl: normalizedBaseUrl,
      model,
      requestModel: profile.requestModel || '',
      contextWindowTokens,
      claudeNativeMemoryEnabled,
      bareMode: !claudeNativeMemoryEnabled,
    },
    env: Object.fromEntries(Object.entries(runtimeEnv).filter(([, value]) => Boolean(value))),
    contextWindowTokens,
    openMythosRuntime,
    subagents,
    goals,
  };
}
