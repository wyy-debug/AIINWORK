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
  it('renders proposed_plan blocks as plan tool cards and removes them from assistant text', () => {
    const messages = normalizedToChatMessages([
      message({
        id: 'assistant-plan',
        role: 'assistant',
        content: [
          'I inspected the app.',
          '<proposed_plan>',
          '# Plan',
          '',
          '- Add button',
          '</proposed_plan>',
        ].join('\n'),
      }),
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe('I inspected the app.');
    expect(messages[1]?.isToolUse).toBe(true);
    expect(messages[1]?.toolName).toBe('proposed_plan');
    expect(messages[1]?.sessionId).toBe('session-1');
    expect(JSON.parse(String(messages[1]?.toolInput))).toEqual({ plan: '# Plan\n\n- Add button' });
  });

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

  it('surfaces task notification summaries as the visible subagent result', () => {
    const messages = [
      message({
        id: 'tool-use-1',
        kind: 'tool_use',
        toolName: 'AgentSpawn',
        toolId: 'tool-1',
        taskId: 'task-1',
        toolInput: { objective: 'Review backend' },
      }),
      message({
        id: 'notification-1',
        kind: 'task_notification',
        toolId: 'tool-1',
        taskId: 'task-1',
        status: 'completed',
        summary: 'Backend review found no blocking issue.',
      }),
    ];

    const [subagent] = normalizedToChatMessages(messages);

    expect(subagent?.subagentState?.resultSummary).toBe('Backend review found no blocking issue.');
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

  it('filters task notification XML even when it arrives as a user text message', () => {
    const messages = [
      message({
        id: 'user-notification-1',
        role: 'user',
        content: [
          '<task-notification>',
          '<task-id>a0505b3f4a718760d</task-id>',
          '<tool-use-id>call_00_b3</tool-use-id>',
          '<output-file>C:\\Users\\Stan\\AppData\\Local\\Temp\\agent-output.txt</output-file>',
          '<status>killed</status>',
          '<summary>Agent was stopped</summary>',
          '</task-notification>',
        ].join('\n'),
      }),
    ];

    expect(normalizedToChatMessages(messages)).toEqual([]);
  });

  it('treats Codex-style spawn_agent as a subagent container', () => {
    const messages = [
      message({
        id: 'spawn-agent-1',
        kind: 'tool_use',
        toolName: 'spawn_agent',
        toolId: 'tool-spawn-1',
        taskId: 'task-spawn-1',
        toolInput: { agent_type: 'worker', message: 'Inspect the change' },
      }),
      message({
        id: 'progress-1',
        kind: 'status',
        status: 'subagent_progress',
        toolId: 'tool-spawn-1',
        taskId: 'task-spawn-1',
        subagentSnapshot: {
          taskId: 'task-spawn-1',
          objective: 'Inspect the change',
          status: 'running',
          runtimeStatus: 'RUNNING',
        },
      }),
    ];

    const [subagent] = normalizedToChatMessages(messages);

    expect(subagent?.isSubagentContainer).toBe(true);
    expect(subagent?.subagentState?.runtimeStatus).toBe('RUNNING');
  });

  it('attaches persisted subagent control events to the matching subagent container', () => {
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
        id: 'control-a',
        kind: 'status',
        status: 'subagent_control_accepted',
        taskId: 'task-a',
        subagentControlEvent: {
          type: 'control_accepted',
          taskId: 'task-a',
          timestamp: 42,
          payload: {
            action: 'send',
            mode: 'fallback-guidance',
          },
        },
      } as Partial<NormalizedMessage>),
    ];

    const [subagent] = normalizedToChatMessages(messages);

    expect(subagent?.subagentState?.subagentEvents).toEqual([
      expect.objectContaining({
        type: 'control_accepted',
        taskId: 'task-a',
        timestamp: 42,
        payload: {
          action: 'send',
          mode: 'fallback-guidance',
        },
      }),
    ]);
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

  it('attaches Obsidian Wiki context status to the triggering user message', () => {
    const [userMessage] = normalizedToChatMessages([
      message({
        id: 'user-1',
        kind: 'text',
        role: 'user',
        content: 'GPUScene 后续怎么优化？',
      }),
      message({
        id: 'status-1',
        kind: 'status',
        event: 'obsidian_context_result',
        messageId: 'user-1',
        obsidianContext: {
          used: true,
          resultCount: 2,
          reranked: true,
          rerankModel: 'gpt-5.4-mini',
          tokenBudgetUsed: 256,
          sources: [{
            path: 'Argus/Wiki/App/GPUScene.md',
            title: 'GPUScene',
            snippet: 'GPUScene review snippet.',
            hitReason: 'title match',
          }],
        },
      } as Partial<NormalizedMessage>),
    ]);

    expect(userMessage?.obsidianContextStatus).toMatchObject({
      used: true,
      resultCount: 2,
      reranked: true,
      rerankModel: 'gpt-5.4-mini',
      tokenBudgetUsed: 256,
      sources: [
        expect.objectContaining({
          path: 'Argus/Wiki/App/GPUScene.md',
          snippet: 'GPUScene review snippet.',
          hitReason: 'title match',
        }),
      ],
    });
  });

  it('adds a visible reminder event before a context compaction card', () => {
    const messages = [
      message({
        id: 'compact-1',
        kind: 'context_compaction',
        compactType: 'summary',
        content: 'Conversation compacted',
        compactSummary: 'Summarized state',
        tokensSaved: 12_345,
      }),
    ];

    const converted = normalizedToChatMessages(messages);

    expect(converted).toHaveLength(2);
    expect(converted[0]).toMatchObject({
      id: 'compact-1-notice',
      type: 'assistant',
      isTaskNotification: true,
      content: '上下文已压缩，后续回复将基于压缩后的摘要继续。',
    });
    expect(converted[1]).toMatchObject({
      id: 'compact-1',
      isContextCompaction: true,
      compactSummary: 'Summarized state',
    });
  });

  it('collapses adjacent duplicate assistant text messages with the same content', () => {
    const converted = normalizedToChatMessages([
      message({
        id: 'assistant-1',
        role: 'assistant',
        timestamp: '2026-05-05T00:00:00.000Z',
        content: 'I am checking the startup path now.',
      }),
      message({
        id: 'assistant-2',
        role: 'assistant',
        timestamp: '2026-05-05T00:00:01.000Z',
        content: 'I am checking the startup path now.',
      }),
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0]).toMatchObject({
      id: 'assistant-1',
      content: 'I am checking the startup path now.',
    });
  });
});
