import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildOpenMythosRuntimeCard,
  createOpenMythosRuntimeState,
  formatOpenMythosRuntimeReminder,
  getOpenMythosRuntimeConfig,
  isOpenMythosReadOnlyPhase,
  shouldAttachOpenMythosRuntimeCard,
  shouldApplyAdaptiveEffort,
  shouldEnforceOpenMythosLoopBudget,
} from '../openmythosRuntime.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('openmythos runtime card', () => {
  test('classifies small conversational prompts as low effort', () => {
    const card = buildOpenMythosRuntimeCard('thanks, what branch am I on?')

    expect(card?.effort).toBe('low')
    expect(card?.loopBudget).toBe(2)
    expect(card?.phasePlan).toEqual(['orient', 'finalize'])
    expect(card?.routes.join(' ')).toContain('Handle locally')
    expect(card?.dispatchPlan).toEqual([])
  })

  test('escalates risky implementation work and records routes', () => {
    process.env.MTL_CODE_COORDINATOR_MODE = '1'
    const card = buildOpenMythosRuntimeCard(
      'Implement an auth database migration with rollback tests and CI verification',
    )

    expect(card?.effort).toBe('max')
    expect(card?.loopBudget).toBe(6)
    expect(card?.reasons).toContain('security or privacy sensitive work')
    expect(card?.reasons).toContain('deployment, data, or CI risk')
    expect(card?.routes.join(' ')).toContain('security-focused skill')
    expect(card?.routes.join(' ')).toContain('verification pass')
    expect(card?.riskScore).toBeGreaterThanOrEqual(8)
    expect(card?.expertRoutes.map(route => route.kind)).toContain('security')
    expect(card?.dispatchPlan.map(task => task.kind)).toContain('security')
    expect(card?.dispatchPlan.map(task => task.kind)).toContain('verification')
    expect(card?.phasePlan).toEqual([
      'orient',
      'plan',
      'implement',
      'verify',
      'finalize',
    ])
  })

  test('adds plan-mode no-mutation constraint', () => {
    const card = buildOpenMythosRuntimeCard('Plan a broad refactor', 'plan')

    expect(card?.constraints.join(' ')).toContain('do not mutate tracked files')
  })

  test('formats the frozen goal reminder', () => {
    const card = buildOpenMythosRuntimeCard('Fix flaky tests')
    if (!card) throw new Error('expected runtime card')

    const reminder = formatOpenMythosRuntimeReminder(card)

    expect(reminder).toContain('Frozen goal: Fix flaky tests')
    expect(reminder).toContain('Adaptive effort:')
    expect(reminder).toContain('Current phase:')
    expect(reminder).toContain('Expert routes:')
    expect(reminder).toContain('Auto-dispatch worker plan:')
  })

  test('creates enforced runtime state with read-only early phases', () => {
    const card = buildOpenMythosRuntimeCard('Implement auth migration')
    if (!card) throw new Error('expected runtime card')

    const state = createOpenMythosRuntimeState(card)

    expect(state.loopControl).toBe('enforced')
    expect(state.hardDispatchAttempted).toBe(false)
    expect(shouldEnforceOpenMythosLoopBudget(state)).toBe(true)
    expect(state.phase).toBe('orient')
    expect(isOpenMythosReadOnlyPhase(state)).toBe(true)
  })

  test('does not override explicit session or environment effort', () => {
    expect(shouldApplyAdaptiveEffort('high')).toBe(false)

    process.env.MTL_CODE_EFFORT_LEVEL = 'low'
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(false)

    process.env.MTL_CODE_EFFORT_LEVEL = 'auto'
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(false)
  })

  test('can disable the runtime entirely', () => {
    process.env.MTL_CODE_OPENMYTHOS_RUNTIME = '0'

    expect(buildOpenMythosRuntimeCard('Implement auth migration')).toBeNull()
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(false)
    expect(shouldAttachOpenMythosRuntimeCard()).toBe(false)
  })

  test('can disable adaptive effort without disabling the task card', () => {
    process.env.MTL_CODE_OPENMYTHOS_ADAPTIVE_EFFORT = '0'

    const card = buildOpenMythosRuntimeCard('Implement auth migration')

    expect(card?.effort).toBe('max')
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(false)
    expect(shouldAttachOpenMythosRuntimeCard()).toBe(true)
  })

  test('can disable task-card attachment independently', () => {
    process.env.MTL_CODE_OPENMYTHOS_TASK_CARD = '0'

    expect(buildOpenMythosRuntimeCard('Implement auth migration')).not.toBeNull()
    expect(shouldAttachOpenMythosRuntimeCard()).toBe(false)
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(true)
  })

  test('can disable routing hints independently', () => {
    process.env.MTL_CODE_OPENMYTHOS_ROUTING_HINTS = '0'
    const card = buildOpenMythosRuntimeCard('Implement auth migration')
    if (!card) throw new Error('expected runtime card')

    expect(card.routes).toEqual([])
    expect(formatOpenMythosRuntimeReminder(card)).toContain(
      'Skill/subagent routing: disabled',
    )
  })

  test('only dispatches workers in coordinator mode above the configured effort', () => {
    const prompt = 'Refactor multi-module architecture'
    let card = buildOpenMythosRuntimeCard(prompt)
    expect(card?.dispatchPlan).toEqual([])

    process.env.MTL_CODE_COORDINATOR_MODE = '1'
    card = buildOpenMythosRuntimeCard(prompt)
    expect(card?.dispatchPlan.length).toBeGreaterThan(0)
    expect(formatOpenMythosRuntimeReminder(card!)).toContain(
      'Coordinator instruction: before direct implementation',
    )

    process.env.MTL_CODE_OPENMYTHOS_AUTO_DISPATCH_MIN_EFFORT = 'high'
    card = buildOpenMythosRuntimeCard(prompt)
    expect(card?.dispatchPlan).toEqual([])
  })

  test('can disable auto-dispatch and cap worker count', () => {
    process.env.MTL_CODE_COORDINATOR_MODE = '1'
    process.env.MTL_CODE_OPENMYTHOS_AUTO_DISPATCH = '0'
    let card = buildOpenMythosRuntimeCard(
      'Implement an auth database migration with rollback tests and CI verification',
    )
    expect(card?.dispatchPlan).toEqual([])

    process.env.MTL_CODE_OPENMYTHOS_AUTO_DISPATCH = '1'
    process.env.MTL_CODE_OPENMYTHOS_AUTO_DISPATCH_MAX_WORKERS = '2'
    card = buildOpenMythosRuntimeCard(
      'Implement an auth database migration with rollback tests and CI verification plus frontend verification',
    )
    expect(card?.dispatchPlan.length).toBeLessThanOrEqual(2)
  })

  test('does not auto-dispatch again for worker task notifications', () => {
    process.env.MTL_CODE_COORDINATOR_MODE = '1'

    const card = buildOpenMythosRuntimeCard(`
      <task-notification>
        <task-id>agent-a1b</task-id>
        <status>completed</status>
        <summary>Implementation worker completed</summary>
        <result>Implement an auth database migration with rollback tests and CI verification.</result>
      </task-notification>
    `)

    expect(card?.dispatchPlan).toEqual([])
    expect(formatOpenMythosRuntimeReminder(card!)).toContain(
      'no automatic worker dispatch is required',
    )
  })

  test('reminder suppresses duplicate coordinator dispatch after hard dispatch', () => {
    process.env.MTL_CODE_COORDINATOR_MODE = '1'
    const card = buildOpenMythosRuntimeCard('Refactor multi-module architecture')
    if (!card) throw new Error('expected runtime card')
    const state = createOpenMythosRuntimeState(card)

    state.hardDispatchAttempted = true

    expect(formatOpenMythosRuntimeReminder(card, state)).toContain(
      'worker dispatch was already attempted',
    )
  })

  test('can switch loop control to advisory and disable expert routing', () => {
    process.env.MTL_CODE_OPENMYTHOS_LOOP_CONTROL = 'advisory'
    process.env.MTL_CODE_OPENMYTHOS_EXPERT_ROUTING = '0'

    const card = buildOpenMythosRuntimeCard('Implement auth migration')
    if (!card) throw new Error('expected runtime card')
    const state = createOpenMythosRuntimeState(card)

    expect(getOpenMythosRuntimeConfig().loopControl).toBe('advisory')
    expect(shouldEnforceOpenMythosLoopBudget(state)).toBe(false)
    expect(card.expertRoutes).toEqual([])
  })

  test('clamps adaptive effort to configured bounds', () => {
    process.env.MTL_CODE_OPENMYTHOS_MIN_EFFORT = 'medium'
    process.env.MTL_CODE_OPENMYTHOS_MAX_EFFORT = 'high'

    expect(buildOpenMythosRuntimeCard('thanks')?.effort).toBe('medium')
    expect(
      buildOpenMythosRuntimeCard(
        'Implement an auth database migration with rollback tests and CI verification',
      )?.effort,
    ).toBe('high')
  })

  test('normalizes inverted effort bounds', () => {
    process.env.MTL_CODE_OPENMYTHOS_MIN_EFFORT = 'xhigh'
    process.env.MTL_CODE_OPENMYTHOS_MAX_EFFORT = 'medium'

    expect(getOpenMythosRuntimeConfig().minEffort).toBe('medium')
    expect(getOpenMythosRuntimeConfig().maxEffort).toBe('xhigh')
  })
})
