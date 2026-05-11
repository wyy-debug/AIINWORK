import { describe, expect, test } from 'bun:test'
import {
  hasFullHistoryForkOverride,
  normalizeForkTurnsForOverrides,
} from '../inputNormalization.js'

describe('spawn_agent input normalization', () => {
  test('detects full-history fork combined with role model or reasoning overrides', () => {
    expect(
      hasFullHistoryForkOverride({
        fork_turns: 'all',
        agent_type: 'reviewer',
      }),
    ).toBe(true)
    expect(
      hasFullHistoryForkOverride({
        fork_turns: ' all ',
        model: 'gpt-5.5',
      }),
    ).toBe(true)
    expect(
      hasFullHistoryForkOverride({
        fork_turns: 'all',
        reasoning_effort: 'high',
      }),
    ).toBe(true)
  })

  test('normalizes conflicting full-history fork to isolated context', () => {
    expect(
      normalizeForkTurnsForOverrides({
        fork_turns: 'all',
        agent_type: 'reviewer',
      }),
    ).toBe('none')
    expect(
      normalizeForkTurnsForOverrides({
        fork_turns: ' all ',
        model: 'gpt-5.5',
      }),
    ).toBe('none')
  })

  test('preserves explicit full-history fork without overrides', () => {
    expect(normalizeForkTurnsForOverrides({ fork_turns: 'all' })).toBe('all')
  })
})
