import crypto from 'crypto';

const SOURCE_ORDER = [
  'system/profile/runtime',
  'obsidian-wiki-context',
  'codegraph-runtime',
  'argus-brain-context',
  'user-task',
];

const SOURCE_BOUNDARIES = [
  'Obsidian Wiki Context is source material, not task state.',
  'Argus Brain is task state, not source material.',
  'Current code, settings, and runtime results must be verified before acting on historical context.',
];

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizePath = (value = '') => readString(value)
  .replace(/\\/g, '/')
  .replace(/\/+/g, '/')
  .replace(/^\/+|\/+$/g, '')
  .toLowerCase();

const normalizeText = (value = '') => readString(value).replace(/\s+/g, ' ').toLowerCase();

export const estimateContextTokens = (value = '') => Math.ceil(String(value || '').length / 4);

const hashText = (value = '') => {
  const text = normalizeText(value);
  if (text.length < 16) return '';
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
};

const addKey = (keys, kind, value) => {
  const clean = readString(value);
  if (clean) keys.push({ kind, key: clean.toLowerCase() });
};

const addPathKey = (keys, value) => {
  const clean = normalizePath(value);
  if (clean) keys.push({ kind: 'path', key: clean });
};

const addTextKey = (keys, value) => {
  const key = hashText(value);
  if (key) keys.push({ kind: 'text', key });
};

const looksLikePath = (value = '') => {
  const text = readString(value);
  return /[\\/]/.test(text) || /\.[a-z0-9]{1,8}$/i.test(text);
};

function collectIdentityKeys(source = {}) {
  const keys = [];
  addPathKey(keys, source.path);
  addPathKey(keys, source.filePath);
  addPathKey(keys, source.sourcePath);
  addPathKey(keys, source.vaultPath);

  if (Array.isArray(source.entities)) {
    for (const entity of source.entities) {
      if (looksLikePath(entity)) addPathKey(keys, entity);
    }
  }

  addKey(keys, 'artifact', source.artifactId || source.artifact_id);
  addKey(keys, 'checkpoint', source.checkpointId || source.checkpoint_id);
  addKey(keys, 'source', source.sourceId || source.source_id || source.refId || source.ref_id || source.sourceRef);

  const textBody = readString(source.snippet || source.summary || source.content || source.text);
  if (readString(source.title) && textBody) {
    addTextKey(keys, `${source.title}\n${textBody}`);
  } else {
    addTextKey(keys, textBody);
  }
  return keys;
}

function buildIdentityIndex(sources = []) {
  const index = {
    path: new Set(),
    artifact: new Set(),
    checkpoint: new Set(),
    source: new Set(),
    text: new Set(),
  };
  for (const source of Array.isArray(sources) ? sources : []) {
    for (const { kind, key } of collectIdentityKeys(source)) {
      index[kind]?.add(key);
    }
  }
  return index;
}

const DEDUP_REASON_BY_KIND = {
  path: 'duplicate-path',
  artifact: 'duplicate-artifact',
  checkpoint: 'duplicate-checkpoint',
  source: 'duplicate-source',
  text: 'duplicate-text',
};

function findDuplicateReason(hit = {}, identityIndex) {
  const keys = collectIdentityKeys(hit);
  for (const kind of ['path', 'artifact', 'checkpoint', 'source', 'text']) {
    const key = keys.find((entry) => entry.kind === kind && identityIndex[kind]?.has(entry.key));
    if (key) return DEDUP_REASON_BY_KIND[kind];
  }
  return '';
}

export function filterBrainRecallHitsAgainstObsidian(hits = [], obsidianSources = []) {
  const identityIndex = buildIdentityIndex(obsidianSources);
  const kept = [];
  const removed = [];
  for (const hit of Array.isArray(hits) ? hits : []) {
    const reason = findDuplicateReason(hit, identityIndex);
    if (reason) {
      removed.push({
        id: hit.id || '',
        title: hit.title || '',
        kind: hit.kind || hit.atomType || '',
        reason,
      });
    } else {
      kept.push(hit);
    }
  }
  return { hits: kept, removed };
}

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
  obsidianContext = {},
  codegraphContext = {},
  brainRuntime = {},
  brainRecall = {},
  dedupedBrainHits = [],
} = {}) {
  const prompt = String(appendSystemPrompt || '');
  const obsidianSection = sliceBetween(prompt, 'Argus Wiki Context', ['CodeGraph Runtime', '## Argus Brain']);
  const codegraphSection = sliceBetween(prompt, 'CodeGraph Runtime', ['## Argus Brain']);
  const brainSection = sliceBetween(prompt, '## Argus Brain', []);
  const obsidianSources = Array.isArray(obsidianContext?.sources) ? obsidianContext.sources : [];
  const brainHits = Array.isArray(brainRecall?.recallHits) ? brainRecall.recallHits : [];
  const codegraphEnabled = Object.prototype.hasOwnProperty.call(codegraphContext || {}, 'enabled')
    ? codegraphContext.enabled === true
    : Boolean(codegraphSection);
  const brainEnabled = Object.prototype.hasOwnProperty.call(brainRuntime || {}, 'enabled')
    ? brainRuntime.enabled !== false
    : brainRecall?.enabled !== false;

  const sources = {
    obsidian: buildSourceContribution({
      enabled: Boolean(obsidianContext?.used || obsidianSources.length || obsidianSection),
      used: Boolean(obsidianContext?.used || obsidianSection),
      sectionText: obsidianSection,
      sourceCount: obsidianSources.length,
      details: {
        source: obsidianContext?.source || 'wiki',
        vaultName: obsidianContext?.vaultName || '',
      },
    }),
    codegraph: buildSourceContribution({
      enabled: codegraphEnabled,
      used: Boolean(codegraphSection),
      sectionText: codegraphSection,
      sourceCount: codegraphContext?.projectRoot ? 1 : 0,
      details: {
        mcpConfigured: Boolean(codegraphContext?.mcpConfigured),
        projectRoot: codegraphContext?.projectRoot || '',
      },
    }),
    brain: buildSourceContribution({
      enabled: brainEnabled,
      used: Boolean(brainRecall?.used || brainSection),
      sectionText: brainSection,
      sourceCount: brainHits.length,
      details: {
        status: brainRecall?.status || '',
      },
    }),
  };

  return {
    sourceOrder: SOURCE_ORDER,
    boundaries: SOURCE_BOUNDARIES,
    sources,
    deduped: {
      brainAgainstObsidian: (Array.isArray(dedupedBrainHits) ? dedupedBrainHits : []).map((entry) => Object.fromEntries(
        Object.entries({
          id: entry.id || '',
          title: entry.title || '',
          kind: entry.kind || '',
          reason: entry.reason || '',
        }).filter(([, value]) => value),
      )),
    },
    totalInjectedTokens: sources.obsidian.injectedTokens
      + sources.codegraph.injectedTokens
      + sources.brain.injectedTokens,
  };
}

export function applyContextFusionGuardrailsToChatCommand(data = {}) {
  const options = data?.options && typeof data.options === 'object' ? data.options : {};
  const diagnostics = buildContextFusionDiagnostics({
    appendSystemPrompt: options.appendSystemPrompt || '',
    obsidianContext: options.obsidianContext || {},
    codegraphContext: options.codegraphContext || {},
    brainRuntime: options.brainRuntime || {},
    brainRecall: options.brainRecall || {},
    dedupedBrainHits: options.brainRecall?.dedupedAgainstObsidian || [],
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
