import { getSessionId } from '../../bootstrap/state.js'
import {
  clearThreadGoal,
  getRemainingGoalTokens,
  getThreadGoal,
  pauseThreadGoal,
  replaceThreadGoal,
  resumeThreadGoal,
  type ThreadGoal,
} from '../../tasks/threadGoalStore.js'
import type { LocalCommandCall } from '../../types/command.js'

function formatGoal(goal: ThreadGoal): string {
  const lines = [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Elapsed: ${goal.timeUsedSeconds} seconds`,
  ]

  if (goal.tokenBudget) {
    const remaining = getRemainingGoalTokens(goal)
    lines.push(`Tokens: ${goal.tokensUsed} / ${goal.tokenBudget}`)
    lines.push(`Remaining: ${remaining}`)
  } else {
    lines.push(`Tokens: ${goal.tokensUsed}`)
  }

  return lines.join('\n')
}

export const call: LocalCommandCall = async args => {
  const sessionId = getSessionId()
  const trimmed = args.trim()
  const subcommand = trimmed.toLowerCase()

  if (!trimmed) {
    const goal = getThreadGoal(sessionId)
    return {
      type: 'text',
      value: goal ? formatGoal(goal) : 'No goal is set for this session.',
    }
  }

  if (subcommand === 'complete') {
    return {
      type: 'text',
      value:
        '/goal complete is not available as a user command. Goals are completed by the model after it verifies the objective, or by explicit UI/API controls.',
    }
  }

  if (subcommand === 'pause') {
    const current = getThreadGoal(sessionId)
    if (!current) {
      return { type: 'text', value: 'No goal is set for this session.' }
    }
    const goal = pauseThreadGoal(sessionId, { expectedGoalId: current.goalId })
    return {
      type: 'text',
      value: goal ? `Goal paused.\n\n${formatGoal(goal)}` : 'Goal changed before it could be paused.',
    }
  }

  if (subcommand === 'resume') {
    const current = getThreadGoal(sessionId)
    if (!current) {
      return { type: 'text', value: 'No goal is set for this session.' }
    }
    const goal = resumeThreadGoal(sessionId, { expectedGoalId: current.goalId })
    return {
      type: 'text',
      value: goal ? `Goal resumed.\n\n${formatGoal(goal)}` : 'Goal changed before it could be resumed.',
    }
  }

  if (subcommand === 'clear') {
    clearThreadGoal(sessionId)
    return { type: 'text', value: 'Goal cleared.' }
  }

  const goal = replaceThreadGoal(sessionId, { objective: trimmed })
  return {
    type: 'text',
    value: `Goal set.\n\n${formatGoal(goal)}`,
  }
}
