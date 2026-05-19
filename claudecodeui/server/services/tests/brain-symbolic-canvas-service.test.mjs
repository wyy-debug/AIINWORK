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
import { createBrainRecallService } from '../brain-recall-service.js';
import { createBrainCompactionService } from '../brain-compaction-service.js';
import {
  CANONICAL_SYMBOLIC_NODE_TYPES,
  createBrainSymbolicCanvasService,
  createStableSymbolicNodeId,
} from '../brain-symbolic-canvas-service.js';
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

const seedEvidenceNode = (store) => {
  const event = store.addEvent({
    sessionId: 'canvas-1',
    projectName: 'Argus',
    eventType: 'checkpoint',
    checkpointId: 'checkpoint-123',
    title: 'Checkpoint captured rollback implementation',
    content: 'RAW_SECRET_STACK_TRACE should only appear in drill-down evidence.',
    refs: [{
      refType: 'checkpoint',
      refId: 'checkpoint-123',
      label: 'Rollback checkpoint',
      checkpointId: 'checkpoint-123',
      content: 'RAW_SECRET_STACK_TRACE checkpoint patch body',
      metadata: { path: 'server/services/checkpoint.js' },
    }],
  });
  const nodeId = createStableSymbolicNodeId({
    sessionId: 'canvas-1',
    nodeType: 'checkpoint',
    meaning: 'Checkpoint captured rollback implementation',
  });
  const node = store.upsertNode({
    id: nodeId,
    sessionId: 'canvas-1',
    projectName: 'Argus',
    nodeType: 'checkpoint',
    title: 'Checkpoint captured rollback implementation',
    summary: 'Checkpoint captured rollback implementation',
    sourceEventIds: [event.id],
    refIds: event.refs.map((ref) => ref.id),
  });
  const atom = store.upsertAtom({
    sessionId: 'canvas-1',
    projectName: 'Argus',
    atomType: 'checkpoint',
    title: 'Rollback checkpoint evidence',
    summary: 'Checkpoint links rollback evidence to the task canvas.',
    stableKey: 'checkpoint:rollback',
    sourceEventIds: [event.id],
    refIds: event.refs.map((ref) => ref.id),
  });
  return { event, node, atom };
};

describe('Brain symbolic Mermaid canvas', () => {
  it('uses canonical node types and stable ids that survive meaning-only recompactions', () => {
    expect(CANONICAL_SYMBOLIC_NODE_TYPES).toEqual(expect.arrayContaining([
      'goal',
      'step',
      'decision',
      'risk',
      'blocker',
      'file',
      'checkpoint',
      'artifact',
      'lesson',
      'next-action',
    ]));

    const first = createStableSymbolicNodeId({
      sessionId: 'canvas-1',
      nodeType: 'Decision',
      meaning: '  Use hybrid recall for checkout rollback. ',
    });
    const second = createStableSymbolicNodeId({
      sessionId: 'canvas-1',
      nodeType: 'decision',
      meaning: 'use HYBRID recall for checkout rollback.',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^brain_decision_[a-f0-9]{10}$/);
  });

  it('renders clickable Mermaid and text fallback without leaking raw evidence', () => {
    const store = createStore();
    const { node, atom } = seedEvidenceNode(store);
    const canvas = createBrainSymbolicCanvasService({ store }).buildCanvas({
      sessionId: 'canvas-1',
      projectName: 'Argus',
    });

    expect(canvas.nodes[0]).toMatchObject({
      id: node.id,
      nodeType: 'checkpoint',
      refIds: node.refIds,
      atomIds: [atom.id],
    });
    expect(canvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: node.id, to: node.refIds[0], kind: 'evidence-ref' }),
      expect.objectContaining({ from: node.id, to: atom.id, kind: 'atom' }),
    ]));
    expect(canvas.mermaid).toContain(`click ${node.id}`);
    expect(canvas.textFallback).toContain(node.id);
    expect(canvas.textFallback).toContain('evidence refs: 1');
    expect(canvas.mermaid).not.toContain('RAW_SECRET_STACK_TRACE');
    expect(canvas.textFallback).not.toContain('RAW_SECRET_STACK_TRACE');
  });

  it('drills into a copied node id to return raw refs and open targets', () => {
    const store = createStore();
    const { node } = seedEvidenceNode(store);
    const detail = createBrainSymbolicCanvasService({ store }).getNodeEvidence({
      sessionId: 'canvas-1',
      nodeId: node.id,
    });

    expect(detail.node.id).toBe(node.id);
    expect(detail.refs[0]).toMatchObject({
      checkpointId: 'checkpoint-123',
      content: expect.stringContaining('RAW_SECRET_STACK_TRACE'),
    });
    expect(detail.openTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'checkpoint', id: 'checkpoint-123' }),
      expect.objectContaining({ kind: 'file', id: 'server/services/checkpoint.js' }),
    ]));
    expect(detail.copyEvidence).toContain(node.id);
    expect(detail.copyEvidence).toContain('RAW_SECRET_STACK_TRACE');
  });

  it('compacts canonical checkpoint, artifact, and lesson nodes with explicit source refs', () => {
    const store = createStore();
    const checkpoint = store.addEvent({
      sessionId: 'compact-canvas-1',
      projectName: 'Argus',
      eventType: 'checkpoint',
      checkpointId: 'checkpoint-9',
      title: 'Checkpoint before rollback',
      content: 'Checkpoint patch content is raw evidence.',
      refs: [{
        refType: 'checkpoint',
        refId: 'checkpoint-9',
        checkpointId: 'checkpoint-9',
        label: 'Checkpoint 9',
        content: 'RAW_CHECKPOINT_PATCH',
      }],
    });
    const artifact = store.addEvent({
      sessionId: 'compact-canvas-1',
      projectName: 'Argus',
      eventType: 'artifact',
      artifactId: 'artifact-9',
      title: 'Artifact impact analysis',
      content: 'Artifact body is raw evidence.',
      refs: [{
        refType: 'artifact',
        refId: 'artifact-9',
        artifactId: 'artifact-9',
        label: 'Artifact 9',
        content: 'RAW_ARTIFACT_BODY',
      }],
    });
    store.addEvent({
      sessionId: 'compact-canvas-1',
      projectName: 'Argus',
      eventType: 'assistant_summary',
      title: 'Lesson learned: verify canvas refs',
      content: 'Lesson learned: node drill-down must own raw evidence.',
    });

    createBrainCompactionService({ store }).compactSession({
      sessionId: 'compact-canvas-1',
      projectName: 'Argus',
      force: true,
      config: { enabled: true },
    });
    const canvas = createBrainSymbolicCanvasService({ store }).buildCanvas({
      sessionId: 'compact-canvas-1',
      projectName: 'Argus',
    });
    const byType = new Map(canvas.nodes.map((node) => [node.nodeType, node]));

    expect(byType.get('checkpoint')).toMatchObject({
      refIds: checkpoint.refs.map((ref) => ref.id),
      sourceEventIds: [checkpoint.id],
    });
    expect(byType.get('artifact')).toMatchObject({
      refIds: artifact.refs.map((ref) => ref.id),
      sourceEventIds: [artifact.id],
    });
    expect(byType.get('lesson')?.title).toContain('Lesson learned');
    expect(canvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: byType.get('checkpoint').id, to: checkpoint.refs[0].id, kind: 'evidence-ref' }),
      expect.objectContaining({ from: byType.get('artifact').id, to: artifact.refs[0].id, kind: 'evidence-ref' }),
    ]));
    expect(canvas.mermaid).not.toContain('RAW_CHECKPOINT_PATCH');
    expect(canvas.mermaid).not.toContain('RAW_ARTIFACT_BODY');
  });

  it('keeps raw evidence out of prompt injection while diagnostics can expose compact canvas sources', async () => {
    const store = createStore();
    const { node } = seedEvidenceNode(store);
    store.addCompaction({
      sessionId: 'canvas-1',
      projectName: 'Argus',
      mermaid: `flowchart TD\n  ${node.id}["Checkpoint captured rollback implementation"]`,
      summary: 'Checkpoint captured rollback implementation',
      currentGoal: 'Continue rollback implementation',
      nextAction: 'Inspect symbolic node evidence only when needed',
      refs: node.refIds,
    });
    const recall = createBrainRecallService({
      store,
      readConfig: async () => ({ enabled: true, maxInjectedTokens: 600 }),
    });

    const result = await recall.applyToChatCommand({
      command: 'continue rollback',
      options: { sessionId: 'canvas-1', projectName: 'Argus' },
    }, 'claude');

    expect(result.options.appendSystemPrompt).toContain(node.id);
    expect(result.options.appendSystemPrompt).not.toContain('RAW_SECRET_STACK_TRACE');
    expect(result.options.runtimeDiagnostics.brainRuntime.recall.recallHits[0]).toMatchObject({
      kind: 'compaction',
    });
  });
});
