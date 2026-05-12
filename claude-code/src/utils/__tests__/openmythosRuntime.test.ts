import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildOpenMythosRuntimeCard,
  createOpenMythosRuntimeState,
  formatOpenMythosRuntimeReminder,
  getOpenMythosRuntimeConfig,
  getOpenMythosPhase,
  isOpenMythosReadOnlyPhase,
  shouldHardBlockOpenMythosReadOnlyPhase,
  shouldAttachOpenMythosRuntimeCard,
  shouldApplyAdaptiveEffort,
  shouldEnforceOpenMythosLoopBudget,
} from '../openmythosRuntime.js'

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.MTL_CODE_OPENMYTHOS_RUNTIME = '1'
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('openmythos runtime card', () => {
  test('is disabled by default without explicit runtime opt-in', () => {
    delete process.env.MTL_CODE_OPENMYTHOS_RUNTIME

    expect(getOpenMythosRuntimeConfig().enabled).toBe(false)
    expect(buildOpenMythosRuntimeCard('Implement auth migration')).toBeNull()
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(false)
    expect(shouldAttachOpenMythosRuntimeCard()).toBe(false)
  })

  test('classifies small conversational prompts as low effort without worker plans', () => {
    const card = buildOpenMythosRuntimeCard('thanks, what branch am I on?')

    expect(card?.effort).toBe('low')
    expect(card?.loopBudget).toBe(2)
    expect(card?.phasePlan).toEqual(['orient', 'finalize'])
    expect(card?.routes.join(' ')).toContain('Handle locally')
    expect(card).not.toHaveProperty('workerPlan')
  })

  test('escalates risky implementation work and records advisory routes only', () => {
    const card = buildOpenMythosRuntimeCard(
      'Implement an auth database migration with rollback tests and CI verification',
    )

    expect(card?.effort).toBe('max')
    expect(card?.loopBudget).toBe(6)
    expect(card?.reasons).toContain('security or privacy sensitive work')
    expect(card?.reasons).toContain('deployment, data, or CI risk')
    expect(card?.routes.join(' ')).toContain('security-focused skill')
    expect(card?.routes.join(' ')).toContain('verification pass')
    expect(card?.expertRoutes.map(route => route.kind)).toContain('security')
    expect(card).not.toHaveProperty('workerPlan')
    expect(card?.phasePlan).toEqual([
      'orient',
      'plan',
      'implement',
      'verify',
      'finalize',
    ])
  })

  test('treats terse code review requests as multi-turn tool work', () => {
    const card = buildOpenMythosRuntimeCard('review代码')

    expect(card?.effort).toBe('high')
    expect(card?.loopBudget).toBeGreaterThanOrEqual(4)
    expect(card?.reasons).toContain('code review requested')
    expect(card?.routes.join(' ')).toContain('Inspect git status')
    expect(card?.phasePlan).toEqual([
      'orient',
      'plan',
      'implement',
      'verify',
      'finalize',
    ])
    expect(card?.loopBudget).toBeGreaterThanOrEqual(card?.phasePlan.length ?? 0)
    expect(getOpenMythosPhase(card!, card!.loopBudget)).toBe('finalize')
  })

  test('keeps code review runtime card active in bare simple mode', () => {
    process.env.MTL_CODE_SIMPLE = '1'

    const card = buildOpenMythosRuntimeCard('review代码')

    expect(card?.reasons).toContain('code review requested')
    expect(card?.routes.join(' ')).toContain('Inspect git status')
  })

  test('formats reminder as advisory-only and never mentions old dispatch tools', () => {
    const card = buildOpenMythosRuntimeCard('Refactor multi-module architecture')
    if (!card) throw new Error('expected runtime card')

    const reminder = formatOpenMythosRuntimeReminder(card)

    expect(reminder).toContain('Frozen goal: Refactor multi-module architecture')
    expect(reminder).toContain('OpenMythos is advisory only')
    expect(reminder).toContain('spawn_agent only when the user explicitly asks')
    expect(reminder).not.toContain('AgentDispatchPlan')
    expect(reminder).not.toContain('dispatch_ticket')
    expect(reminder).not.toContain('MTL_CODE_OPENMYTHOS_WORKER_PLAN')
  })

  test('creates enforced runtime state with read-only early phases', () => {
    const card = buildOpenMythosRuntimeCard('Implement auth migration')
    if (!card) throw new Error('expected runtime card')

    const state = createOpenMythosRuntimeState(card)

    expect(state.loopControl).toBe('enforced')
    expect(shouldEnforceOpenMythosLoopBudget(state)).toBe(true)
    expect(state.phase).toBe('orient')
    expect(isOpenMythosReadOnlyPhase(state)).toBe(true)
  })

  test('hard-blocks read-only phases only for review and plan mode', () => {
    const implementationCard = buildOpenMythosRuntimeCard('Implement auth migration')
    const reviewCard = buildOpenMythosRuntimeCard('review代码')
    if (!implementationCard || !reviewCard) throw new Error('expected runtime cards')

    expect(
      shouldHardBlockOpenMythosReadOnlyPhase(
        createOpenMythosRuntimeState(implementationCard),
        'acceptEdits',
      ),
    ).toBe(false)
    expect(
      shouldHardBlockOpenMythosReadOnlyPhase(
        createOpenMythosRuntimeState(implementationCard),
        'plan',
      ),
    ).toBe(true)
    expect(
      shouldHardBlockOpenMythosReadOnlyPhase(
        createOpenMythosRuntimeState(reviewCard),
        'acceptEdits',
      ),
    ).toBe(true)
  })

  test('uses advisory phase hints instead of write bans for ordinary implementation work', () => {
    const implementationCard = buildOpenMythosRuntimeCard('Implement auth migration')
    if (!implementationCard) throw new Error('expected runtime card')

    const reminder = formatOpenMythosRuntimeReminder(
      implementationCard,
      createOpenMythosRuntimeState(implementationCard),
    )

    expect(reminder).toContain('Phase hint')
    expect(reminder).not.toContain('Do not write files')
  })

  test('does not override explicit session or environment effort', () => {
    expect(shouldApplyAdaptiveEffort('high')).toBe(false)

    process.env.MTL_CODE_EFFORT_LEVEL = 'low'
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(false)

    process.env.MTL_CODE_EFFORT_LEVEL = 'auto'
    expect(shouldApplyAdaptiveEffort(undefined)).toBe(false)
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

  test('does not produce worker plans for task notifications', () => {
    const card = buildOpenMythosRuntimeCard(`
      <task-notification>
        <task-id>agent-a1b</task-id>
        <status>completed</status>
        <summary>Implementation worker completed</summary>
        <result>Implement an auth database migration with rollback tests and CI verification.</result>
      </task-notification>
    `)

    expect(card).not.toHaveProperty('workerPlan')
    expect(formatOpenMythosRuntimeReminder(card!)).toContain('advisory only')
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
})
