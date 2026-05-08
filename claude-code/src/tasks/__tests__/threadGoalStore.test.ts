import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { Database } from 'bun:sqlite'

import {
  accountThreadGoalUsage,
  buildGoalBudgetLimitPrompt,
  buildGoalContinuationPrompt,
  clearThreadGoal,
  clearThreadGoalStoreForTests,
  createThreadGoal,
  getThreadGoalEventsAfter,
  getThreadGoal,
  recordThreadGoalLifecycleEvent,
  replaceThreadGoal,
  resumeThreadGoal,
  setThreadGoalLegacyStorePathForTests,
  setThreadGoalStorePathForTests,
  pauseThreadGoal,
  subscribeThreadGoalEvents,
} from '../threadGoalStore.js'

describe('thread goal store', () => {
  let tempDir: string
  let storePath: string
  let legacyStorePath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'argus-goals-'))
    storePath = join(tempDir, 'thread-goals.db')
    legacyStorePath = join(tempDir, 'thread-goals.json')
    setThreadGoalStorePathForTests(storePath)
    setThreadGoalLegacyStorePathForTests(legacyStorePath)
    clearThreadGoalStoreForTests()
  })

  afterEach(async () => {
    clearThreadGoalStoreForTests()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates and reads a thread goal', () => {
    const goal = createThreadGoal('thread-1', {
      objective: 'Finish the migration',
      tokenBudget: 1200,
    })

    expect(goal.threadId).toBe('thread-1')
    expect(goal.objective).toBe('Finish the migration')
    expect(goal.status).toBe('active')
    expect(goal.tokenBudget).toBe(1200)
    expect(goal.tokensUsed).toBe(0)
    expect(getThreadGoal('thread-1')?.goalId).toBe(goal.goalId)
  })

  it('persists goals in a SQLite thread_goals table', () => {
    const goal = createThreadGoal('thread-sqlite', {
      objective: 'Persist in sqlite',
      tokenBudget: 1200,
    })

    expect(existsSync(storePath)).toBe(true)
    const db = new Database(storePath, { readonly: true })
    try {
      const row = db
        .query('SELECT thread_id, goal_id, objective, status, token_budget FROM thread_goals WHERE thread_id = ?')
        .get('thread-sqlite') as Record<string, unknown> | null
      expect(row).toEqual({
        thread_id: 'thread-sqlite',
        goal_id: goal.goalId,
        objective: 'Persist in sqlite',
        status: 'active',
        token_budget: 1200,
      })
    } finally {
      db.close()
    }
  })

  it('rejects creating over an existing non-complete goal', () => {
    createThreadGoal('thread-1', { objective: 'First goal' })

    expect(() =>
      createThreadGoal('thread-1', { objective: 'Second goal' }),
    ).toThrow(/already has an active goal/i)
  })

  it('replaces, pauses, resumes, and clears goals through user/runtime controls', () => {
    createThreadGoal('thread-1', { objective: 'Old goal' })

    const replacement = replaceThreadGoal('thread-1', {
      objective: 'New goal',
      tokenBudget: 500,
    })
    expect(replacement.objective).toBe('New goal')

    expect(pauseThreadGoal('thread-1')?.status).toBe('paused')
    expect(resumeThreadGoal('thread-1')?.status).toBe('active')

    clearThreadGoal('thread-1')
    expect(getThreadGoal('thread-1')).toBeNull()
  })

  it('rejects stale expected goal ids without mutating the current goal', () => {
    const goal = createThreadGoal('thread-1', { objective: 'Guarded goal' })
    const eventsBefore = getThreadGoalEventsAfter(0)
    const pauseWithCas = pauseThreadGoal as unknown as (
      threadId: string,
      options?: { expectedGoalId?: string },
    ) => ReturnType<typeof pauseThreadGoal>

    expect(pauseWithCas('thread-1', { expectedGoalId: 'stale-goal-id' })).toBeNull()

    const current = getThreadGoal('thread-1')
    expect(current?.goalId).toBe(goal.goalId)
    expect(current?.status).toBe('active')
    expect(getThreadGoalEventsAfter(0)).toHaveLength(eventsBefore.length)
  })

  it('records ordered goal mutation and lifecycle events in SQLite', () => {
    const created = createThreadGoal('thread-events', { objective: 'Emit events' })
    const paused = pauseThreadGoal('thread-events', { expectedGoalId: created.goalId })
    const lifecycle = recordThreadGoalLifecycleEvent('thread-events', 'TurnStarted', {
      baseline: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    })
    clearThreadGoal('thread-events')

    const events = getThreadGoalEventsAfter(0)
    expect(events.map(event => event.eventType)).toEqual([
      'thread_goal_updated',
      'thread_goal_updated',
      'thread_goal_lifecycle',
      'thread_goal_cleared',
    ])
    expect(events.map(event => event.eventId)).toEqual([
      events[0]!.eventId,
      events[0]!.eventId + 1,
      events[0]!.eventId + 2,
      events[0]!.eventId + 3,
    ])
    expect(events[0]?.goal?.goalId).toBe(created.goalId)
    expect(events[1]?.goal?.status).toBe(paused?.status)
    expect(events[2]?.lifecycleType).toBe('TurnStarted')
    expect(events[2]?.payload).toEqual(lifecycle.payload)
    expect(events[3]?.goal).toBeNull()

    const db = new Database(storePath, { readonly: true })
    try {
      const table = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_goal_events'")
        .get() as Record<string, unknown> | null
      expect(table?.name).toBe('thread_goal_events')
    } finally {
      db.close()
    }
  })

  it('notifies in-process subscribers when goal events are recorded', () => {
    const seen: string[] = []
    const unsubscribe = subscribeThreadGoalEvents(event => {
      seen.push(`${event.eventType}:${event.threadId}`)
    })
    try {
      createThreadGoal('thread-live', { objective: 'Notify subscribers' })
      recordThreadGoalLifecycleEvent('thread-live', 'TurnStarted')
    } finally {
      unsubscribe()
    }
    clearThreadGoal('thread-live')

    expect(seen).toEqual([
      'thread_goal_updated:thread-live',
      'thread_goal_lifecycle:thread-live',
    ])
  })

  it('marks active goals budget_limited when usage exhausts the token budget', () => {
    createThreadGoal('thread-1', {
      objective: 'Stay under budget',
      tokenBudget: 100,
    })

    const updated = accountThreadGoalUsage('thread-1', {
      inputTokens: 80,
      outputTokens: 25,
      elapsedMs: 2500,
    })

    expect(updated?.tokensUsed).toBe(105)
    expect(updated?.timeUsedSeconds).toBe(3)
    expect(updated?.status).toBe('budget_limited')
    expect(getThreadGoalEventsAfter(0).at(-1)?.goal?.status).toBe('budget_limited')
  })

  it('subtracts cached input tokens during usage accounting', () => {
    createThreadGoal('thread-1', {
      objective: 'Only count uncached input',
      tokenBudget: 100,
    })

    const updated = accountThreadGoalUsage('thread-1', {
      inputTokens: 80,
      cachedInputTokens: 50,
      outputTokens: 15,
      elapsedMs: 1000,
    })

    expect(updated?.tokensUsed).toBe(45)
    expect(updated?.status).toBe('active')
  })

  it('does not account paused or complete goals', () => {
    createThreadGoal('thread-1', { objective: 'Paused goal', tokenBudget: 10 })
    pauseThreadGoal('thread-1')

    const updated = accountThreadGoalUsage('thread-1', {
      inputTokens: 100,
      outputTokens: 100,
      elapsedMs: 1000,
    })

    expect(updated?.tokensUsed).toBe(0)
    expect(updated?.status).toBe('paused')
  })

  it('migrates legacy JSON goals into SQLite once', () => {
    const timestamp = Date.now()
    writeFileSync(
      legacyStorePath,
      `${JSON.stringify({
        version: 1,
        goals: {
          'thread-legacy': {
            threadId: 'thread-legacy',
            goalId: 'legacy-goal-id',
            objective: 'Imported legacy goal',
            status: 'active',
            tokenBudget: 300,
            tokensUsed: 10,
            timeUsedSeconds: 5,
            createdAtMs: timestamp,
            updatedAtMs: timestamp,
          },
        },
      })}\n`,
      'utf8',
    )

    expect(getThreadGoal('thread-legacy')?.goalId).toBe('legacy-goal-id')

    const db = new Database(storePath, { readonly: true })
    try {
      const row = db
        .query('SELECT objective, tokens_used FROM thread_goals WHERE thread_id = ?')
        .get('thread-legacy') as Record<string, unknown> | null
      expect(row).toEqual({
        objective: 'Imported legacy goal',
        tokens_used: 10,
      })
    } finally {
      db.close()
    }
  })

  it('renders Codex-style guarded continuation and budget prompts', () => {
    const goal = createThreadGoal('thread-1', {
      objective: 'Ship every requirement',
      tokenBudget: 100,
    })
    accountThreadGoalUsage('thread-1', {
      inputTokens: 30,
      outputTokens: 20,
      elapsedMs: 2000,
    })
    const updated = getThreadGoal('thread-1') ?? goal

    const continuation = buildGoalContinuationPrompt(updated)
    expect(continuation).toContain('<untrusted_objective>')
    expect(continuation).toContain('Ship every requirement')
    expect(continuation).toContain('completion audit')
    expect(continuation).toContain('update_goal')
    expect(continuation).toContain('Tokens remaining: 50')

    const budgetLimit = buildGoalBudgetLimitPrompt({
      ...updated,
      status: 'budget_limited',
      tokensUsed: 120,
    })
    expect(budgetLimit).toContain('<untrusted_objective>')
    expect(budgetLimit).toContain('budget_limited')
    expect(budgetLimit).toContain('do not start new substantive work')
  })
})
