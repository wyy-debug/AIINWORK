import { beforeEach, describe, expect, test } from 'bun:test'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  clearSubagentRegistryForTests,
  registerSubagentRecord,
  completeSubagentRecord,
} from 'src/tasks/subagentRegistry.js'
import {
  clearDispatchManagerForTests,
  dispatchManager,
} from 'src/tasks/subagentDispatch.js'
import {
  AgentCancelTool,
  AgentDispatchPlanTool,
  AgentListTool,
  AgentResultTool,
  AgentResumeTool,
  AgentWaitTool,
  AgentSendInputTool,
} from '../AgentControlTools.js'

beforeEach(() => {
  clearSubagentRegistryForTests()
  clearDispatchManagerForTests()
})

describe('AgentControlTools', () => {
  test('AgentDispatchPlan returns tickets only after local event requirements are satisfied', async () => {
    dispatchManager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'mcp_tool_completed',
      mcpServer: 'trace-export-tool-mcp',
      mcpTool: 'list_bookmarks',
      status: 'ok',
    })

    const result = await AgentDispatchPlanTool.call({
      proposal_id: 'proposal-trace',
      session_id: 'session-1',
      user_turn_id: 'turn-1',
      execution_mode: 'mixed',
      merge_strategy: 'Merge only evidence-backed DONE results.',
      current_step_id: 'review-bookmarks',
      steps: [
        {
          id: 'check-bookmarks',
          type: 'local',
          objective: 'List trace bookmarks locally before delegation.',
          depends_on: [],
          can_run_parallel: false,
          stop_condition: 'DONE',
          required_events: [
            {
              type: 'mcp_tool_completed',
              mcp_server: 'trace-export-tool-mcp',
              mcp_tool: 'list_bookmarks',
              status: 'ok',
            },
          ],
        },
        {
          id: 'review-bookmarks',
          type: 'subagent',
          objective: 'Review listed bookmark evidence and identify suspicious slow-frame sections.',
          role: 'reviewer',
          depends_on: ['check-bookmarks'],
          can_run_parallel: true,
          stop_condition: 'DONE',
          expected_result: 'STATUS/SUMMARY/EVIDENCE/NEXT_ACTION',
        },
      ],
    } as any)

    expect(result.data.status).toBe('ready')
    expect(result.data.tickets).toHaveLength(1)
    expect(result.data.tickets?.[0]).toMatchObject({
      proposalId: 'proposal-trace',
      stepId: 'review-bookmarks',
      objective: 'Review listed bookmark evidence and identify suspicious slow-frame sections.',
    })
  })

  test('AgentDispatchPlan derives dispatch scope from runtime context', async () => {
    const sessionId = getSessionId()
    dispatchManager.recordLocalEvent({
      sessionId,
      userTurnId: `${sessionId}:user-turn:user-message-1`,
      type: 'tool_completed',
      toolName: 'Read',
      status: 'ok',
    })

    const result = await (AgentDispatchPlanTool.call as any)(
      {
        proposal_id: 'proposal-context-scope',
        session_id: 'model-supplied-session',
        user_turn_id: 'model-supplied-turn',
        execution_mode: 'sequential',
        merge_strategy: 'summarize evidence',
        steps: [
          {
            id: 'local-read',
            type: 'local',
            objective: 'Read local file',
            depends_on: [],
            can_run_parallel: false,
            stop_condition: 'DONE',
            required_events: [
              {
                type: 'tool_completed',
                tool_name: 'Read',
                status: 'ok',
              },
            ],
          },
          {
            id: 'worker-analyze',
            type: 'subagent',
            objective: 'Analyze bookmarks',
            role: 'explorer',
            depends_on: ['local-read'],
            can_run_parallel: false,
            stop_condition: 'DONE',
            expected_result: 'bookmark summary',
          },
        ],
      } as any,
      {
        messages: [
          {
            type: 'user',
            uuid: 'user-message-1',
            message: { content: [{ type: 'text', text: 'Analyze this file' }] },
          },
        ],
        toolUseId: 'tool-use-plan',
      } as any,
    )

    expect(result.data.status).toBe('ready')
    expect(result.data.tickets?.[0]?.sessionId).toBe(sessionId)
    expect(result.data.tickets?.[0]?.userTurnId).toBe(
      `${sessionId}:user-turn:user-message-1`,
    )
  })

  test('AgentDispatchPlan maps model, skill, and MCP config requirements into dispatch evaluation', async () => {
    dispatchManager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'mcp_config' as any,
      mcpServer: 'trace-export-tool-mcp',
      status: 'ok',
    })
    dispatchManager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'skill_binding',
      skillName: 'trace-export-analysis',
      status: 'ok',
    } as any)
    dispatchManager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'model_binding',
      model: 'mimo-v2.5-pro',
      modelProfileId: 'profile-mimo',
      status: 'ok',
    } as any)

    const result = await AgentDispatchPlanTool.call({
      proposal_id: 'proposal-capabilities',
      session_id: 'session-1',
      user_turn_id: 'turn-1',
      execution_mode: 'mixed',
      merge_strategy: 'dispatch only after capability bindings are verified',
      current_step_id: 'worker-capability',
      steps: [
        {
          id: 'capability-preflight',
          type: 'local',
          objective: 'Verify runtime capability bindings.',
          depends_on: [],
          can_run_parallel: false,
          stop_condition: 'DONE',
          required_events: [
            {
              type: 'mcp_config',
              mcp_server: 'trace-export-tool-mcp',
              status: 'ok',
            },
            {
              type: 'skill_binding',
              skill_name: 'trace-export-analysis',
              status: 'ok',
            },
            {
              type: 'model_binding',
              model: 'mimo-v2.5-pro',
              model_profile_id: 'profile-mimo',
              status: 'ok',
            },
          ],
        },
        {
          id: 'worker-capability',
          type: 'subagent',
          objective: 'Use verified trace capabilities.',
          role: 'reviewer',
          depends_on: ['capability-preflight'],
          can_run_parallel: true,
          stop_condition: 'DONE',
          expected_result: 'structured evidence',
        },
      ],
    } as any)

    expect(result.data.status).toBe('ready')
    expect(result.data.tickets?.[0]).toMatchObject({
      stepId: 'worker-capability',
      objective: 'Use verified trace capabilities.',
    })
  })

  test('rejects Chinese open-ended polling messages for AgentSendInput', async () => {
    const result = await AgentSendInputTool.validateInput?.({
      task_id: 'task-1',
      message: '进度如何？结果呢？',
    })

    expect(result?.result).toBe(false)
    expect(result?.message).toContain('AgentWait/AgentResult')
  })

  test('lists only running subagents when running_only is true', async () => {
    registerSubagentRecord({
      taskId: 'task-running',
      agentId: 'task-running',
      objective: 'Fetch crash page',
      sessionId: 'session-1',
    })
    registerSubagentRecord({
      taskId: 'task-done',
      agentId: 'task-done',
      objective: 'Read skill',
      sessionId: 'session-1',
    })
    completeSubagentRecord({
      agentId: 'task-done',
      content: [{ type: 'text', text: '### STATUS\nDONE\n### SUMMARY\nComplete.' }],
    } as any)

    const result = await AgentListTool.call({ running_only: true } as any)

    expect(result.data.records?.map(record => record.taskId)).toEqual(['task-running'])
  })

  test('AgentResult returns structured protocol fields for completed subagent results', async () => {
    registerSubagentRecord({
      taskId: 'task-done',
      agentId: 'task-done',
      objective: 'Read crash evidence',
      sessionId: 'session-1',
    })
    completeSubagentRecord({
      agentId: 'task-done',
      content: [
        {
          type: 'text',
          text: [
            '### STATUS',
            'DONE',
            '### SUMMARY',
            'Crash evidence extracted.',
            '### EVIDENCE',
            'stacktrace.txt line 42',
            '### NEXT_ACTION',
            'Summarize the root cause.',
            '### CHANGES',
            'No files changed.',
            '### BLOCKERS',
            'None.',
          ].join('\n'),
        },
      ],
    } as any)

    const result = await AgentResultTool.call(
      { task_id: 'task-done' } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
    )

    expect(result.data.status).toBe('completed')
    expect(result.data.result).toEqual({
      status: 'DONE',
      summary: 'Crash evidence extracted.',
      evidence: 'stacktrace.txt line 42',
      nextAction: 'Summarize the root cause.',
      changes: 'No files changed.',
      blockers: 'None.',
    })
  })

  test('AgentWait reports completed and pending task ids for any-mode waits', async () => {
    registerSubagentRecord({
      taskId: 'task-running',
      agentId: 'task-running',
      objective: 'Fetch remote page',
      sessionId: 'session-1',
    })
    registerSubagentRecord({
      taskId: 'task-done',
      agentId: 'task-done',
      objective: 'Read local skill',
      sessionId: 'session-1',
    })
    completeSubagentRecord({
      agentId: 'task-done',
      content: [{ type: 'text', text: '### STATUS\nDONE\n### SUMMARY\nComplete.' }],
    } as any)

    const result = await AgentWaitTool.call(
      {
        task_ids: ['task-running', 'task-done'],
        wait_mode: 'any',
        timeout_ms: 1000,
      } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
    )

    expect(result.data.status).toBe('completed')
    expect(result.data.completed_task_ids).toEqual(['task-done'])
    expect(result.data.pending_task_ids).toEqual(['task-running'])
  })

  test('AgentCancel returns a structured terminal result and removes the task from running list', async () => {
    registerSubagentRecord({
      taskId: 'task-running',
      agentId: 'task-running',
      objective: 'Fetch remote page',
      sessionId: 'session-1',
    })

    const appState = { tasks: {} }
    const result = await AgentCancelTool.call(
      { task_id: 'task-running' } as any,
      { getAppState: () => appState, setAppState: () => undefined } as any,
    )
    const running = await AgentListTool.call({ running_only: true } as any)

    expect(result.data.status).toBe('cancelled')
    expect(result.data.result).toMatchObject({
      status: 'BLOCKED',
      summary: 'Subagent was cancelled.',
    })
    expect(running.data.records?.map(record => record.taskId)).toEqual([])
  })

  test('AgentResume rejects unknown subagent ids instead of spawning blind resumes', async () => {
    const result = await AgentResumeTool.validateInput?.({
      task_id: 'missing-task',
    })

    expect(result?.result).toBe(false)
    expect(result?.message).toContain('No subagent found')
  })
})
