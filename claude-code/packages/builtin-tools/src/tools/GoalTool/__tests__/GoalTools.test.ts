import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { join } from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'

import {
  CreateGoalTool,
  GetGoalTool,
  UpdateGoalTool,
} from '../GoalTools.js'
import {
  clearThreadGoalStoreForTests,
  getThreadGoal,
  setThreadGoalStorePathForTests,
} from '../../../../../../src/tasks/threadGoalStore.js'
import { getSessionId } from '../../../../../../src/bootstrap/state.js'

describe('GoalTools', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'argus-goal-tools-'))
    setThreadGoalStorePathForTests(join(tempDir, 'thread-goals.json'))
    clearThreadGoalStoreForTests()
  })

  afterEach(async () => {
    clearThreadGoalStoreForTests()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('uses Codex goal tool names and schemas', () => {
    expect(GetGoalTool.name).toBe('get_goal')
    expect(CreateGoalTool.name).toBe('create_goal')
    expect(UpdateGoalTool.name).toBe('update_goal')

    expect(CreateGoalTool.inputSchema.safeParse({
      objective: 'Ship the goal alignment',
      token_budget: 1000,
    }).success).toBe(true)
    expect(UpdateGoalTool.inputSchema.safeParse({ status: 'complete' }).success).toBe(true)
    expect(UpdateGoalTool.inputSchema.safeParse({ status: 'paused' }).success).toBe(false)
  })

  it('creates and reads a thread goal', async () => {
    const createResult = await CreateGoalTool.call(
      { objective: 'Finish goal support', token_budget: 800 },
    )

    expect(createResult.data.goal?.objective).toBe('Finish goal support')
    expect(createResult.data.remaining_tokens).toBe(800)

    const getResult = await GetGoalTool.call()
    expect(getResult.data.goal?.objective).toBe('Finish goal support')
  })

  it('rejects create_goal when a non-complete goal already exists', async () => {
    await CreateGoalTool.call({ objective: 'First goal' })

    await expect(
      CreateGoalTool.call({ objective: 'Second goal' }),
    ).rejects.toThrow(/already has an active goal/i)
  })

  it('lets the model complete, but not pause, the current goal', async () => {
    await CreateGoalTool.call({ objective: 'Complete me', token_budget: 100 })

    const completeResult = await UpdateGoalTool.call()
    expect(completeResult.data.goal?.status).toBe('complete')
    expect(completeResult.data.completion_budget_report).toContain('tokens used: 0 of 100')
    expect(getThreadGoal(getSessionId())?.status).toBe('complete')
  })
})
