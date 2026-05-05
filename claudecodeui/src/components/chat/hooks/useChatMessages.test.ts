import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import { normalizedToChatMessages } from './useChatMessages';

const timestamp = '2026-05-05T00:00:00.000Z';

function message(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: overrides.id || `msg-${Math.random()}`,
    sessionId: 'session-1',
    timestamp,
    provider: 'claude',
    kind: 'text',
    ...overrides,
  } as NormalizedMessage;
}

describe('normalizedToChatMessages subagent handling', () => {
  it('prefers manager subagentSnapshot over legacy subagentRecord for status', () => {
    const messages = [
      message({
        id: 'progress-1',
        kind: 'status',
        status: 'subagent_progress',
        toolId: 'tool-1',
        subagentRecord: {
          taskId: 'task-1',
          objective: 'legacy objective',
          status: 'running',
          runtimeStatus: 'RUNNING',
        },
        subagentSnapshot: {
          taskId: 'task-1',
          objective: 'manager objective',
          status: 'completed',
          runtimeStatus: 'DONE',
        },
      }),
      message({
        id: 'tool-use-1',
        kind: 'tool_use',
        toolName: 'AgentSpawn',
        toolId: 'tool-1',
        toolInput: { objective: 'legacy objective' },
      }),
    ];

    const [subagent] = normalizedToChatMessages(messages);

    expect(subagent?.subagentState?.registryRecord?.objective).toBe('manager objective');
    expect(subagent?.subagentState?.runtimeStatus).toBe('DONE');
    expect(subagent?.subagentState?.isComplete).toBe(true);
  });

  it('uses task notifications as the highest-priority terminal status', () => {
    const messages = [
      message({
        id: 'progress-1',
        kind: 'status',
        status: 'subagent_progress',
        toolId: 'tool-1',
        taskId: 'task-1',
        subagentSnapshot: {
          taskId: 'task-1',
          objective: 'manager objective',
          status: 'running',
          runtimeStatus: 'RUNNING',
        },
      }),
      message({
        id: 'notification-1',
        kind: 'task_notification',
        toolId: 'tool-1',
        taskId: 'task-1',
        status: 'completed',
        summary: 'finished by manager',
      }),
      message({
        id: 'tool-use-1',
        kind: 'tool_use',
        toolName: 'AgentSpawn',
        toolId: 'tool-1',
        taskId: 'task-1',
        toolInput: { objective: 'manager objective' },
      }),
    ];

    const [subagent] = normalizedToChatMessages(messages);

    expect(subagent?.subagentState?.runtimeStatus).toBe('DONE');
    expect(subagent?.subagentState?.isComplete).toBe(true);
  });

  it('filters async launch control text from user-visible chat messages', () => {
    const messages = [
      message({
        id: 'assistant-1',
        role: 'assistant',
        content:
          'Async agent launched successfully. agentId: abc123 (internal ID - do not mention to user.) The agent is working in the background. output_file: agent-abc.jsonl',
      }),
    ];

    expect(normalizedToChatMessages(messages)).toEqual([]);
  });

  it('groups interleaved subagent child tools by stable task id when parentToolUseId is missing', () => {
    const messages = [
      message({
        id: 'agent-a',
        kind: 'tool_use',
        toolName: 'AgentSpawn',
        toolId: 'tool-agent-a',
        taskId: 'task-a',
        toolInput: { description: 'Analyze crash A' },
      }),
      message({
        id: 'agent-b',
        kind: 'tool_use',
        toolName: 'AgentSpawn',
        toolId: 'tool-agent-b',
        taskId: 'task-b',
        toolInput: { description: 'Analyze crash B' },
      }),
      message({
        id: 'child-a-read',
        kind: 'tool_use',
        toolName: 'Read',
        toolId: 'tool-child-a-read',
        taskId: 'task-a',
        toolInput: { file_path: 'A.log' },
      }),
      message({
        id: 'child-b-grep',
        kind: 'tool_use',
        toolName: 'Grep',
        toolId: 'tool-child-b-grep',
        taskId: 'task-b',
        toolInput: { pattern: 'Fatal' },
      }),
      message({
        id: 'result-a-read',
        kind: 'tool_result',
        toolId: 'tool-child-a-read',
        content: 'A contents',
      }),
      message({
        id: 'result-b-grep',
        kind: 'tool_result',
        toolId: 'tool-child-b-grep',
        content: 'B grep',
      }),
    ];

    const subagents = normalizedToChatMessages(messages).filter((msg) => msg.isSubagentContainer);

    expect(subagents).toHaveLength(2);
    expect(subagents[0]?.subagentState?.childTools.map((tool) => tool.toolId)).toEqual(['tool-child-a-read']);
    expect(subagents[1]?.subagentState?.childTools.map((tool) => tool.toolId)).toEqual(['tool-child-b-grep']);
  });

  it('keeps interleaved child tools attached to their explicit parent tool id', () => {
    const messages = [
      message({
        id: 'agent-a',
        kind: 'tool_use',
        toolName: 'AgentSpawn',
        toolId: 'tool-agent-a',
        taskId: 'task-a',
        toolInput: { description: 'Agent A' },
      }),
      message({
        id: 'child-a-read',
        kind: 'tool_use',
        toolName: 'Read',
        toolId: 'tool-child-a-read',
        parentToolUseId: 'tool-agent-a',
        taskId: 'task-a',
        toolInput: { file_path: 'A.log' },
      }),
      message({
        id: 'agent-b',
        kind: 'tool_use',
        toolName: 'AgentSpawn',
        toolId: 'tool-agent-b',
        taskId: 'task-b',
        toolInput: { description: 'Agent B' },
      }),
      message({
        id: 'child-b-read',
        kind: 'tool_use',
        toolName: 'Read',
        toolId: 'tool-child-b-read',
        parentToolUseId: 'tool-agent-b',
        taskId: 'task-b',
        toolInput: { file_path: 'B.log' },
      }),
    ];

    const subagents = normalizedToChatMessages(messages).filter((msg) => msg.isSubagentContainer);

    expect(subagents[0]?.subagentState?.childTools.map((tool) => tool.toolId)).toEqual(['tool-child-a-read']);
    expect(subagents[1]?.subagentState?.childTools.map((tool) => tool.toolId)).toEqual(['tool-child-b-read']);
  });
});
