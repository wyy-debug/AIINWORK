import * as React from 'react'
import { z } from 'zod/v4'
import { isTerminalTaskStatus } from 'src/Task.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { stopTask } from 'src/tasks/stopTask.js'
import {
  drainSubagentMailboxItems,
  ROOT_AGENT_NAME,
  ROOT_LAST_TASK_MESSAGE,
  type SubagentRegistryRecord,
} from 'src/tasks/subagentRegistry.js'
import {
  MAILBOX_DELIVERY_QUEUE_ONLY,
  MAILBOX_DELIVERY_TRIGGER_TURN,
  subagentControl,
} from 'src/tasks/subagentControl.js'
import type { TaskState } from 'src/tasks/types.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { sleep } from 'src/utils/sleep.js'

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MAX_WAIT_TIMEOUT_MS = 600_000
const WAIT_INTERVAL_MS = 100

export const AGENT_LIST_TOOL_NAME = 'list_agents'
export const AGENT_WAIT_TOOL_NAME = 'wait_agent'
export const AGENT_CLOSE_TOOL_NAME = 'close_agent'
export const AGENT_SEND_MESSAGE_TOOL_NAME = 'send_message'
export const AGENT_FOLLOWUP_TASK_TOOL_NAME = 'followup_task'

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
    timeout_ms: z.number().optional().describe('Maximum wait time in milliseconds.'),
  }),
)
type WaitInputSchema = ReturnType<typeof waitInputSchema>

const closeInputSchema = lazySchema(() =>
  z.strictObject({
    target: z.string().describe('Canonical or relative agent path to close.'),
  }),
)
type CloseInputSchema = ReturnType<typeof closeInputSchema>

const sendInputSchema = lazySchema(() =>
  z.strictObject({
    target: z.string().describe('Canonical or relative agent path to message.'),
    message: z.string().describe('Plain-text input to queue.'),
  }),
)
type SendInputSchema = ReturnType<typeof sendInputSchema>

const followupInputSchema = lazySchema(() =>
  z.strictObject({
    target: z.string().describe('Canonical or relative agent path to continue.'),
    message: z.string().describe('Concrete follow-up task input.'),
  }),
)
type FollowupInputSchema = ReturnType<typeof followupInputSchema>

const listOutputSchema = lazySchema(() =>
  z.object({
    agents: z.array(
      z.object({
        agent_name: z.string(),
        agent_status: agentStatusSchema,
        last_task_message: z.string(),
      }),
    ),
  }),
)
type ListOutputSchema = ReturnType<typeof listOutputSchema>
type ListOutput = z.infer<ListOutputSchema>

const waitOutputSchema = lazySchema(() =>
  z.object({
    message: z.string(),
    timed_out: z.boolean(),
    sequence: z.number(),
    updates: z.array(
      z.object({
        seq: z.number(),
        type: z.string(),
        agent_name: z.string(),
        agent_status: agentStatusSchema.optional(),
        last_task_message: z.string().optional(),
        message: z.string().optional(),
        from_agent_name: z.string().optional(),
        to_agent_name: z.string().optional(),
        delivery_mode: z.union([
          z.literal('queue_only'),
          z.literal('trigger_turn'),
        ]).optional(),
        timestamp_ms: z.number(),
      }),
    ),
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

type EmptyOutput = string

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WAIT_TIMEOUT_MS
  return Math.max(10, Math.min(MAX_WAIT_TIMEOUT_MS, Math.floor(value!)))
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

function fallbackAgentName(record: SubagentRegistryRecord): string {
  const fallback = record.taskId.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  return `${ROOT_AGENT_NAME}/${fallback || 'agent'}`
}

function toAgentSummary(record: SubagentRegistryRecord) {
  return {
    agent_name: record.agentPath ?? fallbackAgentName(record),
    agent_status: agentStatusFromRecord(record),
    last_task_message:
      record.lastTaskMessage ??
      summarizeLastTaskMessage(record.prompt) ??
      summarizeLastTaskMessage(record.objective) ??
      'Subagent task',
  }
}

function rootAgentSummary() {
  return {
    agent_name: ROOT_AGENT_NAME,
    agent_status: 'running' as const,
    last_task_message: ROOT_LAST_TASK_MESSAGE,
  }
}

function summarizeLastTaskMessage(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  if (!normalized) return undefined
  return normalized.length > 320 ? `${normalized.slice(0, 319)}...` : normalized
}

function toolResult(data: unknown, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: typeof data === 'string' ? data : jsonStringify(data),
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

function liveTaskStatus(task: TaskState | undefined): AgentStatus | undefined {
  if (!task) return undefined
  if (!isTerminalTaskStatus(task.status)) return 'running'
  if (task.status === 'killed') return 'shutdown'
  return undefined
}

function isRootTarget(target: string): boolean {
  const normalized = target.trim()
  return normalized === ROOT_AGENT_NAME || normalized === 'root'
}

function messageInputValidation(
  input: { target?: string; message?: string },
  { rejectRoot = false, toolName = 'send_message' }: { rejectRoot?: boolean; toolName?: string } = {},
) {
  if (!input.target?.trim()) {
    return { result: false as const, message: 'Missing required parameter: target', errorCode: 1 }
  }
  if (!input.message?.trim()) {
    return { result: false as const, message: `${toolName} requires message.`, errorCode: 2 }
  }
  if (rejectRoot && isRootTarget(input.target)) {
    return { result: false as const, message: "Tasks can't be assigned to the root agent", errorCode: 3 }
  }
  return { result: true as const }
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
    const agents = subagentControl
      .listAgents(input.path_prefix)
      .map(toAgentSummary)
    const prefix = input.path_prefix?.trim()
    const includeRoot = !prefix || prefix === ROOT_AGENT_NAME || ROOT_AGENT_NAME.startsWith(prefix)
    return { data: { agents: includeRoot ? [rootAgentSummary(), ...agents] : agents } }
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
    return 'Wait for collaborative agent mailbox events.'
  },
  async prompt() {
    return 'Wait for the next spawned-agent mailbox event. Use list_agents for the current snapshot.'
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  async call(input): Promise<{ data: WaitOutput }> {
    const timeoutMs = clampTimeout(input.timeout_ms)
    const deadline = Date.now() + timeoutMs
    let drain = drainSubagentMailboxItems()

    while (Date.now() <= deadline) {
      if (drain.updates.length > 0) {
        return {
          data: {
            message: 'Wait completed.',
            timed_out: false,
            sequence: drain.sequence,
            updates: drain.updates,
          },
        }
      }
      await sleep(WAIT_INTERVAL_MS)
      drain = drainSubagentMailboxItems()
    }

    return {
      data: {
        message: 'Wait timed out.',
        timed_out: true,
        sequence: drain.sequence,
        updates: [],
      },
    }
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
  async call(input, context): Promise<{ data: CloseOutput }> {
    const target = input.target.trim()
    const record = subagentControl.resolveAgentReferenceForContext(target, context)
    const taskKey = record?.agentId ?? target
    const previousStatus =
      liveTaskStatus(context.getAppState().tasks?.[taskKey] as TaskState | undefined) ??
      agentStatusFromRecord(record)
    const task = context.getAppState().tasks?.[taskKey] as TaskState | undefined
    if (task && !isTerminalTaskStatus(task.status)) {
      await stopTask(taskKey, {
        getAppState: context.getAppState,
        setAppState: context.setAppState,
      })
    }
    subagentControl.closeAgentTree(record.agentPath)
    return { data: { previous_status: previousStatus } }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<CloseInputSchema, CloseOutput>)

export const SendMessageAgentTool = buildTool({
  name: AGENT_SEND_MESSAGE_TOOL_NAME,
  aliases: [],
  searchHint: 'message collaborative agent',
  maxResultSizeChars: 100_000,
  get inputSchema(): SendInputSchema {
    return sendInputSchema()
  },
  async description() {
    return 'Queue concrete input for a collaborative agent.'
  },
  async prompt() {
    return 'Queue new information for an agent without starting a new turn. Use followup_task to trigger work.'
  },
  isReadOnly() {
    return true
  },
  async validateInput(input) {
    return messageInputValidation(input)
  },
  async call(input, context, canUseTool, assistantMessage): Promise<{ data: EmptyOutput }> {
    await subagentControl.sendInterAgentCommunication({
      target: input.target.trim(),
      message: input.message.trim(),
      deliveryMode: MAILBOX_DELIVERY_QUEUE_ONLY,
      context,
      canUseTool,
      assistantMessage,
    })
    return { data: '' }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<SendInputSchema, EmptyOutput>)

export const FollowupTaskAgentTool = buildTool({
  name: AGENT_FOLLOWUP_TASK_TOOL_NAME,
  aliases: [],
  searchHint: 'continue collaborative agent work',
  maxResultSizeChars: 100_000,
  get inputSchema(): FollowupInputSchema {
    return followupInputSchema()
  },
  async description() {
    return 'Assign concrete follow-up work to a collaborative agent.'
  },
  async prompt() {
    return 'Send follow-up work to a known agent. Running agents receive a queued message; stopped agents are resumed for the task.'
  },
  isConcurrencySafe() {
    return true
  },
  async validateInput(input) {
    return messageInputValidation(input, {
      rejectRoot: true,
      toolName: AGENT_FOLLOWUP_TASK_TOOL_NAME,
    })
  },
  async call(input, context, canUseTool, assistantMessage): Promise<{ data: EmptyOutput }> {
    const target = input.target.trim()
    if (isRootTarget(target)) {
      throw new Error("Tasks can't be assigned to the root agent")
    }
    await subagentControl.sendInterAgentCommunication({
      target,
      message: input.message.trim(),
      deliveryMode: MAILBOX_DELIVERY_TRIGGER_TURN,
      context,
      canUseTool,
      assistantMessage,
    })
    return { data: '' }
  },
  renderToolUseMessage: renderControlToolUseMessage,
  mapToolResultToToolResultBlockParam: toolResult,
} satisfies ToolDef<FollowupInputSchema, EmptyOutput>)
