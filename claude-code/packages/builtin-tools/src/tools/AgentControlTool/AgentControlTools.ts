import { z } from 'zod/v4'
import { isTerminalTaskStatus } from 'src/Task.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { stopTask } from 'src/tasks/stopTask.js'
import {
  isLocalAgentTask,
  queuePendingMessage,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import {
  cancelSubagentRecord,
  getSubagentRecord,
  listSubagentRecords,
  type SubagentRegistryRecord,
} from 'src/tasks/subagentRegistry.js'
import type { TaskState } from 'src/tasks/types.js'
import { asAgentId } from 'src/types/ids.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { sleep } from 'src/utils/sleep.js'
import { resumeAgentBackground } from '../AgentTool/resumeAgent.js'
import { appendSubagentContinuationContract } from '../AgentTool/subagentRuntimeGuard.js'

const ID_FIELDS = ['task_id', 'agent_id', 'id'] as const
const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MAX_WAIT_TIMEOUT_MS = 600_000
const WAIT_INTERVAL_MS = 100
export const AGENT_LIST_TOOL_NAME = 'AgentList'
export const AGENT_WAIT_TOOL_NAME = 'AgentWait'
export const AGENT_RESULT_TOOL_NAME = 'AgentResult'
export const AGENT_CANCEL_TOOL_NAME = 'AgentCancel'
export const AGENT_SEND_INPUT_TOOL_NAME = 'AgentSendInput'
export const AGENT_RESUME_TOOL_NAME = 'AgentResume'

const optionalIdSchema = {
  task_id: z.string().optional().describe('Subagent task id'),
  agent_id: z.string().optional().describe('Alias for task_id'),
  id: z.string().optional().describe('Alias for task_id'),
}

const listInputSchema = lazySchema(() =>
  z.strictObject({
    running_only: z.boolean().optional().describe('Only return running subagents'),
  }),
)
type ListInputSchema = ReturnType<typeof listInputSchema>

const resultInputSchema = lazySchema(() =>
  z.strictObject({
    ...optionalIdSchema,
    block: z.boolean().optional().describe('Wait for terminal status before returning'),
    timeout_ms: z.number().optional().describe('Max wait time in milliseconds'),
  }),
)
type ResultInputSchema = ReturnType<typeof resultInputSchema>

const waitInputSchema = lazySchema(() =>
  z.strictObject({
    task_ids: z.array(z.string()).optional().describe('Subagent task ids to wait for'),
    agent_ids: z.array(z.string()).optional().describe('Alias for task_ids'),
    ids: z.array(z.string()).optional().describe('Alias for task_ids'),
    ...optionalIdSchema,
    wait_mode: z.enum(['any', 'all']).optional().describe('Wait for any or all agents'),
    timeout_ms: z.number().optional().describe('Max wait time in milliseconds'),
  }),
)
type WaitInputSchema = ReturnType<typeof waitInputSchema>

const cancelInputSchema = lazySchema(() =>
  z.strictObject({
    ...optionalIdSchema,
  }),
)
type CancelInputSchema = ReturnType<typeof cancelInputSchema>

const sendInputSchema = lazySchema(() =>
  z.strictObject({
    ...optionalIdSchema,
    message: z.string().describe('Concrete input for the subagent'),
    summary: z.string().optional().describe('Short summary for UI display'),
    interrupt: z.boolean().optional().describe('Replace queued input if supported'),
  }),
)
type SendInputSchema = ReturnType<typeof sendInputSchema>

const resumeInputSchema = lazySchema(() =>
  z.strictObject({
    ...optionalIdSchema,
    message: z.string().optional().describe('Optional continuation prompt'),
  }),
)
type ResumeInputSchema = ReturnType<typeof resumeInputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.string(),
    timed_out: z.boolean().optional(),
    records: z.array(z.any()).optional(),
    record: z.any().optional(),
    message: z.string().optional(),
    outputFile: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function normalizeId(input: Record<string, unknown>): string | undefined {
  for (const field of ID_FIELDS) {
    const value = input[field]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function normalizeIds(input: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  for (const key of ['task_ids', 'agent_ids', 'ids'] as const) {
    const value = input[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          ids.add(item.trim())
        }
      }
    }
  }
  const single = normalizeId(input)
  if (single) ids.add(single)
  return [...ids]
}

function terminal(record: SubagentRegistryRecord | undefined): boolean {
  return Boolean(record && record.status !== 'running')
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WAIT_TIMEOUT_MS
  return Math.max(1_000, Math.min(MAX_WAIT_TIMEOUT_MS, Math.floor(value!)))
}

function syncTerminalTaskToRegistry(task: TaskState | undefined): void {
  if (!task || !isTerminalTaskStatus(task.status)) return
  if (task.status === 'killed') {
    cancelSubagentRecord(task.id, 'Subagent was stopped.')
  }
}

async function waitForRecord(
  taskId: string,
  timeoutMs: number,
  getTask?: () => TaskState | undefined,
): Promise<{ record?: SubagentRegistryRecord; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    syncTerminalTaskToRegistry(getTask?.())
    const record = getSubagentRecord(taskId)
    if (terminal(record)) return { record, timedOut: false }
    await sleep(WAIT_INTERVAL_MS)
  }
  return { record: getSubagentRecord(taskId), timedOut: true }
}

function toolResult(data: Output, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: jsonStringify(data),
  }
}

function renderControlToolUseMessage(input: Record<string, unknown>): string {
  const id = normalizeId(input)
  return id ? ` ${id}` : ''
}

function isOpenEndedSubagentProbe(content: string): boolean {
  const normalized = content.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!normalized || normalized.length > 180) return false
  if (
    /\b(done|blocked|need_parent_input|stop condition|if .* complete|if .* blocked)\b/.test(normalized) ||
    /如果|若已|完成目标|阻塞|缺少输入/.test(normalized)
  ) {
    return false
  }
  return /progress|status|finish|finished|complete|completed|result|wait|waiting|check result|进度|状态|完成|结果|等等|等待/.test(
    normalized,
  )
}

export const AgentListTool = buildTool({
  name: AGENT_LIST_TOOL_NAME,
  aliases: ['agent_list'],
  searchHint: 'list running subagents',
  maxResultSizeChars: 100_000,
  get inputSchema(): ListInputSchema {
    return listInputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'List subagents from the canonical subagent registry.'
  },
  async prompt() {
    return 'List running or recent subagents. Use this instead of guessing from chat history.'
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  async call({ running_only }) {
    return {
      data: {
        status: 'ok',
        records: listSubagentRecords({ runningOnly: Boolean(running_only) }),
      },
    }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<ListInputSchema, Output>)

export const AgentResultTool = buildTool({
  name: AGENT_RESULT_TOOL_NAME,
  aliases: ['agent_result'],
  searchHint: 'get subagent result',
  maxResultSizeChars: 100_000,
  get inputSchema(): ResultInputSchema {
    return resultInputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Get the latest status or final result for a subagent.'
  },
  async prompt() {
    return 'Get a subagent result by task_id. Set block=true to wait for completion instead of polling with SendMessage.'
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  async validateInput(input) {
    const taskId = normalizeId(input)
    if (!taskId) {
      return { result: false, message: 'Missing required parameter: task_id', errorCode: 1 }
    }
    if (!getSubagentRecord(taskId)) {
      return { result: false, message: `No subagent found with ID: ${taskId}`, errorCode: 2 }
    }
    return { result: true }
  },
  async call(input, { getAppState }) {
    const taskId = normalizeId(input)!
    const block = Boolean(input.block)
    const timeoutMs = clampTimeout(input.timeout_ms)
    const getTask = () => getAppState().tasks?.[taskId] as TaskState | undefined
    const { record, timedOut } = block
      ? await waitForRecord(taskId, timeoutMs, getTask)
      : { record: getSubagentRecord(taskId), timedOut: false }
    return {
      data: {
        status: record ? record.status : 'not_found',
        timed_out: timedOut,
        record,
      },
    }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<ResultInputSchema, Output>)

export const AgentWaitTool = buildTool({
  name: AGENT_WAIT_TOOL_NAME,
  aliases: ['agent_wait'],
  searchHint: 'wait for subagents to finish',
  maxResultSizeChars: 100_000,
  get inputSchema(): WaitInputSchema {
    return waitInputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Wait for one or more subagents to reach a terminal status.'
  },
  async prompt() {
    return 'Wait for subagents by id. When no ids are provided, waits on all currently running subagents.'
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  async call(input, { getAppState }) {
    let ids = normalizeIds(input)
    if (ids.length === 0) {
      ids = listSubagentRecords({ runningOnly: true }).map(record => record.taskId)
    }
    const waitMode = input.wait_mode ?? 'any'
    const timeoutMs = clampTimeout(input.timeout_ms)
    const deadline = Date.now() + timeoutMs
    let records: SubagentRegistryRecord[] = []
    let timedOut = false

    while (Date.now() <= deadline) {
      records = ids
        .map(id => {
          syncTerminalTaskToRegistry(getAppState().tasks?.[id] as TaskState | undefined)
          return getSubagentRecord(id)
        })
        .filter((record): record is SubagentRegistryRecord => Boolean(record))
      const done =
        ids.length === 0 ||
        (waitMode === 'all'
          ? records.length === ids.length && records.every(terminal)
          : records.some(terminal))
      if (done) break
      await sleep(WAIT_INTERVAL_MS)
    }
    records = ids
      .map(id => getSubagentRecord(id))
      .filter((record): record is SubagentRegistryRecord => Boolean(record))
    const done =
      ids.length === 0 ||
      (waitMode === 'all'
        ? records.length === ids.length && records.every(terminal)
        : records.some(terminal))
    timedOut = !done
    return {
      data: {
        status: done ? 'completed' : 'timeout',
        timed_out: timedOut,
        records,
      },
    }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<WaitInputSchema, Output>)

export const AgentCancelTool = buildTool({
  name: AGENT_CANCEL_TOOL_NAME,
  aliases: ['agent_cancel'],
  searchHint: 'cancel a running subagent',
  maxResultSizeChars: 100_000,
  get inputSchema(): CancelInputSchema {
    return cancelInputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Cancel a running subagent by task_id.'
  },
  async prompt() {
    return 'Cancel a running subagent. Use this before launching a replacement for the same objective.'
  },
  isConcurrencySafe() {
    return true
  },
  async validateInput(input) {
    const taskId = normalizeId(input)
    if (!taskId) {
      return { result: false, message: 'Missing required parameter: task_id', errorCode: 1 }
    }
    if (!getSubagentRecord(taskId)) {
      return { result: false, message: `No subagent found with ID: ${taskId}`, errorCode: 2 }
    }
    return { result: true }
  },
  async call(input, { getAppState, setAppState }) {
    const taskId = normalizeId(input)!
    const task = getAppState().tasks?.[taskId] as TaskState | undefined
    if (task && !isTerminalTaskStatus(task.status)) {
      await stopTask(taskId, { getAppState, setAppState })
    } else {
      cancelSubagentRecord(taskId, 'Subagent was cancelled.')
    }
    return {
      data: {
        status: 'cancelled',
        record: getSubagentRecord(taskId),
      },
    }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<CancelInputSchema, Output>)

export const AgentSendInputTool = buildTool({
  name: AGENT_SEND_INPUT_TOOL_NAME,
  aliases: ['agent_send_input', 'send_input'],
  searchHint: 'send concrete input to a running subagent',
  maxResultSizeChars: 100_000,
  get inputSchema(): SendInputSchema {
    return sendInputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Send concrete input to a subagent. Do not use this for progress polling.'
  },
  async prompt() {
    return 'Send concrete new instructions to a subagent. For status/results, use AgentWait or AgentResult.'
  },
  isReadOnly() {
    return true
  },
  async validateInput(input) {
    const taskId = normalizeId(input)
    if (!taskId) {
      return { result: false, message: 'Missing required parameter: task_id', errorCode: 1 }
    }
    if (isOpenEndedSubagentProbe(input.message)) {
      return {
        result: false,
        message:
          'Refused open-ended subagent polling. Use AgentWait/AgentResult for status, or include DONE/BLOCKED/NEED_PARENT_INPUT stop conditions.',
        errorCode: 3,
      }
    }
    return { result: true }
  },
  async call(input, context, canUseTool, assistantMessage) {
    const taskId = normalizeId(input)!
    const agentId = asAgentId(taskId)
    const message = appendSubagentContinuationContract(input.message)
    const task = context.getAppState().tasks?.[taskId] as TaskState | undefined
    if (isLocalAgentTask(task) && task.status === 'running') {
      queuePendingMessage(
        agentId,
        message,
        context.setAppStateForTasks ?? context.setAppState,
      )
      return {
        data: {
          status: 'queued',
          message: `Message queued for subagent ${taskId}.`,
          record: getSubagentRecord(taskId),
        },
      }
    }
    await resumeAgentBackground({
      agentId,
      prompt: message,
      toolUseContext: context,
      canUseTool,
      invokingRequestId: assistantMessage?.requestId as string | undefined,
    })
    return {
      data: {
        status: 'resumed',
        message: `Subagent ${taskId} was resumed with the provided input.`,
        record: getSubagentRecord(taskId),
      },
    }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<SendInputSchema, Output>)

export const AgentResumeTool = buildTool({
  name: AGENT_RESUME_TOOL_NAME,
  aliases: ['agent_resume', 'resume_agent'],
  searchHint: 'resume an interrupted subagent',
  maxResultSizeChars: 100_000,
  get inputSchema(): ResumeInputSchema {
    return resumeInputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Resume a stopped or interrupted subagent from its transcript.'
  },
  async prompt() {
    return 'Resume a subagent only when the parent has concrete new work for it.'
  },
  async validateInput(input) {
    const taskId = normalizeId(input)
    if (!taskId) {
      return { result: false, message: 'Missing required parameter: task_id', errorCode: 1 }
    }
    return { result: true }
  },
  async call(input, context, canUseTool, assistantMessage) {
    const taskId = normalizeId(input)!
    const prompt = input.message
      ? appendSubagentContinuationContract(input.message)
      : appendSubagentContinuationContract('Resume the assigned objective. If it is complete, return DONE. If blocked, return BLOCKED or NEED_PARENT_INPUT.')
    await resumeAgentBackground({
      agentId: asAgentId(taskId),
      prompt,
      toolUseContext: context,
      canUseTool,
      invokingRequestId: assistantMessage?.requestId as string | undefined,
    })
    return {
      data: {
        status: 'resumed',
        message: `Subagent ${taskId} resumed.`,
        record: getSubagentRecord(taskId),
      },
    }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<ResumeInputSchema, Output>)
