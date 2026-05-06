import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSubagentRegistryForTests,
  completeSubagentRecord,
  registerSubagentRecord,
} from 'src/tasks/subagentRegistry.js'
import {
  CloseAgentTool,
  FollowupTaskAgentTool,
  ListAgentsTool,
  SendMessageAgentTool,
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
    expect(SendMessageAgentTool.name).toBe('send_message')
    expect(FollowupTaskAgentTool.name).toBe('followup_task')

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
      'send_input',
      'resume_agent',
    ]
    for (const tool of [
      ListAgentsTool,
      WaitAgentTool,
      CloseAgentTool,
      SendMessageAgentTool,
      FollowupTaskAgentTool,
    ]) {
      expect(tool.aliases ?? []).toEqual([])
      for (const legacyName of legacyNames) {
        expect(tool.name).not.toBe(legacyName)
        expect(tool.aliases ?? []).not.toContain(legacyName)
      }
    }
  })

  test('wait_agent schema matches Codex mailbox timeout shape', () => {
    const text = schemaText(WaitAgentTool.inputSchema)

    expect(text).toContain('timeout_ms')
    expect(text).not.toContain('targets')
    expect(text).not.toContain('task_id')
    expect(text).not.toContain('task_ids')
    expect(text).not.toContain('agent_ids')
    expect(text).not.toContain('wait_mode')
  })

  test('control schemas do not ask the model for internal agent ids', () => {
    const text = schemaText({
      close: CloseAgentTool.inputSchema,
      send: SendMessageAgentTool.inputSchema,
      followup: FollowupTaskAgentTool.inputSchema,
      listOutput: ListAgentsTool.outputSchema,
    })

    expect(text).not.toContain('Agent id')
    expect(text).not.toContain('agent_id')
    expect(text).not.toContain('thread_id')
    expect(text).not.toContain('parent_thread_id')
    expect(text).not.toContain('taskId')
    expect(text).not.toContain('"interrupt"')
  })

  test('list_agents returns upstream agent_name status and last_task_message fields', async () => {
    registerSubagentRecord({
      taskId: 'agent-running',
      agentId: 'agent-running',
      taskName: '/root/fetch_crash_page',
      agentPath: '/root/fetch_crash_page',
      parentAgentPath: '/root',
      parentThreadId: '/root',
      sessionId: '/root/fetch_crash_page',
      objective: 'Fetch crash page',
      agentNickname: 'crash-reader',
    })

    const result = await ListAgentsTool.call({} as any)

    expect(result.data.agents).toEqual([
      {
        agent_name: '/root',
        agent_status: 'running',
        last_task_message: 'Main thread',
      },
      {
        agent_name: '/root/fetch_crash_page',
        agent_status: 'running',
        last_task_message: 'Fetch crash page',
      },
    ])
    expect(schemaText(result.data)).not.toContain('task_name')
    expect(schemaText(result.data)).not.toContain('nickname')
    expect(schemaText(result.data)).not.toContain('agent_id')
    expect(schemaText(result.data)).not.toContain('thread_id')
    expect(schemaText(result.data)).not.toContain('parent_thread_id')
    expect(schemaText(result.data)).not.toContain('records')
  })

  test('wait_agent returns mailbox completion message when new events exist', async () => {
    registerSubagentRecord({
      taskId: 'agent-done',
      agentId: 'agent-done',
      agentPath: '/root/read_local_skill',
      parentAgentPath: '/root',
      objective: 'Read local skill',
      sessionId: 'child-thread',
    })
    completeSubagentRecord({
      agentId: 'agent-done',
      content: [{ type: 'text', text: '### STATUS\nDONE\n### SUMMARY\nComplete.' }],
    } as any)

    const result = await WaitAgentTool.call({
      timeout_ms: 1000,
    } as any)

    expect(result.data.message).toBe('Wait completed.')
    expect(result.data.timed_out).toBe(false)
    expect(result.data.sequence).toBeGreaterThan(0)
    expect(result.data.updates).toEqual([
      expect.objectContaining({
        type: 'completed',
        agent_name: '/root/read_local_skill',
        agent_status: { completed: 'Complete.' },
        last_task_message: 'Read local skill',
        message: 'Complete.',
      }),
    ])

    const drained = await WaitAgentTool.call({
      timeout_ms: 10,
    } as any)
    expect(drained.data).toEqual({
      message: 'Wait timed out.',
      timed_out: true,
      sequence: result.data.sequence,
      updates: [],
    })
  })

  test('wait_agent returns empty status and timed_out=true on timeout', async () => {
    registerSubagentRecord({
      taskId: 'agent-running',
      agentId: 'agent-running',
      agentPath: '/root/long_running_work',
      parentAgentPath: '/root',
      objective: 'Long running work',
      sessionId: 'child-thread',
    })

    const result = await WaitAgentTool.call({
      timeout_ms: 10,
    } as any)

    expect(result.data).toEqual({
      message: 'Wait timed out.',
      timed_out: true,
      sequence: 0,
      updates: [],
    })
  })

  test('close_agent returns previous_status and closes the subtree', async () => {
    registerSubagentRecord({
      taskId: 'agent-parent',
      agentId: 'agent-parent',
      agentPath: '/root/a',
      parentAgentPath: '/root',
      parentThreadId: 'root-thread',
      sessionId: 'parent-thread',
      objective: 'Parent agent',
    })
    registerSubagentRecord({
      taskId: 'agent-child',
      agentId: 'agent-child',
      agentPath: '/root/a/child',
      parentAgentPath: '/root/a',
      parentThreadId: 'parent-thread',
      sessionId: 'child-thread',
      objective: 'Child agent',
    })
    registerSubagentRecord({
      taskId: 'agent-aa',
      agentId: 'agent-aa',
      agentPath: '/root/aa',
      parentAgentPath: '/root',
      parentThreadId: 'root-thread',
      sessionId: 'aa-thread',
      objective: 'Sibling prefix agent',
    })

    const result = await CloseAgentTool.call(
      { target: '/root/a' } as any,
      { getAppState: () => ({ tasks: {} }), setAppState: () => undefined } as any,
    )
    const running = await ListAgentsTool.call({} as any)

    expect(result.data).toEqual({ previous_status: 'running' })
    expect(running.data.agents).toEqual([
      {
        agent_name: '/root',
        agent_status: 'running',
        last_task_message: 'Main thread',
      },
      {
        agent_name: '/root/aa',
        agent_status: 'running',
        last_task_message: 'Sibling prefix agent',
      },
    ])
  })

  test('close_agent resolves bare targets relative to the current agent path', async () => {
    registerSubagentRecord({
      taskId: 'agent-parent',
      agentId: 'agent-parent',
      agentPath: '/root/a',
      parentAgentPath: '/root',
      objective: 'Parent agent',
    })
    registerSubagentRecord({
      taskId: 'agent-child',
      agentId: 'agent-child',
      agentPath: '/root/a/child',
      parentAgentPath: '/root/a',
      objective: 'Child agent',
    })

    const result = await CloseAgentTool.call(
      { target: 'child' } as any,
      {
        agentId: 'agent-parent',
        getAppState: () => ({ tasks: {} }),
        setAppState: () => undefined,
      } as any,
    )
    const running = await ListAgentsTool.call({} as any)

    expect(result.data).toEqual({ previous_status: 'running' })
    expect(running.data.agents.map(agent => agent.agent_name)).toEqual([
      '/root',
      '/root/a',
    ])
  })

  test('send_message is queue-only, drains mailbox updates, and does not resolve ids or nicknames', async () => {
    registerSubagentRecord({
      taskId: 'agent-running',
      agentId: 'agent-running',
      taskName: '/root/continue_work',
      agentPath: '/root/continue_work',
      parentAgentPath: '/root',
      objective: 'Continue work',
      sessionId: 'child-thread',
      agentNickname: 'continue-nick',
    })

    const result = await SendMessageAgentTool.call(
      {
        target: '/root/continue_work',
        message: 'Please inspect the failing test.',
      } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
      (() => {
        throw new Error('send_message must not trigger or resume an agent')
      }) as any,
      undefined as any,
    )

    expect(result.data).toBe('')
    const mailbox = await WaitAgentTool.call({ timeout_ms: 10 } as any)
    expect(mailbox.data).toEqual({
      message: 'Wait completed.',
      timed_out: false,
      sequence: expect.any(Number),
      updates: [
        expect.objectContaining({
          type: 'message',
          agent_name: '/root/continue_work',
          from_agent_name: '/root',
          to_agent_name: '/root/continue_work',
          delivery_mode: 'queue_only',
          message: 'Please inspect the failing test.',
        }),
      ],
    })

    await expect(
      SendMessageAgentTool.call(
        { target: 'agent-running', message: 'This should not resolve by id.' } as any,
        { getAppState: () => ({ tasks: {} }) } as any,
        (() => Promise.resolve({ behavior: 'allow' })) as any,
        undefined as any,
      ),
    ).rejects.toThrow('live agent path')
    await expect(
      SendMessageAgentTool.call(
        { target: 'continue-nick', message: 'This should not resolve by nickname.' } as any,
        { getAppState: () => ({ tasks: {} }) } as any,
        (() => Promise.resolve({ behavior: 'allow' })) as any,
        undefined as any,
      ),
    ).rejects.toThrow('live agent path')
  })

  test('followup_task rejects root and triggers known stopped agents', async () => {
    expect(
      await FollowupTaskAgentTool.validateInput?.({
        target: '/root',
        message: 'Do work.',
      } as any),
    ).toEqual({
      result: false,
      message: "Tasks can't be assigned to the root agent",
      errorCode: 3,
    })

    registerSubagentRecord({
      taskId: 'agent-stopped',
      agentId: 'agent-stopped',
      taskName: '/root/review_runtime',
      agentPath: '/root/review_runtime',
      parentAgentPath: '/root',
      objective: 'Review runtime',
      sessionId: '/root/review_runtime',
    })
    completeSubagentRecord({
      agentId: 'agent-stopped',
      content: [{ type: 'text', text: '### STATUS\nDONE\n### SUMMARY\nComplete.' }],
    } as any)

    let didTrigger = false
    const result = await FollowupTaskAgentTool.call(
      {
        target: 'review_runtime',
        message: 'Inspect the next failing test.',
      } as any,
      { getAppState: () => ({ tasks: {} }) } as any,
      (() => {
        didTrigger = true
        return Promise.resolve({ behavior: 'allow' })
      }) as any,
      undefined as any,
    )

    expect(didTrigger).toBe(true)
    expect(result.data).toBe('')
    const mailbox = await WaitAgentTool.call({ timeout_ms: 10 } as any)
    expect(mailbox.data.updates).toContainEqual(
      expect.objectContaining({
        type: 'message',
        agent_name: '/root/review_runtime',
        from_agent_name: '/root',
        to_agent_name: '/root/review_runtime',
        delivery_mode: 'trigger_turn',
        message: 'Inspect the next failing test.',
      }),
    )
  })
})
