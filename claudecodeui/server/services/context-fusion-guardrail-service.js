const SOURCE_ORDER = [
  'system/profile/runtime',
  'argus-brain-context',
  'mcp-and-profile-tools',
  'user-task',
];

const SOURCE_BOUNDARIES = [
  'Argus Brain is historical task state, not a live code index.',
  'MCP and Agent Profile tools own external knowledge, code search, and impact analysis.',
  'Current files, settings, and runtime results must be verified before acting on historical context.',
];

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

export const estimateContextTokens = (value = '') => Math.ceil(String(value || '').length / 4);

function sliceBetween(text = '', startMarker = '', endMarkers = []) {
  const start = text.indexOf(startMarker);
  if (start < 0) return '';
  const afterStart = start + startMarker.length;
  const end = endMarkers
    .map((marker) => text.indexOf(marker, afterStart))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return text.slice(start, end ?? text.length).trim();
}

function buildSourceContribution({
  enabled,
  used,
  sectionText,
  sourceCount = 0,
  details = {},
} = {}) {
  return {
    enabled: Boolean(enabled),
    used: Boolean(used),
    injectedTokens: estimateContextTokens(sectionText),
    sourceCount: Number(sourceCount) || 0,
    ...details,
  };
}

export function buildContextFusionDiagnostics({
  appendSystemPrompt = '',
  brainRuntime = {},
  brainRecall = {},
} = {}) {
  const prompt = String(appendSystemPrompt || '');
  const brainSection = sliceBetween(prompt, '## Argus Brain', []);
  const brainHits = Array.isArray(brainRecall?.recallHits) ? brainRecall.recallHits : [];
  const brainEnabled = Object.prototype.hasOwnProperty.call(brainRuntime || {}, 'enabled')
    ? brainRuntime.enabled !== false
    : brainRecall?.enabled !== false;

  const sources = {
    brain: buildSourceContribution({
      enabled: brainEnabled,
      used: Boolean(brainRecall?.used || brainSection),
      sectionText: brainSection,
      sourceCount: brainHits.length,
      details: {
        status: readString(brainRecall?.status),
      },
    }),
  };

  return {
    sourceOrder: SOURCE_ORDER,
    boundaries: SOURCE_BOUNDARIES,
    sources,
    totalInjectedTokens: sources.brain.injectedTokens,
  };
}

export function applyContextFusionGuardrailsToChatCommand(data = {}) {
  const options = data?.options && typeof data.options === 'object' ? data.options : {};
  const diagnostics = buildContextFusionDiagnostics({
    appendSystemPrompt: options.appendSystemPrompt || '',
    brainRuntime: options.brainRuntime || {},
    brainRecall: options.brainRecall || {},
  });
  return {
    ...data,
    options: {
      ...options,
      contextFusion: diagnostics,
      runtimeDiagnostics: {
        ...(options.runtimeDiagnostics || {}),
        contextFusion: diagnostics,
      },
    },
  };
}
