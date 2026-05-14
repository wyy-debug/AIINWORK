import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';

import { buildChatMultiAgentCollaborationView } from './chatMultiAgentCollaboration';


const subagent = (overrides: Partial<ChatMessage>): ChatMessage => ({
  type: 'assistant',
  timestamp: new Date(0),
  isToolUse: true,
  isSubagentContainer: true,
  toolName: 'spawn_agent',
  toolInput: {
    agent_type: 'Explore',
    task_name: 'review_backend_server',
    message: '审查后端服务和数据库配置，并检查安全风险。',
  },
  subagentState: {
    taskId: 'task-backend',
    childTools: [],
    currentToolIndex: -1,
    isComplete: false,
    runtimeStatus: 'RUNNING',
    objective: '审查后端服务和数据库配置',
  },
  ...overrides,
});

describe('chatMultiAgentCollaboration', () => {
  it('returns null unless the process group contains multiple subagents', () => {
    expect(buildChatMultiAgentCollaborationView([subagent({})])).toBeNull();
  });

  it('projects subagent tool messages into an orchestrator collaboration board', () => {
    const view = buildChatMultiAgentCollaborationView([
      subagent({ toolId: 'tool-backend' }),
      subagent({
        toolId: 'tool-frontend',
        toolInput: {
          agent_type: 'Explore',
          task_name: 'review_frontend_components',
          message: '审查 React/TypeScript 改动并检查组件质量。',
        },
        subagentState: {
          taskId: 'task-frontend',
          childTools: [{ toolId: 'bash-1', toolName: 'Bash', toolInput: { command: 'npm test' }, timestamp: new Date(1) }],
          currentToolIndex: 0,
          isComplete: true,
          runtimeStatus: 'DONE',
          lastToolSummary: '组件检查完成。',
        },
      }),
      subagent({
        toolId: 'tool-quality',
        subagentState: {
          taskId: 'task-quality',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          runtimeStatus: 'RUNNING',
        },
        toolInput: {
          agent_type: 'Explore',
          task_name: 'review_tests_and_quality',
          message: '检查测试覆盖和质量风险。',
        },
      }),
    ]);

    expect(view?.orchestrator.title).toBe('主Agent / Orchestrator');
    expect(view?.orchestrator.timeline.map((item) => item.kind)).toEqual(['user_request', 'dispatch_plan', 'dispatch_started', 'summary']);
    expect(view?.dialogs).toHaveLength(3);
    expect(view?.dispatchPlanId).toBe('multi-agent:task:task-backend|task:task-frontend|task:task-quality');
    expect(view?.dialogs[0]).toMatchObject({
      title: 'Explore / review_backend_server',
      dialogId: 'tool-backend',
      taskText: '审查后端服务和数据库配置，并检查安全风险。',
      taskId: 'task-backend',
      status: 'RUNNING',
    });
    expect(view?.dialogs[1]).toMatchObject({
      title: 'Explore / review_frontend_components',
      resultText: '组件检查完成。',
      status: 'DONE',
      toolSummary: '1 tools',
    });
  });

  it('deduplicates retry variants by normalized text only when stable identities are unavailable', () => {
    const view = buildChatMultiAgentCollaborationView([
      subagent({
        toolInput: {
          agent_type: 'Explore',
          task_name: 'backend-review',
          message: '审查后端服务。',
        },
        subagentState: {
          childTools: [],
          currentToolIndex: -1,
          isComplete: true,
          runtimeStatus: 'DONE',
          lastToolSummary: '旧派送结果。',
        },
      }),
      subagent({
        toolInput: {
          agent_type: 'Explore',
          task_name: 'backend_review',
          message: '审查后端服务。',
        },
        subagentState: {
          childTools: [{ toolId: 'bash-1', toolName: 'Bash', toolInput: {}, timestamp: new Date(1) }],
          currentToolIndex: 0,
          isComplete: true,
          runtimeStatus: 'DONE',
          lastToolSummary: '新派送结果。',
        },
      }),
      subagent({
        toolId: 'tool-frontend',
        toolInput: {
          agent_type: 'Explore',
          task_name: 'frontend-review',
          message: '审查前端服务。',
        },
      }),
    ]);

    expect(view?.dialogs.map((dialog) => dialog.taskName)).toEqual(['backend_review', 'frontend-review']);
    expect(view?.dialogs[0]).toMatchObject({
      taskId: '',
      resultText: '新派送结果。',
      toolSummary: '1 tools',
    });
  });

  it('keeps same-name subagent dialogs separate when they have stable task identities', () => {
    const view = buildChatMultiAgentCollaborationView([
      subagent({
        toolId: 'tool-search-1',
        toolInput: {
          agent_type: 'Explore',
          task_name: 'review_backend_server',
          message: 'Review backend API routes.',
        },
        subagentState: {
          taskId: 'task-search-1',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          runtimeStatus: 'RUNNING',
        },
      }),
      subagent({
        toolId: 'tool-search-2',
        toolInput: {
          agent_type: 'Explore',
          task_name: 'review_backend_server',
          message: 'Review backend persistence layer.',
        },
        subagentState: {
          taskId: 'task-search-2',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          runtimeStatus: 'RUNNING',
        },
      }),
    ]);

    expect(view?.dialogs).toHaveLength(2);
    expect(view?.dialogs.map((dialog) => dialog.dialogId)).toEqual(['tool-search-1', 'tool-search-2']);
    expect(view?.dialogs.map((dialog) => dialog.taskId)).toEqual(['task-search-1', 'task-search-2']);
  });

  it('keeps terminal subagent status instead of stale running snapshots for the same task', () => {
    const view = buildChatMultiAgentCollaborationView([
      subagent({
        toolId: 'tool-backend-running',
        toolInput: {
          agent_type: 'Explore',
          task_name: 'review_backend_server',
          message: 'Review backend server.',
        },
        subagentState: {
          taskId: 'task-backend',
          childTools: [{ toolId: 'bash-1', toolName: 'Bash', toolInput: {}, timestamp: new Date(1) }],
          currentToolIndex: 0,
          isComplete: false,
          runtimeStatus: 'RUNNING',
          lastToolSummary: 'Still scanning files.',
        },
      }),
      subagent({
        toolId: 'tool-backend-done',
        toolInput: {
          agent_type: 'Explore',
          task_name: 'review_backend_server',
          message: 'Review backend server.',
        },
        subagentState: {
          taskId: 'task-backend',
          childTools: [],
          currentToolIndex: -1,
          isComplete: true,
          runtimeStatus: 'DONE',
          resultSummary: 'Backend review complete.',
        },
      }),
      subagent({
        toolId: 'tool-frontend',
        toolInput: {
          agent_type: 'Explore',
          task_name: 'review_frontend_components',
          message: 'Review frontend components.',
        },
        subagentState: {
          taskId: 'task-frontend',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          runtimeStatus: 'RUNNING',
        },
      }),
    ]);

    expect(view?.dialogs).toHaveLength(2);
    expect(view?.dialogs[0]).toMatchObject({
      dialogId: 'tool-backend-done',
      taskId: 'task-backend',
      status: 'DONE',
      resultText: 'Backend review complete.',
    });
  });

  it('uses normalized subagent result summaries on collaboration cards', () => {
    const view = buildChatMultiAgentCollaborationView([
      subagent({
        toolId: 'tool-backend',
        subagentState: {
          taskId: 'task-backend',
          childTools: [],
          currentToolIndex: -1,
          isComplete: true,
          runtimeStatus: 'DONE',
          resultSummary: 'Backend review completed from task notification.',
        },
      }),
      subagent({
        toolId: 'tool-frontend',
        subagentState: {
          taskId: 'task-frontend',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          runtimeStatus: 'RUNNING',
        },
        toolInput: {
          agent_type: 'Explore',
          task_name: 'frontend-review',
          message: 'Review frontend.',
        },
      }),
    ]);

    expect(view?.dialogs[0]?.resultText).toBe('Backend review completed from task notification.');
    expect(view?.dialogs[0]?.sourceMessage).toMatchObject({
      toolId: 'tool-backend',
      isSubagentContainer: true,
    });
  });

  it('marks dialogs blocked when runtime events contain repeated tool-result failures', () => {
    const view = buildChatMultiAgentCollaborationView([
      subagent({
        toolId: 'tool-backend',
        subagentState: {
          taskId: 'task-backend',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          runtimeStatus: 'RUNNING',
          subagentEvents: [
            {
              seq: 1,
              sessionId: 'parent-session',
              parentToolUseId: 'tool-backend',
              taskId: 'task-backend',
              threadId: 'thread-backend',
              type: 'blocked',
              timestamp: 1000,
              payload: {
                message: 'Received two consecutive empty, no-match, or error-only tool results.',
                duplicateCount: 4,
              },
            },
          ],
        },
      }),
      subagent({
        toolId: 'tool-frontend',
        subagentState: {
          taskId: 'task-frontend',
          childTools: [],
          currentToolIndex: -1,
          isComplete: false,
          runtimeStatus: 'RUNNING',
        },
        toolInput: {
          agent_type: 'Explore',
          task_name: 'frontend-review',
          message: 'Review frontend.',
        },
      }),
    ]);

    expect(view?.orchestrator.status).toBe('BLOCKED');
    expect(view?.dialogs[0]).toMatchObject({
      status: 'BLOCKED',
      resultText: 'Received two consecutive empty, no-match, or error-only tool results. (repeated 4 times)',
    });
  });
});
