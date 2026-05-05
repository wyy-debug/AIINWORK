import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';
import { summarizeSubagentActivity } from './subagentActivity';

describe('summarizeSubagentActivity', () => {
  it('reports only running subagents in the active status bar and keeps terminal agents in history', () => {
    const messages: ChatMessage[] = [
      {
        id: 'completed',
        type: 'assistant',
        timestamp: '2026-05-05T00:00:00.000Z',
        isSubagentContainer: true,
        isToolUse: true,
        toolName: 'AgentSpawn',
        toolInput: JSON.stringify({ description: 'Completed task' }),
        subagentState: {
          taskId: 'task-done',
          childTools: [],
          currentToolIndex: -1,
          isComplete: true,
          runtimeStatus: 'DONE',
          objective: 'Completed task',
          registryRecord: {
            taskId: 'task-done',
            objective: 'Completed task',
            status: 'completed',
            runtimeStatus: 'DONE',
            resultSummary: 'Done.',
          },
        },
      },
      {
        id: 'running',
        type: 'assistant',
        timestamp: '2026-05-05T00:00:01.000Z',
        isSubagentContainer: true,
        isToolUse: true,
        toolName: 'AgentSpawn',
        toolInput: JSON.stringify({ description: 'Fetch crash page' }),
        subagentState: {
          taskId: 'task-running',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          isAsyncLaunch: true,
          runtimeStatus: 'RUNNING',
          objective: 'Fetch crash page',
          lastTool: 'Browser',
          registryRecord: {
            taskId: 'task-running',
            objective: 'Fetch crash page',
            status: 'running',
            runtimeStatus: 'RUNNING',
            lastTool: 'Browser',
          },
        },
      },
    ];

    const summary = summarizeSubagentActivity(messages);

    expect(summary.total).toBe(1);
    expect(summary.running).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.items.map((item) => item.taskId)).toEqual(['task-running']);
    expect(summary.historyItems.map((item) => item.taskId)).toEqual(['task-running', 'task-done']);
    expect(summary.activeToolLabels?.[0]).toBe('Fetch crash page · Browser');
  });
});

describe('summarizeSubagentActivity manager state details', () => {
  it('hydrates status bar details from manager records when live runtime state is sparse', () => {
    const messages: ChatMessage[] = [
      {
        id: 'running',
        type: 'assistant',
        timestamp: '2026-05-05T00:00:01.000Z',
        isSubagentContainer: true,
        isToolUse: true,
        toolName: 'AgentSpawn',
        toolInput: JSON.stringify({ description: 'Fetch private page' }),
        subagentState: {
          taskId: 'task-running',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          registryRecord: {
            taskId: 'task-running',
            objective: 'Fetch private page',
            status: 'running',
            runtimeStatus: 'RUNNING',
            currentStep: 4,
            maxSteps: 15,
            remainingSteps: 11,
            startedAt: 1000,
            updatedAt: 41_000,
            lastTool: 'Browser',
            lastToolSummary: 'HTTP 401, login required',
          },
        },
      },
    ];

    const summary = summarizeSubagentActivity(messages);

    expect(summary.currentStep).toBe(4);
    expect(summary.maxSteps).toBe(15);
    expect(summary.remainingSteps).toBe(11);
    expect(summary.elapsedMs).toBe(40_000);
    expect(summary.lastTool).toBe('Browser');
    expect(summary.lastToolSummary).toBe('HTTP 401, login required');
  });
});
