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
import { createBrainLayeredMemoryService } from '../brain-layered-memory-service.js';
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
  return { db, store: createBrainStore({ db }) };
};

describe('Brain layered memory pipeline', () => {
  it('materializes L1 atoms, L2 scenario, and L3 project profile with L0 raw ref traceability', () => {
    const { store } = createStore();
    const layered = createBrainLayeredMemoryService({ store });
    store.addEvent({
      sessionId: 'layered-1',
      projectName: 'Argus',
      eventType: 'command',
      title: 'Implement layered memory',
      content: 'Implement layered memory and use SQLite refs.',
      refs: [{ refType: 'raw_text', refId: 'cmd-1', label: 'Command', content: 'Implement layered memory' }],
    });
    store.addEvent({
      sessionId: 'layered-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Decision: keep L3 project-only',
      content: 'Decision: keep L3 project workflow profile and avoid user persona.',
      refs: [{ refType: 'raw_text', refId: 'decision-1', label: 'Decision', content: 'keep L3 project-only' }],
    });

    const result = layered.materializeSessionLayers({ sessionId: 'layered-1', projectName: 'Argus' });

    expect(result.atoms.length).toBeGreaterThanOrEqual(2);
    expect(result.atoms.every((atom) => atom.sourceEventIds.length > 0)).toBe(true);
    expect(result.atoms.every((atom) => atom.refIds.length > 0)).toBe(true);
    expect(result.scenarios[0].atomIds).toEqual(expect.arrayContaining(result.atoms.map((atom) => atom.id)));
    expect(result.projectProfile.sourceAtomIds).toEqual(expect.arrayContaining(result.atoms.map((atom) => atom.id)));
    expect(result.evidence.missingRefCount).toBe(0);
  });

  it('rebuilds L2 and L3 from existing L1 atoms without requiring original events', () => {
    const { store } = createStore();
    const layered = createBrainLayeredMemoryService({ store });
    store.upsertAtom({
      sessionId: 'rebuild-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Use deterministic rebuilds',
      summary: 'Use deterministic rebuilds from atoms.',
      stableKey: 'decision:rebuild',
      sourceEventIds: ['old-event'],
      refIds: ['old-ref'],
    });

    const result = layered.rebuildTopLayers({ sessionId: 'rebuild-1', projectName: 'Argus' });

    expect(result.atoms).toHaveLength(1);
    expect(result.scenarios[0].summary).toContain('decision');
    expect(result.projectProfile.summary).toContain('Use deterministic rebuilds');
  });

  it('skips ordinary personal remember or forget requests', () => {
    const { store } = createStore();
    const layered = createBrainLayeredMemoryService({ store });
    store.addEvent({
      sessionId: 'persona-1',
      projectName: 'Argus',
      eventType: 'command',
      title: 'Remember my preference',
      content: 'Remember that my favorite color is blue and forget that I like tabs.',
      refs: [{ refType: 'raw_text', refId: 'persona', label: 'Personal preference', content: 'favorite color blue' }],
    });

    const result = layered.materializeSessionLayers({ sessionId: 'persona-1', projectName: 'Argus' });

    expect(result.atoms).toHaveLength(0);
    expect(result.scenarios).toHaveLength(0);
    expect(result.projectProfile).toBeNull();
  });

  it('migrates legacy brain nodes into atoms and top layers without losing source refs', () => {
    const { store } = createStore();
    const layered = createBrainLayeredMemoryService({ store });
    store.upsertNode({
      id: 'legacy-decision',
      sessionId: 'legacy-1',
      projectName: 'Argus',
      nodeType: 'decision',
      title: 'Legacy decision',
      summary: 'Legacy decision keeps source evidence.',
      sourceEventIds: ['legacy-event'],
      refIds: ['legacy-ref'],
    });

    const result = layered.migrateLegacyNodesToLayers({ sessionId: 'legacy-1', projectName: 'Argus' });

    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0]).toMatchObject({
      atomType: 'decision',
      sourceEventIds: ['legacy-event'],
      refIds: ['legacy-ref'],
    });
    expect(result.scenarios[0].atomIds).toContain(result.atoms[0].id);
    expect(result.projectProfile.sourceAtomIds).toContain(result.atoms[0].id);
  });

  it('rebuilds summaries when evidence refs are missing and reports missing evidence', () => {
    const { store } = createStore();
    const layered = createBrainLayeredMemoryService({ store });
    store.upsertAtom({
      sessionId: 'missing-ref-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Keep summaries resilient',
      summary: 'Top layers must survive missing raw refs.',
      stableKey: 'decision:missing-ref',
      sourceEventIds: ['missing-event'],
      refIds: ['missing-ref'],
    });

    const result = layered.rebuildTopLayers({ sessionId: 'missing-ref-1', projectName: 'Argus' });

    expect(result.projectProfile.summary).toContain('Keep summaries resilient');
    expect(result.evidence.missingRefCount).toBe(1);
    expect(result.scenarios[0].metrics.missingRefCount).toBe(1);
  });
});
