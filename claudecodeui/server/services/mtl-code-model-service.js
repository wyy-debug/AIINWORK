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

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
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

  if (profile.authToken) {
    runtimeEnv[ANTHROPIC_MODEL_ENV_KEYS.authToken] = profile.authToken;
  }

  return {
    profile: { ...profile, model, contextWindowTokens },
    env: Object.fromEntries(Object.entries(runtimeEnv).filter(([, value]) => Boolean(value))),
    contextWindowTokens,
  };
}
