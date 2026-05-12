import type { PermissionMode } from '../types/permissions.js'
import type { EffortLevel, EffortValue } from './effort.js'
import { getEffortEnvOverride } from './effort.js'
import { isEnvTruthy } from './envUtils.js'

export type OpenMythosRuntimeCard = {
  goal: string
  effort: EffortLevel
  loopBudget: number
  riskScore: number
  reasons: string[]
  constraints: string[]
  acceptance: string[]
  routes: string[]
  phasePlan: OpenMythosPhase[]
  expertRoutes: OpenMythosExpertRoute[]
  remainingBudget?: number
}

export type OpenMythosRuntimeConfig = {
  enabled: boolean
  adaptiveEffort: boolean
  taskCard: boolean
  routingHints: boolean
  loopControl: OpenMythosLoopControl
  stableReinjection: boolean
  phaseAdapter: boolean
  expertRouting: boolean
  contextCacheDiagnostics: boolean
  minEffort: OpenMythosEffortLevel
  maxEffort: OpenMythosEffortLevel
}

export type OpenMythosLoopControl = 'advisory' | 'enforced'
export type OpenMythosPhase =
  | 'orient'
  | 'plan'
  | 'implement'
  | 'verify'
  | 'finalize'

export type OpenMythosExpertRoute = {
  kind: 'security' | 'verification' | 'performance' | 'architecture' | 'frontend' | 'git' | 'local'
  label: string
  reason: string
  required: boolean
}

export type OpenMythosContextCacheDiagnostics = {
  compactBoundaryCount?: number
  microcompactBoundaryCount?: number
  ragExcerptCount?: number
  ragPromptLength?: number
  toolSummaryCount?: number
  summaryLength?: number
}

export type OpenMythosRuntimeState = {
  card: OpenMythosRuntimeCard
  phase: OpenMythosPhase
  turnCount: number
  remainingBudget: number
  loopControl: OpenMythosLoopControl
  stableReinjection: boolean
  phaseAdapter: boolean
  expertRouting: boolean
  contextCacheDiagnostics: boolean
  contextCache?: OpenMythosContextCacheDiagnostics
}

export type OpenMythosEffortLevel = Extract<
  EffortLevel,
  'low' | 'medium' | 'high' | 'xhigh' | 'max'
>

type Signal = {
  pattern: RegExp
  reason: string
  weight: number
  route?: string
  expert?: OpenMythosExpertRoute
}

const OPENMYTHOS_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly OpenMythosEffortLevel[]

const DEFAULT_OPENMYTHOS_RUNTIME_CONFIG: OpenMythosRuntimeConfig = {
  enabled: false,
  adaptiveEffort: true,
  taskCard: true,
  routingHints: true,
  loopControl: 'enforced',
  stableReinjection: true,
  phaseAdapter: true,
  expertRouting: true,
  contextCacheDiagnostics: true,
  minEffort: 'low',
  maxEffort: 'max',
}

const HIGH_RISK_SIGNALS: Signal[] = [
  {
    pattern: /\b(security|auth|permission|secret|token|credential|privacy|hipaa|soc2)\b/i,
    reason: 'security or privacy sensitive work',
    weight: 5,
    route: 'Use a security-focused skill or reviewer before reporting completion.',
    expert: {
      kind: 'security',
      label: 'Security reviewer',
      reason: 'security or privacy sensitive work',
      required: true,
    },
  },
  {
    pattern: /\b(migration|schema|database|sql|backfill|rollback|deploy|release|ci|production)\b/i,
    reason: 'deployment, data, or CI risk',
    weight: 4,
    route: 'Use a verification pass for migration, rollout, or CI-sensitive changes.',
    expert: {
      kind: 'verification',
      label: 'Verification specialist',
      reason: 'deployment, data, or CI risk',
      required: true,
    },
  },
  {
    pattern: /\b(concurrency|async|race|deadlock|performance|memory|latency|benchmark)\b/i,
    reason: 'performance or concurrency-sensitive work',
    weight: 4,
    route: 'Route to a performance, async, or profiling skill when available.',
    expert: {
      kind: 'performance',
      label: 'Performance specialist',
      reason: 'performance or concurrency-sensitive work',
      required: false,
    },
  },
  {
    pattern: /\b(refactor|architecture|design|redesign|multi[- ]?module|cross[- ]?module)\b/i,
    reason: 'broad architectural change',
    weight: 3,
    route: 'Use Explore/Plan agents for broad codebase research before edits.',
    expert: {
      kind: 'architecture',
      label: 'Architecture reviewer',
      reason: 'broad architectural change',
      required: false,
    },
  },
]

const REVIEW_SIGNALS: Signal[] = [
  {
    pattern: /\b(code\s*review|review|audit)\b|(?:review|审查|评审)\s*代码|代码\s*(?:review|审查|评审)|代码审查|审查代码|评审代码/i,
    reason: 'code review requested',
    weight: 4,
    route: 'Inspect git status and current diff before reporting review findings.',
    expert: {
      kind: 'verification',
      label: 'Review verifier',
      reason: 'code review requested',
      required: false,
    },
  },
]

const IMPLEMENTATION_SIGNALS: Signal[] = [
  {
    pattern: /\b(implement|build|add|fix|change|update|wire|integrate)\b/i,
    reason: 'implementation requested',
    weight: 2,
  },
  {
    pattern: /\b(test|typecheck|lint|verify|benchmark|coverage)\b/i,
    reason: 'verification requested',
    weight: 2,
    route: 'Run focused tests or a verification agent after edits.',
    expert: {
      kind: 'verification',
      label: 'Verification specialist',
      reason: 'verification requested',
      required: false,
    },
  },
  {
    pattern: /\b(branch|commit|pr|pull request|merge)\b/i,
    reason: 'git workflow requested',
    weight: 1,
    route: 'Preserve existing worktree changes and report git state explicitly.',
    expert: {
      kind: 'git',
      label: 'Git safety check',
      reason: 'git workflow requested',
      required: false,
    },
  },
]

const FRONTEND_SIGNALS: Signal[] = [
  {
    pattern: /\b(ui|frontend|react|css|layout|responsive|accessibility|visual|figma)\b/i,
    reason: 'frontend or visual quality work',
    weight: 2,
    route: 'Use frontend/design guidance and verify the rendered UI when available.',
    expert: {
      kind: 'frontend',
      label: 'Frontend reviewer',
      reason: 'frontend or visual quality work',
      required: false,
    },
  },
]

export function getOpenMythosRuntimeConfig(): OpenMythosRuntimeConfig {
  const minEffort = readEffortBound(
    process.env.MTL_CODE_OPENMYTHOS_MIN_EFFORT,
    DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.minEffort,
  )
  const maxEffort = readEffortBound(
    process.env.MTL_CODE_OPENMYTHOS_MAX_EFFORT,
    DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.maxEffort,
  )
  const [normalizedMinEffort, normalizedMaxEffort] = normalizeEffortBounds(
    minEffort,
    maxEffort,
  )

  return {
    enabled: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_RUNTIME,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.enabled,
    ),
    adaptiveEffort: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_ADAPTIVE_EFFORT,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.adaptiveEffort,
    ),
    taskCard: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_TASK_CARD,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.taskCard,
    ),
    routingHints: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_ROUTING_HINTS,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.routingHints,
    ),
    loopControl: readLoopControl(
      process.env.MTL_CODE_OPENMYTHOS_LOOP_CONTROL,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.loopControl,
    ),
    stableReinjection: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_STABLE_REINJECTION,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.stableReinjection,
    ),
    phaseAdapter: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_PHASE_ADAPTER,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.phaseAdapter,
    ),
    expertRouting: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_EXPERT_ROUTING,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.expertRouting,
    ),
    contextCacheDiagnostics: readBooleanEnv(
      process.env.MTL_CODE_OPENMYTHOS_CONTEXT_CACHE_DIAGNOSTICS,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.contextCacheDiagnostics,
    ),
    minEffort: normalizedMinEffort,
    maxEffort: normalizedMaxEffort,
  }
}

export function isOpenMythosRuntimeEnabled(): boolean {
  return getOpenMythosRuntimeConfig().enabled
}

export function shouldAttachOpenMythosRuntimeCard(): boolean {
  const config = getOpenMythosRuntimeConfig()
  return config.enabled && config.taskCard
}

export function shouldApplyAdaptiveEffort(
  sessionEffort: EffortValue | undefined,
): boolean {
  const config = getOpenMythosRuntimeConfig()
  if (!config.enabled || !config.adaptiveEffort) return false
  if (sessionEffort !== undefined) return false
  const envOverride = getEffortEnvOverride()
  return envOverride === undefined
}

export function buildOpenMythosRuntimeCard(
  input: string | null,
  permissionMode?: PermissionMode,
): OpenMythosRuntimeCard | null {
  const config = getOpenMythosRuntimeConfig()
  if (!config.enabled || !input?.trim()) return null

  const normalized = input.replace(/\s+/g, ' ').trim()
  const isTaskNotification = isOpenMythosTaskNotificationInput(normalized)
  const goal = truncate(normalized, 260)
  const signals = [
    ...HIGH_RISK_SIGNALS,
    ...REVIEW_SIGNALS,
    ...IMPLEMENTATION_SIGNALS,
    ...FRONTEND_SIGNALS,
  ].filter(s =>
    s.pattern.test(normalized),
  )
  const hasReviewSignal = signals.some(
    signal => signal.reason === 'code review requested',
  )
  if (isEnvTruthy(process.env.MTL_CODE_SIMPLE) && !hasReviewSignal) return null
  const score =
    signals.reduce((sum, signal) => sum + signal.weight, 0) +
    Math.min(3, Math.floor(normalized.length / 600))

  const inferredEffort =
    score >= 10 ? 'max' : score >= 8 ? 'xhigh' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low'
  const effort = clampEffort(
    inferredEffort,
    config.minEffort,
    config.maxEffort,
  )
  const baseLoopBudget = effort === 'max' ? 6 : effort === 'xhigh' ? 5 : effort === 'high' ? 4 : effort === 'medium' ? 3 : 2

  const reasons = unique(signals.map(s => s.reason)).slice(0, 4)
  if (reasons.length === 0) {
    reasons.push('small or conversational task')
  }

  const constraints = [
    'Keep the current user goal visible before each major action.',
    'Do not revert unrelated user changes.',
    permissionMode === 'plan'
      ? 'Plan mode is active: explore and plan only; do not mutate tracked files.'
      : 'Before editing, identify the smallest safe change and the verification path.',
  ]

  const acceptance = [
    'Answer the user request directly.',
    'State what changed or what was found.',
    'Report tests or checks run, or explain why they were not run.',
  ]

  const routes = config.routingHints
    ? unique(
        [
          ...signals.map(s => s.route).filter((route): route is string => !!route),
          effort === 'low'
            ? 'Handle locally; avoid spawning agents unless a specific side task appears.'
            : 'Use skill/subagent routing only for distinct work that can run in parallel or protect main context.',
        ],
      ).slice(0, 4)
    : []
  const expertRoutes = config.expertRouting
    ? selectExpertRoutes(signals, effort)
    : []
  const phasePlan: OpenMythosPhase[] = config.phaseAdapter
    ? buildPhasePlan(effort)
    : ['implement', 'finalize']
  const loopBudget = Math.max(baseLoopBudget, phasePlan.length)
  return {
    goal,
    effort,
    loopBudget,
    riskScore: score,
    reasons,
    constraints,
    acceptance,
    routes,
    phasePlan,
    expertRoutes,
    remainingBudget: loopBudget,
  }
}

export function createOpenMythosRuntimeState(
  card: OpenMythosRuntimeCard,
  turnCount = 1,
  contextCache?: OpenMythosContextCacheDiagnostics,
): OpenMythosRuntimeState {
  const config = getOpenMythosRuntimeConfig()
  return {
    card,
    phase: getOpenMythosPhase(card, turnCount),
    turnCount,
    remainingBudget: getRemainingBudget(card.loopBudget, turnCount),
    loopControl: config.loopControl,
    stableReinjection: config.stableReinjection,
    phaseAdapter: config.phaseAdapter,
    expertRouting: config.expertRouting,
    contextCacheDiagnostics: config.contextCacheDiagnostics,
    contextCache,
  }
}

export function advanceOpenMythosRuntimeState(
  state: OpenMythosRuntimeState,
  turnCount: number,
  contextCache?: OpenMythosContextCacheDiagnostics,
): OpenMythosRuntimeState {
  return {
    ...state,
    phase: getOpenMythosPhase(state.card, turnCount),
    turnCount,
    remainingBudget: getRemainingBudget(state.card.loopBudget, turnCount),
    contextCache: contextCache ?? state.contextCache,
  }
}

export function shouldEnforceOpenMythosLoopBudget(
  state: OpenMythosRuntimeState | undefined,
): boolean {
  return state?.loopControl === 'enforced'
}

export function isOpenMythosReadOnlyPhase(
  state: OpenMythosRuntimeState | undefined,
): boolean {
  return Boolean(
    state?.phaseAdapter &&
      (state.phase === 'orient' || state.phase === 'plan'),
  )
}

export function formatOpenMythosRuntimeReminder(
  card: OpenMythosRuntimeCard,
  state?: OpenMythosRuntimeState,
): string {
  const phase = state?.phase ?? card.phasePlan[0] ?? 'implement'
  const remainingBudget = state?.remainingBudget ?? card.remainingBudget ?? card.loopBudget
  const expertRoutes = card.expertRoutes.length > 0
    ? card.expertRoutes
        .map(route => `${route.label}${route.required ? ' (required)' : ''}: ${route.reason}`)
        .join('; ')
    : 'disabled'
  const coordinatorInstruction = '- Coordinator instruction: OpenMythos is advisory only. Do not auto-spawn workers. Use spawn_agent only when the user explicitly asks for subagents, delegation, or parallel agent work.'
  const contextCache = state?.contextCache
  const contextCacheLine = contextCache
    ? `- Context cache ledger: compact boundaries=${contextCache.compactBoundaryCount ?? 0}; microcompact boundaries=${contextCache.microcompactBoundaryCount ?? 0}; RAG excerpts=${contextCache.ragExcerptCount ?? 0}; RAG prompt chars=${contextCache.ragPromptLength ?? 0}; tool summaries=${contextCache.toolSummaryCount ?? 0}.`
    : null

  return [
    'OpenMythos-inspired runtime card for this turn:',
    `- Frozen goal: ${card.goal}`,
    `- Adaptive effort: ${card.effort}; risk score: ${card.riskScore}; loop budget: ${card.loopBudget}; remaining budget: ${remainingBudget}.`,
    `- Current phase: ${phase}; phase plan: ${card.phasePlan.join(' -> ')}.`,
    `- Why: ${card.reasons.join('; ')}`,
    `- Constraints: ${card.constraints.join(' ')}`,
    `- Acceptance: ${card.acceptance.join(' ')}`,
    `- Skill/subagent routing: ${
      card.routes.length > 0 ? card.routes.join(' ') : 'disabled'
    }`,
    `- Expert routes: ${expertRoutes}`,
    '- Automatic dispatch: removed; OpenMythos provides advisory routes only.',
    coordinatorInstruction,
    phase === 'orient' || phase === 'plan'
      ? '- Phase guard: read, inspect, and plan only. Do not write files or run mutating tools until implement/verify/finalize.'
      : '- Phase guard: write tools are allowed only when they are the smallest safe change and verification remains visible.',
    '- User-facing output guard: do not narrate internal agent-control failures, self-control problems, or fallback plans that ask the user to replace whole files manually. If worker dispatch or tool execution fails, continue locally when possible and report a concise actionable status.',
    contextCacheLine,
  ].join('\n')
}

export function getOpenMythosPhase(
  card: OpenMythosRuntimeCard,
  turnCount: number,
): OpenMythosPhase {
  const index = Math.max(0, Math.min(card.phasePlan.length - 1, turnCount - 1))
  return card.phasePlan[index] ?? 'implement'
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function readLoopControl(
  value: string | undefined,
  fallback: OpenMythosLoopControl,
): OpenMythosLoopControl {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'advisory' || normalized === 'enforced'
    ? normalized
    : fallback
}

function readEffortBound(
  value: string | undefined,
  fallback: OpenMythosEffortLevel,
): OpenMythosEffortLevel {
  const normalized = value?.trim().toLowerCase()
  return OPENMYTHOS_EFFORT_LEVELS.includes(
    normalized as OpenMythosEffortLevel,
  )
    ? (normalized as OpenMythosEffortLevel)
    : fallback
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function normalizeEffortBounds(
  minEffort: OpenMythosEffortLevel,
  maxEffort: OpenMythosEffortLevel,
): [OpenMythosEffortLevel, OpenMythosEffortLevel] {
  const minIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(minEffort)
  const maxIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(maxEffort)
  return minIndex <= maxIndex
    ? [minEffort, maxEffort]
    : [maxEffort, minEffort]
}

function clampEffort(
  effort: OpenMythosEffortLevel,
  minEffort: OpenMythosEffortLevel,
  maxEffort: OpenMythosEffortLevel,
): OpenMythosEffortLevel {
  const [normalizedMinEffort, normalizedMaxEffort] = normalizeEffortBounds(
    minEffort,
    maxEffort,
  )
  const effortIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(effort)
  const minIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(normalizedMinEffort)
  const maxIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(normalizedMaxEffort)
  return OPENMYTHOS_EFFORT_LEVELS[
    Math.min(Math.max(effortIndex, minIndex), maxIndex)
  ]
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function getRemainingBudget(loopBudget: number, turnCount: number): number {
  return Math.max(0, loopBudget - Math.max(0, turnCount - 1))
}

function buildPhasePlan(effort: OpenMythosEffortLevel): OpenMythosPhase[] {
  switch (effort) {
    case 'low':
      return ['orient', 'finalize']
    case 'medium':
      return ['orient', 'plan', 'implement', 'finalize']
    case 'high':
      return ['orient', 'plan', 'implement', 'verify', 'finalize']
    case 'xhigh':
      return ['orient', 'plan', 'implement', 'verify', 'finalize']
    case 'max':
      return ['orient', 'plan', 'implement', 'verify', 'finalize']
  }
}

function selectExpertRoutes(
  signals: Signal[],
  effort: OpenMythosEffortLevel,
): OpenMythosExpertRoute[] {
  const routed = new Map<string, OpenMythosExpertRoute>()
  for (const signal of signals) {
    if (signal.expert) {
      const previous = routed.get(signal.expert.kind)
      routed.set(signal.expert.kind, {
        ...(previous ?? signal.expert),
        required: Boolean(previous?.required || signal.expert.required),
      })
    }
  }

  if (routed.size === 0 || effort === 'low') {
    routed.set('local', {
      kind: 'local',
      label: 'Local execution',
      reason: 'small or conversational task',
      required: true,
    })
  }

  return [...routed.values()].slice(0, 5)
}

function isOpenMythosTaskNotificationInput(input: string): boolean {
  return /<task-notification\b/i.test(input)
}
