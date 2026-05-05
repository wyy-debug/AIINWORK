import * as React from 'react'
import { randomUUID } from 'crypto'
import { z } from 'zod/v4'
import { isTerminalTaskStatus } from 'src/Task.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { stopTask } from 'src/tasks/stopTask.js'
import {
  isLocalAgentTask,
  queuePendingMessage,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import {
  closeSubagentSubtree,
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

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MAX_WAIT_TIMEOUT_MS = 600_000
const WAIT_INTERVAL_MS = 100

export const AGENT_LIST_TOOL_NAME = 'list_agents'
export const AGENT_WAIT_TOOL_NAME = 'wait_agent'
export const AGENT_CLOSE_TOOL_NAME = 'close_agent'
export const AGENT_SEND_INPUT_TOOL_NAME = 'send_input'
export const AGENT_RESUME_TOOL_NAME = 'resume_agent'

const agentStatusSchema = z.union([
  z.literal('pending_init'),
  z.literal('running'),
  z.literal('interrupted'),
  z.literal('shutdown'),
  z.literal('not_found'),
  z.object({ completed: z.string().nullable() }),
  z.object({ errored: z.string() }),
])

export type AgentStatus = z.infer<typeof agentStatusSchema>

const listInputSchema = lazySchema(() =>
  z.strictObject({
    path_prefix: z.string().optional().describe('Optional thread graph path prefix filter.'),
  }),
)
type ListInputSchema = ReturnType<typeof listInputSchema>

const waitInputSchema = lazySchema(() =>
  z.strictObject({
    targets: z.array(z.string()).optional().describe('Agent ids to wait for.'),
    timeout_ms: z.number().optional().describe('Maximum wait time in milliseconds.'),
  }),
)
type WaitInputSchema = ReturnType<typeof waitInputSchema>

const closeInputSchema = lazySchema(() =>
  z.strictObject({
    target: z.string().describe('Agent id to close.'),
  }),
)
type CloseInputSchema = ReturnType<typeof closeInputSchema>

const sendInputSchema = lazySchema(() =>
  z.strictObject({
    target: z.string().describe('Agent id to message.'),
    message: z.string().optional().describe('Plain-text input to send.'),
    items: z.array(z.any()).optional().describe('Structured input items to send.'),
    interrupt: z.boolean().optional().describe('Interrupt current work before sending this input.'),
  }),
)
type SendInputSchema = ReturnType<typeof sendInputSchema>

const resumeInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().describe('Agent id to resume.'),
  }),
)
type ResumeInputSchema = ReturnType<typeof resumeInputSchema>

const listOutputSchema = lazySchema(() =>
  z.object({
    agents: z.array(
      z.object({
        agent_id: z.string(),
        nickname: z.string().nullable().optional(),
        status: agentStatusSchema,
        role: z.string().optional(),
        thread_id: z.string().optional(),
        parent_thread_id: z.string().optional(),
        depth: z.number().optional(),
      }),
    ),
  }),
)
type ListOutputSchema = ReturnType<typeof listOutputSchema>
type ListOutput = z.infer<ListOutputSchema>

const waitOutputSchema = lazySchema(() =>
  z.object({
    status: z.record(z.string(), agentStatusSchema),
    timed_out: z.boolean(),
  }),
)
type WaitOutputSchema = ReturnType<typeof waitOutputSchema>
type WaitOutput = z.infer<WaitOutputSchema>

const closeOutputSchema = lazySchema(() =>
  z.object({
    previous_status: agentStatusSchema,
  }),
)
type CloseOutputSchema = ReturnType<typeof closeOutputSchema>
type CloseOutput = z.infer<CloseOutputSchema>

const sendInputOutputSchema = lazySchema(() =>
  z.object({
    submission_id: z.string(),
  }),
)
type SendInputOutputSchema = ReturnType<typeof sendInputOutputSchema>
type SendInputOutput = z.infer<SendInputOutputSchema>

const resumeOutputSchema = lazySchema(() =>
  z.object({
    status: agentStatusSchema,
  }),
)
type ResumeOutputSchema = ReturnType<typeof resumeOutputSchema>
type ResumeOutput = z.infer<ResumeOutputSchema>

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WAIT_TIMEOUT_MS
  return Math.max(10, Math.min(MAX_WAIT_TIMEOUT_MS, Math.floor(value!)))
}

function isTerminalRecord(record: SubagentRegistryRecord | undefined): boolean {
  return Boolean(record && record.status !== 'running')
}

function syncTerminalTaskToRegistry(task: TaskState | undefined): void {
  if (!task || !isTerminalTaskStatus(task.status)) return
  if (task.status === 'killed') {
    closeSubagentSubtree(task.id, 'Agent was stopped.')
  }
}

function agentStatusFromRecord(
  record: SubagentRegistryRecord | undefined,
): AgentStatus {
  if (!record) return 'not_found'
  switch (record.status) {
    case 'running':
      return 'running'
    case 'completed':
      return { completed: record.resultSummary ?? record.result ?? null }
    case 'failed':
    case 'blocked':
    case 'need_parent_input':
      return {
        errored:
          record.stopReason ??
          record.resultSummary ??
          record.blockers ??
          'Agent stopped with an error.',
      }
    case 'interrupted':
      return 'interrupted'
    case 'cancelled':
      return 'shutdown'
  }
}

function toAgentSummary(record: SubagentRegistryRecord) {
  return {
    agent_id: record.agentId,
    nickname: record.agentNickname ?? null,
    status: agentStatusFromRecord(record),
    role: record.agentRole ?? record.agentType,
    thread_id: record.threadId,
    parent_thread_id: record.parentThreadId,
    depth: record.depth,
  }
}

function matchesPathPrefix(record: SubagentRegistryRecord, pathPrefix: string | undefined) {
  if (!pathPrefix?.trim()) return true
  const prefix = pathPrefix.trim()
  return (
    record.threadId.startsWith(prefix) ||
    record.parentThreadId?.startsWith(prefix) ||
    record.sessionId?.startsWith(prefix) ||
    record.parentSessionId?.startsWith(prefix)
  )
}

function toolResult(data: unknown, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: jsonStringify(data),
  }
}

function renderControlToolUseMessage(input: Record<string, unknown>): React.ReactNode {
  const target =
    typeof input.target === 'string'
      ? input.target
      : typeof input.id === 'string'
        ? input.id
        : ''
  return React.createElement('span', null, target ? ` ${target}` : '')
}

function textFromItems(items: unknown): string | undefined {
  if (!Array.isArray(items)) return undefined
  const text = items
    .map(item => {
      if (!item || typeof item !== 'object') return undefined
      const record = item as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.name === 'string') return record.name
      if (typeof record.path === 'string') return record.path
      return undefined
    })
    .filter((item): item is string => Boolean(item?.trim()))
    .join('\n')
    .trim()
  return text || undefined
}

function liveTaskStatus(task: TaskState | undefined): AgentStatus | undefined {
  if (!task) return undefined
  if (!isTerminalTaskStatus(task.status)) return 'running'
  if (task.status === 'killed') return 'shutdown'
  return undefined
}

export const ListAgentsTool = buildTool({
  name: AGENT_LIST_TOOL_NAME,
  aliases: [],
  searchHint: 'list collaborative agents',
  maxResultSizeChars: 100_000,
  get inputSchema(): ListInputSchema {
    return listInputSchema()
  },
  get outputSchema(): ListOutputSchema {
    return listOutputSchema()
  },
  async description() {
    return 'List collaborative agents spawned from this session.'
  },
  async prompt() {
    return 'List spawned agents and their current statuses.'
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  async call(input): Promise<{ data: ListOutput }> {
    const agents = listSubagentRecords({ includeArchived: false })
      .filter(record => record.graphStatus === 'open' || record.status === 'running')
      .filter(record => matchesPathPrefix(record, input.path_prefix))
      .map(toAgentSummary)
    return { data: { agents } }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<ListInputSchema, ListOutput>)

export const WaitAgentTool = buildTool({
  name: AGENT_WAIT_TOOL_NAME,
  aliases: [],
  searchHint: 'wait for collaborative agents',
  maxResultSizeChars: 100_000,
  get inputSchema(): WaitInputSchema {
    return waitInputSchema()
  },
  get outputSchema(): WaitOutputSchema {
    return waitOutputSchema()
  },
  async description() {
    return 'Wait for one or more collaborative agents to finish.'
  },
  async prompt() {
    return 'Wait for spawned agents by id. If no targets are provided, wait on currently running agents.'
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  async call(input, { getAppState }): Promise<{ data: WaitOutput }> {
    const targets =
      input.targets && input.targets.length > 0
        ? input.targets
        : listSubagentRecords({ runningOnly: true }).map(record => record.agentId)
    const timeoutMs = clampTimeout(input.timeout_ms)
    const deadline = Date.now() + timeoutMs
    const finalStatuses: Record<string, AgentStatus> = {}

    if (targets.length === 0) {
      return { data: { status: {}, timed_out: false } }
    }

    while (Date.now() <= deadline) {
      for (const target of targets) {
        if (finalStatuses[target]) continue
        syncTerminalTaskToRegistry(getAppState().tasks?.[target] as TaskState | undefined)
        const record = getSubagentRecord(target)
        if (!record) {
          finalStatuses[target] = 'not_found'
          continue
        }
        if (isTerminalRecord(record)) {
          finalStatuses[target] = agentStatusFromRecord(record)
        }
      }
      if (Object.keys(finalStatuses).length > 0) {
        return { data: { status: finalStatuses, timed_out: false } }
      }
      await sleep(WAIT_INTERVAL_MS)
    }

    return { data: { status: {}, timed_out: true } }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<WaitInputSchema, WaitOutput>)

export const CloseAgentTool = buildTool({
  name: AGENT_CLOSE_TOOL_NAME,
  aliases: [],
  searchHint: 'close collaborative agent',
  maxResultSizeChars: 100_000,
  get inputSchema(): CloseInputSchema {
    return closeInputSchema()
  },
  get outputSchema(): CloseOutputSchema {
    return closeOutputSchema()
  },
  async description() {
    return 'Close an agent and its descendants.'
  },
  async prompt() {
    return 'Close a spawned agent. Closing also closes any descendants in the thread graph.'
  },
  isConcurrencySafe() {
    return true
  },
  async validateInput(input) {
    if (!input.target?.trim()) {
      return { result: false, message: 'Missing required parameter: target', errorCode: 1 }
    }
    return { result: true }
  },
  async call(input, { getAppState, setAppState }): Promise<{ data: CloseOutput }> {
    const target = input.target.trim()
    const previousStatus =
      liveTaskStatus(getAppState().tasks?.[target] as TaskState | undefined) ??
      agentStatusFromRecord(getSubagentRecord(target))
    const task = getAppState().tasks?.[target] as TaskState | undefined
    if (task && !isTerminalTaskStatus(task.status)) {
      await stopTask(target, { getAppState, setAppState })
    }
    closeSubagentSubtree(target, 'Agent was closed.')
    return { data: { previous_status: previousStatus } }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<CloseInputSchema, CloseOutput>)

export const SendInputAgentTool = buildTool({
  name: AGENT_SEND_INPUT_TOOL_NAME,
  aliases: [],
  searchHint: 'message collaborative agent',
  maxResultSizeChars: 100_000,
  get inputSchema(): SendInputSchema {
    return sendInputSchema()
  },
  get outputSchema(): SendInputOutputSchema {
    return sendInputOutputSchema()
  },
  async description() {
    return 'Send concrete input to a collaborative agent.'
  },
  async prompt() {
    return 'Send new information or instructions to an agent. Use wait_agent for results.'
  },
  isReadOnly() {
    return true
  },
  async validateInput(input) {
    if (!input.target?.trim()) {
      return { result: false, message: 'Missing required parameter: target', errorCode: 1 }
    }
    if (!input.message?.trim() && !textFromItems(input.items)) {
      return {
        result: false,
        message: 'send_input requires message or items.',
        errorCode: 2,
      }
    }
    return { result: true }
  },
  async call(input, context, canUseTool, assistantMessage): Promise<{ data: SendInputOutput }> {
    const target = input.target.trim()
    const agentId = asAgentId(target)
    const message = input.message?.trim() || textFromItems(input.items) || ''
    const task = context.getAppState().tasks?.[target] as TaskState | undefined
    if (isLocalAgentTask(task) && task.status === 'running') {
      queuePendingMessage(
        agentId,
        message,
        context.setAppStateForTasks ?? context.setAppState,
      )
    } else {
      await resumeAgentBackground({
        agentId,
        prompt: message,
        toolUseContext: context,
        canUseTool,
        invokingRequestId: assistantMessage?.requestId as string | undefined,
      })
    }
    return { data: { submission_id: `submission_${randomUUID()}` } }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<SendInputSchema, SendInputOutput>)

export const ResumeAgentTool = buildTool({
  name: AGENT_RESUME_TOOL_NAME,
  aliases: [],
  searchHint: 'resume collaborative agent',
  maxResultSizeChars: 100_000,
  get inputSchema(): ResumeInputSchema {
    return resumeInputSchema()
  },
  get outputSchema(): ResumeOutputSchema {
    return resumeOutputSchema()
  },
  async description() {
    return 'Resume a previously closed agent.'
  },
  async prompt() {
    return 'Resume a previously closed spawned agent.'
  },
  isConcurrencySafe() {
    return true
  },
  async validateInput(input) {
    if (!input.id?.trim()) {
      return { result: false, message: 'Missing required parameter: id', errorCode: 1 }
    }
    return { result: true }
  },
  async call(input, context, canUseTool, assistantMessage): Promise<{ data: ResumeOutput }> {
    const target = input.id.trim()
    const record = getSubagentRecord(target)
    if (!record) {
      return { data: { status: 'not_found' } }
    }
    if (record.status === 'running') {
      return { data: { status: 'running' } }
    }
    await resumeAgentBackground({
      agentId: asAgentId(target),
      prompt: 'Resume the assigned objective and return a final status.',
      toolUseContext: context,
      canUseTool,
      invokingRequestId: assistantMessage?.requestId as string | undefined,
    })
    return { data: { status: 'running' } }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<ResumeInputSchema, ResumeOutput>)
