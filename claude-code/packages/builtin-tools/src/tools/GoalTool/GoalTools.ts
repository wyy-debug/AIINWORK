import * as React from 'react'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  completeThreadGoal,
  createThreadGoal,
  getCompletionBudgetReport,
  getRemainingGoalTokens,
  getThreadGoal,
  recordThreadGoalLifecycleEvent,
  type ThreadGoal,
} from 'src/tasks/threadGoalStore.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { jsonStringify } from 'src/utils/slowOperations.js'

export const GET_GOAL_TOOL_NAME = 'get_goal'
export const CREATE_GOAL_TOOL_NAME = 'create_goal'
export const UPDATE_GOAL_TOOL_NAME = 'update_goal'

const getGoalInputSchema = lazySchema(() => z.strictObject({}))
type GetGoalInputSchema = ReturnType<typeof getGoalInputSchema>

const createGoalInputSchema = lazySchema(() =>
  z.strictObject({
    objective: z.string().describe('Persistent objective to work toward.'),
    token_budget: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional positive token budget for the goal.'),
  }),
)
type CreateGoalInputSchema = ReturnType<typeof createGoalInputSchema>

const updateGoalInputSchema = lazySchema(() =>
  z.strictObject({
    status: z.literal('complete').describe('Only complete is model-settable.'),
    expected_goal_id: z
      .string()
      .optional()
      .describe('Optional goal id read from get_goal, used to prevent stale completion updates.'),
  }),
)
type UpdateGoalInputSchema = ReturnType<typeof updateGoalInputSchema>

type GoalPayload = {
  goal_id: string
  objective: string
  status: ThreadGoal['status']
  token_budget: number | null
  tokens_used: number
  time_used_seconds: number
}

type GoalToolResponse = {
  goal: GoalPayload | null
  remaining_tokens: number | null
  completion_budget_report: string | null
}

function toGoalPayload(goal: ThreadGoal | null): GoalPayload | null {
  if (!goal) return null
  return {
    goal_id: goal.goalId,
    objective: goal.objective,
    status: goal.status,
    token_budget: goal.tokenBudget,
    tokens_used: goal.tokensUsed,
    time_used_seconds: goal.timeUsedSeconds,
  }
}

function goalToolResponse(goal: ThreadGoal | null): GoalToolResponse {
  return {
    goal: toGoalPayload(goal),
    remaining_tokens: getRemainingGoalTokens(goal),
    completion_budget_report:
      goal?.status === 'complete' ? getCompletionBudgetReport(goal) : null,
  }
}

function toolResult(data: unknown, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: jsonStringify(data),
  }
}

function renderGoalToolUseMessage(input: Record<string, unknown>): React.ReactNode {
  const objective = typeof input.objective === 'string' ? input.objective.trim() : ''
  const status = typeof input.status === 'string' ? input.status.trim() : ''
  return React.createElement('span', null, objective || status ? ` ${objective || status}` : '')
}

export const GetGoalTool = buildTool({
  name: GET_GOAL_TOOL_NAME,
  aliases: [],
  searchHint: 'inspect persistent goal',
  maxResultSizeChars: 20_000,
  get inputSchema(): GetGoalInputSchema {
    return getGoalInputSchema()
  },
  async description() {
    return 'Get the current persistent goal for this thread.'
  },
  async prompt() {
    return 'Read the current persistent thread goal and remaining token budget.'
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  async call(): Promise<{ data: GoalToolResponse }> {
    return { data: goalToolResponse(getThreadGoal(getSessionId())) }
  },
  renderToolUseMessage: renderGoalToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<GetGoalInputSchema, GoalToolResponse>)

export const CreateGoalTool = buildTool({
  name: CREATE_GOAL_TOOL_NAME,
  aliases: [],
  searchHint: 'create persistent goal',
  maxResultSizeChars: 20_000,
  get inputSchema(): CreateGoalInputSchema {
    return createGoalInputSchema()
  },
  async description() {
    return 'Create a persistent goal for this thread.'
  },
  async prompt() {
    return 'Create a persistent thread goal. Fails if the thread already has a goal.'
  },
  async call(input): Promise<{ data: GoalToolResponse }> {
    const goal = createThreadGoal(getSessionId(), {
      objective: input.objective,
      tokenBudget: input.token_budget,
    })
    return { data: goalToolResponse(goal) }
  },
  renderToolUseMessage: renderGoalToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<CreateGoalInputSchema, GoalToolResponse>)

export const UpdateGoalTool = buildTool({
  name: UPDATE_GOAL_TOOL_NAME,
  aliases: [],
  searchHint: 'complete persistent goal',
  maxResultSizeChars: 20_000,
  get inputSchema(): UpdateGoalInputSchema {
    return updateGoalInputSchema()
  },
  async description() {
    return 'Update the current persistent goal.'
  },
  async prompt() {
    return 'Mark the current persistent thread goal complete. Pass expected_goal_id from get_goal when available. The model cannot pause, resume, or clear goals.'
  },
  async call(input = { status: 'complete' }): Promise<{ data: GoalToolResponse }> {
    const goal = completeThreadGoal(getSessionId(), {
      expectedGoalId: input.expected_goal_id,
    })
    if (!goal) {
      throw new Error('No goal exists for this thread, or the current goal changed before update_goal could complete it.')
    }
    recordThreadGoalLifecycleEvent(getSessionId(), 'ToolCompletedGoal', {
      tool: UPDATE_GOAL_TOOL_NAME,
      status: 'complete',
      expectedGoalId: input.expected_goal_id ?? null,
    })
    return { data: goalToolResponse(goal) }
  },
  renderToolUseMessage: renderGoalToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<UpdateGoalInputSchema, GoalToolResponse>)
