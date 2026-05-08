import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  emptyGoalUsageSnapshot,
  goalEventToSdkSystemMessage,
  getAssistantUsageSnapshot,
  getGoalUsageDelta,
  shouldStartIdleGoalContinuation,
} from '../threadGoalRuntime'

describe('thread goal runtime helpers', () => {
  test('computes delta usage and leaves cached input available for subtraction', () => {
    const previous = { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 }
    const current = { inputTokens: 150, cachedInputTokens: 70, outputTokens: 25 }

    expect(getGoalUsageDelta(previous, current)).toEqual({
      inputTokens: 50,
      cachedInputTokens: 30,
      outputTokens: 15,
    })
  })

  test('treats lower current usage as a fresh provider snapshot', () => {
    const previous = { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 120 }
    const current = { inputTokens: 60, cachedInputTokens: 20, outputTokens: 10 }

    expect(getGoalUsageDelta(previous, current)).toEqual({
      inputTokens: 60,
      cachedInputTokens: 20,
      outputTokens: 10,
    })
  })

  test('extracts cached input tokens from assistant usage shapes', () => {
    const snapshot = getAssistantUsageSnapshot([
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 200,
            cached_input_tokens: 50,
            output_tokens: 25,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 30 },
            output_tokens: 10,
          },
        },
      },
    ] as any)

    expect(snapshot).toEqual({
      inputTokens: 300,
      cachedInputTokens: 80,
      outputTokens: 35,
    })
  })

  test('idle continuation guard suppresses unsafe or stale contexts', () => {
    const goal = {
      goalId: 'goal-1',
      status: 'active',
    } as const

    expect(shouldStartIdleGoalContinuation({
      goalsEnabled: true,
      isMainThread: true,
      permissionMode: 'acceptEdits',
      hasRunningTurn: false,
      hasQueuedPromptOrTask: false,
      aborted: false,
      materialized: true,
      expectedGoalId: 'goal-1',
      goal,
    })).toBe(true)

    for (const blocked of [
      { goalsEnabled: false },
      { isMainThread: false },
      { permissionMode: 'plan' },
      { hasRunningTurn: true },
      { hasQueuedPromptOrTask: true },
      { aborted: true },
      { materialized: false },
      { expectedGoalId: 'goal-2' },
      { goal: { goalId: 'goal-1', status: 'paused' as const } },
    ]) {
      expect(shouldStartIdleGoalContinuation({
        goalsEnabled: true,
        isMainThread: true,
        permissionMode: 'acceptEdits',
        hasRunningTurn: false,
        hasQueuedPromptOrTask: false,
        aborted: false,
        materialized: true,
        expectedGoalId: 'goal-1',
        goal,
        ...blocked,
      })).toBe(false)
    }
  })

  test('empty usage snapshot is all zeros', () => {
    expect(emptyGoalUsageSnapshot()).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    })
  })

  test('formats thread goal events as ordered SDK system messages', () => {
    const message = goalEventToSdkSystemMessage({
      eventId: 7,
      threadId: 'session-1',
      goalId: 'goal-1',
      eventType: 'thread_goal_lifecycle',
      lifecycleType: 'ThreadResumed',
      goal: null,
      payload: { resumed: true },
      createdAtMs: 1000,
    })

    expect(message).toMatchObject({
      type: 'system',
      subtype: 'thread_goal_lifecycle',
      session_id: 'session-1',
      event_id: 7,
      goal_id: 'goal-1',
      lifecycle_type: 'ThreadResumed',
      payload: { resumed: true },
    })
    expect(message.uuid).toBeTruthy()
  })

  test('query and print runtime wire goal lifecycle and stream-json events', () => {
    const repoRoot = join(import.meta.dir, '..', '..')
    const querySource = readFileSync(join(repoRoot, 'query.ts'), 'utf8')
    const printSource = readFileSync(join(repoRoot, 'cli', 'print.ts'), 'utf8')

    expect(querySource).toContain('recordThreadGoalLifecycleEvent')
    expect(querySource).toContain('TurnStarted')
    expect(querySource).toContain('ToolCompleted')
    expect(querySource).toContain('TaskAborted')
    expect(querySource).toContain('refreshGoalAccountingStateAfterTools')
    expect(printSource).toContain('subscribeThreadGoalEvents')
    expect(printSource).toContain('goalEventToSdkSystemMessage')
    expect(printSource).toContain('ThreadResumed')
  })
})
