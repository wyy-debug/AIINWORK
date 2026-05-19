import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
  BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
  BRAIN_COMPACTIONS_TABLE_SQL,
  BRAIN_ATOMS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_SESSION_INDEX_SQL,
  BRAIN_ATOMS_STABLE_INDEX_SQL,
  BRAIN_ATOMS_TABLE_SQL,
  BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
  BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
  BRAIN_EVENTS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_SESSION_INDEX_SQL,
  BRAIN_EVENTS_TABLE_SQL,
  BRAIN_PROJECT_PROFILES_INDEX_SQL,
  BRAIN_PROJECT_PROFILES_TABLE_SQL,
  BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
  BRAIN_NODES_PROJECT_INDEX_SQL,
  BRAIN_NODES_SESSION_INDEX_SQL,
  BRAIN_NODES_TABLE_SQL,
  BRAIN_REFS_EVENT_INDEX_SQL,
  BRAIN_REFS_REF_INDEX_SQL,
  BRAIN_REFS_SESSION_INDEX_SQL,
  BRAIN_REFS_TABLE_SQL,
  BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
  BRAIN_SCENARIOS_SESSION_INDEX_SQL,
  BRAIN_SCENARIOS_TABLE_SQL,
  BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
  BRAIN_SESSIONS_PROJECT_INDEX_SQL,
  BRAIN_SESSIONS_TABLE_SQL,
} from '../../database/schema.js';
import { createBrainCaptureService, redactBrainPayload } from '../brain-capture-service.js';
import { createBrainCompactionService } from '../brain-compaction-service.js';
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
  return { db, store: createBrainStore({ db }) };
};

describe('Argus Brain storage', () => {
  it('creates traceable sessions, events, refs, nodes, and compactions', () => {
    const { store } = createStore();

    const event = store.addEvent({
      sessionId: 'session-1',
      provider: 'claude',
      projectName: 'Argus',
      eventType: 'command',
      role: 'user',
      title: 'Implement Brain',
      content: 'Implement Argus Brain storage.',
      refs: [{
        refType: 'raw_text',
        refId: 'message-1',
        label: 'User command',
        content: 'Implement Argus Brain storage.',
      }],
    });
    const node = store.upsertNode({
      id: 'brain_goal_test',
      sessionId: 'session-1',
      projectName: 'Argus',
      nodeType: 'goal',
      title: 'Implement Argus Brain storage.',
      sourceEventIds: [event.id],
      refIds: event.refs.map((ref) => ref.id),
    });
    const compaction = store.addCompaction({
      sessionId: 'session-1',
      projectName: 'Argus',
      mermaid: 'flowchart TD\n  brain_goal_test["Implement Argus Brain storage"]',
      summary: 'Goal: Implement Argus Brain storage.',
      currentGoal: 'Implement Argus Brain storage.',
      nextAction: 'Wire recall.',
      sourceEventStartId: event.id,
      sourceEventEndId: event.id,
      sourceEventCount: 1,
      tokenEstimate: 24,
      refs: [event.id],
    });

    expect(event.refs).toHaveLength(1);
    expect(node.sourceEventIds).toEqual([event.id]);
    expect(compaction.refs).toEqual([event.id]);
    expect(store.getLatestCompaction({ sessionId: 'session-1' })?.id).toBe(compaction.id);

    const diagnostics = store.getDiagnostics({ sessionId: 'session-1', projectName: 'Argus' });
    expect(diagnostics.session.eventCount).toBe(1);
    expect(diagnostics.refs[0]).toMatchObject({ refType: 'raw_text', content: '' });
    expect(store.clearSession({ sessionId: 'session-1' }).deleted).toBeGreaterThan(0);
    expect(store.getDiagnostics({ sessionId: 'session-1' }).session).toBeFalsy();
  });

  it('prunes old raw refs without deleting the latest canvas', () => {
    const { store } = createStore();
    for (let index = 0; index < 4; index += 1) {
      store.addEvent({
        sessionId: 'session-2',
        projectName: 'Argus',
        eventType: 'tool_result',
        title: `Tool result ${index}`,
        content: 'x'.repeat(100),
        refs: [{
          refType: 'raw_text',
          refId: `tool-${index}`,
          label: `Tool result ${index}`,
          content: 'x'.repeat(100),
        }],
      });
    }
    store.addCompaction({
      sessionId: 'session-2',
      projectName: 'Argus',
      mermaid: 'flowchart TD\n  a["Latest"]',
      summary: 'Latest summary',
      currentGoal: 'Keep latest summary',
    });

    const result = store.pruneRetention({
      sessionId: 'session-2',
      projectName: 'Argus',
      perSessionMaxEvents: 2,
      rawRefsMaxSizeBytes: 120,
    });

    expect(result.prunedRefs).toBeGreaterThan(0);
    expect(result.prunedEvents).toBeGreaterThan(0);
    expect(store.getLatestCompaction({ sessionId: 'session-2' })?.currentGoal).toBe('Keep latest summary');
  });
});

describe('Argus Brain capture', () => {
  it('captures command, runtime, checkpoint events and redacts sensitive data', () => {
    const { store } = createStore();
    const warnings = [];
    const capture = createBrainCaptureService({
      store,
      logger: { warn: (...args) => warnings.push(args.join(' ')) },
    });

    const redacted = redactBrainPayload({
      authToken: 'abc',
      nested: { apiKey: 'secret', content: 'Authorization bearer abc' },
    });
    expect(redacted).toEqual({
      authToken: '[redacted]',
      nested: { apiKey: '[redacted]', content: '[redacted]' },
    });

    const data = {
      command: 'Implement Brain capture',
      type: 'claude-command',
      options: {
        sessionId: 'capture-1',
        projectPath: 'C:/work/Argus',
        clientMessageId: 'msg-1',
        permissionPresetSnapshot: { id: 'acceptEdits' },
      },
    };
    const command = capture.captureCommand(data, 'claude', { enabled: true, captureRawRefs: true });
    const runtime = capture.captureRuntimeEvents({
      data,
      provider: 'claude',
      config: { enabled: true, captureRawRefs: true },
      events: [{ kind: 'tool_result', toolName: 'Read', content: 'Read src/index.js' }],
    });
    const checkpoint = capture.captureCheckpoint({
      data,
      provider: 'claude',
      config: { enabled: true, captureRawRefs: true },
      checkpoint: {
        id: 'checkpoint-1',
        sessionId: 'capture-1',
        patch: 'diff --git a/file b/file',
        files: [{ path: 'file', status: 'modified' }],
      },
    });

    expect(warnings).toEqual([]);
    expect(command.eventType).toBe('command');
    expect(runtime).toHaveLength(1);
    expect(checkpoint.checkpointId).toBe('checkpoint-1');
    expect(store.getDiagnostics({ sessionId: 'capture-1' }).session.eventCount).toBe(3);
  });

  it('does not block when capture storage fails', () => {
    const warnings = [];
    const capture = createBrainCaptureService({
      store: {
        addEvent() {
          throw new Error('storage unavailable');
        },
      },
      logger: { warn: (...args) => warnings.push(args.join(' ')) },
    });

    expect(capture.captureCommand({
      command: 'hello',
      options: { sessionId: 'capture-fail' },
    }, 'claude', { enabled: true })).toBeNull();
    expect(warnings.join('\n')).toContain('storage unavailable');
  });
});

describe('Argus Brain compaction and recall', () => {
  it('compacts events into a stable Mermaid task canvas with source refs', () => {
    const { store } = createStore();
    store.addEvent({
      sessionId: 'compact-1',
      projectName: 'Argus',
      eventType: 'command',
      title: 'Implement Argus Brain',
      content: 'Implement Argus Brain and remove legacy runtime.',
    });
    store.addEvent({
      sessionId: 'compact-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Changed storage schema',
      content: 'Changed storage schema',
    });
    store.addEvent({
      sessionId: 'compact-1',
      projectName: 'Argus',
      eventType: 'error',
      title: 'Risk: typecheck failed',
      content: 'typecheck failed on diagnostics panel',
    });
    store.addEvent({
      sessionId: 'compact-1',
      projectName: 'Argus',
      eventType: 'assistant_summary',
      title: 'Next',
      content: 'Fix type errors and rerun targeted Vitest.',
    });

    const compaction = createBrainCompactionService({ store }).compactSession({
      sessionId: 'compact-1',
      projectName: 'Argus',
      config: { enabled: true, compactEventThreshold: 99, compactTextThreshold: 999999 },
      force: true,
    });

    expect(compaction.mermaid).toContain('flowchart TD');
    expect(compaction.mermaid).toContain('brain_goal_');
    expect(compaction.currentGoal).toContain('Implement Argus Brain');
    expect(compaction.openRisks[0]).toContain('typecheck failed');
    expect(compaction.refs).toHaveLength(4);
  });

  it('injects short Brain recall context and skips raw logs', async () => {
    const { store } = createStore();
    store.addCompaction({
      sessionId: 'recall-1',
      projectName: 'Argus',
      mermaid: 'flowchart TD\n  brain_goal_x["Implement Brain"]',
      summary: 'Goal: Implement Brain',
      currentGoal: 'Implement Brain',
      activeDecisions: ['Use local SQLite storage'],
      openRisks: ['Typecheck can fail on UI contracts'],
      nextAction: 'Run targeted tests',
      refs: ['brain_event_1'],
      sourceEventCount: 7,
    });
    store.upsertNode({
      id: 'brain_decision_project',
      sessionId: 'recall-1',
      projectName: 'Argus',
      nodeType: 'decision',
      title: 'Use local SQLite storage',
      summary: 'Use local SQLite storage',
      refIds: ['raw-secret-log'],
    });

    const recall = createBrainRecallService({
      store,
      readConfig: async () => ({ enabled: true, maxInjectedTokens: 500 }),
    });
    const result = await recall.applyToChatCommand({
      command: 'continue Brain work',
      type: 'claude-command',
      options: { sessionId: 'recall-1', projectName: 'Argus', appendSystemPrompt: 'Existing prompt' },
    }, 'claude');

    expect(result.options.appendSystemPrompt).toContain('Existing prompt');
    expect(result.options.appendSystemPrompt).toContain('## Argus Brain Context');
    expect(result.options.appendSystemPrompt).toContain('Verify current files, code, settings, and runtime results');
    expect(result.options.appendSystemPrompt).toContain('```mermaid');
    expect(result.options.appendSystemPrompt).not.toContain('raw secret');
    expect(result.options.runtimeDiagnostics.brainRuntime.recall.status).toBe('injected');
  });

  it('skips prompt injection when Brain is disabled', async () => {
    const { store } = createStore();
    const recall = createBrainRecallService({
      store,
      readConfig: async () => ({ enabled: false }),
    });
    const result = await recall.applyToChatCommand({
      command: 'hello',
      options: { sessionId: 'disabled-1', appendSystemPrompt: 'Existing prompt' },
    }, 'claude');

    expect(result.options.appendSystemPrompt).toBe('Existing prompt');
    expect(result.options.runtimeDiagnostics.brainRuntime.recall.status).toBe('disabled');
  });
});
