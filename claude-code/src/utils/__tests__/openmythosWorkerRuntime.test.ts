import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }

type AgentLaunchInput = {
  description: string
  prompt: string
  subagent_type: string
  run_in_background: boolean
  dispatch_ticket?: string
}

const agentCalls: AgentLaunchInput[] = []
let launchStatus = 'async_launched'
let launchDelayMs = 0
let activeLaunches = 0
let maxActiveLaunches = 0

const agentToolCall = mock(async (input: AgentLaunchInput) => {
  activeLaunches += 1
  maxActiveLaunches = Math.max(maxActiveLaunches, activeLaunches)
  agentCalls.push(input)
  const callIndex = agentCalls.length
  try {
    if (launchDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, launchDelayMs))
    }
    return {
      data: {
        status: launchStatus,
        agentId: `agent-${callIndex}`,
        outputFile: `outputs/agent-${callIndex}.md`,
      },
    }
  } finally {
    activeLaunches -= 1
  }
})

mock.module('@mtl-code/builtin-tools/tools/AgentTool/constants.js', () => ({
  AGENT_TOOL_NAME: 'Agent',
  AGENT_SPAWN_TOOL_NAME: 'Agent',
  LEGACY_AGENT_TOOL_NAME: 'Task',
  VERIFICATION_AGENT_TYPE: 'verification',
  ONE_SHOT_BUILTIN_AGENT_TYPES: [],
}))

mock.module('@mtl-code/builtin-tools/tools/AgentTool/AgentTool.js', () => ({
  AgentTool: {
    name: 'Agent',
    call: agentToolCall,
  },
}))

const {
  buildOpenMythosRuntimeCard,
  createOpenMythosRuntimeState,
} = await import('../openmythosRuntime.js')
const {
  formatOpenMythosWorkerRuntimeMessage,
  runOpenMythosWorkerRuntime,
  shouldRunOpenMythosWorkerRuntime,
} = await import('../openmythosWorkerRuntime.js')

beforeEach(() => {
  process.env = { ...originalEnv }
  process.env.MTL_CODE_OPENMYTHOS_RUNTIME = '1'
  process.env.MTL_CODE_OPENMYTHOS_AUTO_DISPATCH = '1'
  process.env.MTL_CODE_COORDINATOR_MODE = '1'
  agentCalls.length = 0
  launchStatus = 'async_launched'
  launchDelayMs = 0
  activeLaunches = 0
  maxActiveLaunches = 0
  agentToolCall.mockClear()
})

afterEach(() => {
  process.env = { ...originalEnv }
})

const toolUseContext = {
  options: {
    tools: [{ name: 'Agent' }],
  },
} as any

const assistantMessage = {
  message: {
    content: [
      {
        type: 'text',
        text: [
          '派发计划：',
          '1. 我已完成本地初查，确认这不是单次读文件或单次 MCP 调用能完成的任务。',
          '2. 子代理负责独立审查迁移、测试和风险证据，不修改无关文件。',
          '3. 我本地继续整理约束和验收标准，等待 AgentResult 后再汇总。',
          '4. 验收标准：返回 DONE 的证据摘要，或 BLOCKED/NEED_PARENT_INPUT 的明确原因。',
        ].join('\n'),
      },
    ],
  },
} as any

const assistantMessageWithoutVisiblePlan = {
  message: {
    content: [
      {
        type: 'text',
        text: '我会启动 worker 来分析。',
      },
    ],
  },
} as any

const allowTool = async (_tool: unknown, input: unknown) => ({
  behavior: 'allow' as const,
  updatedInput: input,
})

function buildRuntimeStateWithWorkerPlan(goal: string) {
  const card = buildOpenMythosRuntimeCard(goal)
  if (!card) throw new Error('expected runtime card')
  const workerPlan = {
    planId: 'test-worker-plan',
    goal,
    effort: 'max' as const,
    status: 'previewed' as const,
    dispatchPolicy: {
      maxWorkers: 3,
      minEffort: 'medium' as const,
      requiresUserConfirmation: true,
    },
    assignments: [
      {
        assignmentId: 'worker-review',
        kind: 'security' as const,
        role: 'worker-review' as const,
        label: 'Security review worker',
        reason: 'security-sensitive change',
        required: true,
        description: 'Review security risk',
        objective: 'Review security risk',
        prompt: 'Review security risk',
      },
      {
        assignmentId: 'worker-verifier',
        kind: 'verification' as const,
        role: 'worker-verifier' as const,
        label: 'Verification worker',
        reason: 'tests and CI verification',
        required: true,
        description: 'Verify tests and CI',
        objective: 'Verify tests and CI',
        prompt: 'Verify tests and CI',
      },
      {
        assignmentId: 'worker-implementer',
        kind: 'implementation' as const,
        role: 'worker-implementer' as const,
        label: 'Implementation worker',
        reason: 'implementation requested',
        required: true,
        description: 'Implement the change',
        objective: 'Implement the change',
        prompt: 'Implement the change',
      },
    ],
  }

  return {
    card: {
      ...card,
      workerPlan,
    },
    state: createOpenMythosRuntimeState({
      ...card,
      workerPlan,
    }),
  }
}

describe('OpenMythos WorkerRuntime', () => {
  test('keeps generated worker plans inert while subagents are hard-disabled', async () => {
    const { card, state } = buildRuntimeStateWithWorkerPlan(
      'Implement an auth database migration with rollback tests and CI verification',
    )

    const roles = card.workerPlan.assignments.map(assignment => assignment.role)
    expect(roles).toContain('worker-review')
    expect(roles).toContain('worker-verifier')
    expect(roles).toContain('worker-implementer')

    expect(shouldRunOpenMythosWorkerRuntime(state, toolUseContext)).toBe(false)

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })

    expect(result.planId).toBe(card.workerPlan.planId)
    expect(result.errors).toEqual([])
    expect(result.launched).toEqual([])
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]?.steps.filter(step => step.type === 'subagent')).toHaveLength(
      card.workerPlan.assignments.length,
    )
    expect(agentCalls).toEqual([])
    expect(formatOpenMythosWorkerRuntimeMessage(result)).toContain('no workers')
  })

  test('does not launch worker assignments even when confirmation and visible plan are present', async () => {
    launchDelayMs = 25
    const { card, state } = buildRuntimeStateWithWorkerPlan(
      'Implement an auth database migration with rollback tests and CI verification',
    )
    expect(card.workerPlan.assignments.length).toBeGreaterThan(1)

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })

    expect(result.launched).toEqual([])
    expect(agentCalls).toEqual([])
    expect(maxActiveLaunches).toBe(0)
  })

  test('requires dispatch confirmation before launching workers', () => {
    const { state } = buildRuntimeStateWithWorkerPlan('Refactor multi-module architecture')

    expect(shouldRunOpenMythosWorkerRuntime(state, toolUseContext)).toBe(false)
  })

  test('does not evaluate visible dispatch plans while worker runtime is hard-disabled', async () => {
    const { state } = buildRuntimeStateWithWorkerPlan(
      'Implement an auth database migration with rollback tests and CI verification',
    )

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage: assistantMessageWithoutVisiblePlan,
    })

    expect(agentCalls).toHaveLength(0)
    expect(result.launched).toEqual([])
    expect(result.errors).toEqual([])
  })

  test('does not reach permission checks while worker runtime is hard-disabled', async () => {
    const { state } = buildRuntimeStateWithWorkerPlan('Refactor multi-module architecture')

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: (async () => ({ behavior: 'deny' as const })) as any,
      assistantMessage,
    })

    expect(agentCalls).toHaveLength(0)
    expect(result.errors).toEqual([])
    expect(result.launched).toEqual([])
  })

  test('does not call AgentTool while worker runtime is hard-disabled', async () => {
    launchStatus = 'completed'
    const { state } = buildRuntimeStateWithWorkerPlan('Refactor multi-module architecture')

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })

    expect(agentCalls).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.launched).toEqual([])
  })

  test('leaves runtime state untouched across repeated hard-disabled dispatch attempts', async () => {
    const { state } = buildRuntimeStateWithWorkerPlan('Refactor multi-module architecture')

    await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })
    const firstLaunchCount = agentCalls.length

    const second = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })

    expect(firstLaunchCount).toBe(0)
    expect(agentCalls).toHaveLength(firstLaunchCount)
    expect(second.launched).toEqual([])
    expect(shouldRunOpenMythosWorkerRuntime(state, toolUseContext)).toBe(false)
  })
})
