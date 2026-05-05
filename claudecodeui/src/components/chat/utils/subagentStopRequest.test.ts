import { describe, expect, it } from 'vitest';

import type { SubagentActivitySummary } from '../types/types';
import { buildSubagentStopRequest } from './subagentStopRequest';

const activity: SubagentActivitySummary = {
  total: 2,
  running: 2,
  completed: 1,
  outputting: 0,
  items: [
    {
      taskId: 'task-one',
      label: 'First worker',
      status: 'running',
      runtimeStatus: 'RUNNING',
      terminal: false,
    },
    {
      taskId: 'task-two',
      label: 'Second worker',
      status: 'running',
      runtimeStatus: 'RUNNING',
      terminal: false,
    },
  ],
  historyItems: [
    {
      taskId: 'task-done',
      label: 'Done worker',
      status: 'completed',
      runtimeStatus: 'DONE',
      terminal: true,
    },
  ],
};

describe('buildSubagentStopRequest', () => {
  it('builds a canonical single-agent stop message', () => {
    const request = buildSubagentStopRequest({
      taskIds: ['task-two'],
      activity,
      sessionId: 'session-1',
      provider: 'mtl-code',
    });

    expect(request).toEqual({
      type: 'claude-stop-tasks',
      sessionId: 'session-1',
      provider: 'mtl-code',
      taskIds: ['task-two'],
    });
  });

  it('builds a stop-all message from currently active agents only', () => {
    const request = buildSubagentStopRequest({
      activity,
      sessionId: 'session-1',
      provider: 'mtl-code',
    });

    expect(request?.taskIds).toEqual(['task-one', 'task-two']);
  });

  it('returns null without a real session or task ids', () => {
    expect(buildSubagentStopRequest({
      activity,
      sessionId: null,
      provider: 'mtl-code',
    })).toBeNull();

    expect(buildSubagentStopRequest({
      activity: { ...activity, items: [] },
      sessionId: 'session-1',
      provider: 'mtl-code',
    })).toBeNull();
  });
});
