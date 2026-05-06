import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentToolResult } from '@mtl-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import type { AgentDefinition } from '@mtl-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type {
  SubagentRuntimeSnapshot,
  SubagentRuntimeStatus,
} from '@mtl-code/builtin-tools/tools/AgentTool/subagentRuntimeGuard.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { extractTextContent } from '../utils/messages.js'

export const SUBAGENT_STATE_SCHEMA_VERSION = 2
export const ROOT_AGENT_NAME = '/root'
export const ROOT_LAST_TASK_MESSAGE = 'Main thread'
export const MAILBOX_DELIVERY_QUEUE_ONLY = 'queue_only'
export const MAILBOX_DELIVERY_TRIGGER_TURN = 'trigger_turn'

const SUBAGENT_TASK_NAME_PATTERN = /^[a-z0-9_]+$/
const INVALID_AGENT_PATH_PREFIX = `${ROOT_AGENT_NAME}/__invalid_`

export function validateSubagentTaskName(taskName: string): string {
  const normalized = taskName.trim()
  if (!SUBAGENT_TASK_NAME_PATTERN.test(normalized)) {
    throw new Error('task_name must use only lowercase letters, digits, and underscores.')
  }
  return normalized
}

function normalizeAgentPath(path: string): string {
  const normalized = path.trim().replace(/\/+/g, '/').replace(/\/$/, '')
  if (!normalized || normalized === '/') return ROOT_AGENT_NAME
  return normalized.startsWith('/') ? normalized : `${ROOT_AGENT_NAME}/${normalized}`
}

function isCanonicalAgentPath(path: string | undefined): path is string {
  if (!path) return false
  const normalized = normalizeAgentPath(path)
  if (normalized === ROOT_AGENT_NAME) return true
  if (!normalized.startsWith(`${ROOT_AGENT_NAME}/`)) return false
  return normalized
    .slice(`${ROOT_AGENT_NAME}/`.length)
    .split('/')
    .every(segment => SUBAGENT_TASK_NAME_PATTERN.test(segment))
}

function parentAgentPathFromPath(agentPath: string): string {
  const normalized = normalizeAgentPath(agentPath)
  if (normalized === ROOT_AGENT_NAME) return ROOT_AGENT_NAME
  const index = normalized.lastIndexOf('/')
  if (index <= ROOT_AGENT_NAME.length) return ROOT_AGENT_NAME
  return normalized.slice(0, index)
}

function invalidAgentPath(taskId: string): string {
  const fallback = taskId.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'agent'
  return `${INVALID_AGENT_PATH_PREFIX}${fallback}`
}

export function canonicalSubagentTaskName(
  taskName: string,
  parentPath = ROOT_AGENT_NAME,
): string {
  const normalizedTaskName = validateSubagentTaskName(taskName)
  const normalizedParent = normalizeAgentPath(parentPath)
  if (normalizedParent === ROOT_AGENT_NAME) {
    return `${ROOT_AGENT_NAME}/${normalizedTaskName}`
  }
  return `${normalizedParent}/${normalizedTaskName}`
}

function normalizeRecordTaskName(taskName: string | undefined): string | undefined {
  if (!taskName?.trim()) return undefined
  const normalized = taskName.trim()
  if (normalized.startsWith('/')) {
    const path = normalizeAgentPath(normalized)
    return isCanonicalAgentPath(path) ? path : undefined
  }
  try {
    return canonicalSubagentTaskName(normalized)
  } catch {
    return undefined
  }
}

export type SubagentMessageDeliveryMode =
  | typeof MAILBOX_DELIVERY_QUEUE_ONLY
  | typeof MAILBOX_DELIVERY_TRIGGER_TURN

export type SubagentMailboxAgentStatus =
  | 'pending_init'
  | 'running'
  | 'interrupted'
  | 'shutdown'
  | 'not_found'
  | { completed: string | null }
  | { errored: string }

export type SubagentMailboxUpdate = {
  seq: number
  type: SubagentEventType
  agent_name: string
  agent_status?: SubagentMailboxAgentStatus
  last_task_message?: string
  message?: string
  from_agent_name?: string
  to_agent_name?: string
  delivery_mode?: SubagentMessageDeliveryMode
  timestamp_ms: number
}

export type SubagentRegistryStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'need_parent_input'
  | 'interrupted'

export type AgentThreadGraphStatus = 'open' | 'closed'

export type SubAgentSource =
  | 'review'
  | 'compact'
  | 'thread_spawn'
  | 'memory_consolidation'
  | 'other'

export type SubagentRole =
  | 'general'
  | 'explorer'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'custom'

export type SubagentEventType =
  | 'started'
  | 'progress'
  | 'tool_started'
  | 'tool_completed'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'token_usage'
  | 'message'

export type SubagentEventV1 = {
  id: string
  seq?: number
  taskId: string
  type: SubagentEventType
  timestamp: number
  message?: string
  fromAgentName?: string
  toAgentName?: string
  deliveryMode?: SubagentMessageDeliveryMode
  toolName?: string
  summary?: string
  runtime?: SubagentRuntimeSnapshot
  usage?: {
    totalTokens?: number
    toolUses?: number
    durationMs?: number
  }
}

export type SubagentProtocolResult = {
  status?: SubagentRuntimeStatus
  summary?: string
  evidence?: string
  nextAction?: string
  changes?: string
  blockers?: string
}

export type SubagentRegistryRecord = {
  taskId: string
  agentId: string
  agentPath: string
  parentAgentPath: string
  taskName?: string
  threadId: string
  parentThreadId?: string
  depth: number
  agentNickname?: string
  agentRole?: string
  graphStatus: AgentThreadGraphStatus
  source: SubAgentSource
  parentToolUseId?: string
  parentSessionId?: string
  sessionId?: string
  userTurnId?: string
  objective: string
  prompt?: string
  lastTaskMessage?: string
  role: SubagentRole
  agentType: string
  status: SubagentRegistryStatus
  runtimeStatus?: SubagentRuntimeStatus
  startedAt: number
  updatedAt: number
  endedAt?: number
  stepBudget: number
  currentStep?: number
  maxSteps?: number
  remainingSteps?: number
  lastTool?: string
  lastInput?: string
  lastToolSummary?: string
  stopReason?: string
  result?: string
  resultSummary?: string
  evidence?: string
  nextAction?: string
  changes?: string
  blockers?: string
  recentActions?: string[]
  events: SubagentEventV1[]
  hasLiveHandle?: boolean
}

export type SubagentRecordV1 = SubagentRegistryRecord

type PersistedSubagentStateV1 = {
  schemaVersion: 1
  records: unknown[]
}

type PersistedSubagentStateV2 = {
  schemaVersion: 2
  records: SubagentRecordV1[]
}

const DEFAULT_STEP_BUDGET = 15
const MAX_EVENTS_PER_RECORD = 80

function now(): number {
  return Date.now()
}

function stateFilePath(): string {
  return (
    process.env.MTL_CODE_SUBAGENT_STATE_FILE ||
    join(getClaudeConfigHomeDir(), 'subagents.v1.json')
  )
}

function eventId(taskId: string): string {
  return `${taskId}:${now()}:${Math.random().toString(36).slice(2, 8)}`
}

function statusFromRuntime(
  status: SubagentRuntimeStatus | undefined,
): SubagentRegistryStatus | undefined {
  switch (status) {
    case 'DONE':
      return 'completed'
    case 'BLOCKED':
      return 'blocked'
    case 'NEED_PARENT_INPUT':
      return 'need_parent_input'
    case 'RUNNING':
    case undefined:
      return undefined
  }
}

function isTerminalStatus(status: SubagentRegistryStatus): boolean {
  return status !== 'running'
}

function summarizeText(value: string | undefined, max = 320): string | undefined {
  const text = value?.trim().replace(/\s+/g, ' ')
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function normalizeRole(agentType: string | undefined): SubagentRole {
  const normalized = (agentType || '').trim().toLowerCase()
  if (['explore', 'explorer', 'exploration'].includes(normalized)) {
    return 'explorer'
  }
  if (['plan', 'planner', 'planning'].includes(normalized)) {
    return 'planner'
  }
  if (['review', 'reviewer', 'code-review'].includes(normalized)) {
    return 'reviewer'
  }
  if (['implement', 'implementer', 'implementation', 'builder'].includes(normalized)) {
    return 'implementer'
  }
  if (['verify', 'verifier', 'verification', 'validator', 'tester'].includes(normalized)) {
    return 'verifier'
  }
  if (normalized === 'custom') return 'custom'
  return 'general'
}

function coerceRecord(value: unknown, schemaVersion: 1 | 2): SubagentRegistryRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const taskId = typeof record.taskId === 'string' ? record.taskId : undefined
  if (!taskId) return undefined
  const status = typeof record.status === 'string'
    ? (record.status as SubagentRegistryStatus)
    : 'interrupted'
  let normalizedStatus = status === 'running' ? 'interrupted' : status
  const timestamp = now()
  const agentType = typeof record.agentType === 'string' ? record.agentType : 'general-purpose'
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined
  const parentSessionId = typeof record.parentSessionId === 'string' ? record.parentSessionId : undefined
  const parentThreadId =
    typeof record.parentThreadId === 'string'
      ? record.parentThreadId
      : parentSessionId
  const threadId =
    typeof record.threadId === 'string'
      ? record.threadId
      : sessionId ?? taskId
  const rawAgentPath =
    typeof record.agentPath === 'string'
      ? normalizeRecordTaskName(record.agentPath)
      : undefined
  const taskName = normalizeRecordTaskName(
    typeof record.taskName === 'string' ? record.taskName : undefined,
  )
  let agentPath = rawAgentPath ?? taskName
  let parentAgentPath =
    typeof record.parentAgentPath === 'string' &&
    isCanonicalAgentPath(record.parentAgentPath)
      ? normalizeAgentPath(record.parentAgentPath)
      : undefined
  let graphStatus: AgentThreadGraphStatus =
    record.graphStatus === 'open' || record.graphStatus === 'closed'
      ? record.graphStatus
      : status === 'running'
        ? 'open'
        : 'closed'
  if (!agentPath) {
    agentPath = invalidAgentPath(taskId)
    parentAgentPath = ROOT_AGENT_NAME
    normalizedStatus = 'interrupted'
    graphStatus = 'closed'
  }
  parentAgentPath ??= parentAgentPathFromPath(agentPath)
  const source =
    record.source === 'review' ||
    record.source === 'compact' ||
    record.source === 'thread_spawn' ||
    record.source === 'memory_consolidation' ||
    record.source === 'other'
      ? record.source
      : 'thread_spawn'
  return {
    taskId,
    agentId: typeof record.agentId === 'string' ? record.agentId : taskId,
    agentPath,
    parentAgentPath,
    taskName,
    threadId,
    parentThreadId,
    depth: typeof record.depth === 'number' ? record.depth : parentThreadId ? 1 : 0,
    agentNickname: typeof record.agentNickname === 'string' ? record.agentNickname : undefined,
    agentRole: typeof record.agentRole === 'string' ? record.agentRole : undefined,
    graphStatus,
    source,
    parentToolUseId: typeof record.parentToolUseId === 'string' ? record.parentToolUseId : undefined,
    parentSessionId,
    sessionId,
    userTurnId: typeof record.userTurnId === 'string' ? record.userTurnId : undefined,
    objective: typeof record.objective === 'string' ? record.objective : 'Subagent task',
    prompt: typeof record.prompt === 'string' ? record.prompt : undefined,
    lastTaskMessage:
      typeof record.lastTaskMessage === 'string'
        ? record.lastTaskMessage
        : typeof record.prompt === 'string'
          ? summarizeText(record.prompt)
          : typeof record.objective === 'string'
            ? record.objective
            : undefined,
    role: normalizeRole(typeof record.role === 'string' ? record.role : agentType),
    agentType,
    status: normalizedStatus,
    runtimeStatus:
      normalizedStatus === 'interrupted'
        ? 'BLOCKED'
        : typeof record.runtimeStatus === 'string'
          ? (record.runtimeStatus as SubagentRuntimeStatus)
          : undefined,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : timestamp,
    updatedAt: timestamp,
    endedAt: typeof record.endedAt === 'number' ? record.endedAt : timestamp,
    stepBudget: typeof record.stepBudget === 'number' ? record.stepBudget : DEFAULT_STEP_BUDGET,
    currentStep: typeof record.currentStep === 'number' ? record.currentStep : undefined,
    maxSteps: typeof record.maxSteps === 'number' ? record.maxSteps : undefined,
    remainingSteps: typeof record.remainingSteps === 'number' ? record.remainingSteps : undefined,
    lastTool: typeof record.lastTool === 'string' ? record.lastTool : undefined,
    lastInput: typeof record.lastInput === 'string' ? record.lastInput : undefined,
    lastToolSummary: typeof record.lastToolSummary === 'string' ? record.lastToolSummary : undefined,
    stopReason:
      typeof record.stopReason === 'string'
        ? record.stopReason
        : normalizedStatus === 'interrupted'
          ? 'Subagent was interrupted because the previous process no longer has a live task handle.'
          : undefined,
    result: typeof record.result === 'string' ? record.result : undefined,
    resultSummary: typeof record.resultSummary === 'string' ? record.resultSummary : undefined,
    evidence: typeof record.evidence === 'string' ? record.evidence : undefined,
    nextAction: typeof record.nextAction === 'string' ? record.nextAction : undefined,
    changes: typeof record.changes === 'string' ? record.changes : undefined,
    blockers: typeof record.blockers === 'string' ? record.blockers : undefined,
    recentActions: Array.isArray(record.recentActions)
      ? record.recentActions.filter((item): item is string => typeof item === 'string')
      : undefined,
    events: Array.isArray(record.events)
      ? record.events.filter((item): item is SubagentEventV1 => Boolean(item && typeof item === 'object'))
      : [],
    hasLiveHandle: false,
  }
}

export class SubagentManager {
  private readonly records = new Map<string, SubagentRegistryRecord>()
  private readonly filePath: string
  private loaded = false
  private mailboxSeq = 0
  private consumedMailboxSeq = 0

  constructor(filePath = stateFilePath()) {
    this.filePath = filePath
  }

  ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<PersistedSubagentStateV1 | PersistedSubagentStateV2>
      if (
        (parsed.schemaVersion !== 1 && parsed.schemaVersion !== SUBAGENT_STATE_SCHEMA_VERSION) ||
        !Array.isArray(parsed.records)
      ) {
        return
      }
      for (const entry of parsed.records) {
        const record = coerceRecord(entry, parsed.schemaVersion)
        if (record) {
          this.records.set(record.taskId, record)
          for (const event of record.events) {
            if (typeof event.seq === 'number') {
              this.mailboxSeq = Math.max(this.mailboxSeq, event.seq)
            }
          }
        }
      }
      this.persist()
    } catch {
      // Corrupt state should never break chat startup. A later mutation will
      // rewrite a clean file.
    }
  }

  clearForTests(): void {
    this.records.clear()
    this.loaded = true
    this.mailboxSeq = 0
    this.consumedMailboxSeq = 0
  }

  register(params: {
    taskId: string
    agentId?: string
    agentPath?: string
    parentAgentPath?: string
    taskName?: string
    threadId?: string
    parentThreadId?: string
    depth?: number
    agentNickname?: string
    agentRole?: string
    source?: SubAgentSource
    parentToolUseId?: string
    parentSessionId?: string
    sessionId?: string
    userTurnId?: string
    objective: string
    prompt?: string
    selectedAgent?: AgentDefinition
    role?: SubagentRole
    stepBudget?: number
  }): SubagentRegistryRecord {
    this.ensureLoaded()
    const timestamp = now()
    const existing = this.records.get(params.taskId)
    const agentType = params.selectedAgent?.agentType ?? existing?.agentType ?? 'general-purpose'
    const threadId = params.threadId ?? params.sessionId ?? existing?.threadId ?? params.taskId
    const agentPath =
      normalizeRecordTaskName(params.agentPath) ??
      normalizeRecordTaskName(params.taskName) ??
      existing?.agentPath
    if (!agentPath) {
      throw new Error('Subagent registry records require a canonical agentPath.')
    }
    const parentAgentPath =
      params.parentAgentPath && isCanonicalAgentPath(params.parentAgentPath)
        ? normalizeAgentPath(params.parentAgentPath)
        : existing?.parentAgentPath ?? parentAgentPathFromPath(agentPath)
    const taskName = normalizeRecordTaskName(params.taskName) ?? agentPath
    const parentThreadId =
      params.parentThreadId ??
      params.parentSessionId ??
      existing?.parentThreadId
    const lastTaskMessage =
      summarizeText(params.prompt) ??
      summarizeText(params.objective) ??
      existing?.lastTaskMessage
    const record: SubagentRegistryRecord = {
      ...existing,
      taskId: params.taskId,
      agentId: params.agentId ?? params.taskId,
      agentPath,
      parentAgentPath,
      taskName,
      threadId,
      parentThreadId,
      depth: params.depth ?? existing?.depth ?? (parentThreadId ? 1 : 0),
      agentNickname: params.agentNickname ?? existing?.agentNickname,
      agentRole: params.agentRole ?? params.role ?? existing?.agentRole,
      graphStatus: 'open',
      source: params.source ?? existing?.source ?? 'thread_spawn',
      parentToolUseId: params.parentToolUseId ?? existing?.parentToolUseId,
      parentSessionId: params.parentSessionId ?? params.parentThreadId ?? existing?.parentSessionId,
      sessionId: params.sessionId ?? existing?.sessionId,
      userTurnId: params.userTurnId ?? existing?.userTurnId,
      objective: params.objective.trim() || existing?.objective || 'Subagent task',
      prompt: params.prompt ?? existing?.prompt,
      lastTaskMessage,
      role: params.role ?? normalizeRole(agentType),
      agentType,
      status: 'running',
      runtimeStatus: 'RUNNING',
      startedAt: existing?.startedAt ?? timestamp,
      updatedAt: timestamp,
      endedAt: undefined,
      stepBudget: params.stepBudget ?? existing?.stepBudget ?? DEFAULT_STEP_BUDGET,
      hasLiveHandle: true,
      events: existing?.events ?? [],
    }
    record.events = this.appendEvent(record, {
      type: 'started',
      message: record.objective,
    })
    this.records.set(record.taskId, record)
    this.persist()
    return record
  }

  updateRuntime(
    taskId: string,
    runtime: SubagentRuntimeSnapshot | undefined,
  ): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    if (!runtime) return this.records.get(taskId)
    const existing = this.records.get(taskId)
    if (!existing) return undefined
    const mappedStatus = statusFromRuntime(runtime.runtimeStatus)
    const timestamp = now()
    const eventType: SubagentEventType =
      mappedStatus && isTerminalStatus(mappedStatus)
        ? mappedStatus === 'blocked'
          ? 'blocked'
          : 'completed'
        : runtime.lastToolSummary &&
            runtime.lastToolSummary !== existing.lastToolSummary
          ? 'tool_completed'
          : runtime.lastTool &&
              (runtime.lastTool !== existing.lastTool ||
                runtime.lastInput !== existing.lastInput)
            ? 'tool_started'
            : 'progress'

    const record: SubagentRegistryRecord = {
      ...existing,
      status: mappedStatus ?? existing.status,
      runtimeStatus: runtime.runtimeStatus,
      currentStep: runtime.currentStep,
      maxSteps: runtime.maxSteps,
      remainingSteps: runtime.remainingSteps,
      lastTool: runtime.lastTool,
      lastInput: runtime.lastInput,
      lastToolSummary: runtime.lastToolSummary,
      stopReason: runtime.stopReason ?? existing.stopReason,
      resultSummary:
        mappedStatus && isTerminalStatus(mappedStatus)
          ? summarizeText(runtime.stopReason ?? runtime.lastToolSummary)
          : existing.resultSummary,
      recentActions: runtime.recentActions,
      updatedAt: timestamp,
      ...(mappedStatus && mappedStatus !== 'running' && !existing.endedAt
        ? { endedAt: timestamp, hasLiveHandle: false }
        : {}),
    }
    record.events = this.appendEvent(record, {
      type: eventType,
      message: runtime.stopReason ?? runtime.lastToolSummary ?? runtime.lastTool,
      toolName: runtime.lastTool,
      summary: runtime.lastToolSummary,
      runtime,
    })
    this.records.set(taskId, record)
    this.persist()
    return record
  }

  recordUsage(
    taskId: string,
    usage: NonNullable<SubagentEventV1['usage']>,
  ): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    const existing = this.records.get(taskId)
    if (!existing) return undefined
    const record: SubagentRegistryRecord = {
      ...existing,
      updatedAt: now(),
    }
    record.events = this.appendEvent(record, {
      type: 'token_usage',
      usage,
      summary: [
        usage.totalTokens !== undefined ? `${usage.totalTokens} tokens` : null,
        usage.toolUses !== undefined ? `${usage.toolUses} tools` : null,
      ]
        .filter(Boolean)
        .join(', '),
    })
    this.records.set(taskId, record)
    this.persist()
    return record
  }

  recordMessage({
    target,
    message,
    fromAgentPath = ROOT_AGENT_NAME,
    deliveryMode,
  }: {
    target: string
    message: string
    fromAgentPath?: string
    deliveryMode?: SubagentMessageDeliveryMode
  }): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    const existing = this.resolveAgentPath(target, fromAgentPath)
    if (!existing) return undefined
    const record: SubagentRegistryRecord = {
      ...existing,
      lastTaskMessage: summarizeText(message) ?? existing.lastTaskMessage,
      updatedAt: now(),
    }
    record.events = this.appendEvent(record, {
      type: 'message',
      message: record.lastTaskMessage,
      fromAgentName: normalizeAgentPath(fromAgentPath),
      toAgentName: record.agentPath,
      deliveryMode,
    })
    this.records.set(record.taskId, record)
    this.persist()
    return record
  }

  complete(result: AgentToolResult): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    const taskId = result.agentId
    const existing = this.records.get(taskId)
    if (!existing) return undefined
    const text = extractTextContent(result.content, '\n')
    const protocol = parseSubagentProtocolResult(text)
    const mappedStatus = statusFromRuntime(protocol.status)
    const timestamp = now()
    const record: SubagentRegistryRecord = {
      ...existing,
      status: mappedStatus ?? 'completed',
      runtimeStatus: protocol.status ?? existing.runtimeStatus ?? 'DONE',
      result: text,
      resultSummary: summarizeText(protocol.summary ?? text),
      evidence: protocol.evidence,
      nextAction: protocol.nextAction,
      changes: protocol.changes,
      blockers: protocol.blockers,
      updatedAt: timestamp,
      endedAt: timestamp,
      hasLiveHandle: false,
      graphStatus: existing.graphStatus,
    }
    record.events = this.appendEvent(record, {
      type: record.status === 'blocked' ? 'blocked' : 'completed',
      message: record.resultSummary,
      summary: record.resultSummary,
      usage: {
        totalTokens: result.totalTokens,
        toolUses: result.totalToolUseCount,
        durationMs: result.totalDurationMs,
      },
    })
    this.records.set(taskId, record)
    this.persist()
    return record
  }

  fail(taskId: string, error: string): SubagentRegistryRecord | undefined {
    return this.terminal(taskId, 'failed', error, 'failed')
  }

  cancel(taskId: string, reason = 'Subagent was cancelled.'): SubagentRegistryRecord | undefined {
    return this.terminal(taskId, 'cancelled', reason, 'cancelled')
  }

  closeSubtree(rootId: string, reason = 'Subagent was closed.'): SubagentRegistryRecord[] {
    this.ensureLoaded()
    const root = this.resolveAgentPath(rootId)
    if (!root) return []
    const closed: SubagentRegistryRecord[] = []
    const rootPath = root.agentPath
    const taskIdsToClose = [...this.records.values()]
      .filter(record =>
        record.graphStatus === 'open' &&
        (record.agentPath === rootPath || record.agentPath.startsWith(`${rootPath}/`)),
      )
      .map(record => record.taskId)
    for (const taskId of taskIdsToClose) {
      const record = this.terminal(taskId, 'cancelled', reason, 'cancelled')
      if (record) closed.push(record)
    }
    return closed
  }

  interrupt(taskId: string, reason = 'Subagent was interrupted.'): SubagentRegistryRecord | undefined {
    return this.terminal(taskId, 'interrupted', reason, 'interrupted')
  }

  get(taskId: string): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    return this.findByGraphId(taskId)
  }

  list({
    runningOnly = false,
    parentToolUseId,
    sessionId,
    includeArchived = true,
  }: {
    runningOnly?: boolean
    parentToolUseId?: string
    sessionId?: string
    includeArchived?: boolean
  } = {}): SubagentRegistryRecord[] {
    this.ensureLoaded()
    return [...this.records.values()]
      .filter(record => !runningOnly || record.status === 'running')
      .filter(record => includeArchived || record.graphStatus === 'open')
      .filter(record => !parentToolUseId || record.parentToolUseId === parentToolUseId)
      .filter(record => !sessionId || record.sessionId === sessionId || record.parentSessionId === sessionId)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  hasRunningForObjective(objective: string, sessionId?: string): boolean {
    const normalized = objective.trim().toLowerCase()
    if (!normalized) return false
    return this.list({ runningOnly: true, sessionId }).some(
      record => record.objective.trim().toLowerCase() === normalized,
    )
  }

  countRunning(sessionId?: string): number {
    return this.list({ runningOnly: true, sessionId }).length
  }

  drainMailboxItems(): { sequence: number; updates: SubagentMailboxUpdate[] } {
    this.ensureLoaded()
    const updates = this.mailboxUpdatesAfter(this.consumedMailboxSeq)
    this.consumedMailboxSeq = this.latestMailboxSeq()
    return {
      sequence: this.consumedMailboxSeq,
      updates,
    }
  }

  private terminal(
    taskId: string,
    status: SubagentRegistryStatus,
    reason: string,
    eventType: SubagentEventType,
  ): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    const existing = this.records.get(taskId)
    if (!existing) return undefined
    const timestamp = now()
    const record: SubagentRegistryRecord = {
      ...existing,
      status,
      runtimeStatus: status === 'completed' ? 'DONE' : 'BLOCKED',
      stopReason: reason,
      resultSummary: summarizeText(reason),
      updatedAt: timestamp,
      endedAt: timestamp,
      hasLiveHandle: false,
      graphStatus: 'closed',
    }
    record.events = this.appendEvent(record, {
      type: eventType,
      message: reason,
      summary: reason,
    })
    this.records.set(taskId, record)
    this.persist()
    return record
  }

  private appendEvent(
    record: SubagentRegistryRecord,
    event: Omit<SubagentEventV1, 'id' | 'taskId' | 'timestamp'>,
  ): SubagentEventV1[] {
    const events = [
      ...(record.events ?? []),
      {
        id: eventId(record.taskId),
        seq: ++this.mailboxSeq,
        taskId: record.taskId,
        timestamp: now(),
        ...event,
      },
    ]
    return events.slice(-MAX_EVENTS_PER_RECORD)
  }

  private persist(): void {
    if (
      process.env.NODE_ENV === 'test' &&
      !process.env.MTL_CODE_SUBAGENT_STATE_FILE &&
      this.filePath === join(getClaudeConfigHomeDir(), 'subagents.v1.json')
    ) {
      return
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const payload: PersistedSubagentStateV2 = {
        schemaVersion: SUBAGENT_STATE_SCHEMA_VERSION,
        records: [...this.records.values()],
      }
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8')
      renameSync(tmp, this.filePath)
    } catch {
      // Persistence is best-effort; runtime state remains authoritative in memory.
    }
  }

  private findByGraphId(id: string): SubagentRegistryRecord | undefined {
    return this.resolveAgentPath(id)
  }

  resolveAgentPath(id: string, currentAgentPath = ROOT_AGENT_NAME): SubagentRegistryRecord | undefined {
    const target = id.trim()
    if (!target || target === ROOT_AGENT_NAME) return undefined
    const basePath = isCanonicalAgentPath(currentAgentPath)
      ? normalizeAgentPath(currentAgentPath)
      : ROOT_AGENT_NAME
    let resolvedPath: string
    try {
      resolvedPath = target.startsWith('/')
        ? normalizeAgentPath(target)
        : canonicalSubagentTaskName(target, basePath)
    } catch {
      return undefined
    }
    return [...this.records.values()].find(
      record => record.graphStatus === 'open' && record.agentPath === resolvedPath,
    )
  }

  getByInternalId(id: string): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    return this.records.get(id)
  }

  private latestMailboxSeq(): number {
    let latest = 0
    for (const record of this.records.values()) {
      for (const event of record.events) {
        if (this.isMailboxEvent(event) && typeof event.seq === 'number') {
          latest = Math.max(latest, event.seq)
        }
      }
    }
    return latest
  }

  private mailboxUpdatesAfter(seq: number): SubagentMailboxUpdate[] {
    const updates: SubagentMailboxUpdate[] = []
    for (const record of this.records.values()) {
      for (const event of record.events) {
        if (!this.isMailboxEvent(event) || typeof event.seq !== 'number' || event.seq <= seq) {
          continue
        }
        updates.push({
          seq: event.seq,
          type: event.type,
          agent_name: record.agentPath,
          agent_status: this.mailboxStatus(record),
          last_task_message: record.lastTaskMessage,
          message: event.message ?? event.summary,
          from_agent_name: event.fromAgentName,
          to_agent_name: event.toAgentName,
          delivery_mode: event.deliveryMode,
          timestamp_ms: event.timestamp,
        })
      }
    }
    return updates.sort((left, right) => left.seq - right.seq)
  }

  private isMailboxEvent(event: SubagentEventV1): boolean {
    return (
      event.type === 'message' ||
      event.type === 'completed' ||
      event.type === 'blocked' ||
      event.type === 'failed' ||
      event.type === 'cancelled' ||
      event.type === 'interrupted'
    )
  }

  private mailboxStatus(
    record: SubagentRegistryRecord,
  ): SubagentMailboxUpdate['agent_status'] {
    switch (record.status) {
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
      case 'cancelled':
        return 'shutdown'
      default:
        return record.status
    }
  }
}

export const subagentManager = new SubagentManager()

export function parseSubagentProtocolResult(
  text: string | undefined,
): SubagentProtocolResult {
  if (!text?.trim()) return {}
  const readSection = (name: string): string | undefined => {
    const pattern = new RegExp(
      `###\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n###\\s*[A-Z_ ]+\\s*\\n|$)`,
      'i',
    )
    const match = text.match(pattern)
    return match?.[1]?.trim()
  }
  const rawStatus = readSection('STATUS')?.split(/\s+/)[0]?.toUpperCase()
  const status =
    rawStatus === 'DONE' ||
    rawStatus === 'BLOCKED' ||
    rawStatus === 'NEED_PARENT_INPUT'
      ? (rawStatus as SubagentRuntimeStatus)
      : undefined
  return {
    status,
    summary: readSection('SUMMARY'),
    evidence: readSection('EVIDENCE'),
    nextAction: readSection('NEXT_ACTION'),
    changes: readSection('CHANGES'),
    blockers: readSection('BLOCKERS'),
  }
}

export function registerSubagentRecord(params: {
  taskId: string
  agentId?: string
  agentPath?: string
  parentAgentPath?: string
  taskName?: string
  threadId?: string
  parentThreadId?: string
  depth?: number
  agentNickname?: string
  agentRole?: string
  source?: SubAgentSource
  parentToolUseId?: string
  parentSessionId?: string
  sessionId?: string
  userTurnId?: string
  objective: string
  prompt?: string
  selectedAgent?: AgentDefinition
  role?: SubagentRole
  stepBudget?: number
}): SubagentRegistryRecord {
  return subagentManager.register(params)
}

export function updateSubagentRuntimeRecord(
  taskId: string,
  runtime: SubagentRuntimeSnapshot | undefined,
): SubagentRegistryRecord | undefined {
  return subagentManager.updateRuntime(taskId, runtime)
}

export function recordSubagentUsage(
  taskId: string,
  usage: NonNullable<SubagentEventV1['usage']>,
): SubagentRegistryRecord | undefined {
  return subagentManager.recordUsage(taskId, usage)
}

export function recordSubagentMessage(
  target: string,
  message: string,
  options: {
    fromAgentPath?: string
    deliveryMode?: SubagentMessageDeliveryMode
  } = {},
): SubagentRegistryRecord | undefined {
  return subagentManager.recordMessage({
    target,
    message,
    fromAgentPath: options.fromAgentPath,
    deliveryMode: options.deliveryMode,
  })
}

export function completeSubagentRecord(
  result: AgentToolResult,
): SubagentRegistryRecord | undefined {
  return subagentManager.complete(result)
}

export function failSubagentRecord(
  taskId: string,
  error: string,
): SubagentRegistryRecord | undefined {
  return subagentManager.fail(taskId, error)
}

export function cancelSubagentRecord(
  taskId: string,
  reason = 'Subagent was cancelled.',
): SubagentRegistryRecord | undefined {
  return subagentManager.cancel(taskId, reason)
}

export function closeSubagentSubtree(
  rootId: string,
  reason = 'Subagent was closed.',
): SubagentRegistryRecord[] {
  return subagentManager.closeSubtree(rootId, reason)
}

export function interruptSubagentRecord(
  taskId: string,
  reason = 'Subagent was interrupted.',
): SubagentRegistryRecord | undefined {
  return subagentManager.interrupt(taskId, reason)
}

export function getSubagentRecord(
  taskId: string,
): SubagentRegistryRecord | undefined {
  return subagentManager.get(taskId)
}

export function getSubagentRecordByInternalId(
  taskId: string,
): SubagentRegistryRecord | undefined {
  return subagentManager.getByInternalId(taskId)
}

export function resolveSubagentRecordByAgentPath(
  target: string,
  currentAgentPath = ROOT_AGENT_NAME,
): SubagentRegistryRecord | undefined {
  subagentManager.ensureLoaded()
  return subagentManager.resolveAgentPath(target, currentAgentPath)
}

export function drainSubagentMailboxItems(): {
  sequence: number
  updates: SubagentMailboxUpdate[]
} {
  return subagentManager.drainMailboxItems()
}

export function listSubagentRecords({
  runningOnly = false,
  parentToolUseId,
  sessionId,
  includeArchived = true,
}: {
  runningOnly?: boolean
  parentToolUseId?: string
  sessionId?: string
  includeArchived?: boolean
} = {}): SubagentRegistryRecord[] {
  return subagentManager.list({ runningOnly, parentToolUseId, sessionId, includeArchived })
}

export function hasRunningSubagentForObjective(
  objective: string,
  sessionId?: string,
): boolean {
  return subagentManager.hasRunningForObjective(objective, sessionId)
}

export function countRunningSubagents(sessionId?: string): number {
  return subagentManager.countRunning(sessionId)
}

export function clearSubagentRegistryForTests(): void {
  subagentManager.clearForTests()
}
