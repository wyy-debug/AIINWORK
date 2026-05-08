import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { getSessionId, resetStateForTests } from '../../bootstrap/state'
import { cleanupTempDir, createTempDir } from '../../../tests/mocks/file-system'
import {
  getThreadGoal,
  setThreadGoalLegacyStorePathForTests,
  setThreadGoalStorePathForTests,
} from '../../tasks/threadGoalStore'
import { call as callGoal } from '../goal/goal'

let tempDir = ''

async function runGoal(args = ''): Promise<string> {
  const result = await callGoal(args, {} as any)
  expect(result.type).toBe('text')
  return result.type === 'text' ? result.value : ''
}

beforeEach(async () => {
  tempDir = await createTempDir('goal-command-')
  resetStateForTests()
  setThreadGoalStorePathForTests(join(tempDir, 'thread-goals.db'))
  setThreadGoalLegacyStorePathForTests(join(tempDir, 'thread-goals.json'))
})

afterEach(async () => {
  resetStateForTests()
  if (tempDir) {
    await cleanupTempDir(tempDir)
  }
})

describe('/goal', () => {
  test('views, sets, pauses, resumes, and clears the current session goal', async () => {
    expect(await runGoal('')).toContain('No goal is set')

    expect(await runGoal('Ship the SQLite migration')).toContain('Goal set')
    expect(getThreadGoal(getSessionId())?.objective).toBe('Ship the SQLite migration')

    const view = await runGoal('')
    expect(view).toContain('Ship the SQLite migration')
    expect(view).toContain('Status: active')

    expect(await runGoal('pause')).toContain('Goal paused')
    expect(getThreadGoal(getSessionId())?.status).toBe('paused')

    expect(await runGoal('resume')).toContain('Goal resumed')
    expect(getThreadGoal(getSessionId())?.status).toBe('active')

    expect(await runGoal('clear')).toContain('Goal cleared')
    expect(getThreadGoal(getSessionId())).toBeNull()
  })

  test('does not expose complete as a user command', async () => {
    await runGoal('Keep going')

    const result = await runGoal('complete')

    expect(result).toContain('not available')
    expect(getThreadGoal(getSessionId())?.status).toBe('active')
  })
})
