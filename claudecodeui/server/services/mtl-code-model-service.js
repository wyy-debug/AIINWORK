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
  protocol: 'MTL_CODE_OPENAI_PROTOCOL',
  defaultHaikuModel: 'OPENAI_DEFAULT_HAIKU_MODEL',
  defaultSonnetModel: 'OPENAI_DEFAULT_SONNET_MODEL',
  defaultOpusModel: 'OPENAI_DEFAULT_OPUS_MODEL',
};

export const MTL_CODE_MODEL_ENV_KEYS = {
  uiBareMode: 'MTL_CODE_UI_BARE',
  claudeNativeMemoryEnabled: 'MTL_CODE_CLAUDE_NATIVE_MEMORY',
  autoMemoryExtractionEnabled: 'MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION',
  maxContextTokens: 'MTL_CODE_MAX_CONTEXT_TOKENS',
  uiContextWindow: 'CONTEXT_WINDOW',
  effortLevel: 'MTL_CODE_EFFORT_LEVEL',
  legacyEffortLevel: 'CLAUDE_CODE_EFFORT_LEVEL',
  coordinatorMode: 'MTL_CODE_COORDINATOR_MODE',
  subagentsEnabled: 'MTL_CODE_SUBAGENTS_ENABLED',
  subagentMaxConcurrentThreadsPerSession: 'MTL_CODE_SESSION_SUBAGENT_MAX_ACTIVE',
  subagentMaxDepth: 'MTL_CODE_SUBAGENTS_MAX_DEPTH',
  allowNestedSubagents: 'MTL_CODE_ALLOW_NESTED_SUBAGENTS',
  goalsEnabled: 'MTL_CODE_GOALS_ENABLED',
};

export const BRAIN_RUNTIME_SETTINGS_KEY = 'argusBrain';
export const SUBAGENT_RUNTIME_SETTINGS_KEY = 'subagents';
export const GOAL_RUNTIME_SETTINGS_KEY = 'goals';

export const DEFAULT_SUBAGENT_RUNTIME_CONFIG = Object.freeze({
  enabled: false,
  maxConcurrentThreadsPerSession: 3,
  maxDepth: 1,
});

export const DEFAULT_GOAL_RUNTIME_CONFIG = Object.freeze({
  enabled: false,
});

export const DEFAULT_BRAIN_RUNTIME_CONFIG = Object.freeze({
  enabled: true,
  captureRawRefs: true,
  compactEventThreshold: 18,
  compactTextThreshold: 12000,
  maxInjectedTokens: 1200,
  recallTimeoutMs: 800,
  retention: Object.freeze({
    perSessionMaxEvents: 1000,
    perProjectMaxCompactions: 80,
    rawRefsMaxSizeBytes: 5_000_000,
  }),
});

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
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

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const resolveClaudeNativeMemoryEnabled = (profile = {}) => (
  hasOwn(profile, 'claudeNativeMemoryEnabled')
    ? profile.claudeNativeMemoryEnabled !== false
    : true
);

function normalizeRuntimeBoolean(value, fallback) {
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

function normalizePositiveInteger(value, fallback, { min = 1, max = 1_000_000 } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function normalizeSubagentPositiveInteger(value, fallback, max = 16) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function normalizeSubagentRuntimeConfig(value, fallback = DEFAULT_SUBAGENT_RUNTIME_CONFIG) {
  const data = readObjectRecord(value) ?? {};
  return {
    enabled: normalizeRuntimeBoolean(data.enabled, fallback.enabled),
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
    enabled: normalizeRuntimeBoolean(data.enabled, fallback.enabled),
  };
}

export function normalizeBrainRuntimeConfig(value, fallback = DEFAULT_BRAIN_RUNTIME_CONFIG) {
  const data = readObjectRecord(value) ?? {};
  const retention = readObjectRecord(data.retention) ?? {};
  const fallbackRetention = fallback.retention || DEFAULT_BRAIN_RUNTIME_CONFIG.retention;
  return {
    enabled: normalizeRuntimeBoolean(data.enabled, fallback.enabled),
    captureRawRefs: normalizeRuntimeBoolean(data.captureRawRefs, fallback.captureRawRefs),
    compactEventThreshold: normalizePositiveInteger(
      data.compactEventThreshold,
      fallback.compactEventThreshold,
      { min: 1, max: 500 },
    ),
    compactTextThreshold: normalizePositiveInteger(
      data.compactTextThreshold,
      fallback.compactTextThreshold,
      { min: 1000, max: 1_000_000 },
    ),
    maxInjectedTokens: normalizePositiveInteger(
      data.maxInjectedTokens,
      fallback.maxInjectedTokens,
      { min: 200, max: 12000 },
    ),
    recallTimeoutMs: normalizePositiveInteger(
      data.recallTimeoutMs,
      fallback.recallTimeoutMs,
      { min: 100, max: 10000 },
    ),
    retention: {
      perSessionMaxEvents: normalizePositiveInteger(
        retention.perSessionMaxEvents,
        fallbackRetention.perSessionMaxEvents,
        { min: 100, max: 100000 },
      ),
      perProjectMaxCompactions: normalizePositiveInteger(
        retention.perProjectMaxCompactions,
        fallbackRetention.perProjectMaxCompactions,
        { min: 10, max: 10000 },
      ),
      rawRefsMaxSizeBytes: normalizePositiveInteger(
        retention.rawRefsMaxSizeBytes,
        fallbackRetention.rawRefsMaxSizeBytes,
        { min: 100000, max: 100_000_000 },
      ),
    },
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

export function readBrainRuntimeConfig(settings = {}) {
  return normalizeBrainRuntimeConfig(
    settings?.[BRAIN_RUNTIME_SETTINGS_KEY],
    DEFAULT_BRAIN_RUNTIME_CONFIG,
  );
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

export async function readResolvedBrainRuntimeConfig(env = process.env) {
  const settings = await readMtlCodeModelSettings(env);
  return readBrainRuntimeConfig(settings);
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
  const brainRuntime = readBrainRuntimeConfig(settings);
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
  if (claudeNativeMemoryEnabled) {
    runtimeEnv[MTL_CODE_MODEL_ENV_KEYS.autoMemoryExtractionEnabled] = '1';
  }
  if (usesOpenAI) {
    runtimeEnv[OPENAI_MODEL_ENV_KEYS.baseUrl] = normalizedBaseUrl;
    runtimeEnv[OPENAI_MODEL_ENV_KEYS.model] = requestModel;
    runtimeEnv[OPENAI_MODEL_ENV_KEYS.protocol] = protocol === 'openai-responses'
      ? 'responses'
      : 'chat-completions';
    applyOpenAIRuntimeModelDefaults(runtimeEnv, { model: requestModel });
  } else {
    runtimeEnv[ANTHROPIC_MODEL_ENV_KEYS.baseUrl] = normalizedBaseUrl;
    runtimeEnv[ANTHROPIC_MODEL_ENV_KEYS.model] = requestModel;
    applyAnthropicRuntimeModelDefaults(runtimeEnv, {
      baseUrl: normalizedBaseUrl,
      model: requestModel,
    });
  }
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
    brainRuntime,
    subagents,
    goals,
  };
}
