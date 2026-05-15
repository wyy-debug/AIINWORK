import os from 'os';
import path from 'path';

import express from 'express';

import { apiKeysDb, credentialsDb, notificationPreferencesDb, pushSubscriptionsDb } from '../database/db.js';
import { getPublicKey } from '../services/vapid-keys.js';
import { createNotificationEvent, notifyUserIfEnabled } from '../services/notification-orchestrator.js';
import {
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  writeJsonConfig,
} from '../shared/utils.js';
import {
  OPENMYTHOS_RUNTIME_SETTINGS_KEY,
  GOAL_RUNTIME_SETTINGS_KEY,
  SMALL_MODEL_RUNTIME_SETTINGS_KEY,
  SUBAGENT_RUNTIME_SETTINGS_KEY,
  applyAnthropicRuntimeModelDefaults,
  applyGoalRuntimeToEnv,
  applyOpenAIRuntimeModelDefaults,
  applyOpenMythosRuntimeToEnv,
  applySubagentRuntimeToEnv,
  canonicalizeAnthropicModel,
  isOpenAIModelProtocol,
  normalizeAnthropicBaseUrl,
  normalizeGoalRuntimeConfig,
  normalizeOpenAIBaseUrl,
  normalizeOpenMythosRuntimeConfig,
  normalizeSmallModelRuntimeConfig,
  normalizeSubagentRuntimeConfig,
  readGoalRuntimeConfig,
  readOpenMythosRuntimeConfig,
  readSmallModelRuntimeConfig,
  readSubagentRuntimeConfig,
} from '../services/mtl-code-model-service.js';
import { testSmallModelRuntime } from '../services/small-model-service.js';
import {
  readRuntimePermissions,
  saveRuntimePermissions,
} from '../services/runtime-permission-service.js';
import {
  ObsidianBridgeError,
  readObsidianBridgeConfig,
  saveObsidianBridgeConfig,
} from '../services/obsidian-bridge-service.js';

const router = express.Router();
const ANTHROPIC_ENV_KEYS = {
  authToken: 'ANTHROPIC_AUTH_TOKEN',
  baseUrl: 'ANTHROPIC_BASE_URL',
  model: 'ANTHROPIC_MODEL',
  defaultHaikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  defaultSonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  defaultOpusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
};
const MTL_CODE_ENV_KEYS = {
  uiBareMode: 'MTL_CODE_UI_BARE',
  claudeNativeMemoryEnabled: 'MTL_CODE_CLAUDE_NATIVE_MEMORY',
  autoMemoryExtractionEnabled: 'MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION',
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
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const MIMO_PAYG_ANTHROPIC_BASE_URL = 'https://api.xiaomimimo.com/anthropic';
const MIMO_TOKEN_PLAN_ANTHROPIC_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/anthropic';
const MODEL_PROFILES_KEY = 'mtlCodeModelProfiles';
const ACTIVE_MODEL_PROFILE_KEY = 'activeMtlCodeModelProfileId';
const MIMO_MODEL_CONTEXT_WINDOWS = {
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'mimo-v2.5-pro': 1_000_000,
  'mimo-v2.5': 1_000_000,
  'mimo-v2-pro': 1_000_000,
  'mimo-v2-omni': 256_000,
  'mimo-v2-flash': 256_000,
};
const MIMO_MODEL_PRESETS = [
  {
    id: 'mimo-v25-pro',
    name: 'MiMo V2.5 Pro',
    baseUrl: MIMO_PAYG_ANTHROPIC_BASE_URL,
    model: 'mimo-v2.5-pro',
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'mimo-v25',
    name: 'MiMo V2.5',
    baseUrl: MIMO_PAYG_ANTHROPIC_BASE_URL,
    model: 'mimo-v2.5',
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro',
    baseUrl: MIMO_PAYG_ANTHROPIC_BASE_URL,
    model: 'mimo-v2-pro',
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'mimo-v2-flash',
    name: 'MiMo V2 Flash',
    baseUrl: MIMO_PAYG_ANTHROPIC_BASE_URL,
    model: 'mimo-v2-flash',
    contextWindowTokens: 256_000,
  },
];
const OPENAI_ENV_KEYS = {
  apiKey: 'OPENAI_API_KEY',
  baseUrl: 'OPENAI_BASE_URL',
  model: 'OPENAI_MODEL',
  orgId: 'OPENAI_ORG_ID',
  projectId: 'OPENAI_PROJECT_ID',
  defaultHaikuModel: 'OPENAI_DEFAULT_HAIKU_MODEL',
  defaultSonnetModel: 'OPENAI_DEFAULT_SONNET_MODEL',
  defaultOpusModel: 'OPENAI_DEFAULT_OPUS_MODEL',
};

const getMtlCodeHomeDir = () => (
  process.env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code')
);

const getLegacyClaudeHomeDir = () => (
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
);

const getMtlCodeSettingsPath = () => path.join(getMtlCodeHomeDir(), 'settings.json');
const getLegacyClaudeSettingsPath = () => path.join(getLegacyClaudeHomeDir(), 'settings.json');

const hasEntries = (record) => Boolean(record && Object.keys(record).length > 0);

const readMtlCodeSettings = async () => {
  const mtlPath = getMtlCodeSettingsPath();
  const mtlSettings = await readJsonConfig(mtlPath);
  if (hasEntries(mtlSettings)) {
    return { filePath: mtlPath, settings: mtlSettings };
  }

  const legacyPath = getLegacyClaudeSettingsPath();
  const legacySettings = await readJsonConfig(legacyPath);
  if (hasEntries(legacySettings)) {
    return { filePath: mtlPath, settings: legacySettings };
  }

  return { filePath: mtlPath, settings: {} };
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

const resolveClaudeNativeMemoryEnabled = (profile = {}, fallback = true) => (
  hasOwn(profile, 'claudeNativeMemoryEnabled')
    ? profile.claudeNativeMemoryEnabled !== false
    : fallback
);

const createStableId = (prefix = 'model') => (
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);

const normalizeProfileId = (value, fallbackPrefix = 'model') => {
  const normalized = (readOptionalString(value) || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || createStableId(fallbackPrefix);
};

const isMimoAnthropicRuntime = (baseUrl, model) => {
  const normalizedBaseUrl = (readOptionalString(baseUrl) || '').toLowerCase();
  const normalizedModel = (readOptionalString(model) || '').toLowerCase();
  return normalizedBaseUrl.includes('xiaomimimo.com') || normalizedModel.startsWith('mimo-');
};

const getMimoContextWindow = (model) => (
  MIMO_MODEL_CONTEXT_WINDOWS[(readOptionalString(model) || '').toLowerCase()] || null
);

const resolveProfileContextWindow = (profile, env) => {
  const explicit = Number.parseInt(String(profile?.contextWindowTokens ?? ''), 10);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const modelDefault = getMimoContextWindow(profile?.model);
  if (modelDefault) {
    return modelDefault;
  }

  return readPositiveIntegerEnv(env, MTL_CODE_ENV_KEYS.maxContextTokens)
    || readPositiveIntegerEnv(env, MTL_CODE_ENV_KEYS.uiContextWindow)
    || DEFAULT_CONTEXT_WINDOW_TOKENS;
};

const sanitizeModelProfile = (profile, env = {}) => {
  const claudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(profile);
  return {
    id: profile.id,
    name: profile.name,
    provider: 'anthropic',
    protocol: normalizeModelProtocol(profile.protocol),
    baseUrl: profile.baseUrl || '',
    model: profile.model || '',
    requestModel: profile.requestModel || '',
    apiKey: '',
    apiKeyConfigured: Boolean(profile.authToken),
    contextWindowTokens: resolveProfileContextWindow(profile, env),
    claudeNativeMemoryEnabled,
    bareMode: !claudeNativeMemoryEnabled,
  };
};

const createProfileFromEnv = (settings, env) => {
  const modelType = readOptionalString(settings.modelType);
  const useOpenAI = modelType === 'openai' || readStringEnv(env, 'MTL_CODE_USE_OPENAI') === '1';
  const anthropicBaseUrl = readStringEnv(env, ANTHROPIC_ENV_KEYS.baseUrl);
  const anthropicModel = canonicalizeAnthropicModel(readStringEnv(env, ANTHROPIC_ENV_KEYS.model));
  const anthropicAuthToken = readStringEnv(env, ANTHROPIC_ENV_KEYS.authToken);
  const legacyOpenAIBaseUrl = readStringEnv(env, OPENAI_ENV_KEYS.baseUrl);
  const legacyOpenAIModel = canonicalizeAnthropicModel(readStringEnv(env, OPENAI_ENV_KEYS.model));
  const legacyOpenAIKey = readStringEnv(env, OPENAI_ENV_KEYS.apiKey);
  const baseUrl = useOpenAI
    ? legacyOpenAIBaseUrl || anthropicBaseUrl
    : anthropicBaseUrl || legacyOpenAIBaseUrl;
  const model = useOpenAI
    ? legacyOpenAIModel || canonicalizeAnthropicModel(settings.model) || anthropicModel || ''
    : anthropicModel || canonicalizeAnthropicModel(settings.model) || legacyOpenAIModel || '';
  const authToken = useOpenAI
    ? legacyOpenAIKey || anthropicAuthToken
    : anthropicAuthToken || legacyOpenAIKey;
  const claudeNativeMemoryEnabled = readBooleanEnv(
    env,
    MTL_CODE_ENV_KEYS.claudeNativeMemoryEnabled,
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
};

const readStoredModelProfiles = (settings, env) => {
  const rawProfiles = Array.isArray(settings?.[MODEL_PROFILES_KEY])
    ? settings[MODEL_PROFILES_KEY]
    : [];
  const profiles = rawProfiles
    .map((entry, index) => {
      const profile = readObjectRecord(entry);
      if (!profile) return null;
      const model = canonicalizeAnthropicModel(profile.model);
      const baseUrl = readOptionalString(profile.baseUrl);
      const name = readOptionalString(profile.name) || model || `Model ${index + 1}`;
      const id = normalizeProfileId(profile.id || name || `model-${index + 1}`);
      const claudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(profile);
      return {
        id,
        name,
        provider: 'anthropic',
        protocol: normalizeModelProtocol(profile.protocol),
        baseUrl,
        model,
        requestModel: readOptionalString(profile.requestModel),
        authToken: readOptionalString(profile.authToken),
        contextWindowTokens: resolveProfileContextWindow(profile, env),
        claudeNativeMemoryEnabled,
        bareMode: !claudeNativeMemoryEnabled,
      };
    })
    .filter(Boolean);

  return profiles.length > 0 ? profiles : [createProfileFromEnv(settings, env)];
};

const resolveActiveModelProfile = (settings, profiles) => {
  const activeId = normalizeProfileId(settings?.[ACTIVE_MODEL_PROFILE_KEY] || '', 'active');
  return profiles.find((profile) => profile.id === activeId) || profiles[0];
};

const hasSmallModelHint = (profile = {}) => {
  const haystack = [profile.id, profile.name, profile.model]
    .map((value) => readOptionalString(value).toLowerCase())
    .join(' ');
  return ['flash', 'haiku', 'mini', 'small', 'lite'].some((hint) => haystack.includes(hint));
};

const resolveSmallModelProfile = (smallModelRuntime, profiles, activeProfile) => {
  if (smallModelRuntime.profileId && smallModelRuntime.profileId !== 'auto') {
    return profiles.find((profile) => profile.id === smallModelRuntime.profileId) || activeProfile || profiles[0] || null;
  }
  return profiles.find(hasSmallModelHint) || activeProfile || profiles[0] || null;
};

const toMtlCodeModelConfig = (settings, filePath) => {
  const env = readObjectRecord(settings.env) ?? {};
  const profiles = readStoredModelProfiles(settings, env);
  const activeProfile = resolveActiveModelProfile(settings, profiles);
  const activeContextWindowTokens = resolveProfileContextWindow(activeProfile, env);
  const activeClaudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(activeProfile);
  const smallModelRuntime = readSmallModelRuntimeConfig(settings, env);
  const smallModelProfile = resolveSmallModelProfile(smallModelRuntime, profiles, activeProfile);

  return {
    provider: 'anthropic',
    configPath: filePath,
    activeProfileId: activeProfile.id,
    profiles: profiles.map((profile) => sanitizeModelProfile(profile, env)),
    presets: {
      mimo: MIMO_MODEL_PRESETS,
      mimoTokenPlanBaseUrl: MIMO_TOKEN_PLAN_ANTHROPIC_BASE_URL,
    },
    anthropic: {
      apiKey: '',
      apiKeyConfigured: Boolean(activeProfile.authToken),
      baseUrl: activeProfile.baseUrl,
      model: activeProfile.model,
    },
    runtime: {
      claudeNativeMemoryEnabled: activeClaudeNativeMemoryEnabled,
      bareMode: !activeClaudeNativeMemoryEnabled,
      contextWindowTokens: activeContextWindowTokens,
      coordinatorMode: readBooleanEnvDefaultTrue(env, MTL_CODE_ENV_KEYS.coordinatorMode),
    },
    openMythosRuntime: readOpenMythosRuntimeConfig(settings, env),
    subagents: readSubagentRuntimeConfig(settings, env),
    goals: readGoalRuntimeConfig(settings, env),
    smallModelRuntime: {
      ...smallModelRuntime,
      resolvedProfile: smallModelProfile
        ? {
          id: smallModelProfile.id,
          name: smallModelProfile.name,
          provider: smallModelProfile.provider,
          baseUrl: smallModelProfile.baseUrl,
          model: smallModelProfile.model,
          tokenConfigured: Boolean(smallModelProfile.authToken),
        }
        : null,
    },
  };
};

const toStringEnv = (value) => {
  const normalized = readOptionalString(value);
  return normalized || undefined;
};

const normalizeModelProtocol = (value) => (
  ['openai-compatible', 'openai-responses'].includes(readOptionalString(value))
    ? readOptionalString(value)
    : 'anthropic'
);

const setOptionalEnv = (env, key, value) => {
  const normalized = toStringEnv(value);
  if (normalized) {
    env[key] = normalized;
    return;
  }

  delete env[key];
};

const normalizeModelConfigInput = (body) => {
  const payload = readObjectRecord(body) ?? {};
  const anthropic = readObjectRecord(payload.anthropic)
    ?? readObjectRecord(payload.openai)
    ?? {};
  const runtime = readObjectRecord(payload.runtime) ?? {};
  const runtimeClaudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(runtime);
  const contextWindowTokens = Number.parseInt(String(runtime.contextWindowTokens ?? ''), 10);
  const rawProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const profiles = rawProfiles
    .map((entry, index) => {
      const profile = readObjectRecord(entry);
      if (!profile) return null;
      const model = toStringEnv(canonicalizeAnthropicModel(profile.model));
      const requestModel = toStringEnv(profile.requestModel);
      const protocol = normalizeModelProtocol(profile.protocol);
      const baseUrl = toStringEnv(profile.baseUrl);
      const name = readOptionalString(profile.name) || model || `Model ${index + 1}`;
      const id = normalizeProfileId(profile.id || name || `model-${index + 1}`);
      const profileContextWindowTokens = Number.parseInt(String(profile.contextWindowTokens ?? ''), 10);
      const claudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(profile, runtimeClaudeNativeMemoryEnabled);
      return {
        id,
        name,
        provider: 'anthropic',
        protocol,
        apiKey: toStringEnv(profile.apiKey),
        baseUrl,
        model,
        requestModel,
        contextWindowTokens: Number.isFinite(profileContextWindowTokens) && profileContextWindowTokens > 0
          ? profileContextWindowTokens
          : undefined,
        claudeNativeMemoryEnabled,
        bareMode: !claudeNativeMemoryEnabled,
      };
    })
    .filter(Boolean);

  if (profiles.length === 0) {
    profiles.push({
      id: 'default',
      name: canonicalizeAnthropicModel(anthropic.model) || 'Default model',
      provider: 'anthropic',
      protocol: 'anthropic',
      apiKey: toStringEnv(anthropic.apiKey),
      baseUrl: toStringEnv(anthropic.baseUrl),
      model: toStringEnv(canonicalizeAnthropicModel(anthropic.model)),
      requestModel: '',
      contextWindowTokens: Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
        ? contextWindowTokens
        : undefined,
      claudeNativeMemoryEnabled: runtimeClaudeNativeMemoryEnabled,
      bareMode: !runtimeClaudeNativeMemoryEnabled,
    });
  }

  return {
    provider: 'anthropic',
    activeProfileId: normalizeProfileId(payload.activeProfileId || profiles[0]?.id || 'default'),
    profiles,
    anthropic: {
      apiKey: toStringEnv(anthropic.apiKey),
      baseUrl: toStringEnv(anthropic.baseUrl),
      model: toStringEnv(canonicalizeAnthropicModel(anthropic.model)),
    },
    runtime: {
      claudeNativeMemoryEnabled: runtimeClaudeNativeMemoryEnabled,
      bareMode: !runtimeClaudeNativeMemoryEnabled,
      coordinatorMode: Object.prototype.hasOwnProperty.call(runtime, 'coordinatorMode')
        ? runtime.coordinatorMode !== false
        : undefined,
      contextWindowTokens: Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
        ? contextWindowTokens
        : undefined,
    },
  };
};

const clearOpenAIEnv = (env) => {
  for (const key of Object.values(OPENAI_ENV_KEYS)) {
    delete env[key];
  }
};

const clearAnthropicEnv = (env) => {
  for (const key of Object.values(ANTHROPIC_ENV_KEYS)) {
    delete env[key];
  }
};

const mergeAndStoreModelProfiles = (settings, env, input) => {
  const existingProfiles = readStoredModelProfiles(settings, env);
  const existingById = new Map(existingProfiles.map((profile) => [profile.id, profile]));
  const uniqueProfiles = [];
  const seenIds = new Set();

  for (const incoming of input.profiles) {
    let id = incoming.id;
    while (seenIds.has(id)) {
      id = createStableId('model');
    }
    seenIds.add(id);

    const existing = existingById.get(incoming.id) || existingById.get(id);
    const authToken = incoming.apiKey || existing?.authToken || '';
    const model = canonicalizeAnthropicModel(incoming.model) || '';
    const requestModel = readOptionalString(incoming.requestModel) || '';
    const protocol = normalizeModelProtocol(incoming.protocol);
    const claudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(incoming);
    const profile = {
      id,
      name: incoming.name || model || `Model ${uniqueProfiles.length + 1}`,
      provider: 'anthropic',
      protocol,
      baseUrl: incoming.baseUrl || '',
      model,
      requestModel,
      authToken,
      contextWindowTokens: incoming.contextWindowTokens
        || getMimoContextWindow(model)
        || existing?.contextWindowTokens
        || DEFAULT_CONTEXT_WINDOW_TOKENS,
      claudeNativeMemoryEnabled,
      bareMode: !claudeNativeMemoryEnabled,
    };
    uniqueProfiles.push(profile);
  }

  const activeProfile = uniqueProfiles.find((profile) => profile.id === input.activeProfileId)
    || uniqueProfiles[0]
    || createProfileFromEnv(settings, env);

  settings[MODEL_PROFILES_KEY] = uniqueProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    protocol: profile.protocol || 'anthropic',
    baseUrl: profile.baseUrl,
    model: profile.model,
    requestModel: profile.requestModel || '',
    authToken: profile.authToken,
    contextWindowTokens: profile.contextWindowTokens,
    claudeNativeMemoryEnabled: profile.claudeNativeMemoryEnabled,
    bareMode: profile.bareMode,
  }));
  settings[ACTIVE_MODEL_PROFILE_KEY] = activeProfile.id;

  return activeProfile;
};

const applyActiveProfileToEnv = (settings, env, profile) => {
  settings.modelType = 'anthropic';
  const requestModel = readOptionalString(profile.requestModel) || profile.model;
  const protocol = normalizeModelProtocol(profile.protocol);
  const usesOpenAI = isOpenAIModelProtocol(protocol);
  const claudeNativeMemoryEnabled = resolveClaudeNativeMemoryEnabled(profile);

  env[MTL_CODE_ENV_KEYS.claudeNativeMemoryEnabled] = claudeNativeMemoryEnabled ? '1' : '0';
  env[MTL_CODE_ENV_KEYS.uiBareMode] = claudeNativeMemoryEnabled ? '0' : '1';
  if (claudeNativeMemoryEnabled) {
    env[MTL_CODE_ENV_KEYS.autoMemoryExtractionEnabled] = '1';
  } else {
    delete env[MTL_CODE_ENV_KEYS.autoMemoryExtractionEnabled];
  }

  const contextWindowTokens = resolveProfileContextWindow(profile, env);
  env[MTL_CODE_ENV_KEYS.maxContextTokens] = String(contextWindowTokens);
  env[MTL_CODE_ENV_KEYS.uiContextWindow] = String(contextWindowTokens);

  if (usesOpenAI) {
    clearAnthropicEnv(env);
    env.MTL_CODE_USE_OPENAI = '1';
    setOptionalEnv(env, OPENAI_ENV_KEYS.baseUrl, normalizeOpenAIBaseUrl(profile.baseUrl));
    setOptionalEnv(env, OPENAI_ENV_KEYS.model, requestModel);
    if (profile.authToken) {
      env[OPENAI_ENV_KEYS.apiKey] = profile.authToken;
    } else {
      delete env[OPENAI_ENV_KEYS.apiKey];
    }
    applyOpenAIRuntimeModelDefaults(env, { model: requestModel });
    if (profile.model) {
      settings.model = profile.model;
    } else {
      delete settings.model;
    }
    return;
  }

  clearOpenAIEnv(env);
  env.MTL_CODE_USE_OPENAI = '0';
  setOptionalEnv(env, ANTHROPIC_ENV_KEYS.baseUrl, normalizeAnthropicBaseUrl(profile.baseUrl));
  setOptionalEnv(env, ANTHROPIC_ENV_KEYS.model, requestModel);

  if (profile.authToken) {
    env[ANTHROPIC_ENV_KEYS.authToken] = profile.authToken;
  } else {
    delete env[ANTHROPIC_ENV_KEYS.authToken];
  }
  applyAnthropicRuntimeModelDefaults(env, {
    baseUrl: normalizeAnthropicBaseUrl(profile.baseUrl),
    model: requestModel,
  });

  if (profile.model) {
    settings.model = profile.model;
  } else {
    delete settings.model;
  }
};

const readArgusRuntimeConfig = (settings) => {
  const env = readObjectRecord(settings.env) ?? {};
  return {
    coordinatorMode: readBooleanEnvDefaultTrue(env, MTL_CODE_ENV_KEYS.coordinatorMode),
  };
};

const normalizeArgusRuntimeInput = (body) => ({
  coordinatorMode: readObjectRecord(body)?.coordinatorMode !== false,
});

const applyArgusRuntimeToEnv = (env, runtime) => {
  if (typeof runtime?.coordinatorMode !== 'boolean') {
    return;
  }
  env[MTL_CODE_ENV_KEYS.coordinatorMode] = runtime.coordinatorMode !== false ? '1' : '0';
};

const applyCoordinatorModeFromOpenMythosRuntime = (env, runtime) => {
  void env;
  void runtime;
};

// ===============================
// API Keys Management
// ===============================

// Get all API keys for the authenticated user
router.get('/api-keys', async (req, res) => {
  try {
    const apiKeys = apiKeysDb.getApiKeys(req.user.id);
    // Don't send the full API key in the list for security
    const sanitizedKeys = apiKeys.map(key => ({
      ...key,
      api_key: key.api_key.substring(0, 10) + '...'
    }));
    res.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create a new API key
router.post('/api-keys', async (req, res) => {
  try {
    const { keyName } = req.body;

    if (!keyName || !keyName.trim()) {
      return res.status(400).json({ error: 'Key name is required' });
    }

    const result = apiKeysDb.createApiKey(req.user.id, keyName.trim());
    res.json({
      success: true,
      apiKey: result
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Delete an API key
router.delete('/api-keys/:keyId', async (req, res) => {
  try {
    const { keyId } = req.params;
    const success = apiKeysDb.deleteApiKey(req.user.id, parseInt(keyId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Toggle API key active status
router.patch('/api-keys/:keyId/toggle', async (req, res) => {
  try {
    const { keyId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = apiKeysDb.toggleApiKey(req.user.id, parseInt(keyId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error toggling API key:', error);
    res.status(500).json({ error: 'Failed to toggle API key' });
  }
});

// ===============================
// Generic Credentials Management
// ===============================

// Get all credentials for the authenticated user (optionally filtered by type)
router.get('/credentials', async (req, res) => {
  try {
    const { type } = req.query;
    const credentials = credentialsDb.getCredentials(req.user.id, type || null);
    // Don't send the actual credential values for security
    res.json({ credentials });
  } catch (error) {
    console.error('Error fetching credentials:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// Create a new credential
router.post('/credentials', async (req, res) => {
  try {
    const { credentialName, credentialType, credentialValue, description } = req.body;

    if (!credentialName || !credentialName.trim()) {
      return res.status(400).json({ error: 'Credential name is required' });
    }

    if (!credentialType || !credentialType.trim()) {
      return res.status(400).json({ error: 'Credential type is required' });
    }

    if (!credentialValue || !credentialValue.trim()) {
      return res.status(400).json({ error: 'Credential value is required' });
    }

    const result = credentialsDb.createCredential(
      req.user.id,
      credentialName.trim(),
      credentialType.trim(),
      credentialValue.trim(),
      description?.trim() || null
    );

    res.json({
      success: true,
      credential: result
    });
  } catch (error) {
    console.error('Error creating credential:', error);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

// Delete a credential
router.delete('/credentials/:credentialId', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const success = credentialsDb.deleteCredential(req.user.id, parseInt(credentialId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error deleting credential:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

// Toggle credential active status
router.patch('/credentials/:credentialId/toggle', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = credentialsDb.toggleCredential(req.user.id, parseInt(credentialId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error toggling credential:', error);
    res.status(500).json({ error: 'Failed to toggle credential' });
  }
});

// ===============================
// Notification Preferences
// ===============================

router.get('/notification-preferences', async (req, res) => {
  try {
    const preferences = notificationPreferencesDb.getPreferences(req.user.id);
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

router.put('/notification-preferences', async (req, res) => {
  try {
    const preferences = notificationPreferencesDb.updatePreferences(req.user.id, req.body || {});
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error saving notification preferences:', error);
    res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

// ===============================
// Push Subscription Management
// ===============================

router.get('/push/vapid-public-key', async (req, res) => {
  try {
    const publicKey = getPublicKey();
    res.json({ publicKey });
  } catch (error) {
    console.error('Error fetching VAPID public key:', error);
    res.status(500).json({ error: 'Failed to fetch VAPID public key' });
  }
});

router.post('/push/subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Missing subscription fields' });
    }
    pushSubscriptionsDb.saveSubscription(req.user.id, endpoint, keys.p256dh, keys.auth);

    // Enable webPush in preferences so the confirmation goes through the full pipeline
    const currentPrefs = notificationPreferencesDb.getPreferences(req.user.id);
    if (!currentPrefs?.channels?.webPush) {
      notificationPreferencesDb.updatePreferences(req.user.id, {
        ...currentPrefs,
        channels: { ...currentPrefs?.channels, webPush: true },
      });
    }

    res.json({ success: true });

    // Send a confirmation push through the full notification pipeline
    const event = createNotificationEvent({
      provider: 'system',
      kind: 'info',
      code: 'push.enabled',
      meta: { message: 'Push notifications are now enabled!' },
      severity: 'info'
    });
    notifyUserIfEnabled({ userId: req.user.id, event });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

router.post('/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint' });
    }
    pushSubscriptionsDb.removeSubscription(endpoint);

    // Disable webPush in preferences to match subscription state
    const currentPrefs = notificationPreferencesDb.getPreferences(req.user.id);
    if (currentPrefs?.channels?.webPush) {
      notificationPreferencesDb.updatePreferences(req.user.id, {
        ...currentPrefs,
        channels: { ...currentPrefs.channels, webPush: false },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing push subscription:', error);
    res.status(500).json({ error: 'Failed to remove push subscription' });
  }
});

// ===============================
// Argus Model Runtime
// ===============================

router.get('/mtl-code-model', async (req, res) => {
  try {
    const { filePath, settings } = await readMtlCodeSettings();
    res.json({
      success: true,
      config: toMtlCodeModelConfig(settings, filePath),
    });
  } catch (error) {
    console.error('Error reading Argus model settings:', error);
    res.status(500).json({ error: 'Failed to read Argus model settings' });
  }
});

router.put('/mtl-code-model', async (req, res) => {
  try {
    const { filePath, settings } = await readMtlCodeSettings();
    const input = normalizeModelConfigInput(req.body);
    const env = readObjectRecord(settings.env) ?? {};

    const activeProfile = mergeAndStoreModelProfiles(settings, env, input);
    applyActiveProfileToEnv(settings, env, activeProfile);
    applyArgusRuntimeToEnv(env, input.runtime);
    const openMythosRuntime = normalizeOpenMythosRuntimeConfig(
      readObjectRecord(req.body?.openMythosRuntime),
      readOpenMythosRuntimeConfig(settings, env),
    );
    settings[OPENMYTHOS_RUNTIME_SETTINGS_KEY] = openMythosRuntime;
    applyOpenMythosRuntimeToEnv(env, openMythosRuntime);
    const subagents = normalizeSubagentRuntimeConfig(
      readObjectRecord(req.body?.subagents),
      readSubagentRuntimeConfig(settings, env),
    );
    settings[SUBAGENT_RUNTIME_SETTINGS_KEY] = subagents;
    applySubagentRuntimeToEnv(env, subagents);
    const goals = normalizeGoalRuntimeConfig(
      readObjectRecord(req.body?.goals),
      readGoalRuntimeConfig(settings, env),
    );
    settings[GOAL_RUNTIME_SETTINGS_KEY] = goals;
    const smallModelRuntime = normalizeSmallModelRuntimeConfig(
      readObjectRecord(req.body?.smallModelRuntime),
      readSmallModelRuntimeConfig(settings, env),
    );
    settings[SMALL_MODEL_RUNTIME_SETTINGS_KEY] = smallModelRuntime;
    applyGoalRuntimeToEnv(env, goals);
    applyCoordinatorModeFromOpenMythosRuntime(env, openMythosRuntime);
    settings.env = env;
    await writeJsonConfig(filePath, settings);

    res.json({
      success: true,
      config: toMtlCodeModelConfig(settings, filePath),
    });
  } catch (error) {
    console.error('Error saving Argus model settings:', error);
    res.status(500).json({ error: 'Failed to save Argus model settings' });
  }
});

router.get('/argus-runtime', async (req, res) => {
  try {
    const { filePath, settings } = await readMtlCodeSettings();
    res.json({
      success: true,
      runtime: {
        ...readArgusRuntimeConfig(settings),
        configPath: filePath,
      },
    });
  } catch (error) {
    console.error('Error reading Argus runtime settings:', error);
    res.status(500).json({ error: 'Failed to read Argus runtime settings' });
  }
});

router.put('/argus-runtime', async (req, res) => {
  try {
    const { filePath, settings } = await readMtlCodeSettings();
    const env = readObjectRecord(settings.env) ?? {};
    const runtime = normalizeArgusRuntimeInput(req.body);
    applyArgusRuntimeToEnv(env, runtime);
    settings.env = env;
    await writeJsonConfig(filePath, settings);
    res.json({
      success: true,
      runtime: {
        ...readArgusRuntimeConfig(settings),
        configPath: filePath,
      },
    });
  } catch (error) {
    console.error('Error saving Argus runtime settings:', error);
    res.status(500).json({ error: 'Failed to save Argus runtime settings' });
  }
});

router.get('/runtime-permissions', async (_req, res) => {
  try {
    res.json({ success: true, permissions: readRuntimePermissions() });
  } catch (error) {
    console.error('Error reading runtime permissions:', error);
    res.status(500).json({ error: 'Failed to read runtime permissions' });
  }
});

router.put('/runtime-permissions', async (req, res) => {
  try {
    const permissions = saveRuntimePermissions(req.body || {});
    res.json({ success: true, permissions });
  } catch (error) {
    console.error('Error saving runtime permissions:', error);
    res.status(500).json({ error: 'Failed to save runtime permissions' });
  }
});

router.post('/small-model/test', async (req, res) => {
  try {
    const result = await testSmallModelRuntime({
      prompt: readOptionalString(req.body?.prompt) || '',
      readMtlCodeModelSettings: async () => {
        const { settings } = await readMtlCodeSettings();
        return settings;
      },
    });
    res.json({
      success: result.success,
      ...result,
    });
  } catch (error) {
    console.error('Error testing small model:', error);
    res.status(500).json({ error: 'Failed to test small model' });
  }
});

router.get('/obsidian-bridge', async (_req, res) => {
  try {
    res.json({ success: true, config: readObsidianBridgeConfig() });
  } catch (error) {
    console.error('Error reading Obsidian bridge settings:', error);
    res.status(500).json({ error: 'Failed to read Obsidian bridge settings' });
  }
});

router.put('/obsidian-bridge', async (req, res) => {
  try {
    res.json({ success: true, config: saveObsidianBridgeConfig(req.body || {}) });
  } catch (error) {
    if (error instanceof ObsidianBridgeError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    console.error('Error saving Obsidian bridge settings:', error);
    return res.status(500).json({ error: 'Failed to save Obsidian bridge settings' });
  }
});

// Host OS for UI (e.g. hide Cursor agent when the backend runs on Windows).
router.get('/server-env', async (req, res) => {
  try {
    res.json({ platform: process.platform });
  } catch (error) {
    console.error('Error reading server environment:', error);
    res.status(500).json({ error: 'Failed to read server environment' });
  }
});

export default router;
