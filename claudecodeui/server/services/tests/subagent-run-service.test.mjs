import { describe, expect, test } from 'vitest';

import {
  createSubagentRunStore,
  resolveTaskPermission,
} from '../subagent-run-service.js';

describe('subagent run service', () => {
  test('resolves task permissions with last matching pattern winning', () => {
    expect(resolveTaskPermission({ '*': 'deny', 'review*': 'ask', reviewer: 'allow' }, 'reviewer')).toBe('allow');
    expect(resolveTaskPermission({ '*': 'deny', 'review*': 'ask' }, 'reviewer')).toBe('ask');
    expect(resolveTaskPermission({ '*': 'deny' }, 'explore')).toBe('deny');
    expect(resolveTaskPermission('allow', 'explore')).toBe('allow');
  });

  test('creates, lists, reads, and controls subagent runs', async () => {
    const store = createSubagentRunStore({ persist: false, now: () => 123 });
    const run = await store.createRun({
      agent: { id: 'explore', name: 'Explore', mode: 'subagent' },
      objective: 'Map the codebase',
      projectPath: 'E:/AIINWORK',
      sessionId: 'session-1',
      source: 'manual',
    });

    expect(run.agentId).toBe('explore');
    expect(run.status).toBe('running');
    expect(run.objective).toBe('Map the codebase');
    expect(store.listRuns()[0].id).toBe(run.id);
    expect(store.getRun(run.id).events[0].type).toBe('subagent_run_created');

    const stopped = await store.controlRun(run.id, { action: 'stop' });
    expect(stopped.status).toBe('stopped');
    expect(stopped.events.at(-1).type).toBe('subagent_run_stopped');
  });
});
