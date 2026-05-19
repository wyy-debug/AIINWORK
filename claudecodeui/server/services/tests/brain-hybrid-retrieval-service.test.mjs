import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  BRAIN_ATOMS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_SESSION_INDEX_SQL,
  BRAIN_ATOMS_STABLE_INDEX_SQL,
  BRAIN_ATOMS_TABLE_SQL,
  BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
  BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
  BRAIN_COMPACTIONS_TABLE_SQL,
  BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
  BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
  BRAIN_EVENTS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_SESSION_INDEX_SQL,
  BRAIN_EVENTS_TABLE_SQL,
  BRAIN_NODES_PROJECT_INDEX_SQL,
  BRAIN_NODES_SESSION_INDEX_SQL,
  BRAIN_NODES_TABLE_SQL,
  BRAIN_PROJECT_PROFILES_INDEX_SQL,
  BRAIN_PROJECT_PROFILES_TABLE_SQL,
  BRAIN_REFS_EVENT_INDEX_SQL,
  BRAIN_REFS_REF_INDEX_SQL,
  BRAIN_REFS_SESSION_INDEX_SQL,
  BRAIN_REFS_TABLE_SQL,
  BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
  BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
  BRAIN_SCENARIOS_SESSION_INDEX_SQL,
  BRAIN_SCENARIOS_TABLE_SQL,
  BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
  BRAIN_SESSIONS_PROJECT_INDEX_SQL,
  BRAIN_SESSIONS_TABLE_SQL,
} from '../../database/schema.js';
import { createBrainHybridRetrievalService, reciprocalRankFuse } from '../brain-hybrid-retrieval-service.js';
import { createBrainRecallService } from '../brain-recall-service.js';
import { createBrainStore } from '../brain-store-service.js';

const createStore = () => {
  const db = new Database(':memory:');
  db.exec([
    BRAIN_SESSIONS_TABLE_SQL,
    BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
    BRAIN_SESSIONS_PROJECT_INDEX_SQL,
    BRAIN_EVENTS_TABLE_SQL,
    BRAIN_EVENTS_SESSION_INDEX_SQL,
    BRAIN_EVENTS_PROJECT_INDEX_SQL,
    BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
    BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
    BRAIN_REFS_TABLE_SQL,
    BRAIN_REFS_SESSION_INDEX_SQL,
    BRAIN_REFS_EVENT_INDEX_SQL,
    BRAIN_REFS_REF_INDEX_SQL,
    BRAIN_NODES_TABLE_SQL,
    BRAIN_NODES_SESSION_INDEX_SQL,
    BRAIN_NODES_PROJECT_INDEX_SQL,
    BRAIN_COMPACTIONS_TABLE_SQL,
    BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
    BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
    BRAIN_ATOMS_TABLE_SQL,
    BRAIN_ATOMS_SESSION_INDEX_SQL,
    BRAIN_ATOMS_PROJECT_INDEX_SQL,
    BRAIN_ATOMS_STABLE_INDEX_SQL,
    BRAIN_SCENARIOS_TABLE_SQL,
    BRAIN_SCENARIOS_SESSION_INDEX_SQL,
    BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
    BRAIN_PROJECT_PROFILES_TABLE_SQL,
    BRAIN_PROJECT_PROFILES_INDEX_SQL,
    BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
    BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
    BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
  ].join('\n'));
  return createBrainStore({ db });
};

describe('Brain hybrid retrieval', () => {
  it('fuses BM25/entity/recency/status/source-confidence ranks with reasons', async () => {
    const store = createStore();
    const target = store.upsertAtom({
      sessionId: 'hybrid-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Checkout webhook idempotency',
      summary: 'Use idempotency keys for checkout webhook retries.',
      stableKey: 'decision:checkout',
      entities: ['server/routes/checkouts.js', '#42'],
      refIds: ['ref-checkout'],
      updatedAtMs: 2000,
      confidence: 0.95,
    });
    store.upsertAtom({
      sessionId: 'hybrid-1',
      projectName: 'Argus',
      atomType: 'lesson',
      title: 'Theme color cleanup',
      summary: 'Avoid one-note dark blue palettes.',
      stableKey: 'lesson:theme',
      entities: ['src/theme.ts'],
      updatedAtMs: 1000,
      confidence: 0.7,
    });
    const retrieval = createBrainHybridRetrievalService({ store, vectorAdapter: null });

    const result = await retrieval.retrieve({
      query: 'checkout retry #42 server/routes/checkouts.js',
      sessionId: 'hybrid-1',
      projectName: 'Argus',
    });

    expect(result.hits[0]).toMatchObject({ id: target.id, kind: 'atom' });
    expect(result.hits[0].reasons.map((reason) => reason.signal)).toEqual(expect.arrayContaining(['bm25', 'entity', 'recency', 'source-confidence']));
    expect(result.diagnostics.mode).toBe('hybrid');
    expect(result.diagnostics.degraded).toBe(true);
    expect(result.diagnostics.warnings).toContain('vector-unavailable');
  });

  it('uses optional vector hits for differently worded queries and times out safely', async () => {
    const store = createStore();
    const target = store.upsertAtom({
      sessionId: 'semantic-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Rollback reverse patch',
      summary: 'Use reverse patch application for checkpoint undo.',
      stableKey: 'decision:rollback',
      entities: ['checkpoint'],
    });
    const retrieval = createBrainHybridRetrievalService({
      store,
      vectorAdapter: {
        enabled: true,
        search: async () => [{ id: target.id, score: 0.92, reason: 'semantic checkpoint undo match' }],
      },
    });

    const semantic = await retrieval.retrieve({
      query: 'undo the saved work state',
      sessionId: 'semantic-1',
      projectName: 'Argus',
      vectorTimeoutMs: 50,
    });
    expect(semantic.hits[0].id).toBe(target.id);
    expect(semantic.hits[0].reasons.map((reason) => reason.signal)).toContain('vector');
    expect(semantic.diagnostics.degraded).toBe(false);

    const timeout = await createBrainHybridRetrievalService({
      store,
      vectorAdapter: {
        enabled: true,
        search: () => new Promise(() => {}),
      },
    }).retrieve({
      query: 'undo the saved work state',
      sessionId: 'semantic-1',
      projectName: 'Argus',
      vectorTimeoutMs: 1,
    });
    expect(timeout.hits.length).toBeGreaterThan(0);
    expect(timeout.diagnostics.degraded).toBe(true);
    expect(timeout.diagnostics.warnings).toContain('vector-timeout');
  });

  it('adds hybrid retrieval diagnostics to Brain recall', async () => {
    const store = createStore();
    store.upsertAtom({
      sessionId: 'recall-hybrid-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Use RRF retrieval',
      summary: 'Fuse BM25, entity, recency, and vector signals.',
      stableKey: 'decision:rrf',
      entities: ['RRF'],
    });
    const recall = createBrainRecallService({
      store,
      readConfig: async () => ({ enabled: true, maxInjectedTokens: 500, hybridRetrieval: { enabled: true } }),
    });

    const result = await recall.applyToChatCommand({
      command: 'How should RRF retrieval work?',
      options: { sessionId: 'recall-hybrid-1', projectName: 'Argus' },
    }, 'claude');

    const diagnostics = result.options.runtimeDiagnostics.brainRuntime.recall;
    expect(diagnostics.retrieval.mode).toBe('hybrid');
    expect(diagnostics.recallHits[0].reasons[0].signal).toBeTruthy();
    expect(result.options.appendSystemPrompt).toContain('### Relevant memory');
  });

  it('builds Brain recall without retired external-source dedupe diagnostics', async () => {
    const store = createStore();
    store.upsertAtom({
      id: 'checkout-flow-atom',
      sessionId: 'recall-boundary-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Checkout flow decision',
      summary: 'Use the exact checkout flow described by the prior task state.',
      stableKey: 'decision:checkout-flow',
      entities: ['checkout-flow'],
    });
    store.upsertAtom({
      id: 'brain-only-atom',
      sessionId: 'recall-boundary-1',
      projectName: 'Argus',
      atomType: 'lesson',
      title: 'Brain-only deployment lesson',
      summary: 'Remember the rollout checklist from the prior task.',
      stableKey: 'lesson:brain-only-deploy',
      entities: ['deployment-checklist'],
    });
    const recall = createBrainRecallService({
      store,
      readConfig: async () => ({ enabled: true, maxInjectedTokens: 500, hybridRetrieval: { enabled: true } }),
    });

    const result = await recall.applyToChatCommand({
      command: 'checkout deployment',
      options: {
        sessionId: 'recall-boundary-1',
        projectName: 'Argus',
      },
    }, 'claude');

    expect(result.options.appendSystemPrompt).toContain('Checkout flow decision');
    expect(result.options.appendSystemPrompt).toContain('Brain-only deployment lesson');
    expect(result.options.brainRecall).not.toHaveProperty('dedupedAgainstObsidian');
    expect(result.options.contextFusion.sources).not.toHaveProperty('obsidian');
    expect(result.options.contextFusion.sources).not.toHaveProperty('codegraph');
  });
});

describe('reciprocalRankFuse', () => {
  it('preserves per-signal reasons while combining ranks', () => {
    const fused = reciprocalRankFuse([
      { signal: 'bm25', hits: [{ id: 'a', score: 4 }, { id: 'b', score: 2 }] },
      { signal: 'entity', hits: [{ id: 'b', score: 3 }, { id: 'a', score: 1 }] },
    ], { k: 60 });

    expect(fused).toHaveLength(2);
    expect(fused[0].reasons.map((reason) => reason.signal)).toEqual(expect.arrayContaining(['bm25', 'entity']));
  });
});
