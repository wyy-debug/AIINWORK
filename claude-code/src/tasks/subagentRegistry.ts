import type { AgentToolResult } from '@mtl-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import type { AgentDefinition } from '@mtl-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type {
  SubagentRuntimeSnapshot,
  SubagentRuntimeStatus,
} from '@mtl-code/builtin-tools/tools/AgentTool/subagentRuntimeGuard.js'
import { extractTextContent } from '../utils/messages.js'

export type SubagentRegistryStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'need_parent_input'

export type SubagentProtocolResult = {
  status?: SubagentRuntimeStatus
  summary?: string
  evidence?: string
  nextAction?: string
}

export type SubagentRegistryRecord = {
  taskId: string
  agentId: string
  parentToolUseId?: string
  sessionId?: string
  objective: string
  prompt?: string
  agentType: string
  status: SubagentRegistryStatus
  runtimeStatus?: SubagentRuntimeStatus
  startedAt: number
  updatedAt: number
  endedAt?: number
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
  recentActions?: string[]
}

const records = new Map<string, SubagentRegistryRecord>()

function now(): number {
  return Date.now()
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

function summarizeText(value: string | undefined, max = 320): string | undefined {
  const text = value?.trim().replace(/\s+/g, ' ')
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

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
  }
}

export function registerSubagentRecord({
  taskId,
  agentId = taskId,
  parentToolUseId,
  sessionId,
  objective,
  prompt,
  selectedAgent,
}: {
  taskId: string
  agentId?: string
  parentToolUseId?: string
  sessionId?: string
  objective: string
  prompt?: string
  selectedAgent?: AgentDefinition
}): SubagentRegistryRecord {
  const timestamp = now()
  const existing = records.get(taskId)
  const record: SubagentRegistryRecord = {
    ...existing,
    taskId,
    agentId,
    ...(parentToolUseId ? { parentToolUseId } : {}),
    ...(sessionId ? { sessionId } : {}),
    objective: objective.trim() || existing?.objective || 'Subagent task',
    ...(prompt ? { prompt } : {}),
    agentType: selectedAgent?.agentType ?? existing?.agentType ?? 'general-purpose',
    status: 'running',
    startedAt: existing?.startedAt ?? timestamp,
    updatedAt: timestamp,
  }
  records.set(taskId, record)
  return record
}

export function updateSubagentRuntimeRecord(
  taskId: string,
  runtime: SubagentRuntimeSnapshot | undefined,
): SubagentRegistryRecord | undefined {
  if (!runtime) return records.get(taskId)
  const existing = records.get(taskId)
  if (!existing) return undefined
  const mappedStatus = statusFromRuntime(runtime.runtimeStatus)
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
    updatedAt: now(),
    ...(mappedStatus && mappedStatus !== 'running' && !existing.endedAt
      ? { endedAt: now() }
      : {}),
  }
  records.set(taskId, record)
  return record
}

export function completeSubagentRecord(
  result: AgentToolResult,
): SubagentRegistryRecord | undefined {
  const taskId = result.agentId
  const existing = records.get(taskId)
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
    updatedAt: timestamp,
    endedAt: timestamp,
  }
  records.set(taskId, record)
  return record
}

export function failSubagentRecord(
  taskId: string,
  error: string,
): SubagentRegistryRecord | undefined {
  const existing = records.get(taskId)
  if (!existing) return undefined
  const timestamp = now()
  const record: SubagentRegistryRecord = {
    ...existing,
    status: 'failed',
    stopReason: error,
    resultSummary: summarizeText(error),
    updatedAt: timestamp,
    endedAt: timestamp,
  }
  records.set(taskId, record)
  return record
}

export function cancelSubagentRecord(
  taskId: string,
  reason = 'Subagent was cancelled.',
): SubagentRegistryRecord | undefined {
  const existing = records.get(taskId)
  if (!existing) return undefined
  const timestamp = now()
  const record: SubagentRegistryRecord = {
    ...existing,
    status: 'cancelled',
    runtimeStatus: 'BLOCKED',
    stopReason: reason,
    resultSummary: summarizeText(reason),
    updatedAt: timestamp,
    endedAt: timestamp,
  }
  records.set(taskId, record)
  return record
}

export function getSubagentRecord(
  taskId: string,
): SubagentRegistryRecord | undefined {
  return records.get(taskId)
}

export function listSubagentRecords({
  runningOnly = false,
  parentToolUseId,
  sessionId,
}: {
  runningOnly?: boolean
  parentToolUseId?: string
  sessionId?: string
} = {}): SubagentRegistryRecord[] {
  return [...records.values()]
    .filter(record => !runningOnly || record.status === 'running')
    .filter(record => !parentToolUseId || record.parentToolUseId === parentToolUseId)
    .filter(record => !sessionId || record.sessionId === sessionId)
    .sort((a, b) => b.startedAt - a.startedAt)
}

export function hasRunningSubagentForObjective(
  objective: string,
  sessionId?: string,
): boolean {
  const normalized = objective.trim().toLowerCase()
  if (!normalized) return false
  return listSubagentRecords({ runningOnly: true, sessionId }).some(
    record => record.objective.trim().toLowerCase() === normalized,
  )
}

export function countRunningSubagents(sessionId?: string): number {
  return listSubagentRecords({ runningOnly: true, sessionId }).length
}

export function clearSubagentRegistryForTests(): void {
  records.clear()
}
