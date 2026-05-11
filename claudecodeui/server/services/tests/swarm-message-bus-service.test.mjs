import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createSwarmStore } from '../swarm-store-service.js';
import { createSwarmMessageBus } from '../swarm-message-bus-service.js';

describe('swarm-message-bus-service', () => {
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
    return { store, bus };
  }

  it('publishes direct, topic, and broadcast messages with idempotency and events', () => {
    const { store, bus } = createHarness();
    store.createRun({ id: 'run-1', templateId: 'review-swarm', status: 'running' });

    const first = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-1',
      type: 'assignment',
      payload: { file: 'auth.ts' },
      idempotencyKey: 'assign-auth',
    });
    const duplicate = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-1',
      type: 'assignment',
      payload: { file: 'auth.ts' },
      idempotencyKey: 'assign-auth',
    });
    const topic = bus.publish({
      runId: 'run-1',
      fromAgentId: 'reviewer-1',
      topic: 'review.findings',
      type: 'finding',
      payload: { severity: 'high' },
    });
    const broadcast = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      topic: '*',
      type: 'broadcast',
      payload: { message: 'sync' },
    });

    expect(duplicate.id).toBe(first.id);
    expect([first.status, topic.status, broadcast.status]).toEqual(['published', 'published', 'published']);
    expect([first.deliveryMode, topic.deliveryMode, broadcast.deliveryMode]).toEqual(['direct', 'topic', 'broadcast']);
    expect([first.nextAttemptAt, topic.nextAttemptAt, broadcast.nextAttemptAt]).toEqual([1000, 1000, 1000]);
    expect(store.listMessages('run-1')).toHaveLength(3);
    expect(store.listEvents('run-1').map((event) => event.type)).toEqual([
      'swarm_run_created',
      'swarm_message_published',
      'swarm_message_published',
      'swarm_message_published',
    ]);
  });

  it('delivers, acknowledges, expires, retries, and dead-letters messages', () => {
    let clock = 1000;
    const db = new Database(':memory:');
    dbs.push(db);
    const store = createSwarmStore(db);
    store.initialize();
    const bus = createSwarmMessageBus({ store, now: () => clock });
    store.createRun({ id: 'run-1', templateId: 'review-swarm', status: 'running' });

    const message = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-1',
      type: 'assignment',
      payload: { file: 'auth.ts' },
      ttlMs: 500,
      retryLimit: 1,
    });

    bus.deliver(message.id, 'reviewer-1');
    bus.ack(message.id, 'reviewer-1');
    expect(store.getMessage(message.id)).toMatchObject({ status: 'acknowledged', ackedBy: 'reviewer-1' });
    expect(store.listDeliveryTrace(message.id).map((entry) => entry.status)).toEqual([
      'published',
      'delivered',
      'acknowledged',
    ]);

    const expiring = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-2',
      type: 'assignment',
      payload: { file: 'billing.ts' },
      ttlMs: 100,
      retryLimit: 1,
    });
    clock = 1200;
    expect(bus.expireDue('run-1').map((entry) => entry.id)).toEqual([expiring.id]);
    expect(store.getMessage(expiring.id)).toMatchObject({ status: 'expired' });

    const retrying = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-3',
      type: 'assignment',
      payload: { file: 'payments.ts' },
      retryLimit: 1,
    });
    bus.failDelivery(retrying.id, 'network');
    expect(store.getMessage(retrying.id)).toMatchObject({
      status: 'retry_scheduled',
      attempts: 1,
      deliveryAttempts: 1,
      nextAttemptAt: 3200,
      lastDeliveryError: 'network',
    });
    expect(store.listDeliverableMessages('run-1', 3199).map((entry) => entry.id)).not.toContain(retrying.id);
    expect(store.listDeliverableMessages('run-1', 3200).map((entry) => entry.id)).toContain(retrying.id);
    bus.failDelivery(retrying.id, 'network again');
    expect(store.getMessage(retrying.id)).toMatchObject({
      status: 'dead_lettered',
      attempts: 2,
      nextAttemptAt: null,
      lastDeliveryError: 'network again',
    });

    const replayed = bus.replayDeadLetter(retrying.id);
    expect(replayed).toMatchObject({ status: 'published', attempts: 0, nextAttemptAt: 1200, lastDeliveryError: '' });
    expect(store.listDeliveryTrace(retrying.id).map((entry) => entry.status)).toEqual([
      'published',
      'failed',
      'retry_scheduled',
      'failed',
      'dead_lettered',
      'replayed',
    ]);

    expect(store.listEvents('run-1').map((event) => event.type)).toContain('swarm_message_dead_lettered');
  });

  it('replays dead-letter messages in batches and leaves acknowledged messages untouched', () => {
    const { store, bus } = createHarness();
    store.createRun({ id: 'run-1', templateId: 'review-swarm', status: 'running' });
    const dead = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-1',
      type: 'assignment',
      payload: { file: 'auth.ts' },
      retryLimit: 0,
    });
    const acknowledged = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-2',
      type: 'assignment',
      payload: { file: 'billing.ts' },
    });
    bus.failDelivery(dead.id, 'offline');
    bus.deliver(acknowledged.id, 'reviewer-2');
    bus.ack(acknowledged.id, 'reviewer-2');

    const replayed = bus.replayMessages({ runId: 'run-1', statusFilter: 'dead_lettered' });

    expect(replayed.map((message) => message.id)).toEqual([dead.id]);
    expect(store.getMessage(dead.id)).toMatchObject({ status: 'published', attempts: 0 });
    expect(store.getMessage(acknowledged.id)).toMatchObject({ status: 'acknowledged' });
  });

  it('scopes delivery trace reads to the owning run when a run id is provided', () => {
    const { store, bus } = createHarness();
    store.createRun({ id: 'run-1', templateId: 'review-swarm', status: 'running' });
    store.createRun({ id: 'run-2', templateId: 'other-swarm', status: 'running' });
    const message = bus.publish({
      runId: 'run-1',
      fromAgentId: 'queen',
      toAgentId: 'reviewer-1',
      type: 'assignment',
      payload: { file: 'auth.ts' },
    });

    expect(store.listDeliveryTrace(message.id, 'run-2')).toEqual([]);
    expect(store.listDeliveryTrace(message.id, 'run-1').map((entry) => entry.status)).toEqual(['published']);
  });
});
