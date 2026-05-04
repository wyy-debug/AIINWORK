import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }

type AgentLaunchInput = {
  description: string
  prompt: string
  subagent_type: string
  run_in_background: boolean
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
  process.env.MTL_CODE_OPENMYTHOS_DISPATCH_CONFIRMED = '1'
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

const assistantMessage = {} as any

const allowTool = async (_tool: unknown, input: unknown) => ({
  behavior: 'allow' as const,
  updatedInput: input,
})

describe('OpenMythos WorkerRuntime', () => {
  test('generates role-specific assignments and launches confirmed worker plan', async () => {
    const card = buildOpenMythosRuntimeCard(
      'Implement an auth database migration with rollback tests and CI verification',
    )
    if (!card?.workerPlan) throw new Error('expected worker plan')

    const roles = card.workerPlan.assignments.map(assignment => assignment.role)
    expect(roles).toContain('worker-review')
    expect(roles).toContain('worker-verifier')
    expect(roles).toContain('worker-implementer')

    const state = createOpenMythosRuntimeState(card)
    expect(shouldRunOpenMythosWorkerRuntime(state, toolUseContext)).toBe(true)

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })

    expect(result.planId).toBe(card.workerPlan.planId)
    expect(result.errors).toEqual([])
    expect(result.launched).toHaveLength(card.workerPlan.assignments.length)
    expect(result.launched.every(run => run.status === 'running')).toBe(true)
    expect(agentCalls.every(call => call.run_in_background === true)).toBe(true)
    expect(agentCalls.map(call => call.subagent_type)).toEqual(roles)
    expect(agentCalls[0]?.prompt).toContain('### SUMMARY')
    expect(formatOpenMythosWorkerRuntimeMessage(result)).toContain(card.workerPlan.planId)
  })

  test('launches worker assignments concurrently after confirmation', async () => {
    launchDelayMs = 25
    const card = buildOpenMythosRuntimeCard(
      'Implement an auth database migration with rollback tests and CI verification',
    )
    if (!card?.workerPlan) throw new Error('expected worker plan')
    expect(card.workerPlan.assignments.length).toBeGreaterThan(1)

    const state = createOpenMythosRuntimeState(card)
    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })

    expect(result.launched).toHaveLength(card.workerPlan.assignments.length)
    expect(maxActiveLaunches).toBeGreaterThan(1)
    expect(result.launched.map(run => run.assignmentId)).toEqual(
      card.workerPlan.assignments.map(assignment => assignment.assignmentId),
    )
  })

  test('requires dispatch confirmation before launching workers', () => {
    delete process.env.MTL_CODE_OPENMYTHOS_DISPATCH_CONFIRMED
    const card = buildOpenMythosRuntimeCard('Refactor multi-module architecture')
    if (!card?.workerPlan) throw new Error('expected worker plan')
    const state = createOpenMythosRuntimeState(card)

    expect(shouldRunOpenMythosWorkerRuntime(state, toolUseContext)).toBe(false)
  })

  test('records permission denial as failed worker run', async () => {
    const card = buildOpenMythosRuntimeCard('Refactor multi-module architecture')
    if (!card?.workerPlan) throw new Error('expected worker plan')
    const state = createOpenMythosRuntimeState(card)

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: (async () => ({ behavior: 'deny' as const })) as any,
      assistantMessage,
    })

    expect(agentCalls).toHaveLength(0)
    expect(result.errors[0]).toContain('denied by permission policy')
    expect(result.launched[0]?.status).toBe('failed')
  })

  test('records non-async AgentTool response as failed worker run', async () => {
    launchStatus = 'completed'
    const card = buildOpenMythosRuntimeCard('Refactor multi-module architecture')
    if (!card?.workerPlan) throw new Error('expected worker plan')
    const state = createOpenMythosRuntimeState(card)

    const result = await runOpenMythosWorkerRuntime({
      state,
      toolUseContext,
      canUseTool: allowTool as any,
      assistantMessage,
    })

    expect(agentCalls.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('did not launch asynchronously')
    expect(result.launched[0]?.status).toBe('failed')
  })

  test('prevents duplicate dispatch for the same runtime state', async () => {
    const card = buildOpenMythosRuntimeCard('Refactor multi-module architecture')
    if (!card?.workerPlan) throw new Error('expected worker plan')
    const state = createOpenMythosRuntimeState(card)

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

    expect(firstLaunchCount).toBeGreaterThan(0)
    expect(agentCalls).toHaveLength(firstLaunchCount)
    expect(second.launched).toEqual([])
    expect(shouldRunOpenMythosWorkerRuntime(state, toolUseContext)).toBe(false)
  })
})
