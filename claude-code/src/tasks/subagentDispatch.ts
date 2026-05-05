import { randomUUID } from 'node:crypto'

import {
  countRunningSubagents,
  hasRunningSubagentForObjective,
} from './subagentRegistry.js'

export type DispatchEventStatus = 'ok' | 'error' | 'missing' | 'blocked'

export type LocalToolEventType =
  | 'tool_completed'
  | 'file_read'
  | 'file_exists'
  | 'mcp_tool_completed'
  | 'mcp_config'
  | 'permission_result'
  | 'model_binding'
  | 'skill_binding'
  | 'task_notification'

export type LocalToolEvent = {
  id?: string
  sessionId: string
  userTurnId: string
  type: LocalToolEventType
  toolName?: string
  filePath?: string
  mcpServer?: string
  mcpTool?: string
  model?: string
  modelProfileId?: string
  skillName?: string
  status?: DispatchEventStatus
  summary?: string
  createdAt?: number
}

export type DispatchEventRequirement = {
  type?: LocalToolEventType
  toolName?: string
  filePathContains?: string
  mcpServer?: string
  mcpTool?: string
  model?: string
  modelProfileId?: string
  skillName?: string
  status?: DispatchEventStatus
}

export type DispatchPlanStep = {
  id: string
  type: 'local' | 'subagent'
  objective: string
  role?: string
  dependsOn: string[]
  canRunParallel: boolean
  stopCondition: 'DONE' | 'BLOCKED' | 'NEED_PARENT_INPUT'
  requiredEvents?: DispatchEventRequirement[]
  expectedResult?: string
}

export type DispatchProposal = {
  proposalId?: string
  sessionId: string
  userTurnId: string
  executionMode: 'sequential' | 'parallel' | 'mixed'
  steps: DispatchPlanStep[]
  currentStepId?: string
  mergeStrategy: string
}

export type DispatchTicket = {
  ticketId: string
  proposalId: string
  sessionId: string
  userTurnId: string
  stepId: string
  objective: string
  role: string
  stopCondition: 'DONE' | 'BLOCKED' | 'NEED_PARENT_INPUT'
  expectedResult?: string
  issuedAt: number
  expiresAt: number
  usedAt?: number
}

export type DispatchEvaluationResult = {
  status: 'ready' | 'blocked'
  proposalId: string
  tickets: DispatchTicket[]
  completedStepIds: string[]
  denials: string[]
  nextLocalActions: string[]
}

export type LocalToolExecutionEventInput = {
  sessionId: string
  userTurnId: string
  toolName: string
  input?: unknown
  status?: DispatchEventStatus
  summary?: string
}

export type RuntimeBindingMcpClient = {
  name: string
  type?: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | string
}

export type RuntimeBindingEventsInput = {
  sessionId: string
  userTurnId: string
  model?: string | null
  modelProfileId?: string | null
  skillNames?: string[]
  mcpClients?: RuntimeBindingMcpClient[]
}

type DispatchManagerOptions = {
  now?: () => number
  ticketTtlMs?: number
  maxTicketsPerTurn?: number
  maxRunningPerSession?: number
  getRunningObjectives?: (sessionId: string) => string[]
  getRunningCount?: (sessionId: string) => number
}

const DEFAULT_TICKET_TTL_MS = 5 * 60_000
const DEFAULT_MAX_TICKETS_PER_TURN = 3
const DEFAULT_MAX_RUNNING_PER_SESSION = 3

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function inputStringField(input: unknown, fields: string[]): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function mcpDetailsFromToolName(
  toolName: string,
): { serverName: string; toolName: string } | undefined {
  const match = /^mcp__(.+?)__(.+)$/.exec(toolName)
  if (!match?.[1] || !match[2]) return undefined
  return {
    serverName: match[1],
    toolName: match[2],
  }
}

export function createLocalToolEventFromToolExecution({
  sessionId,
  userTurnId,
  toolName,
  input,
  status = 'ok',
  summary,
}: LocalToolExecutionEventInput): LocalToolEvent {
  const filePath = inputStringField(input, [
    'file_path',
    'filePath',
    'path',
    'notebook_path',
  ])
  const mcpDetails = mcpDetailsFromToolName(toolName)
  if (mcpDetails) {
    return {
      sessionId,
      userTurnId,
      type: 'mcp_tool_completed',
      toolName,
      mcpServer: mcpDetails.serverName,
      mcpTool: mcpDetails.toolName,
      filePath,
      status,
      summary,
    }
  }

  if (toolName === 'Read' && filePath) {
    return {
      sessionId,
      userTurnId,
      type: 'file_read',
      toolName,
      filePath,
      status,
      summary,
    }
  }

  return {
    sessionId,
    userTurnId,
    type: 'tool_completed',
    toolName,
    filePath,
    status,
    summary,
  }
}

function dispatchStatusForMcpClient(client: RuntimeBindingMcpClient): DispatchEventStatus {
  switch (client.type) {
    case undefined:
    case 'connected':
      return 'ok'
    case 'failed':
      return 'error'
    case 'needs-auth':
    case 'disabled':
      return 'blocked'
    case 'pending':
      return 'missing'
    default:
      return 'missing'
  }
}

export function createDispatchRuntimeBindingEvents({
  sessionId,
  userTurnId,
  model,
  modelProfileId,
  skillNames = [],
  mcpClients = [],
}: RuntimeBindingEventsInput): LocalToolEvent[] {
  const events: LocalToolEvent[] = []
  const normalizedModel = model?.trim()
  const normalizedModelProfileId = modelProfileId?.trim()
  if (normalizedModel || normalizedModelProfileId) {
    events.push({
      sessionId,
      userTurnId,
      type: 'model_binding',
      model: normalizedModel || undefined,
      modelProfileId: normalizedModelProfileId || undefined,
      status: 'ok',
    })
  }
  for (const skillName of skillNames) {
    const normalizedSkillName = skillName.trim()
    if (!normalizedSkillName) continue
    events.push({
      sessionId,
      userTurnId,
      type: 'skill_binding',
      skillName: normalizedSkillName,
      status: 'ok',
    })
  }
  for (const client of mcpClients) {
    const serverName = client.name.trim()
    if (!serverName) continue
    events.push({
      sessionId,
      userTurnId,
      type: 'mcp_config',
      mcpServer: serverName,
      status: dispatchStatusForMcpClient(client),
      summary: client.type ?? 'connected',
    })
  }
  return events
}

type DispatchMessageLike = {
  type?: string
  uuid?: string
  message?: { content?: unknown }
  content?: unknown
}

function getMessageContentBlocks(message: DispatchMessageLike): unknown[] | undefined {
  const content = message.message?.content ?? message.content
  return Array.isArray(content) ? content : undefined
}

function isToolResultOnlyUserMessage(message: DispatchMessageLike): boolean {
  if (message.type !== 'user') return false
  const content = getMessageContentBlocks(message)
  return (
    Boolean(content?.length) &&
    content!.every(block => {
      if (!block || typeof block !== 'object') return false
      return (block as { type?: unknown }).type === 'tool_result'
    })
  )
}

function currentUserTurnKey(messages: DispatchMessageLike[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.type !== 'user' || isToolResultOnlyUserMessage(message)) {
      continue
    }
    if (message.uuid) return message.uuid
    const content = getMessageContentBlocks(message)
    const fallbackText = content
      ?.map(block => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('\n')
      .trim()
    return `message-${i}:${normalize(fallbackText).slice(0, 160)}`
  }
  return undefined
}

export function deriveDispatchUserTurnId({
  sessionId,
  messages,
  requestId,
  toolUseId,
}: {
  sessionId: string
  messages?: DispatchMessageLike[]
  requestId?: string
  toolUseId?: string
}): string {
  const userTurnKey = currentUserTurnKey(messages ?? [])
  if (userTurnKey) return `${sessionId}:user-turn:${userTurnKey}`
  return `${sessionId}:${requestId || toolUseId || 'unknown-turn'}`
}

function eventMatchesRequirement(
  event: LocalToolEvent,
  requirement: DispatchEventRequirement,
): boolean {
  if (requirement.type && event.type !== requirement.type) return false
  if (requirement.toolName && normalize(event.toolName) !== normalize(requirement.toolName)) {
    return false
  }
  if (
    requirement.filePathContains &&
    !normalize(event.filePath).includes(normalize(requirement.filePathContains))
  ) {
    return false
  }
  if (requirement.mcpServer && normalize(event.mcpServer) !== normalize(requirement.mcpServer)) {
    return false
  }
  if (requirement.mcpTool && normalize(event.mcpTool) !== normalize(requirement.mcpTool)) {
    return false
  }
  if (requirement.model && normalize(event.model) !== normalize(requirement.model)) {
    return false
  }
  if (
    requirement.modelProfileId &&
    normalize(event.modelProfileId) !== normalize(requirement.modelProfileId)
  ) {
    return false
  }
  if (requirement.skillName && normalize(event.skillName) !== normalize(requirement.skillName)) {
    return false
  }
  if (requirement.status && event.status !== requirement.status) return false
  return true
}

function proposalIdFor(proposal: DispatchProposal): string {
  return proposal.proposalId?.trim() || `proposal-${randomUUID()}`
}

function ticketKey({
  sessionId,
  userTurnId,
}: {
  sessionId: string
  userTurnId: string
}): string {
  return `${sessionId}:${userTurnId}`
}

export class DispatchManager {
  private readonly events: LocalToolEvent[] = []
  private readonly tickets = new Map<string, DispatchTicket>()
  private readonly issuedByTurn = new Map<string, number>()
  private readonly now: () => number
  private readonly ticketTtlMs: number
  private readonly maxTicketsPerTurn: number
  private readonly maxRunningPerSession: number
  private readonly getRunningObjectives: (sessionId: string) => string[]
  private readonly getRunningCount: (sessionId: string) => number

  constructor(options: DispatchManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.ticketTtlMs = options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS
    this.maxTicketsPerTurn = options.maxTicketsPerTurn ?? DEFAULT_MAX_TICKETS_PER_TURN
    this.maxRunningPerSession = options.maxRunningPerSession ?? DEFAULT_MAX_RUNNING_PER_SESSION
    this.getRunningObjectives =
      options.getRunningObjectives ??
      (sessionId => [])
    this.getRunningCount =
      options.getRunningCount ??
      (sessionId => countRunningSubagents(sessionId))
  }

  clearForTests(): void {
    this.events.length = 0
    this.tickets.clear()
    this.issuedByTurn.clear()
  }

  recordLocalEvent(event: LocalToolEvent): LocalToolEvent {
    const timestamp = this.now()
    const recorded: LocalToolEvent = {
      ...event,
      id: event.id ?? `event-${randomUUID()}`,
      status: event.status ?? 'ok',
      createdAt: event.createdAt ?? timestamp,
    }
    this.events.push(recorded)
    return recorded
  }

  evaluate(proposal: DispatchProposal): DispatchEvaluationResult {
    const proposalId = proposalIdFor(proposal)
    const completedStepIds = this.completedStepIds(proposal)
    const denials: string[] = []
    const nextLocalActions: string[] = []
    const tickets: DispatchTicket[] = []
    const runningCount = this.getRunningCount(proposal.sessionId)

    if (runningCount >= this.maxRunningPerSession) {
      denials.push(`Session already has ${runningCount} running subagents.`)
      return {
        status: 'blocked',
        proposalId,
        tickets,
        completedStepIds,
        denials,
        nextLocalActions,
      }
    }

    for (const step of proposal.steps) {
      if (step.type === 'local' && !completedStepIds.includes(step.id)) {
        nextLocalActions.push(step.id)
      }
    }

    const candidates = this.runnableSubagentSteps(proposal, completedStepIds)
    for (const step of candidates) {
      const runningObjectives = this.getRunningObjectives(proposal.sessionId)
      if (
        runningObjectives.some(objective => normalize(objective) === normalize(step.objective)) ||
        hasRunningSubagentForObjective(step.objective, proposal.sessionId)
      ) {
        denials.push(`A subagent for "${step.objective}" is already running.`)
        continue
      }
      if (!this.canIssueTicket(proposal.sessionId, proposal.userTurnId)) {
        denials.push(`This user turn already has ${this.maxTicketsPerTurn} dispatch tickets.`)
        continue
      }
      tickets.push(this.issueTicket({
        proposalId,
        proposal,
        step,
      }))
    }

    return {
      status: tickets.length > 0 ? 'ready' : 'blocked',
      proposalId,
      tickets,
      completedStepIds,
      denials,
      nextLocalActions,
    }
  }

  consumeTicket({
    ticketId,
    sessionId,
    userTurnId,
    objective,
  }: {
    ticketId: string
    sessionId: string
    userTurnId: string
    objective: string
  }): DispatchTicket {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) throw new Error(`Unknown dispatch ticket: ${ticketId}`)
    if (ticket.usedAt) throw new Error(`Dispatch ticket ${ticketId} was already used.`)
    if (ticket.expiresAt <= this.now()) throw new Error(`Dispatch ticket ${ticketId} is expired.`)
    if (ticket.sessionId !== sessionId) {
      throw new Error(`Dispatch ticket ${ticketId} belongs to a different session.`)
    }
    if (ticket.userTurnId !== userTurnId) {
      throw new Error(`Dispatch ticket ${ticketId} belongs to a different user turn.`)
    }
    if (normalize(ticket.objective) !== normalize(objective)) {
      throw new Error(`Dispatch ticket ${ticketId} does not match the requested objective.`)
    }
    const consumed = {
      ...ticket,
      usedAt: this.now(),
    }
    this.tickets.set(ticketId, consumed)
    return consumed
  }

  listTickets(): DispatchTicket[] {
    return [...this.tickets.values()]
  }

  private eventsFor(proposal: DispatchProposal): LocalToolEvent[] {
    return this.events.filter(
      event =>
        event.sessionId === proposal.sessionId &&
        event.userTurnId === proposal.userTurnId,
    )
  }

  private completedStepIds(proposal: DispatchProposal): string[] {
    const events = this.eventsFor(proposal)
    const completed = new Set<string>()
    for (const step of proposal.steps) {
      if (step.type !== 'local') continue
      const requirements = step.requiredEvents ?? []
      if (
        requirements.length > 0 &&
        requirements.every(requirement =>
          events.some(event => eventMatchesRequirement(event, requirement)),
        )
      ) {
        completed.add(step.id)
      }
    }
    return [...completed]
  }

  private runnableSubagentSteps(
    proposal: DispatchProposal,
    completedStepIds: string[],
  ): DispatchPlanStep[] {
    const completed = new Set(completedStepIds)
    const subagentSteps = proposal.steps.filter(step => step.type === 'subagent')
    const selectedSteps = proposal.currentStepId
      ? subagentSteps.filter(step => step.id === proposal.currentStepId)
      : subagentSteps

    return selectedSteps.filter(step => {
      if (proposal.executionMode === 'parallel' && !step.canRunParallel) return false
      return step.dependsOn.every(dependency => completed.has(dependency))
    })
  }

  private canIssueTicket(sessionId: string, userTurnId: string): boolean {
    const key = ticketKey({ sessionId, userTurnId })
    return (this.issuedByTurn.get(key) ?? 0) < this.maxTicketsPerTurn
  }

  private issueTicket({
    proposalId,
    proposal,
    step,
  }: {
    proposalId: string
    proposal: DispatchProposal
    step: DispatchPlanStep
  }): DispatchTicket {
    const issuedAt = this.now()
    const ticket: DispatchTicket = {
      ticketId: `ticket-${randomUUID()}`,
      proposalId,
      sessionId: proposal.sessionId,
      userTurnId: proposal.userTurnId,
      stepId: step.id,
      objective: step.objective,
      role: step.role ?? 'general',
      stopCondition: step.stopCondition,
      expectedResult: step.expectedResult,
      issuedAt,
      expiresAt: issuedAt + this.ticketTtlMs,
    }
    this.tickets.set(ticket.ticketId, ticket)
    const key = ticketKey(proposal)
    this.issuedByTurn.set(key, (this.issuedByTurn.get(key) ?? 0) + 1)
    return ticket
  }
}

export const dispatchManager = new DispatchManager()

export function clearDispatchManagerForTests(): void {
  dispatchManager.clearForTests()
}
