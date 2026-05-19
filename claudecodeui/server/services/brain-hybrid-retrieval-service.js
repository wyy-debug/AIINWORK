import { performance } from 'node:perf_hooks';

import { extractBrainEntities, tokenizeBrainText } from './brain-layered-memory-service.js';
import { brainStore as defaultBrainStore } from './brain-store-service.js';

const compact = (value = '', max = 260) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const USEFUL_ATOM_TYPE_WEIGHTS = new Map([
  ['goal', 2.4],
  ['decision', 2.2],
  ['constraint', 2.1],
  ['lesson', 1.9],
  ['fix', 1.4],
  ['verification', 1.1],
]);

function isLowValueMemory(document = {}) {
  const title = String(document.title || '').trim().toLowerCase();
  const summary = String(document.summary || '').trim().toLowerCase();
  if (document.kind === 'scenario') {
    const looksRuntimeOnly = /tool_use|tool_result|checkpoint captured/.test(summary);
    const hasMemorySignal = /goal|decision|constraint|lesson|remember|do not restore|\u4e0d\u8981\u6062\u590d|\u8bb0\u4f4f/u.test(summary);
    return looksRuntimeOnly && !hasMemorySignal;
  }
  if (document.kind === 'project-profile') {
    return /^(decisions:\s*tool_result\s*)?(constraints:\s*tool_result\s*)?(lessons:\s*tool_result\s*)?$/i
      .test(String(document.summary || '').replace(/\s+/g, ' ').trim());
  }
  return (
    title === 'tool_result'
    || title.startsWith('tool_use:')
    || title.startsWith('checkpoint captured')
    || summary === 'tool_result'
    || summary === 'no matches found'
    || summary.startsWith('checkpoint captured')
  );
}

function scoreMemoryQuality(document = {}, queryTokens = []) {
  const textTokens = tokenizeBrainText(`${document.title || ''}\n${document.summary || ''}`);
  const hasQueryOverlap = queryTokens.some((token) => textTokens.includes(token));
  let score = USEFUL_ATOM_TYPE_WEIGHTS.get(document.atomType) || 0;
  score += Math.min(Number(document.confidence || 0), 1);
  if (document.pinned) score += 1.4;
  if (Array.isArray(document.entities) && document.entities.length > 0) score += 0.5;
  if (hasQueryOverlap) score += 0.7;
  if (isLowValueMemory(document) && !hasQueryOverlap) score -= 2.8;
  return score;
}

const withTimeout = (promise, timeoutMs) => Promise.race([
  promise,
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error('vector-timeout')), Math.max(Number(timeoutMs) || 50, 1));
  }),
]);

function scoreTokenOverlap(queryTokens, documentTokens) {
  if (!queryTokens.length || !documentTokens.length) return 0;
  const documentSet = new Set(documentTokens);
  const matches = queryTokens.filter((token) => documentSet.has(token));
  return matches.length / Math.sqrt(queryTokens.length * documentTokens.length);
}

function normalizeDocuments({ atoms = [], scenarios = [], projectProfile = null } = {}) {
  return [
    ...atoms.map((atom) => ({
      id: atom.id,
      kind: 'atom',
      title: atom.title,
      summary: atom.summary,
      status: atom.status,
      atomType: atom.atomType,
      confidence: atom.confidence,
      entities: atom.entities || [],
      updatedAtMs: atom.updatedAtMs || atom.createdAtMs || 0,
      source: atom,
    })),
    ...scenarios.map((scenario) => ({
      id: scenario.id,
      kind: 'scenario',
      title: scenario.title,
      summary: scenario.summary,
      status: scenario.status,
      atomType: '',
      confidence: 0.8,
      entities: [],
      updatedAtMs: scenario.updatedAtMs || scenario.createdAtMs || 0,
      source: scenario,
    })),
    ...(projectProfile ? [{
      id: projectProfile.id,
      kind: 'project-profile',
      title: projectProfile.profileType || 'Project workflow profile',
      summary: projectProfile.summary,
      status: 'active',
      atomType: '',
      confidence: 0.76,
      entities: extractBrainEntities(projectProfile.summary),
      updatedAtMs: projectProfile.updatedAtMs || projectProfile.createdAtMs || 0,
      source: projectProfile,
    }] : []),
  ];
}

function rankedSignal(signal, documents, scorer) {
  return {
    signal,
    hits: documents
      .map((document) => ({ ...document, score: scorer(document) }))
      .filter((document) => document.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((document, index) => ({
        id: document.id,
        kind: document.kind,
        title: document.title,
        summary: document.summary,
        score: document.score,
        rank: index + 1,
        source: document.source,
      })),
  };
}

export function reciprocalRankFuse(signalRankings = [], { k = 60 } = {}) {
  const byId = new Map();
  for (const ranking of signalRankings) {
    for (const hit of ranking.hits || []) {
      const current = byId.get(hit.id) || {
        id: hit.id,
        kind: hit.kind,
        title: hit.title,
        summary: hit.summary,
        source: hit.source,
        score: 0,
        reasons: [],
      };
      const rank = Number(hit.rank) || current.reasons.length + 1;
      const signalScore = 1 / ((Number(k) || 60) + rank);
      current.score += signalScore;
      current.reasons.push({
        signal: ranking.signal,
        rank,
        score: hit.score,
      });
      byId.set(hit.id, current);
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.score - left.score);
}

export function createBrainHybridRetrievalService({
  store = defaultBrainStore,
  vectorAdapter = null,
  clock = () => Date.now(),
} = {}) {
  const retrieve = async ({
    query = '',
    sessionId = '',
    provider = 'claude',
    projectName = '',
    limit = 8,
    vectorTimeoutMs = 80,
  } = {}) => {
    const started = performance.now();
    const warnings = [];
    const projectScoped = Boolean(String(projectName || '').trim());
    const memoryScope = projectScoped
      ? { provider, projectName }
      : { sessionId, provider };
    const atoms = store.listAtoms({ ...memoryScope, limit: 240 });
    const scenarios = store.listScenarios({ ...memoryScope, limit: 60 });
    const projectProfile = projectName ? store.getProjectProfile({ projectName, provider }) : null;
    const documents = normalizeDocuments({ atoms, scenarios, projectProfile });
    const queryTokens = tokenizeBrainText(query);
    const queryLooksLikeFailure = /\b(fail|failed|failure|error|rollback|leak|timeout|conflict|vitest|test)\b/i.test(query);
    const queryEntities = extractBrainEntities(query).map((entity) => entity.toLowerCase());
    const newest = documents.reduce((max, document) => Math.max(max, Number(document.updatedAtMs || 0)), 0) || clock();

    const rankings = [
      rankedSignal('bm25', documents, (document) => scoreTokenOverlap(
        queryTokens,
        tokenizeBrainText(`${document.title}\n${document.summary}`),
      )),
      rankedSignal('entity', documents, (document) => {
        const entities = (document.entities || []).map((entity) => String(entity).toLowerCase());
        if (!queryEntities.length || !entities.length) return 0;
        return queryEntities.filter((entity) => entities.includes(entity)).length / queryEntities.length;
      }),
      rankedSignal('recency', documents, (document) => {
        const distance = Math.max(0, newest - Number(document.updatedAtMs || 0));
        return 1 / (1 + (distance / 86_400_000));
      }),
      rankedSignal('task-status', documents, (document) => (document.status === 'active' ? 1 : 0.3)),
      rankedSignal('source-confidence', documents, (document) => Number(document.confidence || 0.5)),
      rankedSignal('memory-quality', documents, (document) => scoreMemoryQuality(document, queryTokens)),
      rankedSignal('lesson-fit', documents, (document) => (
        queryLooksLikeFailure && document.atomType === 'lesson' ? 1 : 0
      )),
    ];

    if (vectorAdapter?.enabled && typeof vectorAdapter.search === 'function') {
      try {
        const vectorHits = await withTimeout(
          Promise.resolve(vectorAdapter.search({ query, documents, sessionId, provider, projectName })),
          vectorTimeoutMs,
        );
        rankings.push({
          signal: 'vector',
          hits: (Array.isArray(vectorHits) ? vectorHits : [])
            .map((hit, index) => {
              const document = documents.find((candidate) => candidate.id === hit.id);
              if (!document) return null;
              return {
                ...document,
                score: Number(hit.score || 0.01),
                rank: index + 1,
              };
            })
            .filter(Boolean),
        });
      } catch (error) {
        warnings.push(error?.message === 'vector-timeout' ? 'vector-timeout' : 'vector-error');
      }
    } else {
      warnings.push('vector-unavailable');
    }

    const fused = reciprocalRankFuse(rankings)
      .map((hit) => ({
        ...hit,
        memoryDocument: {
          ...(hit.source || {}),
          kind: hit.kind,
          title: hit.title,
          summary: hit.summary,
          atomType: hit.source?.atomType || '',
        },
      }))
      .filter((hit) => !isLowValueMemory(hit.memoryDocument))
      .map((hit) => ({
        ...hit,
        qualityScore: scoreMemoryQuality(hit.memoryDocument, queryTokens),
      }))
      .sort((left, right) => (
        right.qualityScore - left.qualityScore
        || right.score - left.score
        || String(left.title || left.id).localeCompare(String(right.title || right.id))
      ))
      .slice(0, Math.max(Number(limit) || 8, 1))
      .map((hit) => ({
        id: hit.id,
        kind: hit.kind,
        title: hit.title,
        summary: compact(hit.summary, 360),
        status: hit.source?.status || '',
        confidence: hit.source?.confidence || 0,
        pinned: Boolean(hit.source?.pinned),
        atomType: hit.source?.atomType || '',
        entities: Array.isArray(hit.source?.entities) ? hit.source.entities : [],
        refIds: Array.isArray(hit.source?.refIds) ? hit.source.refIds : [],
        sourceEventIds: Array.isArray(hit.source?.sourceEventIds) ? hit.source.sourceEventIds : [],
        updatedAtMs: hit.source?.updatedAtMs || hit.source?.createdAtMs || 0,
        score: hit.score,
        reasons: hit.reasons,
      }));
    const diagnostics = {
      mode: 'hybrid',
      degraded: warnings.length > 0,
      warnings,
      signals: rankings.map((ranking) => ranking.signal),
      latencyMs: Math.round(performance.now() - started),
      totalCandidates: documents.length,
      memoryScope: projectScoped ? 'project' : 'session',
    };
    const run = store.addRetrievalRun?.({
      sessionId,
      provider,
      projectName,
      query,
      mode: diagnostics.degraded ? 'hybrid-degraded' : 'hybrid',
      hits: fused,
      metrics: diagnostics,
    });
    return {
      hits: fused,
      diagnostics: {
        ...diagnostics,
        runId: run?.id || '',
      },
    };
  };

  return { retrieve };
}

export const brainHybridRetrievalService = createBrainHybridRetrievalService();
