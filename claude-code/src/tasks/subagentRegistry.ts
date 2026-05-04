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

export const SUBAGENT_STATE_SCHEMA_VERSION = 1

export type SubagentRegistryStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'need_parent_input'
  | 'interrupted'

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

export type SubagentEventV1 = {
  id: string
  taskId: string
  type: SubagentEventType
  timestamp: number
  message?: string
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
  parentToolUseId?: string
  parentSessionId?: string
  sessionId?: string
  userTurnId?: string
  objective: string
  prompt?: string
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

function coerceRecord(value: unknown): SubagentRegistryRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const taskId = typeof record.taskId === 'string' ? record.taskId : undefined
  if (!taskId) return undefined
  const status = typeof record.status === 'string'
    ? (record.status as SubagentRegistryStatus)
    : 'interrupted'
  const normalizedStatus =
    status === 'running' ? 'interrupted' : status
  const timestamp = now()
  const agentType = typeof record.agentType === 'string' ? record.agentType : 'general-purpose'
  return {
    taskId,
    agentId: typeof record.agentId === 'string' ? record.agentId : taskId,
    parentToolUseId: typeof record.parentToolUseId === 'string' ? record.parentToolUseId : undefined,
    parentSessionId: typeof record.parentSessionId === 'string' ? record.parentSessionId : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    userTurnId: typeof record.userTurnId === 'string' ? record.userTurnId : undefined,
    objective: typeof record.objective === 'string' ? record.objective : 'Subagent task',
    prompt: typeof record.prompt === 'string' ? record.prompt : undefined,
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

  constructor(filePath = stateFilePath()) {
    this.filePath = filePath
  }

  ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<PersistedSubagentStateV1>
      if (parsed.schemaVersion !== SUBAGENT_STATE_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
        return
      }
      for (const entry of parsed.records) {
        const record = coerceRecord(entry)
        if (record) {
          this.records.set(record.taskId, record)
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
  }

  register(params: {
    taskId: string
    agentId?: string
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
    const record: SubagentRegistryRecord = {
      ...existing,
      taskId: params.taskId,
      agentId: params.agentId ?? params.taskId,
      parentToolUseId: params.parentToolUseId ?? existing?.parentToolUseId,
      parentSessionId: params.parentSessionId ?? params.sessionId ?? existing?.parentSessionId,
      sessionId: params.sessionId ?? existing?.sessionId,
      userTurnId: params.userTurnId ?? existing?.userTurnId,
      objective: params.objective.trim() || existing?.objective || 'Subagent task',
      prompt: params.prompt ?? existing?.prompt,
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

  interrupt(taskId: string, reason = 'Subagent was interrupted.'): SubagentRegistryRecord | undefined {
    return this.terminal(taskId, 'interrupted', reason, 'interrupted')
  }

  get(taskId: string): SubagentRegistryRecord | undefined {
    this.ensureLoaded()
    return this.records.get(taskId)
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
      .filter(record => includeArchived || record.status === 'running')
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
      const payload: PersistedSubagentStateV1 = {
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
