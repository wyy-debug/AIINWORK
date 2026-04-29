import type { PermissionMode } from '../types/permissions.js'
import type { EffortLevel, EffortValue } from './effort.js'
import { getEffortEnvOverride } from './effort.js'
import { isEnvTruthy } from './envUtils.js'

export type OpenMythosRuntimeCard = {
  goal: string
  effort: EffortLevel
  loopBudget: number
  reasons: string[]
  constraints: string[]
  acceptance: string[]
  routes: string[]
}

export type OpenMythosRuntimeConfig = {
  enabled: boolean
  adaptiveEffort: boolean
  taskCard: boolean
  routingHints: boolean
  minEffort: OpenMythosEffortLevel
  maxEffort: OpenMythosEffortLevel
}

type OpenMythosEffortLevel = Extract<
  EffortLevel,
  'low' | 'medium' | 'high' | 'xhigh'
>

type Signal = {
  pattern: RegExp
  reason: string
  weight: number
  route?: string
}

const OPENMYTHOS_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly OpenMythosEffortLevel[]

const DEFAULT_OPENMYTHOS_RUNTIME_CONFIG: OpenMythosRuntimeConfig = {
  enabled: true,
  adaptiveEffort: true,
  taskCard: true,
  routingHints: true,
  minEffort: 'low',
  maxEffort: 'xhigh',
}

const HIGH_RISK_SIGNALS: Signal[] = [
  {
    pattern: /\b(security|auth|permission|secret|token|credential|privacy|hipaa|soc2)\b/i,
    reason: 'security or privacy sensitive work',
    weight: 5,
    route: 'Use a security-focused skill or reviewer before reporting completion.',
  },
  {
    pattern: /\b(migration|schema|database|sql|backfill|rollback|deploy|release|ci|production)\b/i,
    reason: 'deployment, data, or CI risk',
    weight: 4,
    route: 'Use a verification pass for migration, rollout, or CI-sensitive changes.',
  },
  {
    pattern: /\b(concurrency|async|race|deadlock|performance|memory|latency|benchmark)\b/i,
    reason: 'performance or concurrency-sensitive work',
    weight: 4,
    route: 'Route to a performance, async, or profiling skill when available.',
  },
  {
    pattern: /\b(refactor|architecture|design|redesign|multi[- ]?module|cross[- ]?module)\b/i,
    reason: 'broad architectural change',
    weight: 3,
    route: 'Use Explore/Plan agents for broad codebase research before edits.',
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
  },
  {
    pattern: /\b(branch|commit|pr|pull request|merge)\b/i,
    reason: 'git workflow requested',
    weight: 1,
    route: 'Preserve existing worktree changes and report git state explicitly.',
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
    enabled: readBooleanEnvDefaultTrue(
      process.env.MTL_CODE_OPENMYTHOS_RUNTIME,
    ),
    adaptiveEffort: readBooleanEnvDefaultTrue(
      process.env.MTL_CODE_OPENMYTHOS_ADAPTIVE_EFFORT,
    ),
    taskCard: readBooleanEnvDefaultTrue(
      process.env.MTL_CODE_OPENMYTHOS_TASK_CARD,
    ),
    routingHints: readBooleanEnvDefaultTrue(
      process.env.MTL_CODE_OPENMYTHOS_ROUTING_HINTS,
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
  if (isEnvTruthy(process.env.MTL_CODE_SIMPLE)) return null

  const normalized = input.replace(/\s+/g, ' ').trim()
  const goal = truncate(normalized, 260)
  const signals = [...HIGH_RISK_SIGNALS, ...IMPLEMENTATION_SIGNALS].filter(s =>
    s.pattern.test(normalized),
  )
  const score =
    signals.reduce((sum, signal) => sum + signal.weight, 0) +
    Math.min(3, Math.floor(normalized.length / 600))

  const inferredEffort =
    score >= 8 ? 'xhigh' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low'
  const effort = clampEffort(
    inferredEffort,
    config.minEffort,
    config.maxEffort,
  )
  const loopBudget = effort === 'xhigh' ? 5 : effort === 'high' ? 4 : effort === 'medium' ? 3 : 2

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

  return {
    goal,
    effort,
    loopBudget,
    reasons,
    constraints,
    acceptance,
    routes,
  }
}

export function formatOpenMythosRuntimeReminder(
  card: OpenMythosRuntimeCard,
): string {
  return [
    'OpenMythos-inspired runtime card for this turn:',
    `- Frozen goal: ${card.goal}`,
    `- Adaptive effort: ${card.effort} (${card.loopBudget} planning/execution loops before final response if needed)`,
    `- Why: ${card.reasons.join('; ')}`,
    `- Constraints: ${card.constraints.join(' ')}`,
    `- Acceptance: ${card.acceptance.join(' ')}`,
    `- Skill/subagent routing: ${
      card.routes.length > 0 ? card.routes.join(' ') : 'disabled'
    }`,
  ].join('\n')
}

function readBooleanEnvDefaultTrue(value: string | undefined): boolean {
  if (value === undefined) return true
  const normalized = value.trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(normalized)
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
