import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSwarmStore } from '../swarm-store-service.js';
import { createSwarmMessageBus } from '../swarm-message-bus-service.js';
import { createSwarmDeliveryWorker } from '../swarm-delivery-worker-service.js';

describe('swarm-delivery-worker-service', () => {
  const dbs = [];

  afterEach(() => {
    while (dbs.length) dbs.pop().close();
  });

  function createHarness() {
    let clock = 1000;
    const db = new Database(':memory:');
    dbs.push(db);
    const store = createSwarmStore(db, { now: () => clock });
    store.initialize();
    const bus = createSwarmMessageBus({ store, now: () => clock });
    const runtimeAdapter = {
      deliverMessage: vi.fn(async () => ({ success: true, mode: 'direct' })),
    };
    const worker = createSwarmDeliveryWorker({
      store,
      bus,
      runtimeAdapterResolver: () => runtimeAdapter,
      now: () => clock,
    });
    const setClock = (value) => {
      clock = value;
    };
    return { store, bus, runtimeAdapter, worker, setClock };
  }

  function createRunWithAgents(store) {
    store.createRun({
      id: 'run-1',
      templateId: 'review-swarm',
      status: 'running',
      template: {
        routing: {
          topics: [
            { name: 'review.assignments', subscribers: ['reviewer'] },
          ],
        },
      },
    });
    const queen = store.upsertAgent({
      id: 'agent-queen',
      runId: 'run-1',
      roleId: 'queen',
      roleIndex: 0,
      label: 'Queen',
      status: 'running',
      taskId: 'task-queen',
      metadata: { topics: ['coordination'] },
    });
    const reviewer = store.upsertAgent({
      id: 'agent-reviewer',
      runId: 'run-1',
      roleId: 'reviewer',
      roleIndex: 0,
      label: 'Reviewer',
      status: 'running',
      taskId: 'task-reviewer',
      metadata: { topics: ['review.assignments'] },
    });
    return { queen, reviewer };
  }

  it('delivers direct, topic, and broadcast messages from the queue', async () => {
    const { store, bus, runtimeAdapter, worker } = createHarness();
    const { queen, reviewer } = createRunWithAgents(store);

    const direct = bus.publish({
      runId: 'run-1',
      fromAgentId: queen.id,
      toAgentId: reviewer.id,
      type: 'assignment',
      payload: { file: 'auth.ts' },
    });
    const topic = bus.publish({
      runId: 'run-1',
      fromAgentId: queen.id,
      topic: 'review.assignments',
      type: 'topic_assignment',
      payload: { file: 'billing.ts' },
    });
    const broadcast = bus.publish({
      runId: 'run-1',
      fromAgentId: queen.id,
      topic: '*',
      type: 'sync',
      payload: { message: 'status' },
    });

    const result = await worker.processRun('run-1');

    expect(result).toMatchObject({ processed: 3, acknowledged: 3, failed: 0 });
    expect(store.getMessage(direct.id)).toMatchObject({ status: 'acknowledged', deliveredTo: reviewer.id, deliveryMode: 'direct' });
    expect(store.getMessage(topic.id)).toMatchObject({ status: 'acknowledged', deliveredTo: reviewer.id, deliveryMode: 'topic' });
    expect(store.getMessage(broadcast.id)).toMatchObject({ status: 'acknowledged', deliveryMode: 'broadcast' });
    expect(runtimeAdapter.deliverMessage).toHaveBeenCalledTimes(4);
  });

  it('schedules retry and dead-letters failed deliveries with fixed backoff', async () => {
    const { store, bus, runtimeAdapter, worker, setClock } = createHarness();
    const { queen, reviewer } = createRunWithAgents(store);
    runtimeAdapter.deliverMessage.mockResolvedValue({ success: false, error: 'runtime unavailable' });
    const message = bus.publish({
      runId: 'run-1',
      fromAgentId: queen.id,
      toAgentId: reviewer.id,
      type: 'assignment',
      payload: { file: 'auth.ts' },
      retryLimit: 1,
    });

    await worker.processRun('run-1');
    expect(store.getMessage(message.id)).toMatchObject({
      status: 'retry_scheduled',
      deliveryAttempts: 1,
      nextAttemptAt: 3000,
      lastDeliveryError: 'runtime unavailable',
    });

    setClock(2999);
    expect(await worker.processRun('run-1')).toMatchObject({ processed: 0 });

    setClock(3000);
    await worker.processRun('run-1');
    expect(store.getMessage(message.id)).toMatchObject({
      status: 'dead_lettered',
      deliveryAttempts: 2,
      nextAttemptAt: null,
      lastDeliveryError: 'runtime unavailable',
    });
  });

  it('does not redeliver successful broadcast targets when a later target retries', async () => {
    const { store, bus, runtimeAdapter, worker, setClock } = createHarness();
    const { queen, reviewer } = createRunWithAgents(store);
    runtimeAdapter.deliverMessage
      .mockResolvedValueOnce({ success: true, mode: 'direct' })
      .mockResolvedValueOnce({ success: false, error: 'reviewer offline' })
      .mockResolvedValueOnce({ success: true, mode: 'direct' });
    const message = bus.publish({
      runId: 'run-1',
      fromAgentId: queen.id,
      topic: '*',
      type: 'sync',
      payload: { message: 'status' },
      retryLimit: 2,
    });

    await worker.processRun('run-1');
    expect(store.getMessage(message.id)).toMatchObject({
      status: 'retry_scheduled',
      deliveryAttempts: 1,
      lastDeliveryError: 'reviewer offline',
    });

    setClock(3000);
    await worker.processRun('run-1');

    expect(runtimeAdapter.deliverMessage).toHaveBeenCalledTimes(3);
    expect(runtimeAdapter.deliverMessage.mock.calls.map(([input]) => input.agent.id)).toEqual([
      queen.id,
      reviewer.id,
      reviewer.id,
    ]);
    expect(store.getMessage(message.id)).toMatchObject({
      status: 'acknowledged',
      deliveryMode: 'broadcast',
    });
    const deliveredAgents = store.listDeliveryTrace(message.id)
      .filter((entry) => entry.status === 'delivered')
      .map((entry) => entry.agentId);
    expect(deliveredAgents.filter((agentId) => agentId === queen.id)).toHaveLength(1);
    expect(deliveredAgents.filter((agentId) => agentId === reviewer.id)).toHaveLength(2);
  });
});
