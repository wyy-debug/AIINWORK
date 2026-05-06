import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { ToolUseContext } from 'src/Tool.js'
import type { AssistantMessage } from 'src/types/message.js'
import { asAgentId } from 'src/types/ids.js'
import {
  isLocalAgentTask,
  queuePendingMessage,
} from './LocalAgentTask/LocalAgentTask.js'
import { resumeAgentBackground } from '@mtl-code/builtin-tools/tools/AgentTool/resumeAgent.js'
import type { TaskState } from './types.js'
import {
  closeSubagentSubtree,
  getSubagentRecordByInternalId,
  listSubagentRecords,
  MAILBOX_DELIVERY_QUEUE_ONLY,
  MAILBOX_DELIVERY_TRIGGER_TURN,
  recordSubagentMessage,
  resolveSubagentRecordByAgentPath,
  ROOT_AGENT_NAME,
  type SubagentMessageDeliveryMode,
  type SubagentRegistryRecord,
} from './subagentRegistry.js'

type StartAgentTurnParams = {
  record: SubagentRegistryRecord
  message: string
  context: ToolUseContext
  canUseTool: CanUseToolFn
  invokingRequestId?: string
}

type SubagentControlDeps = {
  startAgentTurn?: (params: StartAgentTurnParams) => Promise<void>
}

function currentAgentPathFromContext(context: ToolUseContext): string {
  if (!context.agentId) return ROOT_AGENT_NAME
  return getSubagentRecordByInternalId(context.agentId)?.agentPath ?? ROOT_AGENT_NAME
}

function getTaskForRecord(
  context: { getAppState?: () => { tasks?: Record<string, unknown> } },
  record: SubagentRegistryRecord,
): TaskState | undefined {
  return context.getAppState?.().tasks?.[record.agentId] as TaskState | undefined
}

async function defaultStartAgentTurn({
  record,
  message,
  context,
  canUseTool,
  invokingRequestId,
}: StartAgentTurnParams): Promise<void> {
  if (typeof context.setAppState === 'function') {
    await resumeAgentBackground({
      agentId: asAgentId(record.agentId),
      prompt: message,
      toolUseContext: context,
      canUseTool,
      invokingRequestId,
    })
    return
  }

  await (canUseTool as unknown as () => Promise<unknown>)()
}

export class SubagentControl {
  private readonly startAgentTurn: (params: StartAgentTurnParams) => Promise<void>

  constructor(deps: SubagentControlDeps = {}) {
    this.startAgentTurn = deps.startAgentTurn ?? defaultStartAgentTurn
  }

  resolveAgentReference(
    target: string,
    currentAgentPath = ROOT_AGENT_NAME,
  ): SubagentRegistryRecord {
    const record = resolveSubagentRecordByAgentPath(target, currentAgentPath)
    if (!record) {
      const resolved = target.startsWith('/')
        ? target
        : `${currentAgentPath === ROOT_AGENT_NAME ? ROOT_AGENT_NAME : currentAgentPath}/${target}`
      throw new Error(`live agent path \`${resolved}\` not found`)
    }
    return record
  }

  resolveAgentReferenceForContext(
    target: string,
    context: ToolUseContext,
  ): SubagentRegistryRecord {
    return this.resolveAgentReference(target, currentAgentPathFromContext(context))
  }

  listAgents(pathPrefix?: string): SubagentRegistryRecord[] {
    const prefix = pathPrefix?.trim()
    return resolvePathFilteredRecords(prefix)
  }

  closeAgentTree(target: string, currentAgentPath = ROOT_AGENT_NAME): SubagentRegistryRecord[] {
    const record = this.resolveAgentReference(target, currentAgentPath)
    return closeSubagentSubtree(record.agentPath, 'Agent was closed.')
  }

  async sendInterAgentCommunication({
    target,
    message,
    deliveryMode,
    context,
    canUseTool,
    assistantMessage,
  }: {
    target: string
    message: string
    deliveryMode: SubagentMessageDeliveryMode
    context: ToolUseContext
    canUseTool: CanUseToolFn
    assistantMessage?: AssistantMessage
  }): Promise<SubagentRegistryRecord> {
    const senderAgentPath = currentAgentPathFromContext(context)
    const record = this.resolveAgentReference(target, senderAgentPath)

    if (
      deliveryMode === MAILBOX_DELIVERY_TRIGGER_TURN &&
      record.agentPath === ROOT_AGENT_NAME
    ) {
      throw new Error("Tasks can't be assigned to the root agent")
    }

    if (deliveryMode === MAILBOX_DELIVERY_QUEUE_ONLY && record.status !== 'running') {
      throw new Error(`live agent path \`${record.agentPath}\` not found`)
    }

    recordSubagentMessage(record.agentPath, message, {
      fromAgentPath: senderAgentPath,
      deliveryMode,
    })
    const queued = this.queueIfRunning(record, message, context)

    if (
      deliveryMode === MAILBOX_DELIVERY_TRIGGER_TURN &&
      !queued &&
      record.status !== 'running'
    ) {
      await this.startAgentTurn({
        record,
        message,
        context,
        canUseTool,
        invokingRequestId: assistantMessage?.requestId as string | undefined,
      })
    }

    return record
  }

  private queueIfRunning(
    record: SubagentRegistryRecord,
    message: string,
    context: ToolUseContext,
  ): boolean {
    const task = getTaskForRecord(context, record)
    if (!isLocalAgentTask(task) || task.status !== 'running') return false
    const setAppState = context.setAppStateForTasks ?? context.setAppState
    if (!setAppState) return false
    queuePendingMessage(asAgentId(record.agentId), message, setAppState)
    return true
  }
}

function resolvePathFilteredRecords(pathPrefix: string | undefined): SubagentRegistryRecord[] {
  return listSubagentRecords({ includeArchived: false })
    .filter(record => !pathPrefix || record.agentPath === pathPrefix || record.agentPath.startsWith(`${pathPrefix}/`))
    .sort((left, right) => left.agentPath.localeCompare(right.agentPath))
}

export const subagentControl = new SubagentControl()
export { MAILBOX_DELIVERY_QUEUE_ONLY, MAILBOX_DELIVERY_TRIGGER_TURN }
