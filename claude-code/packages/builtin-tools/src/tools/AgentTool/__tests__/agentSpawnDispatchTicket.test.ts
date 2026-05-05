import { describe, expect, test } from 'bun:test'
import { DispatchManager, type DispatchProposal } from 'src/tasks/subagentDispatch.js'
import { consumeAgentSpawnDispatchTicket } from '../AgentTool.js'

function proposal(): DispatchProposal {
  return {
    proposalId: 'proposal-agent-spawn',
    sessionId: 'session-1',
    userTurnId: 'turn-1',
    executionMode: 'mixed',
    mergeStrategy: 'Use ticketed subagent output only.',
    currentStepId: 'worker',
    steps: [
      {
        id: 'local-ready',
        type: 'local',
        objective: 'Verify local readiness.',
        dependsOn: [],
        canRunParallel: false,
        stopCondition: 'DONE',
        requiredEvents: [
          {
            type: 'tool_completed',
            toolName: 'Read',
            status: 'ok',
          },
        ],
      },
      {
        id: 'worker',
        type: 'subagent',
        objective: 'Analyze verified evidence.',
        role: 'reviewer',
        dependsOn: ['local-ready'],
        canRunParallel: true,
        stopCondition: 'DONE',
      },
    ],
  }
}

function readyManager(now: () => number): DispatchManager {
  const manager = new DispatchManager({
    now,
    ticketTtlMs: 10,
  })
  manager.recordLocalEvent({
    sessionId: 'session-1',
    userTurnId: 'turn-1',
    type: 'tool_completed',
    toolName: 'Read',
    status: 'ok',
  })
  return manager
}

describe('AgentSpawn dispatch tickets', () => {
  test('rejects AgentSpawn without a dispatch ticket', () => {
    expect(() =>
      consumeAgentSpawnDispatchTicket({
        manager: readyManager(() => 1_000),
        dispatchTicket: undefined,
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        objective: 'Analyze verified evidence.',
      }),
    ).toThrow(/requires a dispatch_ticket/i)
  })

  test('consumes a valid ticket exactly once', () => {
    const manager = readyManager(() => 1_000)
    const ticket = manager.evaluate(proposal()).tickets[0]!

    const consumed = consumeAgentSpawnDispatchTicket({
      manager,
      dispatchTicket: ticket.ticketId,
      sessionId: 'session-1',
      userTurnId: 'turn-1',
      objective: 'Analyze verified evidence.',
    })

    expect(consumed.ticketId).toBe(ticket.ticketId)
    expect(() =>
      consumeAgentSpawnDispatchTicket({
        manager,
        dispatchTicket: ticket.ticketId,
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        objective: 'Analyze verified evidence.',
      }),
    ).toThrow(/already used/i)
  })

  test('rejects expired, cross-session, and objective-mismatched tickets', () => {
    let now = 1_000
    const manager = readyManager(() => now)
    const tickets = [
      manager.evaluate(proposal()).tickets[0]!,
      manager.evaluate(proposal()).tickets[0]!,
      manager.evaluate(proposal()).tickets[0]!,
    ]

    expect(() =>
      consumeAgentSpawnDispatchTicket({
        manager,
        dispatchTicket: tickets[0].ticketId,
        sessionId: 'session-2',
        userTurnId: 'turn-1',
        objective: 'Analyze verified evidence.',
      }),
    ).toThrow(/different session/i)

    expect(() =>
      consumeAgentSpawnDispatchTicket({
        manager,
        dispatchTicket: tickets[1].ticketId,
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        objective: 'Analyze something else.',
      }),
    ).toThrow(/does not match/i)

    now = 2_000
    expect(() =>
      consumeAgentSpawnDispatchTicket({
        manager,
        dispatchTicket: tickets[2].ticketId,
        sessionId: 'session-1',
        userTurnId: 'turn-1',
        objective: 'Analyze verified evidence.',
      }),
    ).toThrow(/expired/i)
  })
})
