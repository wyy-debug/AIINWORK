import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'budget_limited'
  | 'complete'

export type ThreadGoal = {
  threadId: string
  goalId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAtMs: number
  updatedAtMs: number
}

export type CreateThreadGoalInput = {
  objective: string
  tokenBudget?: number | null
}

export type AccountThreadGoalUsageInput = {
  inputTokens?: number | null
  outputTokens?: number | null
  elapsedMs?: number | null
}

type ThreadGoalStoreFile = {
  version: 1
  goals: Record<string, ThreadGoal>
}

let testStorePath: string | null = null

function getThreadGoalStorePath(): string {
  return testStorePath ?? join(getClaudeConfigHomeDir(), 'thread-goals.json')
}

export function setThreadGoalStorePathForTests(path: string): void {
  testStorePath = path
}

export function clearThreadGoalStoreForTests(): void {
  writeStore({ version: 1, goals: {} })
}

function emptyStore(): ThreadGoalStoreFile {
  return { version: 1, goals: {} }
}

function readStore(): ThreadGoalStoreFile {
  const path = getThreadGoalStorePath()
  if (!existsSync(path)) return emptyStore()

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return emptyStore()
    const goals =
      parsed.goals && typeof parsed.goals === 'object'
        ? parsed.goals as Record<string, ThreadGoal>
        : {}
    return { version: 1, goals }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: ThreadGoalStoreFile): void {
  const path = getThreadGoalStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

function normalizeObjective(objective: string): string {
  const normalized = objective.trim()
  if (!normalized) {
    throw new Error('Goal objective is required.')
  }
  if (normalized.length > 4000) {
    throw new Error('Goal objective must be 4000 characters or fewer.')
  }
  return normalized
}

function normalizeTokenBudget(tokenBudget?: number | null): number | null {
  if (tokenBudget === undefined || tokenBudget === null) return null
  if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) {
    throw new Error('Goal token budget must be a positive integer.')
  }
  return tokenBudget
}

function nowMs(): number {
  return Date.now()
}

function makeGoal(threadId: string, input: CreateThreadGoalInput): ThreadGoal {
  const timestamp = nowMs()
  return {
    threadId,
    goalId: randomUUID(),
    objective: normalizeObjective(input.objective),
    status: 'active',
    tokenBudget: normalizeTokenBudget(input.tokenBudget),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAtMs: timestamp,
    updatedAtMs: timestamp,
  }
}

function updateGoal(
  threadId: string,
  updater: (goal: ThreadGoal) => ThreadGoal,
): ThreadGoal | null {
  const store = readStore()
  const current = store.goals[threadId]
  if (!current) return null
  const updated = updater(current)
  store.goals[threadId] = { ...updated, updatedAtMs: nowMs() }
  writeStore(store)
  return store.goals[threadId]
}

export function getThreadGoal(threadId: string): ThreadGoal | null {
  return readStore().goals[threadId] ?? null
}

export function createThreadGoal(
  threadId: string,
  input: CreateThreadGoalInput,
): ThreadGoal {
  const store = readStore()
  if (store.goals[threadId]) {
    throw new Error(`Thread ${threadId} already has an active goal.`)
  }
  const goal = makeGoal(threadId, input)
  store.goals[threadId] = goal
  writeStore(store)
  return goal
}

export function replaceThreadGoal(
  threadId: string,
  input: CreateThreadGoalInput,
): ThreadGoal {
  const store = readStore()
  const goal = makeGoal(threadId, input)
  store.goals[threadId] = goal
  writeStore(store)
  return goal
}

export function pauseThreadGoal(threadId: string): ThreadGoal | null {
  return updateGoal(threadId, goal => ({ ...goal, status: 'paused' }))
}

export function resumeThreadGoal(threadId: string): ThreadGoal | null {
  return updateGoal(threadId, goal => ({ ...goal, status: 'active' }))
}

export function completeThreadGoal(threadId: string): ThreadGoal | null {
  return updateGoal(threadId, goal => ({ ...goal, status: 'complete' }))
}

export function clearThreadGoal(threadId: string): void {
  const store = readStore()
  delete store.goals[threadId]
  writeStore(store)
}

export function getRemainingGoalTokens(goal: ThreadGoal | null): number | null {
  if (!goal?.tokenBudget) return null
  return Math.max(0, goal.tokenBudget - goal.tokensUsed)
}

export function getCompletionBudgetReport(goal: ThreadGoal | null): string | null {
  if (!goal) return null
  if (!goal.tokenBudget) {
    return `Goal completed with no token budget. Total tokens used: ${goal.tokensUsed}.`
  }
  return `Goal completed with tokens used: ${goal.tokensUsed} of ${goal.tokenBudget}.`
}

export function accountThreadGoalUsage(
  threadId: string,
  usage: AccountThreadGoalUsageInput,
): ThreadGoal | null {
  return updateGoal(threadId, goal => {
    if (goal.status !== 'active') return goal

    const inputTokens = Math.max(0, Math.floor(usage.inputTokens ?? 0))
    const outputTokens = Math.max(0, Math.floor(usage.outputTokens ?? 0))
    const elapsedSeconds = Math.max(
      0,
      Math.ceil(Math.max(0, usage.elapsedMs ?? 0) / 1000),
    )
    const tokensUsed = goal.tokensUsed + inputTokens + outputTokens
    const status =
      goal.tokenBudget && tokensUsed >= goal.tokenBudget
        ? 'budget_limited'
        : goal.status

    return {
      ...goal,
      status,
      tokensUsed,
      timeUsedSeconds: goal.timeUsedSeconds + elapsedSeconds,
    }
  })
}

export function buildGoalBudgetLimitPrompt(goal: ThreadGoal): string {
  return [
    `The active goal token budget has been exhausted (${goal.tokensUsed}/${goal.tokenBudget ?? 'unlimited'} tokens).`,
    'Stop work on this goal unless the user extends or resumes it.',
  ].join('\n')
}

export function buildGoalContinuationPrompt(goal: ThreadGoal): string {
  return [
    `Continue working on the active goal: ${goal.objective}`,
    'Make progress autonomously only while the goal is active and within budget.',
  ].join('\n')
}
