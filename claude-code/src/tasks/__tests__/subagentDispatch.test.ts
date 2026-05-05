import { describe, expect, test } from 'bun:test'
import {
  DispatchManager,
  createDispatchRuntimeBindingEvents,
  createLocalToolEventFromToolExecution,
  type DispatchProposal,
} from '../subagentDispatch'

function traceProposal(): DispatchProposal {
  return {
    proposalId: 'proposal-trace',
    sessionId: 'session-1',
    userTurnId: 'turn-1',
    executionMode: 'mixed',
    mergeStrategy: 'Merge only evidence-backed DONE results; report BLOCKED with the missing dependency.',
    steps: [
      {
        id: 'check-bookmarks',
        type: 'local',
        objective: 'List trace bookmarks locally before delegation.',
        dependsOn: [],
        canRunParallel: false,
        stopCondition: 'DONE',
        requiredEvents: [
          {
            type: 'mcp_tool_completed',
            mcpServer: 'trace-export-tool-mcp',
            mcpTool: 'list_bookmarks',
            status: 'ok',
          },
        ],
      },
      {
        id: 'review-bookmarks',
        type: 'subagent',
        objective: 'Review listed bookmark evidence and identify suspicious slow-frame sections.',
        role: 'reviewer',
        dependsOn: ['check-bookmarks'],
        canRunParallel: true,
        stopCondition: 'DONE',
        expectedResult: 'STATUS/SUMMARY/EVIDENCE/NEXT_ACTION with bookmark evidence only.',
      },
    ],
    currentStepId: 'review-bookmarks',
  }
}

describe('DispatchManager', () => {
  test('does not issue a ticket before required local events exist', () => {
    const manager = new DispatchManager({
      now: () => 1_000,
    })

    const result = manager.evaluate(traceProposal())

    expect(result.status).toBe('blocked')
    expect(result.tickets).toEqual([])
    expect(result.nextLocalActions.join('\n')).toContain('check-bookmarks')
  })

  test('issues a dispatch ticket once local event dependencies are satisfied', () => {
    const manager = new DispatchManager({
      now: () => 1_000,
    })
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'mcp_tool_completed',
      mcpServer: 'trace-export-tool-mcp',
      mcpTool: 'list_bookmarks',
      status: 'ok',
    })

    const result = manager.evaluate(traceProposal())

    expect(result.status).toBe('ready')
    expect(result.tickets).toHaveLength(1)
    expect(result.tickets[0]).toMatchObject({
      proposalId: 'proposal-trace',
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      stepId: 'review-bookmarks',
      objective: 'Review listed bookmark evidence and identify suspicious slow-frame sections.',
      role: 'reviewer',
    })
  })

  test('requires explicit MCP, skill, model, and permission events before issuing a ticket', () => {
    const manager = new DispatchManager({
      now: () => 1_000,
    })
    const proposal: DispatchProposal = {
      ...traceProposal(),
      steps: [
        {
          id: 'preflight',
          type: 'local',
          objective: 'Verify the trace tool, selected skill, active model, and permission state before delegation.',
          dependsOn: [],
          canRunParallel: false,
          stopCondition: 'DONE',
          requiredEvents: [
            {
              type: 'mcp_tool_completed',
              mcpServer: 'trace-export-tool-mcp',
              mcpTool: 'list_bookmarks',
              status: 'ok',
            },
            {
              type: 'mcp_config' as any,
              mcpServer: 'trace-export-tool-mcp',
              status: 'ok',
            },
            {
              type: 'skill_binding',
              skillName: 'trace-export-analysis',
              status: 'ok',
            } as any,
            {
              type: 'model_binding',
              model: 'mimo-v2.5-pro',
              modelProfileId: 'profile-mimo',
              status: 'ok',
            } as any,
            {
              type: 'permission_result',
              toolName: 'AgentSpawn',
              status: 'ok',
            },
          ],
        },
        {
          id: 'worker-analysis',
          type: 'subagent',
          objective: 'Analyze bookmarks after verified local preflight.',
          role: 'reviewer',
          dependsOn: ['preflight'],
          canRunParallel: true,
          stopCondition: 'DONE',
        },
      ],
      currentStepId: 'worker-analysis',
    }

    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'mcp_tool_completed',
      mcpServer: 'trace-export-tool-mcp',
      mcpTool: 'list_bookmarks',
      status: 'ok',
    })
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'mcp_config' as any,
      mcpServer: 'trace-export-tool-mcp',
      status: 'ok',
    })
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'skill_binding',
      skillName: 'different-skill',
      status: 'ok',
    } as any)
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'model_binding',
      model: 'deepseek-v4-flash',
      modelProfileId: 'profile-deepseek',
      status: 'ok',
    } as any)
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'permission_result',
      toolName: 'AgentSpawn',
      status: 'ok',
    })

    expect(manager.evaluate(proposal).tickets).toEqual([])

    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'skill_binding',
      skillName: 'trace-export-analysis',
      status: 'ok',
    } as any)
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'model_binding',
      model: 'mimo-v2.5-pro',
      modelProfileId: 'profile-mimo',
      status: 'ok',
    } as any)

    const result = manager.evaluate(proposal)

    expect(result.status).toBe('ready')
    expect(result.tickets).toHaveLength(1)
    expect(result.tickets[0]).toMatchObject({
      stepId: 'worker-analysis',
      objective: 'Analyze bookmarks after verified local preflight.',
    })
  })

  test('does not issue a ticket when permission dependency is blocked', () => {
    const manager = new DispatchManager({
      now: () => 1_000,
    })
    const proposal: DispatchProposal = {
      proposalId: 'proposal-permission',
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      executionMode: 'mixed',
      mergeStrategy: 'Only dispatch after permission is granted.',
      currentStepId: 'worker',
      steps: [
        {
          id: 'permission-preflight',
          type: 'local',
          objective: 'Ask permission for AgentSpawn.',
          dependsOn: [],
          canRunParallel: false,
          stopCondition: 'DONE',
          requiredEvents: [
            {
              type: 'permission_result',
              toolName: 'AgentSpawn',
              status: 'ok',
            },
          ],
        },
        {
          id: 'worker',
          type: 'subagent',
          objective: 'Do delegated work after permission.',
          dependsOn: ['permission-preflight'],
          canRunParallel: true,
          stopCondition: 'DONE',
        },
      ],
    }
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'permission_result',
      toolName: 'AgentSpawn',
      status: 'blocked',
      summary: 'user denied',
    })

    const result = manager.evaluate(proposal)

    expect(result.status).toBe('blocked')
    expect(result.tickets).toEqual([])
    expect(result.nextLocalActions).toEqual(['permission-preflight'])
  })

  test('dispatch tickets are single use and scoped to session and user turn', () => {
    const manager = new DispatchManager({
      now: () => 1_000,
    })
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'mcp_tool_completed',
      mcpServer: 'trace-export-tool-mcp',
      mcpTool: 'list_bookmarks',
      status: 'ok',
    })
    const ticket = manager.evaluate(traceProposal()).tickets[0]!

    expect(() =>
      manager.consumeTicket({
        ticketId: ticket.ticketId,
        sessionId: 'session-2',
        userTurnId: 'turn-1',
        objective: ticket.objective,
      }),
    ).toThrow(/session/i)

    const consumed = manager.consumeTicket({
      ticketId: ticket.ticketId,
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      objective: ticket.objective,
    })

    expect(consumed.stepId).toBe('review-bookmarks')
    expect(() =>
      manager.consumeTicket({
        ticketId: ticket.ticketId,
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        objective: ticket.objective,
      }),
    ).toThrow(/already used/i)
  })

  test('does not issue duplicate tickets for a running objective', () => {
    const manager = new DispatchManager({
      now: () => 1_000,
      getRunningObjectives: () => [
        'Review listed bookmark evidence and identify suspicious slow-frame sections.',
      ],
    })
    manager.recordLocalEvent({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      type: 'mcp_tool_completed',
      mcpServer: 'trace-export-tool-mcp',
      mcpTool: 'list_bookmarks',
      status: 'ok',
    })

    const result = manager.evaluate(traceProposal())

    expect(result.status).toBe('blocked')
    expect(result.tickets).toEqual([])
    expect(result.denials.join('\n')).toContain('already running')
  })

  test('classifies local tool executions as dispatch events', () => {
    expect(
      createLocalToolEventFromToolExecution({
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        toolName: 'Read',
        input: { file_path: 'E:/trace/file.utrace' },
        status: 'ok',
      }),
    ).toMatchObject({
      type: 'file_read',
      filePath: 'E:/trace/file.utrace',
      status: 'ok',
    })

    expect(
      createLocalToolEventFromToolExecution({
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        toolName: 'mcp__trace-export-tool-mcp__list_bookmarks',
        input: { path: 'E:/trace/file.utrace' },
        status: 'ok',
      }),
    ).toMatchObject({
      type: 'mcp_tool_completed',
      mcpServer: 'trace-export-tool-mcp',
      mcpTool: 'list_bookmarks',
      status: 'ok',
    })

    expect(
      createLocalToolEventFromToolExecution({
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        toolName: 'Bash',
        input: { command: 'TraceExportTool.exe list-bookmarks trace.utrace' },
        status: 'error',
        summary: 'command failed',
      }),
    ).toMatchObject({
      type: 'tool_completed',
      toolName: 'Bash',
      status: 'error',
      summary: 'command failed',
    })
  })

  test('creates runtime binding events for active model, MCP configs, and selected skills', () => {
    const events = createDispatchRuntimeBindingEvents({
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      model: 'mimo-v2.5-pro',
      modelProfileId: 'profile-mimo',
      skillNames: ['trace-export-analysis'],
      mcpClients: [
        { name: 'trace-export-tool-mcp', type: 'connected' },
        { name: 'soc-redmine', type: 'needs-auth' },
        { name: 'broken-server', type: 'failed' },
        { name: 'pending-server', type: 'pending' },
      ],
    })

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'model_binding',
        model: 'mimo-v2.5-pro',
        modelProfileId: 'profile-mimo',
        status: 'ok',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'skill_binding',
        skillName: 'trace-export-analysis',
        status: 'ok',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'mcp_config',
        mcpServer: 'trace-export-tool-mcp',
        status: 'ok',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'mcp_config',
        mcpServer: 'soc-redmine',
        status: 'blocked',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'mcp_config',
        mcpServer: 'broken-server',
        status: 'error',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'mcp_config',
        mcpServer: 'pending-server',
        status: 'missing',
      }),
    )
  })
})
