import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSubagentRegistryForTests,
  completeSubagentRecord,
  registerSubagentRecord,
} from 'src/tasks/subagentRegistry.js'
import {
  CloseAgentTool,
  ListAgentsTool,
  ResumeAgentTool,
  SendInputAgentTool,
  WaitAgentTool,
} from '../AgentControlTools.js'

beforeEach(() => {
  clearSubagentRegistryForTests()
})

const schemaText = (value: unknown) => JSON.stringify(value)

describe('Codex collaborative agent control tools', () => {
  test('exposes only Codex-style tool names without legacy callable aliases', () => {
    expect(ListAgentsTool.name).toBe('list_agents')
    expect(WaitAgentTool.name).toBe('wait_agent')
    expect(CloseAgentTool.name).toBe('close_agent')
    expect(SendInputAgentTool.name).toBe('send_input')
    expect(ResumeAgentTool.name).toBe('resume_agent')

    const legacyNames = [
      'AgentDispatchPlan',
      'AgentResult',
      'AgentSpawn',
      'AgentWait',
      'AgentCancel',
      'AgentSendInput',
      'agent_wait',
      'agent_cancel',
      'agent_send_input',
    ]
    for (const tool of [
      ListAgentsTool,
      WaitAgentTool,
      CloseAgentTool,
      SendInputAgentTool,
      ResumeAgentTool,
    ]) {
      expect(tool.aliases ?? []).toEqual([])
      for (const legacyName of legacyNames) {
        expect(tool.name).not.toBe(legacyName)
        expect(tool.aliases ?? []).not.toContain(legacyName)
      }
    }
  })

  test('wait_agent schema matches Codex targets and timeout shape', () => {
    const text = schemaText(WaitAgentTool.inputSchema)

    expect(text).toContain('targets')
    expect(text).toContain('timeout_ms')
    expect(text).not.toContain('task_id')
    expect(text).not.toContain('task_ids')
    expect(text).not.toContain('agent_ids')
    expect(text).not.toContain('wait_mode')
  })

  test('list_agents returns Codex-style agents array', async () => {
    registerSubagentRecord({
      taskId: 'agent-running',
      agentId: 'agent-running',
      parentThreadId: 'parent-thread',
      sessionId: 'child-thread',
      objective: 'Fetch crash page',
      agentNickname: 'crash-reader',
    })

    const result = await ListAgentsTool.call({} as any)

    expect(result.data.agents?.map(agent => agent.agent_id)).toEqual([
      'agent-running',
    ])
    expect(schemaText(result.data)).not.toContain('records')
  })

  test('wait_agent returns completed status map and timed_out=false', async () => {
    registerSubagentRecord({
      taskId: 'agent-done',
      agentId: 'agent-done',
      objective: 'Read local skill',
      sessionId: 'child-thread',
    })
    completeSubagentRecord({
      agentId: 'agent-done',
      content: [{ type: 'text', text: '### STATUS\nDONE\n### SUMMARY\nComplete.' }],
    } as any)

    const result = await WaitAgentTool.call(
      {
        targets: ['agent-done'],
        timeout_ms: 1000,
      } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
    )

    expect(result.data).toEqual({
      status: {
        'agent-done': { completed: 'Complete.' },
      },
      timed_out: false,
    })
  })

  test('wait_agent returns empty status and timed_out=true on timeout', async () => {
    registerSubagentRecord({
      taskId: 'agent-running',
      agentId: 'agent-running',
      objective: 'Long running work',
      sessionId: 'child-thread',
    })

    const result = await WaitAgentTool.call(
      {
        targets: ['agent-running'],
        timeout_ms: 10,
      } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
    )

    expect(result.data).toEqual({
      status: {},
      timed_out: true,
    })
  })

  test('close_agent returns previous_status and closes the subtree', async () => {
    registerSubagentRecord({
      taskId: 'agent-parent',
      agentId: 'agent-parent',
      parentThreadId: 'root-thread',
      sessionId: 'parent-thread',
      objective: 'Parent agent',
    })
    registerSubagentRecord({
      taskId: 'agent-child',
      agentId: 'agent-child',
      parentThreadId: 'parent-thread',
      sessionId: 'child-thread',
      objective: 'Child agent',
    })

    const result = await CloseAgentTool.call(
      { target: 'agent-parent' } as any,
      { getAppState: () => ({ tasks: {} }), setAppState: () => undefined } as any,
    )
    const running = await ListAgentsTool.call({} as any)

    expect(result.data).toEqual({ previous_status: 'running' })
    expect(running.data.agents).toEqual([])
  })

  test('send_input returns a submission id instead of exposing legacy status fields', async () => {
    registerSubagentRecord({
      taskId: 'agent-running',
      agentId: 'agent-running',
      objective: 'Continue work',
      sessionId: 'child-thread',
    })

    const result = await SendInputAgentTool.call(
      {
        target: 'agent-running',
        message: 'Please inspect the failing test.',
      } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
      undefined as any,
      undefined as any,
    )

    expect(result.data.submission_id).toMatch(/^submission_/)
    expect(schemaText(result.data)).not.toContain('queued')
  })

  test('resume_agent returns not_found status for unknown agents', async () => {
    const result = await ResumeAgentTool.call(
      { id: 'missing-agent' } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
      undefined as any,
      undefined as any,
    )

    expect(result.data).toEqual({ status: 'not_found' })
  })
})
