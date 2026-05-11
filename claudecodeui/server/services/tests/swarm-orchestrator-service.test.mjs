import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSwarmStore } from '../swarm-store-service.js';
import { createSwarmMessageBus } from '../swarm-message-bus-service.js';
import { createSwarmOrchestrator } from '../swarm-orchestrator-service.js';
import { normalizeSwarmTemplateManifest } from '../swarm-template-manifest-service.js';

describe('swarm-orchestrator-service', () => {
  const dbs = [];

  afterEach(() => {
    while (dbs.length) dbs.pop().close();
  });

  function createHarness() {
    const db = new Database(':memory:');
    dbs.push(db);
    const store = createSwarmStore(db);
    store.initialize();
    const bus = createSwarmMessageBus({ store, now: () => 1000 });
    const runtimeAdapter = {
      spawnAgent: vi.fn(async ({ role, objective }) => ({
        taskId: `task-${role.id}`,
        threadId: `thread-${role.id}`,
        objective,
        coordinatorSessionId: 'coordinator-session',
        mode: 'coordinator-subagents',
      })),
      controlAgent: vi.fn(async () => ({ success: true, mode: 'direct' })),
      deliverMessage: vi.fn(async () => ({ success: true, mode: 'direct' })),
      stopCoordinator: vi.fn(async () => ({ success: true, mode: 'direct', sessionId: 'coordinator-session' })),
      reconcileRun: vi.fn(async () => ({ coordinatorSessionId: 'coordinator-session' })),
    };
    const orchestrator = createSwarmOrchestrator({ store, bus, runtimeAdapter, now: () => 1000 });
    return { store, bus, runtimeAdapter, orchestrator };
  }

  const template = normalizeSwarmTemplateManifest({
    id: 'review-swarm',
    kind: 'swarm-template',
    topology: {
      type: 'queen',
      coordinatorRoleId: 'queen',
      edges: [{ from: 'queen', to: 'reviewer', topic: 'review.assignments' }],
    },
    roles: [
      { id: 'queen', agentTemplateId: 'review-queen' },
      { id: 'reviewer', agentTemplateId: 'security-reviewer', count: 2 },
    ],
    policies: { maxAgents: 4 },
  });

  it('creates a swarm run, materializes role agents, and records lifecycle events', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();

    const run = await orchestrator.startRun({
      template,
      objective: 'Review the auth refactor',
      sessionId: 'parent-session',
      projectPath: 'E:/repo',
      launchAnswers: { objective: 'auth refactor' },
    });

    expect(run).toMatchObject({
      templateId: 'review-swarm',
      status: 'running',
      runtimeStatus: 'running',
      objective: 'Review the auth refactor',
      runtimeMode: 'coordinator-subagents',
      coordinatorSessionId: 'coordinator-session',
    });
    expect(runtimeAdapter.spawnAgent).toHaveBeenCalledTimes(3);
    expect(store.getRunSnapshot(run.id).agents.map((agent) => agent.roleId)).toEqual([
      'queen',
      'reviewer',
      'reviewer',
    ]);
    expect(store.getRunSnapshot(run.id).agents[0]).toMatchObject({
      runtimeMode: 'coordinator-subagents',
      runtimeStatus: 'running',
      taskId: 'task-queen',
      threadId: 'thread-queen',
    });
    expect(store.listEvents(run.id).map((event) => event.type)).toEqual([
      'swarm_run_created',
      'swarm_coordinator_started',
      'swarm_agent_spawn_requested',
      'swarm_agent_spawn_mapped',
      'swarm_agent_started',
      'swarm_agent_spawn_requested',
      'swarm_agent_spawn_mapped',
      'swarm_agent_started',
      'swarm_agent_spawn_requested',
      'swarm_agent_spawn_mapped',
      'swarm_agent_started',
    ]);
  });

  it('can return a background swarm run before runtime spawning settles', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();
    const singleRoleTemplate = normalizeSwarmTemplateManifest({
      id: 'single-review-swarm',
      kind: 'swarm-template',
      topology: { type: 'mesh' },
      roles: [{ id: 'reviewer', agentTemplateId: 'security-reviewer' }],
    });
    let releaseSpawn;
    runtimeAdapter.spawnAgent.mockImplementation(() => new Promise((resolve) => {
      releaseSpawn = () => resolve({
        taskId: 'task-delayed',
        threadId: 'thread-delayed',
        coordinatorSessionId: 'coordinator-session',
        mode: 'coordinator-subagents',
      });
    }));

    const runPromise = orchestrator.startRun({
      template: singleRoleTemplate,
      objective: 'Review auth',
      sessionId: 'parent-session',
      background: true,
    });
    const race = await Promise.race([
      runPromise.then((run) => ({ settled: true, run })),
      new Promise((resolve) => setTimeout(() => resolve({ settled: false }), 20)),
    ]);

    expect(race.settled).toBe(true);
    expect(race.run).toMatchObject({ status: 'running', runtimeStatus: 'spawning' });
    expect(race.run.agents.every((agent) => agent.status === 'queued')).toBe(true);
    await vi.waitUntil(() => typeof releaseSpawn === 'function');
    releaseSpawn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getRunSnapshot(race.run.id).agents[0]).toMatchObject({
      status: 'running',
      taskId: 'task-delayed',
    });
  });

  it('publishes messages immediately and lets the worker acknowledge successful deliveries', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();
    const run = await orchestrator.startRun({ template, objective: 'Review auth', sessionId: 'parent-session' });
    const reviewer = store.getRunSnapshot(run.id).agents.find((agent) => agent.roleId === 'reviewer');

    const message = await orchestrator.sendMessage({
      runId: run.id,
      fromAgentId: 'queen',
      toAgentId: reviewer.id,
      type: 'assignment',
      payload: { file: 'auth.ts' },
    });

    expect(message).toMatchObject({ status: 'published', toAgentId: reviewer.id, nextAttemptAt: 1000 });
    expect(runtimeAdapter.deliverMessage).not.toHaveBeenCalled();

    const delivery = await orchestrator.processDeliveryQueue(run.id);

    expect(delivery).toMatchObject({ processed: 1, acknowledged: 1, failed: 0 });
    expect(store.getMessage(message.id)).toMatchObject({ status: 'acknowledged', toAgentId: reviewer.id });
    expect(runtimeAdapter.deliverMessage).toHaveBeenCalledWith(expect.objectContaining({
      agent: expect.objectContaining({ id: reviewer.id, taskId: reviewer.taskId }),
      message: expect.objectContaining({ id: message.id }),
    }));
    expect(store.listEvents(run.id).map((event) => event.type)).toContain('swarm_message_published');
    expect(store.listEvents(run.id).map((event) => event.type)).toContain('swarm_message_acknowledged');
  });

  it('marks partial spawn failures as degraded while keeping mapped agents running', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();
    runtimeAdapter.spawnAgent.mockImplementation(async ({ role, roleIndex }) => {
      if (role.id === 'reviewer' && roleIndex === 1) {
        return {
          status: 'failed',
          error: 'spawn timeout',
          coordinatorSessionId: 'coordinator-session',
          mode: 'coordinator-subagents',
        };
      }
      return {
        taskId: `task-${role.id}-${roleIndex}`,
        threadId: `thread-${role.id}-${roleIndex}`,
        coordinatorSessionId: 'coordinator-session',
        mode: 'coordinator-subagents',
      };
    });

    const run = await orchestrator.startRun({ template, objective: 'Review auth', sessionId: 'parent-session' });
    const snapshot = store.getRunSnapshot(run.id);

    expect(snapshot).toMatchObject({ status: 'running', runtimeStatus: 'degraded' });
    expect(snapshot.agents.filter((agent) => agent.status === 'running')).toHaveLength(2);
    expect(snapshot.agents.find((agent) => agent.status === 'failed')).toMatchObject({
      runtimeStatus: 'failed',
      lastSpawnError: 'spawn timeout',
    });
    expect(store.listEvents(run.id).map((event) => event.type)).toContain('swarm_agent_spawn_failed');
  });

  it('cancels a run by stopping all mapped role agents', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();
    const run = await orchestrator.startRun({ template, objective: 'Review auth', sessionId: 'parent-session' });

    const control = await orchestrator.controlRun({ runId: run.id, action: 'cancel' });
    const snapshot = store.getRunSnapshot(run.id);

    expect(control).toMatchObject({ success: true, action: 'cancel', stoppedAgents: 3 });
    expect(runtimeAdapter.controlAgent).toHaveBeenCalledTimes(3);
    expect(runtimeAdapter.stopCoordinator).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({ id: run.id, coordinatorSessionId: 'coordinator-session' }),
    }));
    expect(snapshot).toMatchObject({ status: 'cancelled', runtimeStatus: 'cancelled' });
    expect(snapshot.agents.every((agent) => agent.status === 'cancelled')).toBe(true);
    expect(snapshot.agents[0].lastControl).toMatchObject({ action: 'stop', success: true });
  });

  it('reconciles persisted mappings and marks uncertain active agents as degraded', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();
    const run = await orchestrator.startRun({ template, objective: 'Review auth', sessionId: 'parent-session' });
    const reviewer = store.getRunSnapshot(run.id).agents.find((agent) => agent.roleId === 'reviewer');
    runtimeAdapter.reconcileRun.mockResolvedValue({
      coordinatorSessionId: 'coordinator-session-recovered',
      mappings: new Map([[`${reviewer.roleId}:${reviewer.roleIndex}`, {
        roleId: reviewer.roleId,
        roleIndex: reviewer.roleIndex,
        taskId: 'task-recovered',
        threadId: 'thread-recovered',
      }]]),
    });
    store.upsertAgent({
      ...reviewer,
      status: 'running',
      taskId: '',
      threadId: '',
      metadata: { ...reviewer.metadata, runtimeStatus: 'running' },
    });

    const control = await orchestrator.controlRun({ runId: run.id, action: 'reconcile-run' });
    const snapshot = store.getRunSnapshot(run.id);

    expect(control).toMatchObject({ success: true, action: 'reconcile-run', recoveredAgents: 1, degradedAgents: 0 });
    expect(snapshot).toMatchObject({ status: 'running', runtimeStatus: 'running', coordinatorSessionId: 'coordinator-session-recovered' });
    expect(snapshot.agents.find((agent) => agent.id === reviewer.id)).toMatchObject({
      status: 'running',
      runtimeStatus: 'running',
      taskId: 'task-recovered',
      threadId: 'thread-recovered',
    });
    expect(snapshot.agents.filter((agent) => agent.taskId).every((agent) => agent.status === 'running')).toBe(true);
  });

  it('retries a failed role spawn without restarting successful agents', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();
    runtimeAdapter.spawnAgent.mockImplementation(async ({ role, roleIndex }) => {
      if (role.id === 'reviewer' && roleIndex === 1 && runtimeAdapter.spawnAgent.mock.calls.length <= 3) {
        return { status: 'failed', error: 'first spawn failed', coordinatorSessionId: 'coordinator-session', mode: 'coordinator-subagents' };
      }
      return {
        taskId: `task-${role.id}-${roleIndex}-retry`,
        threadId: `thread-${role.id}-${roleIndex}-retry`,
        coordinatorSessionId: 'coordinator-session',
        mode: 'coordinator-subagents',
      };
    });
    const run = await orchestrator.startRun({ template, objective: 'Review auth', sessionId: 'parent-session' });
    const failed = store.getRunSnapshot(run.id).agents.find((agent) => agent.status === 'failed');

    const retry = await orchestrator.controlRun({ runId: run.id, action: 'retry-agent-spawn', agentId: failed.id });

    expect(retry).toMatchObject({ success: true, action: 'retry-agent-spawn', agentId: failed.id });
    expect(runtimeAdapter.spawnAgent).toHaveBeenCalledTimes(4);
    expect(store.getAgent(failed.id)).toMatchObject({
      status: 'running',
      taskId: 'task-reviewer-1-retry',
      threadId: 'thread-reviewer-1-retry',
      metadata: expect.objectContaining({ spawnRetryCount: 1 }),
    });
  });

  it('controls agents through the runtime adapter and records control events', async () => {
    const { store, runtimeAdapter, orchestrator } = createHarness();
    const run = await orchestrator.startRun({ template, objective: 'Review auth', sessionId: 'parent-session' });
    const reviewer = store.getRunSnapshot(run.id).agents.find((agent) => agent.roleId === 'reviewer');

    const control = await orchestrator.controlRun({
      runId: run.id,
      action: 'wait-agent',
      agentId: reviewer.id,
    });

    expect(control).toMatchObject({ success: true, action: 'wait-agent' });
    expect(runtimeAdapter.controlAgent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wait',
      taskId: reviewer.taskId,
      run: expect.objectContaining({ id: run.id }),
    }));
    expect(store.getAgent(reviewer.id).lastControl).toMatchObject({ success: true, mode: 'direct' });
    expect(store.getAgent(reviewer.id).lastWaitResult).toMatchObject({ success: true, mode: 'direct' });
    const acceptedEvent = store.listEvents(run.id).find((event) => event.type === 'swarm_agent_control_accepted');
    expect(acceptedEvent.payload).toMatchObject({
      action: 'wait-agent',
      agentId: reviewer.id,
      taskId: reviewer.taskId,
      threadId: reviewer.threadId,
      mode: 'direct',
      success: true,
      timestamp: 1000,
    });
  });

  it('scopes memory updates and deletes to the requested run', async () => {
    const { store, orchestrator } = createHarness();
    const run = await orchestrator.startRun({ template, objective: 'Review auth', sessionId: 'parent-session' });
    store.createRun({ id: 'run-other', templateId: 'review-swarm', status: 'running' });
    const memory = orchestrator.recordMemory({
      runId: run.id,
      scope: 'facts',
      title: 'Finding',
      content: 'Auth issue',
    });

    expect(orchestrator.updateMemory({
      runId: 'run-other',
      memoryId: memory.id,
      patch: { title: 'Tampered' },
    })).toBeNull();
    expect(store.getMemory(memory.id)).toMatchObject({ title: 'Finding' });

    expect(orchestrator.deleteMemory({ runId: 'run-other', memoryId: memory.id })).toMatchObject({ success: false });
    expect(store.getMemory(memory.id)).toMatchObject({ title: 'Finding' });

    expect(orchestrator.updateMemory({
      runId: run.id,
      memoryId: memory.id,
      patch: { title: 'Updated' },
    })).toMatchObject({ title: 'Updated' });
    expect(orchestrator.deleteMemory({ runId: run.id, memoryId: memory.id })).toMatchObject({ success: true });
  });

  it('keeps local-control-plane runs on the local adapter path', async () => {
    const { runtimeAdapter, orchestrator } = createHarness();

    const run = await orchestrator.startRun({
      template,
      objective: 'Offline dry run',
      runtimeMode: 'local-control-plane',
    });

    expect(run).toMatchObject({ runtimeMode: 'local-control-plane' });
    expect(runtimeAdapter.spawnAgent).not.toHaveBeenCalled();
    expect(run.agents[0]).toMatchObject({ runtimeMode: 'local-control-plane' });

    await orchestrator.sendMessage({
      runId: run.id,
      fromAgentId: 'operator',
      toAgentId: run.agents[0].id,
      type: 'assignment',
      payload: { message: 'dry run' },
    });

    expect(runtimeAdapter.deliverMessage).not.toHaveBeenCalled();
  });
});
