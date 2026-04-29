import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildOpenMythosRuntimeCard,
  formatOpenMythosRuntimeReminder,
  getOpenMythosRuntimeConfig,
  shouldAttachOpenMythosRuntimeCard,
  shouldApplyAdaptiveEffort,
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
    expect(card?.routes.join(' ')).toContain('Handle locally')
  })

  test('escalates risky implementation work and records routes', () => {
    const card = buildOpenMythosRuntimeCard(
      'Implement an auth database migration with rollback tests and CI verification',
    )

    expect(card?.effort).toBe('xhigh')
    expect(card?.reasons).toContain('security or privacy sensitive work')
    expect(card?.reasons).toContain('deployment, data, or CI risk')
    expect(card?.routes.join(' ')).toContain('security-focused skill')
    expect(card?.routes.join(' ')).toContain('verification pass')
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
    expect(reminder).toContain('Skill/subagent routing:')
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

    expect(card?.effort).toBe('xhigh')
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
