import {
  MTL_CODE_MODEL_ENV_KEYS,
  readMtlCodeModelSettings,
  readStoredModelProfiles,
  resolveActiveModelProfile,
  resolveMtlCodeModelRuntime,
} from './mtl-code-model-service.js';
import { readObjectRecord } from '../shared/utils.js';

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
export const CONTEXT_BUDGET_WINDOW_SOURCES = {
  ACTIVE_PROFILE: 'active_profile',
  CUMULATIVE_ONLY: 'cumulative_only',
  ENV: 'env',
  FALLBACK: 'fallback',
  MODEL_USAGE: 'model_usage',
  RUNTIME_OPTION: 'runtime_option',
  SESSION_PROFILE: 'session_profile',
};

const TOKEN_KEYS = {
  input: ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'],
  output: ['outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens'],
  cacheRead: ['cacheReadInputTokens', 'cache_read_input_tokens', 'cacheReadTokens', 'cache_read_tokens'],
  cacheCreation: [
    'cacheCreationInputTokens',
    'cache_creation_input_tokens',
    'cacheCreationTokens',
    'cache_creation_tokens',
  ],
  cumulativeInput: ['cumulativeInputTokens', 'cumulative_input_tokens'],
  cumulativeOutput: ['cumulativeOutputTokens', 'cumulative_output_tokens'],
  cumulativeCacheRead: [
    'cumulativeCacheReadInputTokens',
    'cumulative_cache_read_input_tokens',
    'cumulativeCacheReadTokens',
    'cumulative_cache_read_tokens',
  ],
  cumulativeCacheCreation: [
    'cumulativeCacheCreationInputTokens',
    'cumulative_cache_creation_input_tokens',
    'cumulativeCacheCreationTokens',
    'cumulative_cache_creation_tokens',
  ],
};

function readPositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readFirstNumber(source, keys) {
  const data = readObjectRecord(source) ?? {};
  for (const key of keys) {
    const value = Number(data[key]);
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}

function hasAnyNumber(source, keys) {
  const data = readObjectRecord(source) ?? {};
  return keys.some((key) => {
    const value = Number(data[key]);
    return Number.isFinite(value) && value >= 0;
  });
}

function hasCumulativeUsage(source) {
  return hasAnyNumber(source, [
    ...TOKEN_KEYS.cumulativeInput,
    ...TOKEN_KEYS.cumulativeOutput,
    ...TOKEN_KEYS.cumulativeCacheRead,
    ...TOKEN_KEYS.cumulativeCacheCreation,
  ]);
}

function getUsageBreakdown(source, cumulative = false) {
  if (!source) {
    return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  }

  return {
    input: readFirstNumber(source, cumulative ? TOKEN_KEYS.cumulativeInput : TOKEN_KEYS.input),
    output: readFirstNumber(source, cumulative ? TOKEN_KEYS.cumulativeOutput : TOKEN_KEYS.output),
    cacheRead: readFirstNumber(source, cumulative ? TOKEN_KEYS.cumulativeCacheRead : TOKEN_KEYS.cacheRead),
    cacheCreation: readFirstNumber(source, cumulative ? TOKEN_KEYS.cumulativeCacheCreation : TOKEN_KEYS.cacheCreation),
  };
}

function addBreakdown(a, b) {
  return {
    input: (a?.input || 0) + (b?.input || 0),
    output: (a?.output || 0) + (b?.output || 0),
    cacheRead: (a?.cacheRead || 0) + (b?.cacheRead || 0),
    cacheCreation: (a?.cacheCreation || 0) + (b?.cacheCreation || 0),
  };
}

function currentUsed(breakdown) {
  return (breakdown?.input || 0) + (breakdown?.cacheRead || 0) + (breakdown?.cacheCreation || 0);
}

function cumulativeUsed(breakdown) {
  return currentUsed(breakdown) + (breakdown?.output || 0);
}

function getPercent(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.round((used / total) * 10_000) / 100;
}

function readEnvContextWindow(env) {
  return readPositiveInteger(env?.[MTL_CODE_MODEL_ENV_KEYS.maxContextTokens])
    || readPositiveInteger(env?.[MTL_CODE_MODEL_ENV_KEYS.uiContextWindow])
    || readPositiveInteger(env?.CONTEXT_WINDOW);
}

async function resolveActiveProfileWindow(env) {
  try {
    const settings = await readMtlCodeModelSettings(env);
    const settingsEnv = readObjectRecord(settings.env) ?? {};
    const profiles = readStoredModelProfiles(settings, settingsEnv);
    const activeProfile = resolveActiveModelProfile(settings, profiles);
    if (!activeProfile) {
      return null;
    }
    return {
      tokens: activeProfile.contextWindowTokens,
      model: activeProfile.model || null,
      modelProfileId: activeProfile.id || null,
      source: CONTEXT_BUDGET_WINDOW_SOURCES.ACTIVE_PROFILE,
    };
  } catch (error) {
    console.warn('[ContextBudget] Failed to resolve active model profile:', error?.message || error);
    return null;
  }
}

export async function resolveContextWindow({
  modelUsageWindow,
  model = null,
  modelProfileId = null,
  contextWindowTokens = null,
  env = process.env,
} = {}) {
  const usageWindow = readPositiveInteger(modelUsageWindow);
  if (usageWindow) {
    return {
      tokens: usageWindow,
      model,
      modelProfileId: modelProfileId || null,
      source: CONTEXT_BUDGET_WINDOW_SOURCES.MODEL_USAGE,
    };
  }

  if (modelProfileId) {
    try {
      const runtime = await resolveMtlCodeModelRuntime(modelProfileId, env);
      if (runtime?.contextWindowTokens) {
        return {
          tokens: runtime.contextWindowTokens,
          model: runtime.profile?.model || model || null,
          modelProfileId,
          source: CONTEXT_BUDGET_WINDOW_SOURCES.SESSION_PROFILE,
        };
      }
    } catch (error) {
      console.warn('[ContextBudget] Failed to resolve session model profile:', error?.message || error);
    }
  }

  const optionWindow = readPositiveInteger(contextWindowTokens);
  if (optionWindow) {
    return {
      tokens: optionWindow,
      model,
      modelProfileId: modelProfileId || null,
      source: CONTEXT_BUDGET_WINDOW_SOURCES.RUNTIME_OPTION,
    };
  }

  const activeProfileWindow = await resolveActiveProfileWindow(env);
  if (activeProfileWindow?.tokens) {
    return {
      ...activeProfileWindow,
      model: model || activeProfileWindow.model,
      modelProfileId: modelProfileId || activeProfileWindow.modelProfileId,
    };
  }

  const envWindow = readEnvContextWindow(env);
  if (envWindow) {
    return {
      tokens: envWindow,
      model,
      modelProfileId: modelProfileId || null,
      source: CONTEXT_BUDGET_WINDOW_SOURCES.ENV,
    };
  }

  return {
    tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    model,
    modelProfileId: modelProfileId || null,
      source: CONTEXT_BUDGET_WINDOW_SOURCES.FALLBACK,
  };
}

function createContextBudget({ currentBreakdown, cumulativeBreakdown, window, updatedAt = new Date().toISOString() }) {
  const total = window?.tokens || DEFAULT_CONTEXT_WINDOW_TOKENS;
  const current = currentBreakdown || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const cumulative = cumulativeBreakdown || current;
  const currentTotal = currentUsed(current);
  const cumulativeTotal = cumulativeUsed(cumulative);

  return {
    current: {
      used: currentTotal,
      total,
      percent: getPercent(currentTotal, total),
      breakdown: current,
    },
    cumulative: {
      used: cumulativeTotal,
      total,
      percent: getPercent(cumulativeTotal, total),
      breakdown: cumulative,
    },
    window: {
      tokens: total,
      model: window?.model || null,
      modelProfileId: window?.modelProfileId || null,
      source: window?.source || 'fallback',
    },
    updatedAt,
  };
}

function getModelUsageEntries(modelUsage) {
  const usage = readObjectRecord(modelUsage) ?? {};
  return Object.entries(usage)
    .map(([model, data]) => ({ model, data: readObjectRecord(data) }))
    .filter((entry) => entry.data);
}

function selectCurrentModelUsageEntry(entries) {
  let selected = null;
  let selectedScore = -1;
  for (const entry of entries) {
    const current = getUsageBreakdown(entry.data, false);
    const cumulative = getUsageBreakdown(entry.data, hasCumulativeUsage(entry.data));
    const score = currentUsed(current) || cumulativeUsed(cumulative) || readPositiveInteger(entry.data?.contextWindow) || 0;
    if (score > selectedScore) {
      selected = entry;
      selectedScore = score;
    }
  }
  return selected;
}

export async function buildContextBudgetFromModelUsage(resultMessage, options = {}) {
  const modelUsage = resultMessage?.modelUsage || resultMessage;
  const entries = getModelUsageEntries(modelUsage);
  if (entries.length === 0) {
    return null;
  }

  const selected = selectCurrentModelUsageEntry(entries);
  if (!selected) {
    return null;
  }

  const currentBreakdown = getUsageBreakdown(selected.data, false);
  const cumulativeBreakdown = entries.reduce((sum, entry) => (
    addBreakdown(sum, getUsageBreakdown(entry.data, hasCumulativeUsage(entry.data)))
  ), { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  const window = await resolveContextWindow({
    modelUsageWindow: selected.data?.contextWindow,
    model: selected.model,
    modelProfileId: options.modelProfileId,
    contextWindowTokens: options.contextWindowTokens,
    env: options.env,
  });

  return createContextBudget({ currentBreakdown, cumulativeBreakdown, window });
}

function parseJsonlLines(lines) {
  return lines
    .map((line) => {
      if (!line || !String(line).trim()) {
        return null;
      }
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function buildContextBudgetFromJsonlEntries(entries, options = {}) {
  let latestAssistantUsage = null;
  let latestModelUsageResult = null;
  let cumulativeBreakdown = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const entry of entries || []) {
    if (entry?.type === 'result' && entry.modelUsage) {
      latestModelUsageResult = entry;
    }

    const usage = entry?.message?.usage;
    if (entry?.type === 'assistant' && usage) {
      latestAssistantUsage = usage;
      cumulativeBreakdown = addBreakdown(cumulativeBreakdown, getUsageBreakdown(usage, false));
    }
  }

  if (latestModelUsageResult) {
    const resultBudget = await buildContextBudgetFromModelUsage(latestModelUsageResult, options);
    if (resultBudget) {
      return resultBudget;
    }
  }

  const currentBreakdown = latestAssistantUsage
    ? getUsageBreakdown(latestAssistantUsage, false)
    : { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const window = await resolveContextWindow({
    model: options.model || null,
    modelProfileId: options.modelProfileId,
    contextWindowTokens: options.contextWindowTokens,
    env: options.env,
  });

  return createContextBudget({ currentBreakdown, cumulativeBreakdown, window });
}

export async function buildContextBudgetFromJsonlLines(lines, options = {}) {
  return buildContextBudgetFromJsonlEntries(parseJsonlLines(lines), options);
}

export async function buildContextBudgetFromFlatUsage({
  currentBreakdown,
  cumulativeBreakdown,
  total,
  model = null,
  modelProfileId = null,
  contextWindowTokens = null,
  env = process.env,
  windowSource = 'provided',
} = {}) {
  const explicitTotal = readPositiveInteger(total);
  const window = explicitTotal
    ? {
        tokens: explicitTotal,
        model,
        modelProfileId,
        source: windowSource,
      }
    : await resolveContextWindow({
        model,
        modelProfileId,
        contextWindowTokens,
        env,
      });
  return createContextBudget({
    currentBreakdown: currentBreakdown || cumulativeBreakdown || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    cumulativeBreakdown: cumulativeBreakdown || currentBreakdown || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    window,
  });
}

export function toLegacyTokenBudget(contextBudget) {
  if (!contextBudget) {
    return null;
  }
  return {
    used: contextBudget.current.used,
    total: contextBudget.current.total,
  };
}

export function toContextBudgetResponse(contextBudget, extra = {}) {
  if (!contextBudget) {
    return {
      used: 0,
      total: 0,
      breakdown: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      contextBudget: null,
      ...extra,
    };
  }

  return {
    used: contextBudget.current.used,
    total: contextBudget.current.total,
    percentage: contextBudget.current.percent,
    breakdown: contextBudget.current.breakdown,
    cumulative: contextBudget.cumulative,
    window: contextBudget.window,
    contextBudget,
    ...extra,
  };
}
