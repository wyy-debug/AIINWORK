import express from 'express';
import os from 'os';
import path from 'path';
import { apiKeysDb, credentialsDb, notificationPreferencesDb, pushSubscriptionsDb } from '../database/db.js';
import { getPublicKey } from '../services/vapid-keys.js';
import { createNotificationEvent, notifyUserIfEnabled } from '../services/notification-orchestrator.js';
import {
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  writeJsonConfig,
} from '../shared/utils.js';

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
  maxContextTokens: 'MTL_CODE_MAX_CONTEXT_TOKENS',
  uiContextWindow: 'CONTEXT_WINDOW',
  effortLevel: 'MTL_CODE_EFFORT_LEVEL',
  legacyEffortLevel: 'CLAUDE_CODE_EFFORT_LEVEL',
  subagentModel: 'MTL_CODE_SUBAGENT_MODEL',
  legacySubagentModel: 'CLAUDE_CODE_SUBAGENT_MODEL',
};
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
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

const toMtlCodeModelConfig = (settings, filePath) => {
  const env = readObjectRecord(settings.env) ?? {};
  const modelType = readOptionalString(settings.modelType);
  const preferLegacyOpenAI = modelType === 'openai';
  const anthropicBaseUrl = readStringEnv(env, ANTHROPIC_ENV_KEYS.baseUrl);
  const anthropicModel = readStringEnv(env, ANTHROPIC_ENV_KEYS.model);
  const anthropicApiKeyConfigured = Boolean(readStringEnv(env, ANTHROPIC_ENV_KEYS.authToken));
  const legacyOpenAIBaseUrl = readStringEnv(env, OPENAI_ENV_KEYS.baseUrl);
  const legacyOpenAIModel = readStringEnv(env, OPENAI_ENV_KEYS.model);
  const legacyOpenAIApiKeyConfigured = Boolean(readStringEnv(env, OPENAI_ENV_KEYS.apiKey));
  const baseUrl = preferLegacyOpenAI
    ? legacyOpenAIBaseUrl || anthropicBaseUrl
    : anthropicBaseUrl || legacyOpenAIBaseUrl;
  const model = preferLegacyOpenAI
    ? legacyOpenAIModel || readOptionalString(settings.model) || anthropicModel || ''
    : anthropicModel || readOptionalString(settings.model) || legacyOpenAIModel || '';
  const apiKeyConfigured = preferLegacyOpenAI
    ? legacyOpenAIApiKeyConfigured || anthropicApiKeyConfigured
    : anthropicApiKeyConfigured || legacyOpenAIApiKeyConfigured;
  const contextWindowTokens = readPositiveIntegerEnv(env, MTL_CODE_ENV_KEYS.maxContextTokens)
    || readPositiveIntegerEnv(env, MTL_CODE_ENV_KEYS.uiContextWindow)
    || DEFAULT_CONTEXT_WINDOW_TOKENS;

  return {
    provider: 'anthropic',
    configPath: filePath,
    anthropic: {
      apiKey: '',
      apiKeyConfigured,
      baseUrl,
      model,
    },
    runtime: {
      bareMode: readBooleanEnvDefaultTrue(env, MTL_CODE_ENV_KEYS.uiBareMode),
      contextWindowTokens,
    },
  };
};

const toStringEnv = (value) => {
  const normalized = readOptionalString(value);
  return normalized || undefined;
};

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
  const contextWindowTokens = Number.parseInt(String(runtime.contextWindowTokens ?? ''), 10);

  return {
    provider: 'anthropic',
    anthropic: {
      apiKey: toStringEnv(anthropic.apiKey),
      baseUrl: toStringEnv(anthropic.baseUrl),
      model: toStringEnv(anthropic.model),
    },
    runtime: {
      bareMode: runtime.bareMode !== false,
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

const isDeepSeekAnthropicRuntime = (baseUrl, model) => {
  const normalizedBaseUrl = readOptionalString(baseUrl).toLowerCase();
  const normalizedModel = readOptionalString(model).toLowerCase();
  return normalizedBaseUrl.includes('api.deepseek.com') || normalizedModel.includes('deepseek');
};

const applyDeepSeekAnthropicDefaults = (env, model) => {
  const configuredModel = readOptionalString(model) || 'deepseek-v4-pro';
  const smallModel = configuredModel.toLowerCase().includes('deepseek-v4-pro')
    ? 'deepseek-v4-flash'
    : configuredModel;

  env[ANTHROPIC_ENV_KEYS.defaultSonnetModel] = configuredModel;
  env[ANTHROPIC_ENV_KEYS.defaultOpusModel] = configuredModel;
  env[ANTHROPIC_ENV_KEYS.defaultHaikuModel] = smallModel || 'deepseek-v4-flash';
  env[MTL_CODE_ENV_KEYS.subagentModel] = env[MTL_CODE_ENV_KEYS.subagentModel] || env[MTL_CODE_ENV_KEYS.legacySubagentModel] || env[ANTHROPIC_ENV_KEYS.defaultHaikuModel];
  env[MTL_CODE_ENV_KEYS.legacySubagentModel] = env[MTL_CODE_ENV_KEYS.legacySubagentModel] || env[MTL_CODE_ENV_KEYS.subagentModel];
  env[MTL_CODE_ENV_KEYS.effortLevel] = env[MTL_CODE_ENV_KEYS.effortLevel] || env[MTL_CODE_ENV_KEYS.legacyEffortLevel] || 'high';
  env[MTL_CODE_ENV_KEYS.legacyEffortLevel] = env[MTL_CODE_ENV_KEYS.legacyEffortLevel] || env[MTL_CODE_ENV_KEYS.effortLevel];
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
// MTL-Code Model Runtime
// ===============================

router.get('/mtl-code-model', async (req, res) => {
  try {
    const { filePath, settings } = await readMtlCodeSettings();
    res.json({
      success: true,
      config: toMtlCodeModelConfig(settings, filePath),
    });
  } catch (error) {
    console.error('Error reading MTL-Code model settings:', error);
    res.status(500).json({ error: 'Failed to read MTL-Code model settings' });
  }
});

router.put('/mtl-code-model', async (req, res) => {
  try {
    const { filePath, settings } = await readMtlCodeSettings();
    const input = normalizeModelConfigInput(req.body);
    const env = readObjectRecord(settings.env) ?? {};
    const previousModelType = readOptionalString(settings.modelType);

    settings.modelType = 'anthropic';

    const legacyOpenAIKey = readStringEnv(env, OPENAI_ENV_KEYS.apiKey);
    setOptionalEnv(env, ANTHROPIC_ENV_KEYS.baseUrl, input.anthropic.baseUrl);
    setOptionalEnv(env, ANTHROPIC_ENV_KEYS.model, input.anthropic.model);
    setOptionalEnv(env, ANTHROPIC_ENV_KEYS.defaultHaikuModel, input.anthropic.model);
    setOptionalEnv(env, ANTHROPIC_ENV_KEYS.defaultSonnetModel, input.anthropic.model);
    setOptionalEnv(env, ANTHROPIC_ENV_KEYS.defaultOpusModel, input.anthropic.model);
    env[MTL_CODE_ENV_KEYS.uiBareMode] = input.runtime.bareMode ? '1' : '0';
    const contextWindowTokens = input.runtime.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS;
    env[MTL_CODE_ENV_KEYS.maxContextTokens] = String(contextWindowTokens);
    env[MTL_CODE_ENV_KEYS.uiContextWindow] = String(contextWindowTokens);
    if (isDeepSeekAnthropicRuntime(input.anthropic.baseUrl, input.anthropic.model)) {
      applyDeepSeekAnthropicDefaults(env, input.anthropic.model);
    }

    if (input.anthropic.apiKey) {
      env[ANTHROPIC_ENV_KEYS.authToken] = input.anthropic.apiKey;
    } else if ((previousModelType === 'openai' || !env[ANTHROPIC_ENV_KEYS.authToken]) && legacyOpenAIKey) {
      env[ANTHROPIC_ENV_KEYS.authToken] = legacyOpenAIKey;
    }

    if (input.anthropic.model) {
      settings.model = input.anthropic.model;
    } else {
      delete settings.model;
    }

    clearOpenAIEnv(env);
    settings.env = env;
    await writeJsonConfig(filePath, settings);

    res.json({
      success: true,
      config: toMtlCodeModelConfig(settings, filePath),
    });
  } catch (error) {
    console.error('Error saving MTL-Code model settings:', error);
    res.status(500).json({ error: 'Failed to save MTL-Code model settings' });
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
