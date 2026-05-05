import { describe, expect, it } from 'vitest';

import type { SubagentActivitySummary } from '../types/types';
import { buildSubagentDetailRows } from './subagentDetailRows';

describe('buildSubagentDetailRows', () => {
  const summary: SubagentActivitySummary = {
    total: 1,
    running: 1,
    completed: 2,
    outputting: 0,
    items: [
      {
        taskId: 'running-1',
        label: 'Fetch crash page',
        status: 'running',
        runtimeStatus: 'RUNNING',
        objective: 'Fetch crash page',
        currentStep: 2,
        maxSteps: 15,
        lastTool: 'Browser',
        terminal: false,
      },
    ],
    historyItems: [
      {
        taskId: 'blocked-1',
        label: 'Read protected page',
        status: 'blocked',
        runtimeStatus: 'BLOCKED',
        objective: 'Read protected page',
        stopReason: '401 login required',
        evidence: 'Request returned 401.',
        nextAction: 'Ask user to log in.',
        terminal: true,
      },
      {
        taskId: 'running-1',
        label: 'Fetch crash page',
        status: 'running',
        runtimeStatus: 'RUNNING',
        objective: 'Fetch crash page',
        currentStep: 2,
        maxSteps: 15,
        lastTool: 'Browser',
        terminal: false,
      },
    ],
  };

  it('builds active detail rows with stop affordances', () => {
    const rows = buildSubagentDetailRows(summary, { mode: 'active' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: 'running-1',
      label: 'Fetch crash page',
      statusLabel: '运行中',
      canStop: true,
      canReuse: false,
    });
    expect(rows[0]?.meta).toContain('2/15');
    expect(rows[0]?.meta).toContain('Browser');
  });

  it('builds manager rows with blocked guidance and evidence text', () => {
    const rows = buildSubagentDetailRows(summary, { mode: 'history' });
    const blocked = rows.find((row) => row.taskId === 'blocked-1');

    expect(blocked).toMatchObject({
      statusLabel: '已阻塞',
      canStop: false,
      canReuse: true,
    });
    expect(blocked?.guidance?.title).toBe('需要登录或提供导出数据');
    expect(blocked?.evidenceText).toContain('Request returned 401.');
    expect(blocked?.evidenceText).toContain('Ask user to log in.');
  });
});
