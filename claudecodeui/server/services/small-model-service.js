import {
  DEFAULT_SMALL_MODEL_RUNTIME_CONFIG,
  normalizeSmallModelRuntimeConfig as defaultNormalizeSmallModelRuntimeConfig,
  readMtlCodeModelSettings as defaultReadMtlCodeModelSettings,
  readSmallModelRuntimeConfig,
  readStoredModelProfiles,
  resolveActiveModelProfile,
} from './mtl-code-model-service.js';

const SMALL_MODEL_HINTS = ['flash', 'haiku', 'mini', 'small', 'lite'];

const readString = (value) => (typeof value === 'string' ? value.trim() : '');
const readProtocol = (value) => (
  value === 'openai-compatible' || value === 'openai-responses' || value === 'anthropic'
    ? value
    : undefined
);
const normalizeProtocol = (value) => readProtocol(value) || 'anthropic';

const redactProfile = (profile = null) => {
  if (!profile) return null;
  return {
    id: profile.id || '',
    name: profile.name || '',
    provider: profile.provider || 'anthropic',
    protocol: normalizeProtocol(profile.protocol),
    baseUrl: profile.baseUrl || '',
    model: profile.model || '',
    requestModel: profile.requestModel || '',
    tokenConfigured: Boolean(profile.authToken),
  };
};

const hasSmallModelHint = (profile = {}) => {
  const haystack = [profile.id, profile.name, profile.model].map((value) => readString(value).toLowerCase()).join(' ');
  return SMALL_MODEL_HINTS.some((hint) => haystack.includes(hint));
};

const pickSmallModelProfile = ({ runtimeConfig, profiles, activeProfile }) => {
  if (!Array.isArray(profiles) || profiles.length === 0) return null;
  if (runtimeConfig.profileId && runtimeConfig.profileId !== 'auto') {
    return profiles.find((profile) => profile.id === runtimeConfig.profileId) || activeProfile || profiles[0] || null;
  }
  return profiles.find(hasSmallModelHint) || activeProfile || profiles[0] || null;
};

export const normalizeSmallModelRuntimeConfig = defaultNormalizeSmallModelRuntimeConfig;
export { DEFAULT_SMALL_MODEL_RUNTIME_CONFIG };

const readProfilesFromSettingsOrConfig = (settings = {}, env = {}) => {
  if (Array.isArray(settings.profiles)) {
    return settings.profiles.map((profile) => ({
      id: profile.id || '',
      name: profile.name || profile.model || '',
      provider: profile.provider || 'anthropic',
      protocol: readProtocol(profile.protocol),
      baseUrl: profile.baseUrl || '',
      model: profile.model || '',
      requestModel: profile.requestModel || '',
      authToken: profile.authToken || profile.apiKey || '',
      contextWindowTokens: profile.contextWindowTokens,
      bareMode: profile.bareMode !== false,
    })).filter((profile) => profile.id || profile.model);
  }
  return readStoredModelProfiles(settings, env);
};

const resolveActiveProfileFromSettingsOrConfig = (settings = {}, profiles = []) => {
  if (settings.activeProfileId) {
    return profiles.find((profile) => profile.id === settings.activeProfileId) || profiles[0] || null;
  }
  return resolveActiveModelProfile(settings, profiles);
};

export const resolveSmallModelRuntimeConfig = async ({
  readMtlCodeModelSettings = defaultReadMtlCodeModelSettings,
} = {}) => {
  const settings = await readMtlCodeModelSettings();
  const runtimeConfig = settings.smallModelRuntime
    ? defaultNormalizeSmallModelRuntimeConfig(settings.smallModelRuntime)
    : readSmallModelRuntimeConfig(settings);
  const env = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  const profiles = readProfilesFromSettingsOrConfig(settings, env);
  const activeProfile = resolveActiveProfileFromSettingsOrConfig(settings, profiles);
  const resolvedProfile = pickSmallModelProfile({ runtimeConfig, profiles, activeProfile });
  return {
    ...runtimeConfig,
    resolvedProfile: redactProfile(resolvedProfile),
    profile: resolvedProfile || null,
  };
};

const buildAnthropicUrl = (baseUrl = '') => {
  const cleanBaseUrl = readString(baseUrl).replace(/\/+$/, '');
  return cleanBaseUrl.endsWith('/v1/messages') ? cleanBaseUrl : `${cleanBaseUrl}/v1/messages`;
};

const buildOpenAICompatibleUrl = (baseUrl = '') => {
  const cleanBaseUrl = readString(baseUrl).replace(/\/+$/, '');
  if (cleanBaseUrl.endsWith('/v1/chat/completions')) {
    return cleanBaseUrl;
  }
  if (cleanBaseUrl.endsWith('/chat/completions')) {
    return cleanBaseUrl;
  }
  if (cleanBaseUrl.endsWith('/v1')) {
    return `${cleanBaseUrl}/chat/completions`;
  }
  return `${cleanBaseUrl}/v1/chat/completions`;
};

const buildOpenAIResponsesUrl = (baseUrl = '') => {
  const cleanBaseUrl = readString(baseUrl).replace(/\/+$/, '');
  if (cleanBaseUrl.endsWith('/v1/responses')) {
    return cleanBaseUrl;
  }
  if (cleanBaseUrl.endsWith('/responses')) {
    return cleanBaseUrl;
  }
  if (cleanBaseUrl.endsWith('/v1')) {
    return `${cleanBaseUrl}/responses`;
  }
  return `${cleanBaseUrl}/v1/responses`;
};

const parseJsonObject = (text = '') => {
  const cleanText = readString(text);
  if (!cleanText) return null;
  try {
    const parsed = JSON.parse(cleanText);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = cleanText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
};

const extractAnthropicText = (payload = {}) => {
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (typeof payload.text === 'string') return payload.text;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        return typeof entry?.text === 'string' ? entry.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const extractOpenAICompatibleText = (payload = {}) => {
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (typeof payload.text === 'string') return payload.text;
  if (Array.isArray(payload.choices)) {
    return payload.choices
      .map((choice) => {
        if (typeof choice?.message?.content === 'string') return choice.message.content;
        if (Array.isArray(choice?.message?.content)) {
          return choice.message.content
            .map((entry) => {
              if (typeof entry === 'string') return entry;
              return typeof entry?.text === 'string' ? entry.text : '';
            })
            .filter(Boolean)
            .join('\n');
        }
        if (typeof choice?.text === 'string') return choice.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const extractOpenAIResponsesText = (payload = {}) => {
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (typeof payload.text === 'string') return payload.text;
  if (Array.isArray(payload.output)) {
    return payload.output
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : [entry]))
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (typeof entry?.text === 'string') return entry.text;
        if (typeof entry?.content === 'string') return entry.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const extractOpenAIStreamText = (rawText = '') => {
  const raw = String(rawText || '');
  const deltas = [];
  const finals = [];
  const events = raw.split(/\r?\n\r?\n/);

  for (const event of events) {
    const dataText = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
      .trim();
    if (!dataText || dataText === '[DONE]') continue;

    let payload = null;
    try {
      payload = JSON.parse(dataText);
    } catch {
      continue;
    }

    if (typeof payload.delta === 'string') {
      deltas.push(payload.delta);
      continue;
    }

    if (Array.isArray(payload.choices)) {
      const choiceDelta = payload.choices
        .map((choice) => choice?.delta?.content || choice?.text || '')
        .filter(Boolean)
        .join('');
      if (choiceDelta) {
        deltas.push(choiceDelta);
        continue;
      }
    }

    const finalText = payload.response
      ? extractOpenAIResponsesText(payload.response)
      : extractOpenAIResponsesText(payload);
    if (finalText) finals.push(finalText);
  }

  if (deltas.length > 0) return deltas.join('');
  if (finals.length > 0) return finals.join('\n');
  return raw;
};

const buildOpenAIResponsesInput = (userPrompt = '') => [
  {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: userPrompt,
      },
    ],
  },
];

const buildRequestForProtocol = ({
  protocol,
  profile,
  systemPrompt,
  userPrompt,
  maxTokens,
}) => {
  if (protocol === 'openai-responses') {
    return {
      url: buildOpenAIResponsesUrl(profile.baseUrl),
      extractText: extractOpenAIResponsesText,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.authToken}`,
      },
      body: {
        model: profile.model,
        max_output_tokens: maxTokens,
        temperature: 0,
        stream: true,
        ...(readString(systemPrompt) ? { instructions: systemPrompt } : {}),
        input: buildOpenAIResponsesInput(userPrompt),
      },
      streamResponse: true,
    };
  }

  if (protocol === 'openai-compatible') {
    return {
      url: buildOpenAICompatibleUrl(profile.baseUrl),
      extractText: extractOpenAICompatibleText,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.authToken}`,
      },
      body: {
        model: profile.model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          ...(readString(systemPrompt) ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userPrompt },
        ],
      },
    };
  }

  return {
    url: buildAnthropicUrl(profile.baseUrl),
    extractText: extractAnthropicText,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': profile.authToken,
      Authorization: `Bearer ${profile.authToken}`,
    },
    body: {
      model: profile.model,
      max_tokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
  };
};

export const completeSmallModelJson = async ({
  systemPrompt = '',
  userPrompt = '',
  maxTokens = 800,
  timeoutMs,
  purpose = 'generic',
  readMtlCodeModelSettings = defaultReadMtlCodeModelSettings,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const runtime = await resolveSmallModelRuntimeConfig({ readMtlCodeModelSettings });
  if (!runtime.enabled) {
    return { success: false, reason: 'disabled' };
  }
  if (purpose === 'wiki-routing' && runtime.useForWikiRouting === false) {
    return { success: false, reason: 'disabled_for_wiki_routing' };
  }
  if (purpose === 'wiki-readback' && runtime.useForWikiReadback === false) {
    return { success: false, reason: 'disabled_for_wiki_readback' };
  }
  const profile = runtime.profile;
  if (!profile?.authToken || !profile.baseUrl || !profile.model || typeof fetchImpl !== 'function') {
    return {
      success: false,
      reason: 'not_configured',
      resolvedProfile: runtime.resolvedProfile,
    };
  }
  const requestModel = readString(profile.requestModel) || readString(runtime.requestModel) || profile.model;
  const requestProfile = {
    ...profile,
    model: requestModel,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || runtime.timeoutMs || 2500);
  timeout.unref?.();
  try {
    const protocol = profile.protocol
      ? normalizeProtocol(profile.protocol)
      : normalizeProtocol(runtime.protocol);
    const request = buildRequestForProtocol({
      protocol,
      profile: requestProfile,
      systemPrompt,
      userPrompt,
      maxTokens,
    });
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      signal: controller.signal,
      body: JSON.stringify(request.body),
    });
    const payload = request.streamResponse
      ? null
      : await response.json().catch(() => null);
    if (!response.ok) {
      const errorText = request.streamResponse
        ? await response.text().catch(() => '')
        : '';
      const errorJson = request.streamResponse ? parseJsonObject(errorText) : payload;
      return {
        success: false,
        reason: 'request_failed',
        error: errorJson?.error?.message || errorJson?.error || errorText || `Small model returned HTTP ${response.status}`,
        model: requestProfile.model,
        profileModel: profile.model,
        protocol,
        resolvedProfile: runtime.resolvedProfile,
      };
    }
    const text = request.streamResponse
      ? extractOpenAIStreamText(await response.text().catch(() => ''))
      : request.extractText(payload || {});
    const json = parseJsonObject(text);
    if (!json) {
      return {
        success: false,
        reason: 'invalid_json',
        text,
        model: requestProfile.model,
        profileModel: profile.model,
        protocol,
        resolvedProfile: runtime.resolvedProfile,
      };
    }
    return {
      success: true,
      json,
      text,
      model: requestProfile.model,
      profileModel: profile.model,
      protocol,
      resolvedProfile: runtime.resolvedProfile,
    };
  } catch (error) {
    const protocol = profile.protocol
      ? normalizeProtocol(profile.protocol)
      : normalizeProtocol(runtime.protocol);
    return {
      success: false,
      reason: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
      error: error?.message || 'Small model request failed.',
      model: requestProfile.model,
      profileModel: profile.model,
      protocol,
      resolvedProfile: runtime.resolvedProfile,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeStringArray = (value) => (
  typeof value === 'string'
    ? [readString(value)].filter(Boolean)
    : Array.isArray(value)
      ? [...new Set(value.map(readString).filter(Boolean))]
      : []
);

export const classifyKnowledgeWithSmallModel = async ({
  title = '',
  content = '',
  userPrompt = '',
  ruleAssessment = {},
  completeJson = completeSmallModelJson,
} = {}) => {
  const result = await completeJson({
    purpose: 'wiki-routing',
    systemPrompt: [
      '你是 Argus Bridge for Obsidian 的主知识库路由器，只返回 JSON。',
      '由你主导判断 assistant 回复是否应该沉淀到 Obsidian Wiki；规则判断只作为参考。',
      '合法 mode 只有 project-knowledge, second-brain, ai-memory。',
      '不要把寒暄、临时调试日志或无长期价值文本强行标记为写入。',
      '返回格式：{"shouldCapture":true/false,"mode":"","routingModes":[],"confidence":0-1,"reason":"","signals":[],"memoryCapturePolicy":"","topicKey":""}',
    ].join('\n'),
    userPrompt: JSON.stringify({
      title,
      userPrompt,
      content: String(content || '').slice(0, 8000),
      ruleAssessment,
    }),
  });
  if (!result.success) {
    return {
      used: false,
      reason: result.reason,
      assessment: ruleAssessment,
    };
  }
  const json = result.json || {};
  const allowedModes = new Set(['project-knowledge', 'second-brain', 'ai-memory']);
  const aiModes = normalizeStringArray(json.routingModes || json.modes || json.mode)
    .filter((mode) => allowedModes.has(mode));
  const ruleModes = normalizeStringArray(ruleAssessment.routingModes || ruleAssessment.routingMode || ruleAssessment.mode)
    .filter((mode) => allowedModes.has(mode));
  const routingModes = [...new Set([...ruleModes, ...aiModes])];
  const confidence = Number(json.confidence ?? json.routingConfidence);
  const boundedConfidence = Number.isFinite(confidence)
    ? Math.min(Math.max(confidence, 0), 1)
    : undefined;
  const aiShouldCapture = typeof json.shouldCapture === 'boolean'
    ? json.shouldCapture
    : ruleAssessment.shouldCapture !== false;
  const aiMode = aiModes[0] || ruleAssessment.mode || ruleAssessment.routingMode;
  const merged = {
    ...ruleAssessment,
    shouldCapture: aiShouldCapture,
    reason: aiShouldCapture ? (ruleAssessment.reason || 'knowledge') : 'not_knowledge',
    routingMode: aiMode,
    mode: aiMode,
    routingModes: routingModes.length > 0 ? routingModes : ruleAssessment.routingModes,
    routingConfidence: Number.isFinite(boundedConfidence)
      ? boundedConfidence
      : ruleAssessment.routingConfidence,
    confidence: Number.isFinite(boundedConfidence)
      ? boundedConfidence
      : ruleAssessment.confidence,
    routingSignals: [...new Set([
      ...normalizeStringArray(ruleAssessment.routingSignals),
      ...normalizeStringArray(json.signals || json.routingSignals),
    ])],
    routingReason: readString(json.reason || json.routingReason) || ruleAssessment.routingReason,
    memoryCapturePolicy: readString(json.memoryCapturePolicy) || ruleAssessment.memoryCapturePolicy,
    topicKey: readString(json.topicKey) || ruleAssessment.topicKey,
    aiRoutingUsed: true,
    aiRoutingModel: result.model,
    aiRoutingReason: readString(json.reason || json.routingReason),
  };
  return {
    used: true,
    model: result.model,
    assessment: merged,
  };
};

export const refineWikiReadbackContext = async ({
  query = '',
  projectName = '',
  context = '',
  activeNote = null,
  results = [],
  completeJson = completeSmallModelJson,
} = {}) => {
  const sourceResults = Array.isArray(results) ? results : [];
  if (!readString(context) && sourceResults.length === 0 && !activeNote?.path) {
    return { refined: false, context: '', sources: [] };
  }
  const result = await completeJson({
    purpose: 'wiki-readback',
    systemPrompt: [
      '你是 Argus Wiki 上下文筛选器，只返回 JSON。',
      '从候选 Obsidian Wiki 片段中选择和用户请求最相关的内容。',
      '不要编造 path/title/snippet；只能使用输入里的来源。',
      '返回格式：{"snippets":[{"path":"","title":"","snippet":"","reason":""}]}',
    ].join('\n'),
    userPrompt: JSON.stringify({
      query,
      projectName,
      activeNote,
      context: String(context || '').slice(0, 12000),
      results: sourceResults.slice(0, 20).map((entry) => ({
        path: entry.path || '',
        title: entry.title || '',
        snippet: entry.snippet || entry.excerpt || entry.content || '',
      })),
    }),
    maxTokens: 1200,
  });
  if (!result.success) {
    return {
      refined: false,
      reason: result.reason,
      context,
      sources: sourceResults.map((entry) => ({
        kind: 'context-result',
        path: entry.path || '',
        title: entry.title || '',
      })).filter((source) => source.path),
    };
  }
  const snippets = Array.isArray(result.json?.snippets) ? result.json.snippets : [];
  const allowedPaths = new Set(sourceResults.map((entry) => readString(entry.path)).filter(Boolean));
  const normalizedSnippets = snippets
    .map((snippet) => ({
      path: readString(snippet.path),
      title: readString(snippet.title),
      snippet: readString(snippet.snippet),
      hitReason: readString(snippet.reason),
    }))
    .filter((snippet) => snippet.path && snippet.snippet && (allowedPaths.size === 0 || allowedPaths.has(snippet.path)))
    .slice(0, 8);
  if (normalizedSnippets.length === 0) {
    return { refined: false, reason: 'empty_result', context, sources: [] };
  }
  return {
    refined: true,
    model: result.model,
    context: normalizedSnippets.map((snippet) => [
      `Path: ${snippet.path}`,
      snippet.title ? `Title: ${snippet.title}` : '',
      snippet.hitReason ? `Reason: ${snippet.hitReason}` : '',
      snippet.snippet,
    ].filter(Boolean).join('\n')).join('\n\n'),
    sources: normalizedSnippets.map((snippet) => ({
      kind: 'context-result',
      path: snippet.path,
      title: snippet.title,
      hitReason: snippet.hitReason,
    })),
  };
};

export const testSmallModelRuntime = async ({
  prompt = '',
  fetchImpl = globalThis.fetch,
  readMtlCodeModelSettings = defaultReadMtlCodeModelSettings,
} = {}) => {
  const startedAt = Date.now();
  const result = await completeSmallModelJson({
    systemPrompt: '只返回 JSON。格式：{"ok":true,"summary":"","signals":[]}',
    userPrompt: readString(prompt) || '请返回 {"ok": true, "summary": "ready", "signals": ["test"]}',
    fetchImpl,
    readMtlCodeModelSettings,
  });
  return {
    ...result,
    latencyMs: Date.now() - startedAt,
  };
};
