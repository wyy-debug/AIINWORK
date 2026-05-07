import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { join } from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'

import {
  accountThreadGoalUsage,
  clearThreadGoal,
  clearThreadGoalStoreForTests,
  createThreadGoal,
  getThreadGoal,
  replaceThreadGoal,
  resumeThreadGoal,
  setThreadGoalStorePathForTests,
  pauseThreadGoal,
} from '../threadGoalStore.js'

describe('thread goal store', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'argus-goals-'))
    setThreadGoalStorePathForTests(join(tempDir, 'thread-goals.json'))
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
})
