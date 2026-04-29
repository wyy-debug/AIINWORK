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

export const MTL_CODE_MODEL_ENV_KEYS = {
  uiBareMode: 'MTL_CODE_UI_BARE',
  maxContextTokens: 'MTL_CODE_MAX_CONTEXT_TOKENS',
  uiContextWindow: 'CONTEXT_WINDOW',
  effortLevel: 'MTL_CODE_EFFORT_LEVEL',
  legacyEffortLevel: 'CLAUDE_CODE_EFFORT_LEVEL',
  subagentModel: 'MTL_CODE_SUBAGENT_MODEL',
  legacySubagentModel: 'CLAUDE_CODE_SUBAGENT_MODEL',
};

export const OPENMYTHOS_RUNTIME_SETTINGS_KEY = 'openMythosRuntime';

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
  enabled: true,
  adaptiveEffort: true,
  taskCard: true,
  routingHints: true,
  loopControl: 'enforced',
  stableReinjection: true,
  phaseAdapter: true,
  expertRouting: true,
  contextCacheDiagnostics: true,
  minEffort: 'low',
  maxEffort: 'xhigh',
});

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const OPENMYTHOS_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];
const OPENMYTHOS_LOOP_CONTROLS = ['advisory', 'enforced'];
const MIMO_MODEL_CONTEXT_WINDOWS = {
  'mimo-v2.5-pro': 1_000_000,
  'mimo-v2.5': 1_000_000,
  'mimo-v2-pro': 1_000_000,
  'mimo-v2-omni': 256_000,
  'mimo-v2-flash': 256_000,
};

const readStringEnv = (env, key) => readOptionalString(env?.[key]) || '';

const readPositiveIntegerEnv = (env, key) => {
  const value = Number.parseInt(readStringEnv(env, key), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const readBooleanEnvDefaultTrue = (env, key) => {
  const value = readStringEnv(env, key).toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
};

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

export function readOpenMythosRuntimeConfig(settings = {}, env = {}) {
  const envConfig = normalizeOpenMythosRuntimeConfig({
    enabled: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.enabled),
    adaptiveEffort: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.adaptiveEffort),
    taskCard: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.taskCard),
    routingHints: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.routingHints),
    loopControl: readStringEnv(env, OPENMYTHOS_RUNTIME_ENV_KEYS.loopControl)
      || DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.loopControl,
    stableReinjection: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.stableReinjection),
    phaseAdapter: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.phaseAdapter),
    expertRouting: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.expertRouting),
    contextCacheDiagnostics: readBooleanEnvDefaultTrue(env, OPENMYTHOS_RUNTIME_ENV_KEYS.contextCacheDiagnostics),
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

export function buildOpenMythosRuntimePreview(input, config, permissionMode = '') {
  const normalizedConfig = normalizeOpenMythosRuntimeConfig(config);
  const prompt = (readOptionalString(input) || '').replace(/\s+/g, ' ').trim();
  if (!normalizedConfig.enabled || !prompt) {
    return null;
  }

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
  const inferredEffort = riskScore >= 8 ? 'xhigh' : riskScore >= 4 ? 'high' : riskScore >= 2 ? 'medium' : 'low';
  const effort = clampOpenMythosEffort(inferredEffort, normalizedConfig.minEffort, normalizedConfig.maxEffort);
  const loopBudget = effort === 'xhigh' ? 5 : effort === 'high' ? 4 : effort === 'medium' ? 3 : 2;
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

function normalizeProfileId(value) {
  return (readOptionalString(value) || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  const preferLegacyOpenAI = modelType === 'openai';
  const anthropicBaseUrl = readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.baseUrl);
  const anthropicModel = canonicalizeAnthropicModel(readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.model));
  const anthropicAuthToken = readStringEnv(env, ANTHROPIC_MODEL_ENV_KEYS.authToken);
  const legacyOpenAIBaseUrl = readStringEnv(env, 'OPENAI_BASE_URL');
  const legacyOpenAIModel = canonicalizeAnthropicModel(readStringEnv(env, 'OPENAI_MODEL'));
  const legacyOpenAIKey = readStringEnv(env, 'OPENAI_API_KEY');
  const baseUrl = preferLegacyOpenAI
    ? legacyOpenAIBaseUrl || anthropicBaseUrl
    : anthropicBaseUrl || legacyOpenAIBaseUrl;
  const model = preferLegacyOpenAI
    ? legacyOpenAIModel || canonicalizeAnthropicModel(settings?.model) || anthropicModel || ''
    : anthropicModel || canonicalizeAnthropicModel(settings?.model) || legacyOpenAIModel || '';
  const authToken = preferLegacyOpenAI
    ? legacyOpenAIKey || anthropicAuthToken
    : anthropicAuthToken || legacyOpenAIKey;

  return {
    id: 'default',
    name: model ? `Default (${model})` : 'Default model',
    provider: 'anthropic',
    baseUrl,
    model,
    authToken,
    contextWindowTokens: resolveProfileContextWindow({ model }, env),
    bareMode: readBooleanEnvDefaultTrue(env, MTL_CODE_MODEL_ENV_KEYS.uiBareMode),
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
      return {
        id,
        name,
        provider: 'anthropic',
        baseUrl,
        model,
        authToken: readOptionalString(profile.authToken) || '',
        contextWindowTokens: resolveProfileContextWindow(profile, env),
        bareMode: profile.bareMode !== false,
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
  return readOpenMythosRuntimeConfig(settings, settingsEnv);
}

export async function resolveMtlCodeModelRuntime(profileId, env = process.env) {
  const normalizedProfileId = normalizeProfileId(profileId);
  if (!normalizedProfileId) {
    return null;
  }

  const settings = await readMtlCodeModelSettings(env);
  const settingsEnv = readObjectRecord(settings.env) ?? {};
  const profiles = readStoredModelProfiles(settings, settingsEnv);
  const profile = profiles.find((entry) => entry.id === normalizedProfileId);
  if (!profile) {
    return null;
  }

  const model = canonicalizeAnthropicModel(profile.model);
  const contextWindowTokens = resolveProfileContextWindow({ ...profile, model }, settingsEnv);
  const openMythosRuntime = readOpenMythosRuntimeConfig(settings, settingsEnv);
  const runtimeEnv = {
    [ANTHROPIC_MODEL_ENV_KEYS.baseUrl]: profile.baseUrl,
    [ANTHROPIC_MODEL_ENV_KEYS.model]: model,
    [ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel]: model,
    [ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel]: model,
    [ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel]: model,
    [MTL_CODE_MODEL_ENV_KEYS.uiBareMode]: profile.bareMode !== false ? '1' : '0',
    [MTL_CODE_MODEL_ENV_KEYS.maxContextTokens]: String(contextWindowTokens),
    [MTL_CODE_MODEL_ENV_KEYS.uiContextWindow]: String(contextWindowTokens),
  };
  applyOpenMythosRuntimeToEnv(runtimeEnv, openMythosRuntime);

  if (profile.authToken) {
    runtimeEnv[ANTHROPIC_MODEL_ENV_KEYS.authToken] = profile.authToken;
  }

  return {
    profile: { ...profile, model, contextWindowTokens },
    env: Object.fromEntries(Object.entries(runtimeEnv).filter(([, value]) => Boolean(value))),
    contextWindowTokens,
    openMythosRuntime,
  };
}
