import type { AssistantMessage } from '../types/message.js'
import { randomUUID } from 'crypto'
import type { ThreadGoal, ThreadGoalEvent } from './threadGoalStore.js'

export type GoalUsageSnapshot = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

type IdleGoalContinuationInput = {
  goalsEnabled: boolean
  isMainThread: boolean
  permissionMode?: string | null
  hasRunningTurn: boolean
  hasQueuedPromptOrTask: boolean
  aborted: boolean
  materialized: boolean
  expectedGoalId?: string | null
  goal?: Pick<ThreadGoal, 'goalId' | 'status'> | null
}

export type ThreadGoalSdkSystemMessage = {
  type: 'system'
  subtype: ThreadGoalEvent['eventType']
  session_id: string
  uuid: string
  timestamp: string
  event_id: number
  goal_id: string | null
  goal: ThreadGoal | null
  lifecycle_type: ThreadGoalEvent['lifecycleType']
  payload: Record<string, unknown> | null
}

export function emptyGoalUsageSnapshot(): GoalUsageSnapshot {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  }
}

function normalizeTokenCount(value: unknown): number {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

function getCachedInputTokens(usage: Record<string, unknown>): number {
  const details = usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? usage.input_tokens_details as Record<string, unknown>
    : null
  return normalizeTokenCount(
    usage.cached_input_tokens
      ?? usage.cache_read_input_tokens
      ?? details?.cached_tokens,
  )
}

export function getAssistantUsageSnapshot(
  assistantMessages: Pick<AssistantMessage, 'message'>[],
): GoalUsageSnapshot {
  const snapshot = emptyGoalUsageSnapshot()
  for (const assistantMessage of assistantMessages) {
    const usage = assistantMessage.message?.usage as
      | Record<string, unknown>
      | undefined
    if (!usage) continue
    snapshot.inputTokens += normalizeTokenCount(usage.input_tokens)
    snapshot.cachedInputTokens += getCachedInputTokens(usage)
    snapshot.outputTokens += normalizeTokenCount(usage.output_tokens)
  }
  return snapshot
}

function deltaTokenCount(previous: number, current: number): number {
  return current >= previous ? current - previous : current
}

export function getGoalUsageDelta(
  previous: GoalUsageSnapshot,
  current: GoalUsageSnapshot,
): GoalUsageSnapshot {
  return {
    inputTokens: deltaTokenCount(previous.inputTokens, current.inputTokens),
    cachedInputTokens: deltaTokenCount(previous.cachedInputTokens, current.cachedInputTokens),
    outputTokens: deltaTokenCount(previous.outputTokens, current.outputTokens),
  }
}

export function shouldStartIdleGoalContinuation({
  goalsEnabled,
  isMainThread,
  permissionMode,
  hasRunningTurn,
  hasQueuedPromptOrTask,
  aborted,
  materialized,
  expectedGoalId,
  goal,
}: IdleGoalContinuationInput): boolean {
  if (!goalsEnabled || !isMainThread || !materialized || aborted) return false
  if (permissionMode === 'plan') return false
  if (hasRunningTurn || hasQueuedPromptOrTask) return false
  if (!goal || goal.status !== 'active') return false
  if (expectedGoalId && goal.goalId !== expectedGoalId) return false
  return true
}

export function goalEventToSdkSystemMessage(
  event: ThreadGoalEvent,
): ThreadGoalSdkSystemMessage {
  return {
    type: 'system',
    subtype: event.eventType,
    session_id: event.threadId,
    uuid: randomUUID(),
    timestamp: new Date(event.createdAtMs).toISOString(),
    event_id: event.eventId,
    goal_id: event.goalId,
    goal: event.goal,
    lifecycle_type: event.lifecycleType,
    payload: event.payload,
  }
}
