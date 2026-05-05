import type { AssistantMessage, Message, UserMessage } from 'src/types/message.js'

export const SUBAGENT_DEFAULT_MAX_TURNS = 15
export const SUBAGENT_MAX_TURNS_CAP = 15

export type SubagentRuntimeStatus =
  | 'RUNNING'
  | 'DONE'
  | 'BLOCKED'
  | 'NEED_PARENT_INPUT'

export type SubagentRuntimeSnapshot = {
  objective: string
  currentStep: number
  maxSteps: number
  remainingSteps: number
  startedAt: number
  elapsedMs: number
  runtimeStatus: SubagentRuntimeStatus
  stopReason?: string
  lastTool?: string
  lastInput?: string
  lastToolSummary?: string
  recentActions: string[]
}

type ToolUseRecord = {
  id?: string
  name: string
  input: unknown
  signature: string
  displayInput: string
  readPath?: string
  url?: string
}

export function resolveSubagentMaxTurns(
  requestedMaxTurns?: number,
  agentMaxTurns?: number,
): number {
  const candidates = [SUBAGENT_DEFAULT_MAX_TURNS, SUBAGENT_MAX_TURNS_CAP]
  if (requestedMaxTurns && Number.isFinite(requestedMaxTurns)) {
    candidates.push(requestedMaxTurns)
  }
  if (agentMaxTurns && Number.isFinite(agentMaxTurns)) {
    candidates.push(agentMaxTurns)
  }
  const effective = Math.min(...candidates.map(value => Math.floor(value)))
  return Math.max(1, effective)
}

export function appendSubagentContinuationContract(message: string): string {
  const trimmed = message.trimEnd()
  if (trimmed.includes('### STATUS') && trimmed.includes('### NEXT_ACTION')) {
    return trimmed
  }

  return `${trimmed}

---
Runtime stop contract for this continuation:
- Do not continue open-ended exploration or answer only with progress updates.
- If the requested objective is already satisfied, immediately stop with:
  ### STATUS
  DONE
- If required information is missing from the parent, stop with:
  ### STATUS
  NEED_PARENT_INPUT
- If you are blocked by missing tools, permissions, repeated empty results, or unclear scope, stop with:
  ### STATUS
  BLOCKED
- Your final response must include exactly these sections:
  ### STATUS
  ### SUMMARY
  ### EVIDENCE
  ### NEXT_ACTION`
}

export function formatSubagentProtocolReminder(): string {
  return `Subagent completion protocol:
- Stop as soon as the assigned objective is satisfied or blocked.
- Do not loop on the same file, same tool call, or empty/error results.
- Your final response must include exactly these sections:
  ### STATUS
  DONE | BLOCKED | NEED_PARENT_INPUT
  ### SUMMARY
  ### EVIDENCE
  ### NEXT_ACTION`
}

export function formatBlockedSubagentResult(
  snapshot: SubagentRuntimeSnapshot,
): string {
  const reason = snapshot.stopReason || 'Subagent runtime guard stopped the task.'
  const evidence = [
    snapshot.lastTool ? `Last tool: ${snapshot.lastTool}` : null,
    snapshot.lastInput ? `Last input: ${snapshot.lastInput}` : null,
    snapshot.lastToolSummary ? `Last output: ${snapshot.lastToolSummary}` : null,
    snapshot.recentActions.length > 0
      ? `Recent actions: ${snapshot.recentActions.join(' | ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  return `### STATUS
BLOCKED

### SUMMARY
${reason}

### EVIDENCE
${evidence || 'No additional evidence was captured before the guard stopped the subagent.'}

### NEXT_ACTION
Ask the parent agent for clearer input, choose a different strategy, or stop relying on the repeated/empty tool path.`
}

export class SubagentRuntimeGuard {
  private readonly objective: string
  private readonly maxSteps: number
  private readonly startedAt = Date.now()
  private currentStep = 0
  private runtimeStatus: SubagentRuntimeStatus = 'RUNNING'
  private stopReason: string | undefined
  private lastTool: string | undefined
  private lastInput: string | undefined
  private lastToolSummary: string | undefined
  private lastToolUse: ToolUseRecord | undefined
  private lastReadPath: string | undefined
  private lastUrl: string | undefined
  private consecutiveSameSignature = 0
  private consecutiveSameReadPath = 0
  private consecutiveSameUrl = 0
  private consecutiveEmptyResults = 0
  private consecutiveAuthFailures = 0
  private textSinceLastTool = false
  private pendingStopReason: string | undefined
  private readonly toolUseById = new Map<string, ToolUseRecord>()
  private readonly unresolvedToolUseIds = new Set<string>()
  private readonly recentActions: string[] = []

  constructor({
    objective,
    maxSteps,
  }: {
    objective: string
    maxSteps: number
  }) {
    this.objective = objective.trim() || 'Subagent task'
    this.maxSteps = Math.max(1, maxSteps)
  }

  snapshot(): SubagentRuntimeSnapshot {
    return {
      objective: this.objective,
      currentStep: this.currentStep,
      maxSteps: this.maxSteps,
      remainingSteps: Math.max(0, this.maxSteps - this.currentStep),
      startedAt: this.startedAt,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
      runtimeStatus: this.runtimeStatus,
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      ...(this.lastTool ? { lastTool: this.lastTool } : {}),
      ...(this.lastInput ? { lastInput: this.lastInput } : {}),
      ...(this.lastToolSummary ? { lastToolSummary: this.lastToolSummary } : {}),
      recentActions: [...this.recentActions],
    }
  }

  markBudgetReached(maxTurns = this.maxSteps): SubagentRuntimeSnapshot {
    this.block(`Reached the subagent hard budget of ${maxTurns} turns.`)
    return this.snapshot()
  }

  observeMessage(message: Message): {
    shouldStop: boolean
    snapshot: SubagentRuntimeSnapshot
  } {
    if (this.runtimeStatus !== 'RUNNING') {
      return { shouldStop: true, snapshot: this.snapshot() }
    }

    if (message.type === 'assistant') {
      this.observeAssistant(message as AssistantMessage)
    } else if (message.type === 'user') {
      this.observeUser(message as UserMessage)
    }

    return {
      shouldStop: this.runtimeStatus !== 'RUNNING',
      snapshot: this.snapshot(),
    }
  }

  private observeAssistant(message: AssistantMessage): void {
    const content = message.message?.content
    if (!Array.isArray(content)) return

    const text = content
      .filter((block): block is { type: 'text'; text: string } =>
        Boolean(block && block.type === 'text' && typeof block.text === 'string'),
      )
      .map(block => block.text.trim())
      .filter(Boolean)
      .join('\n')

    if (text.length >= 24) {
      this.textSinceLastTool = true
      const status = parseStructuredStatus(text)
      if (status) {
        this.runtimeStatus = status
      }
    }

    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue
      const tool = toToolUseRecord(block)
      this.currentStep += 1
      this.lastTool = tool.name
      this.lastInput = tool.displayInput
      if (tool.id) {
        this.toolUseById.set(tool.id, tool)
        this.unresolvedToolUseIds.add(tool.id)
      }
      this.pushAction(`${tool.name} ${tool.displayInput}`.trim())

      if (this.lastToolUse?.signature === tool.signature) {
        this.consecutiveSameSignature += 1
      } else {
        this.consecutiveSameSignature = 1
      }

      if (
        tool.readPath &&
        this.lastReadPath === tool.readPath &&
        !this.textSinceLastTool
      ) {
        this.consecutiveSameReadPath += 1
      } else {
        this.consecutiveSameReadPath = tool.readPath ? 1 : 0
      }

      if (
        tool.url &&
        this.lastUrl === tool.url &&
        !this.textSinceLastTool
      ) {
        this.consecutiveSameUrl += 1
      } else {
        this.consecutiveSameUrl = tool.url ? 1 : 0
      }

      this.lastToolUse = tool
      this.lastReadPath = tool.readPath
      this.lastUrl = tool.url
      this.textSinceLastTool = false

      if (this.consecutiveSameSignature >= 2) {
        this.stopAfterToolResults(`Repeated the same tool call twice: ${tool.name}.`)
      } else if (this.consecutiveSameReadPath >= 2 && tool.readPath) {
        this.stopAfterToolResults(`Read the same file twice without new progress: ${tool.readPath}.`)
      } else if (this.consecutiveSameUrl >= 2 && tool.url) {
        this.stopAfterToolResults(`Visited the same URL twice without new progress: ${tool.url}.`)
      } else if (this.currentStep >= this.maxSteps) {
        this.stopAfterToolResults(`Reached the subagent hard budget of ${this.maxSteps} steps.`)
      }
    }
  }

  private observeUser(message: UserMessage): void {
    const content = message.message?.content
    if (!Array.isArray(content)) return

    for (const block of content) {
      if (!block || block.type !== 'tool_result') continue
      if (typeof block.tool_use_id === 'string') {
        this.unresolvedToolUseIds.delete(block.tool_use_id)
      }
      const resultText = extractResultText(block)
      const tool = this.toolUseById.get(block.tool_use_id)
      const summary = summarizeText(resultText || (block.is_error ? 'tool error' : ''))
      this.lastToolSummary = summary
      if (tool) {
        this.lastTool = tool.name
        this.lastInput = tool.displayInput
      }

      if (isEmptyOrUnhelpfulResult(resultText, Boolean(block.is_error))) {
        this.consecutiveEmptyResults += 1
      } else {
        this.consecutiveEmptyResults = 0
      }

      if (isAuthenticationFailureResult(resultText)) {
        this.consecutiveAuthFailures += 1
      } else if (!isEmptyOrUnhelpfulResult(resultText, Boolean(block.is_error))) {
        this.consecutiveAuthFailures = 0
      }

      if (this.consecutiveEmptyResults >= 2) {
        this.block('Received two consecutive empty, no-match, or error-only tool results.')
        return
      }
    }

    if (this.pendingStopReason && this.unresolvedToolUseIds.size === 0) {
      this.block(this.pendingStopReason)
      this.pendingStopReason = undefined
      return
    }

    if (this.consecutiveAuthFailures >= 2) {
      this.block('Received repeated authentication or permission failures. Ask the parent/user to log in, export the data, or configure the required token before retrying.')
    }
  }

  private block(reason: string): void {
    if (this.runtimeStatus !== 'RUNNING') return
    this.runtimeStatus = 'BLOCKED'
    this.stopReason = reason
  }

  private stopAfterToolResults(reason: string): void {
    this.pendingStopReason ??= reason
  }

  private pushAction(action: string): void {
    if (!action) return
    this.recentActions.push(action)
    while (this.recentActions.length > 5) {
      this.recentActions.shift()
    }
  }
}

export function createSubagentRuntimeGuard(params: {
  objective: string
  maxSteps: number
}): SubagentRuntimeGuard {
  return new SubagentRuntimeGuard(params)
}

function parseStructuredStatus(text: string): SubagentRuntimeStatus | undefined {
  const match = text.match(/###\s*STATUS\s*\n\s*(DONE|BLOCKED|NEED_PARENT_INPUT)\b/i)
  if (!match) return undefined
  return match[1]!.toUpperCase() as SubagentRuntimeStatus
}

function toToolUseRecord(block: {
  id?: string
  name?: string
  input?: unknown
}): ToolUseRecord {
  const name = typeof block.name === 'string' ? block.name : 'Tool'
  const displayInput = summarizeInput(block.input)
  return {
    id: typeof block.id === 'string' ? block.id : undefined,
    name,
    input: block.input,
    signature: `${name}:${stableStringify(normalizeInput(block.input))}`,
    displayInput,
    readPath: getReadPath(name, block.input),
    url: getUrl(block.input),
  }
}

function getReadPath(toolName: string, input: unknown): string | undefined {
  if (!/^(Read|FileRead|View)$/i.test(toolName)) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const value = record.file_path ?? record.path ?? record.filePath
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\\/g, '/').toLowerCase()
    : undefined
}

function getUrl(input: unknown): string | undefined {
  if (typeof input === 'string') {
    const match = input.match(/https?:\/\/[^\s"'<>]+/i)
    return match ? normalizeUrl(match[0]!) : undefined
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const direct = record.url ?? record.uri ?? record.href
  if (typeof direct === 'string' && direct.trim()) {
    return normalizeUrl(direct)
  }
  const command = record.command ?? record.query ?? record.prompt
  if (typeof command === 'string') {
    const match = command.match(/https?:\/\/[^\s"'<>]+/i)
    return match ? normalizeUrl(match[0]!) : undefined
  }
  return undefined
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/[),.;]+$/g, '').toLowerCase()
}

function normalizeInput(input: unknown): unknown {
  if (typeof input === 'string') return input.trim()
  if (!input || typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map(normalizeInput)
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries.map(([key, value]) => [key, normalizeInput(value)]))
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return summarizeText(typeof input === 'string' ? input : stableStringify(input))
  }
  const record = input as Record<string, unknown>
  const preferred =
    record.file_path ??
    record.path ??
    record.pattern ??
    record.command ??
    record.query ??
    record.description ??
    record.prompt ??
    record.url
  if (typeof preferred === 'string' && preferred.trim()) {
    return summarizeText(preferred)
  }
  return summarizeText(stableStringify(normalizeInput(input)))
}

function extractResultText(block: { content?: unknown }): string {
  const content = block.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return content == null ? '' : stableStringify(content)
}

function isEmptyOrUnhelpfulResult(text: string, isError: boolean): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (isError) return true
  if (!normalized) return true
  if (
    normalized === '[]' ||
    normalized === '{}' ||
    normalized === 'null' ||
    normalized === 'undefined'
  ) {
    return true
  }
  return [
    'no matches',
    'no results',
    'not found',
    '0 matches',
    '0 results',
    'nothing found',
    'empty result',
  ].some(marker => normalized.includes(marker))
}

function isAuthenticationFailureResult(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return false
  return [
    '401',
    '403',
    'unauthorized',
    'forbidden',
    'login required',
    'please login',
    'please log in',
    'not authenticated',
    'authentication required',
    'permission denied',
    'session expired',
    'api key is required',
    'token is required',
    'missing token',
    'invalid token',
  ].some(marker => normalized.includes(marker))
}

function summarizeText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 160) return compact
  return `${compact.slice(0, 157)}...`
}
