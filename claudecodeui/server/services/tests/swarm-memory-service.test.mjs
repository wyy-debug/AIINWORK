import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createSwarmStore } from '../swarm-store-service.js';
import { createSwarmMemoryStore } from '../swarm-memory-service.js';

describe('swarm-memory-service', () => {
  const dbs = [];

  afterEach(() => {
    while (dbs.length) dbs.pop().close();
  });

  it('stores run-scoped memory and promotes explicit snapshots into examples', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    const store = createSwarmStore(db);
    store.initialize();
    store.createRun({ id: 'run-1', templateId: 'review-swarm', status: 'running' });
    const memory = createSwarmMemoryStore({ store, now: () => 1000 });

    memory.record({
      runId: 'run-1',
      agentId: 'reviewer-1',
      scope: 'facts',
      title: 'Auth entrypoint',
      content: 'Login validation lives in auth.ts',
    });
    memory.record({
      runId: 'run-1',
      agentId: 'queen',
      scope: 'decisions',
      title: 'Review strategy',
      content: 'Prioritize auth and payments',
    });

    expect(memory.list('run-1').map((entry) => entry.scope)).toEqual(['facts', 'decisions']);
    expect(memory.promoteToExamples({ runId: 'run-1' })).toEqual([
      {
        title: 'Auth entrypoint',
        transcript: [{ role: 'system', content: 'Login validation lives in auth.ts' }],
      },
      {
        title: 'Review strategy',
        transcript: [{ role: 'system', content: 'Prioritize auth and payments' }],
      },
    ]);
  });

  it('updates, deletes, exports, and promotes only reviewed memory entries', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    const store = createSwarmStore(db);
    store.initialize();
    store.createRun({ id: 'run-1', templateId: 'review-swarm', status: 'running' });
    const memory = createSwarmMemoryStore({ store });

    const fact = memory.record({
      runId: 'run-1',
      agentId: 'reviewer-1',
      scope: 'facts',
      title: 'Auth entrypoint',
      content: 'Login validation lives in auth.ts',
    });
    const decision = memory.record({
      runId: 'run-1',
      agentId: 'queen',
      scope: 'decisions',
      title: 'Do not promote automatically',
      content: 'This should stay run scoped',
    });

    expect(memory.update(fact.id, { title: 'Auth module', promoteable: false })).toMatchObject({
      id: fact.id,
      title: 'Auth module',
      promoteable: false,
    });
    expect(memory.exportRun('run-1')).toMatchObject({
      runId: 'run-1',
      memory: [
        expect.objectContaining({ id: fact.id, title: 'Auth module' }),
        expect.objectContaining({ id: decision.id }),
      ],
    });
    expect(memory.promoteReviewedToExamples({ runId: 'run-1', memoryIds: [fact.id, decision.id] })).toEqual([
      {
        title: 'Do not promote automatically',
        transcript: [{ role: 'system', content: 'This should stay run scoped' }],
      },
    ]);
    expect(memory.delete(fact.id)).toEqual({ success: true, memoryId: fact.id });
    expect(memory.list('run-1').map((entry) => entry.id)).toEqual([decision.id]);
  });
});
