import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  Gauge,
  Route,
  Save,
  ShieldCheck,
  Snowflake,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../../../../lib/utils';
import { Button } from '../../../../../../../shared/view/ui';
import { apiFetch } from '../../../../../../../utils/api';
import SettingsToggle from '../../../../SettingsToggle';

type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type LoopControl = 'advisory' | 'enforced';

type OpenMythosRuntimeConfig = {
  enabled: boolean;
  adaptiveEffort: boolean;
  taskCard: boolean;
  routingHints: boolean;
  loopControl: LoopControl;
  stableReinjection: boolean;
  phaseAdapter: boolean;
  expertRouting: boolean;
  contextCacheDiagnostics: boolean;
  autoDispatchSubagents: boolean;
  autoDispatchMinEffort: EffortLevel;
  autoDispatchMaxWorkers: number;
  minEffort: EffortLevel;
  maxEffort: EffortLevel;
};

type ModelProfile = {
  id: string;
  name: string;
  provider: 'anthropic';
  apiKey: string;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  contextWindowTokens: number;
  bareMode: boolean;
};

type MtlCodeModelConfig = {
  provider: 'anthropic';
  activeProfileId: string;
  profiles: ModelProfile[];
  anthropic: {
    apiKey: string;
    apiKeyConfigured: boolean;
    baseUrl: string;
    model: string;
  };
  runtime: {
    bareMode: boolean;
    contextWindowTokens: number;
  };
  openMythosRuntime: OpenMythosRuntimeConfig;
  configPath?: string;
};

type Signal = {
  pattern: RegExp;
  reasonKey: string;
  reasonDefault: string;
  weight: number;
  routeKey?: string;
  routeDefault?: string;
  dispatch?: {
    kind: string;
    labelKey: string;
    labelDefault: string;
    required: boolean;
  };
};

type RuntimeTranslator = (key: string, defaultValue: string) => string;

type PreviewCard = {
  goal: string;
  effort: EffortLevel;
  loopBudget: number;
  riskScore: number;
  reasons: string[];
  constraints: string[];
  acceptance: string[];
  routes: string[];
  phasePlan: string[];
  expertRoutes: string[];
  workerPlan: {
    assignments: Array<{
      kind: string;
      role: string;
      label: string;
      reason: string;
      required: boolean;
      description: string;
      objective: string;
    }>;
  } | null;
};

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[];
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_PREVIEW_PROMPT = 'Implement an auth database migration with rollback tests and CI verification';
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
  autoDispatchSubagents: false,
  autoDispatchMinEffort: 'medium',
  autoDispatchMaxWorkers: 3,
  minEffort: 'low',
  maxEffort: 'max',
};

const HIGH_RISK_SIGNALS: Signal[] = [
  {
    pattern: /\b(security|auth|permission|secret|token|credential|privacy|hipaa|soc2)\b/i,
    reasonKey: 'reasons.security',
    reasonDefault: 'security or privacy sensitive work',
    weight: 5,
    routeKey: 'routes.security',
    routeDefault: 'Use a security-focused skill or reviewer before reporting completion.',
    dispatch: {
      kind: 'security',
      labelKey: 'dispatch.security',
      labelDefault: 'Security reviewer',
      required: true,
    },
  },
  {
    pattern: /\b(migration|schema|database|sql|backfill|rollback|deploy|release|ci|production)\b/i,
    reasonKey: 'reasons.deployment',
    reasonDefault: 'deployment, data, or CI risk',
    weight: 4,
    routeKey: 'routes.verification',
    routeDefault: 'Use a verification pass for migration, rollout, or CI-sensitive changes.',
    dispatch: {
      kind: 'verification',
      labelKey: 'dispatch.verification',
      labelDefault: 'Verification specialist',
      required: true,
    },
  },
  {
    pattern: /\b(concurrency|async|race|deadlock|performance|memory|latency|benchmark)\b/i,
    reasonKey: 'reasons.performance',
    reasonDefault: 'performance or concurrency-sensitive work',
    weight: 4,
    routeKey: 'routes.performance',
    routeDefault: 'Route to a performance, async, or profiling skill when available.',
    dispatch: {
      kind: 'performance',
      labelKey: 'dispatch.performance',
      labelDefault: 'Performance specialist',
      required: false,
    },
  },
  {
    pattern: /\b(refactor|architecture|design|redesign|multi[- ]?module|cross[- ]?module)\b/i,
    reasonKey: 'reasons.architecture',
    reasonDefault: 'broad architectural change',
    weight: 3,
    routeKey: 'routes.architecture',
    routeDefault: 'Use Explore/Plan agents for broad codebase research before edits.',
    dispatch: {
      kind: 'architecture',
      labelKey: 'dispatch.architecture',
      labelDefault: 'Architecture reviewer',
      required: false,
    },
  },
];

const IMPLEMENTATION_SIGNALS: Signal[] = [
  {
    pattern: /\b(implement|build|add|fix|change|update|wire|integrate)\b/i,
    reasonKey: 'reasons.implementation',
    reasonDefault: 'implementation requested',
    weight: 2,
    dispatch: {
      kind: 'implementation',
      labelKey: 'dispatch.implementation',
      labelDefault: 'Implementation worker',
      required: true,
    },
  },
  {
    pattern: /\b(test|typecheck|lint|verify|benchmark|coverage)\b/i,
    reasonKey: 'reasons.verification',
    reasonDefault: 'verification requested',
    weight: 2,
    routeKey: 'routes.test',
    routeDefault: 'Run focused tests or a verification agent after edits.',
    dispatch: {
      kind: 'verification',
      labelKey: 'dispatch.verification',
      labelDefault: 'Verification specialist',
      required: false,
    },
  },
  {
    pattern: /\b(branch|commit|pr|pull request|merge)\b/i,
    reasonKey: 'reasons.git',
    reasonDefault: 'git workflow requested',
    weight: 1,
    routeKey: 'routes.git',
    routeDefault: 'Preserve existing worktree changes and report git state explicitly.',
  },
];

const FRONTEND_SIGNALS: Signal[] = [
  {
    pattern: /\b(ui|frontend|react|css|layout|responsive|accessibility|visual|figma)\b/i,
    reasonKey: 'reasons.frontend',
    reasonDefault: 'frontend or visual quality work',
    weight: 2,
    routeKey: 'routes.frontend',
    routeDefault: 'Use frontend/design guidance and verify the rendered UI when available.',
    dispatch: {
      kind: 'frontend',
      labelKey: 'dispatch.frontend',
      labelDefault: 'Frontend reviewer',
      required: false,
    },
  },
];

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const normalizeEffort = (value: unknown, fallback: EffortLevel): EffortLevel => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EFFORT_LEVELS.includes(normalized as EffortLevel)
    ? (normalized as EffortLevel)
    : fallback;
};

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const normalizeLoopControl = (value: unknown, fallback: LoopControl): LoopControl => (
  value === 'advisory' || value === 'enforced' ? value : fallback
);

const normalizePositiveInteger = (value: unknown, fallback: number, max = 8): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const normalizeBounds = (
  minEffort: EffortLevel,
  maxEffort: EffortLevel,
): [EffortLevel, EffortLevel] => {
  const minIndex = EFFORT_LEVELS.indexOf(minEffort);
  const maxIndex = EFFORT_LEVELS.indexOf(maxEffort);
  return minIndex <= maxIndex ? [minEffort, maxEffort] : [maxEffort, minEffort];
};

const normalizeRuntimeConfig = (value: unknown): OpenMythosRuntimeConfig => {
  const data = isObjectRecord(value) ? value : {};
  const [minEffort, maxEffort] = normalizeBounds(
    normalizeEffort(data.minEffort, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.minEffort),
    normalizeEffort(data.maxEffort, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.maxEffort),
  );

  return {
    enabled: normalizeBoolean(data.enabled, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.enabled),
    adaptiveEffort: normalizeBoolean(data.adaptiveEffort, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.adaptiveEffort),
    taskCard: normalizeBoolean(data.taskCard, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.taskCard),
    routingHints: normalizeBoolean(data.routingHints, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.routingHints),
    loopControl: normalizeLoopControl(data.loopControl, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.loopControl),
    stableReinjection: normalizeBoolean(data.stableReinjection, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.stableReinjection),
    phaseAdapter: normalizeBoolean(data.phaseAdapter, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.phaseAdapter),
    expertRouting: normalizeBoolean(data.expertRouting, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.expertRouting),
    contextCacheDiagnostics: normalizeBoolean(data.contextCacheDiagnostics, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.contextCacheDiagnostics),
    autoDispatchSubagents: normalizeBoolean(data.autoDispatchSubagents, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.autoDispatchSubagents),
    autoDispatchMinEffort: normalizeEffort(data.autoDispatchMinEffort, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.autoDispatchMinEffort),
    autoDispatchMaxWorkers: normalizePositiveInteger(data.autoDispatchMaxWorkers, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.autoDispatchMaxWorkers),
    minEffort,
    maxEffort,
  };
};

const createProfile = (patch: Partial<ModelProfile> = {}): ModelProfile => ({
  id: patch.id || 'default',
  name: patch.name || 'Default model',
  provider: 'anthropic',
  apiKey: '',
  apiKeyConfigured: Boolean(patch.apiKeyConfigured),
  baseUrl: patch.baseUrl || '',
  model: patch.model || '',
  contextWindowTokens: patch.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS,
  bareMode: patch.bareMode !== false,
});

const toProfile = (value: unknown, index: number): ModelProfile | null => {
  if (!isObjectRecord(value)) {
    return null;
  }
  const contextWindowTokens = Number(value.contextWindowTokens);
  return createProfile({
    id: typeof value.id === 'string' && value.id ? value.id : `model-${index + 1}`,
    name: typeof value.name === 'string' && value.name ? value.name : `Model ${index + 1}`,
    apiKeyConfigured: Boolean(value.apiKeyConfigured),
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    model: typeof value.model === 'string' ? value.model : '',
    contextWindowTokens:
      Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
        ? contextWindowTokens
        : DEFAULT_CONTEXT_WINDOW_TOKENS,
    bareMode: value.bareMode !== false,
  });
};

const createEmptyConfig = (): MtlCodeModelConfig => {
  const defaultProfile = createProfile();
  return {
    provider: 'anthropic',
    activeProfileId: defaultProfile.id,
    profiles: [defaultProfile],
    anthropic: {
      apiKey: '',
      apiKeyConfigured: false,
      baseUrl: '',
      model: '',
    },
    runtime: {
      bareMode: true,
      contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    },
    openMythosRuntime: DEFAULT_OPENMYTHOS_RUNTIME_CONFIG,
  };
};

const toConfig = (value: unknown): MtlCodeModelConfig => {
  const data = isObjectRecord(value) ? value : {};
  const fallback = createEmptyConfig();
  const profiles = Array.isArray(data.profiles)
    ? data.profiles.map(toProfile).filter((profile): profile is ModelProfile => Boolean(profile))
    : [];
  const activeProfile = profiles.find((profile) => profile.id === data.activeProfileId)
    || profiles[0]
    || fallback.profiles[0];
  const runtime = isObjectRecord(data.runtime) ? data.runtime : {};
  const contextWindowTokens = Number(runtime.contextWindowTokens);

  return {
    provider: 'anthropic',
    activeProfileId: activeProfile.id,
    configPath: typeof data.configPath === 'string' ? data.configPath : undefined,
    profiles: profiles.length > 0 ? profiles : [activeProfile],
    anthropic: {
      apiKey: '',
      apiKeyConfigured: activeProfile.apiKeyConfigured,
      baseUrl: activeProfile.baseUrl,
      model: activeProfile.model,
    },
    runtime: {
      bareMode: runtime.bareMode !== false && activeProfile.bareMode !== false,
      contextWindowTokens:
        Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
          ? contextWindowTokens
          : activeProfile.contextWindowTokens,
    },
    openMythosRuntime: normalizeRuntimeConfig(data.openMythosRuntime),
  };
};

const unique = (values: string[]): string[] => [...new Set(values)];

const truncate = (value: string, max: number): string => (
  value.length <= max ? value : `${value.slice(0, max - 1)}...`
);

const clampEffort = (
  effort: EffortLevel,
  minEffort: EffortLevel,
  maxEffort: EffortLevel,
): EffortLevel => {
  const [normalizedMinEffort, normalizedMaxEffort] = normalizeBounds(minEffort, maxEffort);
  const effortIndex = EFFORT_LEVELS.indexOf(effort);
  const minIndex = EFFORT_LEVELS.indexOf(normalizedMinEffort);
  const maxIndex = EFFORT_LEVELS.indexOf(normalizedMaxEffort);
  return EFFORT_LEVELS[Math.min(Math.max(effortIndex, minIndex), maxIndex)];
};

const effortMeetsMinimum = (effort: EffortLevel, minimum: EffortLevel): boolean => (
  EFFORT_LEVELS.indexOf(effort) >= EFFORT_LEVELS.indexOf(minimum)
);

const routeToWorkerRole = (kind: string): string => {
  if (kind === 'implementation' || kind === 'frontend') return 'worker-implementer';
  if (kind === 'verification') return 'worker-verifier';
  if (kind === 'architecture') return 'worker-plan';
  if (kind === 'security') return 'worker-review';
  return 'worker-explore';
};

const buildWorkerPlan = (
  goal: string,
  effort: EffortLevel,
  runtimeConfig: OpenMythosRuntimeConfig,
  signals: Signal[],
  translate: RuntimeTranslator,
): PreviewCard['workerPlan'] => {
  if (!runtimeConfig.autoDispatchSubagents || !effortMeetsMinimum(effort, runtimeConfig.autoDispatchMinEffort)) {
    return null;
  }

  const routes = new Map<string, NonNullable<PreviewCard['workerPlan']>['assignments'][number]>();
  for (const signal of signals) {
    if (!signal.dispatch) continue;
    const label = translate(signal.dispatch.labelKey, signal.dispatch.labelDefault);
    const previous = routes.get(signal.dispatch.kind);
    routes.set(signal.dispatch.kind, {
      kind: signal.dispatch.kind,
      role: routeToWorkerRole(signal.dispatch.kind),
      label,
      reason: translate(signal.reasonKey, signal.reasonDefault),
      required: Boolean(previous?.required || signal.dispatch.required),
      description: truncate(`${label}: ${goal}`, 80),
      objective: `${label}: ${goal}`,
    });
  }

  const assignments = [...routes.values()].slice(0, Math.max(1, runtimeConfig.autoDispatchMaxWorkers));
  return assignments.length > 0 ? { assignments } : null;
};

const buildPreviewCard = (
  input: string,
  runtimeConfig: OpenMythosRuntimeConfig,
  translate: RuntimeTranslator,
): PreviewCard | null => {
  if (!runtimeConfig.enabled || !input.trim()) {
    return null;
  }

  const normalized = input.replace(/\s+/g, ' ').trim();
  const signals = [...HIGH_RISK_SIGNALS, ...IMPLEMENTATION_SIGNALS, ...FRONTEND_SIGNALS].filter((signal) => (
    signal.pattern.test(normalized)
  ));
  const score = signals.reduce((sum, signal) => sum + signal.weight, 0)
    + Math.min(3, Math.floor(normalized.length / 600));
  const inferredEffort: EffortLevel = score >= 10
    ? 'max'
    : score >= 8
      ? 'xhigh'
      : score >= 4
        ? 'high'
        : score >= 2
          ? 'medium'
          : 'low';
  const effort = clampEffort(inferredEffort, runtimeConfig.minEffort, runtimeConfig.maxEffort);
  const loopBudget = effort === 'max' ? 6 : effort === 'xhigh' ? 5 : effort === 'high' ? 4 : effort === 'medium' ? 3 : 2;
  const phasePlan = runtimeConfig.phaseAdapter
    ? effort === 'low'
      ? ['orient', 'finalize']
      : effort === 'medium'
        ? ['orient', 'plan', 'implement', 'finalize']
        : ['orient', 'plan', 'implement', 'verify', 'finalize']
    : ['implement', 'finalize'];
  const reasons = unique(signals.map((signal) => (
    translate(signal.reasonKey, signal.reasonDefault)
  ))).slice(0, 4);
  if (reasons.length === 0) {
    reasons.push(translate('reasons.small', 'small or conversational task'));
  }
  const goal = truncate(normalized, 260);

  return {
    goal,
    effort,
    loopBudget,
    riskScore: score,
    reasons,
    constraints: [
      translate('constraints.keepGoal', 'Keep the current user goal visible before each major action.'),
      translate('constraints.noRevert', 'Do not revert unrelated user changes.'),
      translate('constraints.safeChange', 'Before editing, identify the smallest safe change and the verification path.'),
    ],
    acceptance: [
      translate('acceptance.answer', 'Answer the user request directly.'),
      translate('acceptance.changed', 'State what changed or what was found.'),
      translate('acceptance.tests', 'Report tests or checks run, or explain why they were not run.'),
    ],
    routes: runtimeConfig.routingHints
      ? unique([
        ...signals
          .map((signal) => (
            signal.routeKey && signal.routeDefault
              ? translate(signal.routeKey, signal.routeDefault)
              : null
          ))
          .filter((route): route is string => Boolean(route)),
        effort === 'low'
          ? translate('routes.local', 'Handle locally; avoid spawning agents unless a specific side task appears.')
          : translate('routes.routed', 'Use skill/subagent routing only for distinct work that can run in parallel or protect main context.'),
      ]).slice(0, 4)
      : [],
    phasePlan,
    expertRoutes: runtimeConfig.expertRouting
      ? unique([
        ...signals.map((signal) => signal.routeDefault ? translate(signal.routeKey || signal.reasonKey, signal.routeDefault) : null)
          .filter((route): route is string => Boolean(route)),
        effort === 'low' ? translate('experts.local', 'Local execution') : null,
      ].filter((route): route is string => Boolean(route))).slice(0, 5)
      : [],
    workerPlan: buildWorkerPlan(goal, effort, runtimeConfig, signals, translate),
  };
};

function RuntimeToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4">
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <SettingsToggle
        checked={checked}
        onChange={onChange}
        ariaLabel={title}
        disabled={disabled}
      />
    </div>
  );
}

function EffortSegmentedControl({
  label,
  value,
  disabled,
  onChange,
  formatEffortLevel,
}: {
  label: string;
  value: EffortLevel;
  disabled?: boolean;
  onChange: (value: EffortLevel) => void;
  formatEffortLevel: (value: EffortLevel) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="grid grid-cols-4 rounded-lg border border-border bg-muted/30 p-1">
        {EFFORT_LEVELS.map((level) => {
          const active = level === value;
          return (
            <button
              key={level}
              type="button"
              disabled={disabled}
              onClick={() => onChange(level)}
              className={cn(
                'h-9 min-w-0 rounded-md px-2 text-xs font-medium uppercase transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {formatEffortLevel(level)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LoopControlSegmentedControl({
  value,
  disabled,
  onChange,
  formatLoopControl,
}: {
  value: LoopControl;
  disabled?: boolean;
  onChange: (value: LoopControl) => void;
  formatLoopControl: (value: LoopControl) => { label: string; description: string };
}) {
  const options: LoopControl[] = ['enforced', 'advisory'];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const optionText = formatLoopControl(option);
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              active
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <div className="text-sm font-medium">{optionText.label}</div>
            <div className="mt-1 text-xs leading-4">{optionText.description}</div>
          </button>
        );
      })}
    </div>
  );
}

function PreviewList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="space-y-1">
        {values.map((value) => (
          <div key={value} className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs leading-5 text-foreground">
            {value}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OpenMythosRuntimeContent() {
  const { t } = useTranslation('settings');
  const formatEffortLevel = (level: EffortLevel) => (
    t(`openMythosRuntime.effort.${level}`, { defaultValue: level })
  );
  const formatLoopControl = (loopControl: LoopControl) => ({
    label: t(`openMythosRuntime.loopControlOptions.${loopControl}.label`, {
      defaultValue: loopControl === 'enforced' ? '强制' : '建议',
    }),
    description: t(`openMythosRuntime.loopControlOptions.${loopControl}.description`, {
      defaultValue: loopControl === 'enforced'
        ? '将循环预算映射到最大轮次'
        : '仅作为提示约束',
    }),
  });
  const formatPhasePlan = (phases: string[]) => (
    phases.map((phase) => (
      t(`openMythosRuntime.phases.${phase}`, { defaultValue: phase })
    )).join(' → ')
  );
  const [config, setConfig] = useState<MtlCodeModelConfig>(() => createEmptyConfig());
  const [runtimeConfig, setRuntimeConfig] = useState<OpenMythosRuntimeConfig>(DEFAULT_OPENMYTHOS_RUNTIME_CONFIG);
  const [previewPrompt, setPreviewPrompt] = useState(() => (
    t('openMythosRuntime.defaultPreviewPrompt', { defaultValue: DEFAULT_PREVIEW_PROMPT })
  ));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'success' | 'load-error' | 'save-error' | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setIsLoading(true);
      setStatus(null);

      try {
        const response = await apiFetch('/api/settings/mtl-code-model');
        if (!response.ok) {
          throw new Error('加载 Argus 运行时配置失败');
        }
        const payload = await response.json();
        const nextConfig = toConfig(payload.config);
        if (!cancelled) {
          setConfig(nextConfig);
          setRuntimeConfig(nextConfig.openMythosRuntime);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setStatus('load-error');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const previewCard = useMemo(
    () => buildPreviewCard(
      previewPrompt,
      runtimeConfig,
      (key, defaultValue) => t(`openMythosRuntime.${key}`, { defaultValue }),
    ),
    [previewPrompt, runtimeConfig, t],
  );

  const updateRuntimeConfig = (patch: Partial<OpenMythosRuntimeConfig>) => {
    setRuntimeConfig((current) => normalizeRuntimeConfig({ ...current, ...patch }));
    setStatus(null);
  };

  const handleMinEffortChange = (minEffort: EffortLevel) => {
    const minIndex = EFFORT_LEVELS.indexOf(minEffort);
    const maxIndex = EFFORT_LEVELS.indexOf(runtimeConfig.maxEffort);
    updateRuntimeConfig({
      minEffort,
      maxEffort: maxIndex < minIndex ? minEffort : runtimeConfig.maxEffort,
    });
  };

  const handleMaxEffortChange = (maxEffort: EffortLevel) => {
    const minIndex = EFFORT_LEVELS.indexOf(runtimeConfig.minEffort);
    const maxIndex = EFFORT_LEVELS.indexOf(maxEffort);
    updateRuntimeConfig({
      minEffort: minIndex > maxIndex ? maxEffort : runtimeConfig.minEffort,
      maxEffort,
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);

    try {
      const activeProfile = config.profiles.find((profile) => profile.id === config.activeProfileId)
        || config.profiles[0]
        || createProfile();
      const payload = {
        provider: 'anthropic',
        activeProfileId: activeProfile.id,
        profiles: config.profiles,
        anthropic: {
          apiKey: activeProfile.apiKey || '',
          baseUrl: activeProfile.baseUrl || '',
          model: activeProfile.model || '',
        },
        runtime: config.runtime,
        openMythosRuntime: runtimeConfig,
      };
      const response = await apiFetch('/api/settings/mtl-code-model', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error('保存 Argus 运行时配置失败');
      }

      const responsePayload = await response.json();
      const nextConfig = toConfig(responsePayload.config);
      setConfig(nextConfig);
      setRuntimeConfig(nextConfig.openMythosRuntime);
      setStatus('success');
      window.dispatchEvent(new Event('mtlCodeModelSettingsChanged'));
    } catch (error) {
      console.error(error);
      setStatus('save-error');
    } finally {
      setIsSaving(false);
    }
  };

  const disabled = isLoading || isSaving;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BrainCircuit className="h-5 w-5 text-violet-500" />
        <div>
          <h3 className="text-lg font-medium text-foreground">
            {t('openMythosRuntime.title', { defaultValue: 'OpenMythos 运行时' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('openMythosRuntime.subtitle', {
              defaultValue: '配置 Argus 会话的自适应推理强度、冻结任务卡和技能路由提示。',
            })}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-4">
          <RuntimeToggleRow
            icon={BrainCircuit}
            title={t('openMythosRuntime.enabled', { defaultValue: 'OpenMythos 运行时' })}
            description={t('openMythosRuntime.enabledDescription', {
              defaultValue: '为每轮任务注入运行时引导，并允许按任务复杂度自动选择推理强度。',
            })}
            checked={runtimeConfig.enabled}
            disabled={disabled}
            onChange={(enabled) => updateRuntimeConfig({ enabled })}
          />

          <div className={cn('grid gap-4 md:grid-cols-2', !runtimeConfig.enabled && 'opacity-60')}>
            <RuntimeToggleRow
              icon={Gauge}
              title={t('openMythosRuntime.adaptiveEffort', { defaultValue: '自适应推理强度' })}
              description={t('openMythosRuntime.adaptiveEffortDescription', {
                defaultValue: '未显式指定推理强度时，根据任务复杂度在低到极深之间自动选择。',
              })}
              checked={runtimeConfig.adaptiveEffort}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(adaptiveEffort) => updateRuntimeConfig({ adaptiveEffort })}
            />

            <RuntimeToggleRow
              icon={Snowflake}
              title={t('openMythosRuntime.taskCard', { defaultValue: '冻结任务卡' })}
              description={t('openMythosRuntime.taskCardDescription', {
                defaultValue: '将目标、约束和验收标准作为隐藏提醒随每轮任务携带。',
              })}
              checked={runtimeConfig.taskCard}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(taskCard) => updateRuntimeConfig({ taskCard })}
            />

            <RuntimeToggleRow
              icon={Route}
              title={t('openMythosRuntime.routingHints', { defaultValue: '技能路由提示' })}
              description={t('openMythosRuntime.routingHintsDescription', {
                defaultValue: '为高风险任务建议最小必要的技能或子代理路由。',
              })}
              checked={runtimeConfig.routingHints}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(routingHints) => updateRuntimeConfig({ routingHints })}
            />

            <RuntimeToggleRow
              icon={ShieldCheck}
              title={t('openMythosRuntime.stableReinjection', { defaultValue: '稳定重注入' })}
              description={t('openMythosRuntime.stableReinjectionDescription', {
                defaultValue: '在工具结果和子代理上下文后重新注入冻结目标、约束和验收标准。',
              })}
              checked={runtimeConfig.stableReinjection}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(stableReinjection) => updateRuntimeConfig({ stableReinjection })}
            />

            <RuntimeToggleRow
              icon={BrainCircuit}
              title={t('openMythosRuntime.phaseAdapter', { defaultValue: '阶段适配器' })}
              description={t('openMythosRuntime.phaseAdapterDescription', {
                defaultValue: '使用定位、计划、实现、验证和收尾阶段；早期阶段保持只读。',
              })}
              checked={runtimeConfig.phaseAdapter}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(phaseAdapter) => updateRuntimeConfig({ phaseAdapter })}
            />

            <RuntimeToggleRow
              icon={Route}
              title={t('openMythosRuntime.expertRouting', { defaultValue: '专家路由' })}
              description={t('openMythosRuntime.expertRoutingDescription', {
                defaultValue: '按任务信号确定性建议安全、验证、性能、架构或前端专家。',
              })}
              checked={runtimeConfig.expertRouting}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(expertRouting) => updateRuntimeConfig({ expertRouting })}
            />

            <RuntimeToggleRow
              icon={Gauge}
              title={t('openMythosRuntime.contextCacheDiagnostics', { defaultValue: '上下文缓存诊断' })}
              description={t('openMythosRuntime.contextCacheDiagnosticsDescription', {
                defaultValue: '在诊断中显示压缩、检索增强和工具摘要账本；不伪装成 KV 缓存。',
              })}
              checked={runtimeConfig.contextCacheDiagnostics}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(contextCacheDiagnostics) => updateRuntimeConfig({ contextCacheDiagnostics })}
            />

            <RuntimeToggleRow
              icon={Route}
              title={t('openMythosRuntime.autoDispatchSubagents', { defaultValue: '自动分发子智能体' })}
              description={t('openMythosRuntime.autoDispatchSubagentsDescription', {
                defaultValue: '复杂任务会生成 Coordinator worker 派发计划，并由 Argus 首轮自动启动对应 worker。',
              })}
              checked={runtimeConfig.autoDispatchSubagents}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(autoDispatchSubagents) => updateRuntimeConfig({ autoDispatchSubagents })}
            />

            <div className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                {t('openMythosRuntime.effortBounds', { defaultValue: '推理强度范围' })}
              </div>
              <EffortSegmentedControl
                label={t('openMythosRuntime.minEffort', { defaultValue: '最低推理强度' })}
                value={runtimeConfig.minEffort}
                disabled={disabled || !runtimeConfig.enabled}
                onChange={handleMinEffortChange}
                formatEffortLevel={formatEffortLevel}
              />
              <EffortSegmentedControl
                label={t('openMythosRuntime.maxEffort', { defaultValue: '最高推理强度' })}
                value={runtimeConfig.maxEffort}
                disabled={disabled || !runtimeConfig.enabled}
                onChange={handleMaxEffortChange}
                formatEffortLevel={formatEffortLevel}
              />
            </div>

            <div className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Route className="h-4 w-4 text-primary" />
                {t('openMythosRuntime.dispatchPolicy', { defaultValue: '子智能体派发策略' })}
              </div>
              <EffortSegmentedControl
                label={t('openMythosRuntime.autoDispatchMinEffort', { defaultValue: '最低派发强度' })}
                value={runtimeConfig.autoDispatchMinEffort}
                disabled={disabled || !runtimeConfig.enabled || !runtimeConfig.autoDispatchSubagents}
                onChange={(autoDispatchMinEffort) => updateRuntimeConfig({ autoDispatchMinEffort })}
                formatEffortLevel={formatEffortLevel}
              />
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">
                  {t('openMythosRuntime.autoDispatchMaxWorkers', { defaultValue: '最大 worker 数' })}
                </span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={runtimeConfig.autoDispatchMaxWorkers}
                  disabled={disabled || !runtimeConfig.enabled || !runtimeConfig.autoDispatchSubagents}
                  onChange={(event) => updateRuntimeConfig({
                    autoDispatchMaxWorkers: normalizePositiveInteger(
                      event.target.value,
                      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.autoDispatchMaxWorkers,
                    ),
                  })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Gauge className="h-4 w-4 text-primary" />
                {t('openMythosRuntime.loopControl', { defaultValue: '循环控制' })}
              </div>
              <LoopControlSegmentedControl
                value={runtimeConfig.loopControl}
                disabled={disabled || !runtimeConfig.enabled}
                onChange={(loopControl) => updateRuntimeConfig({ loopControl })}
                formatLoopControl={formatLoopControl}
              />
            </div>
          </div>
        </div>

        <aside className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {t('openMythosRuntime.preview', { defaultValue: '运行时预览' })}
          </div>
          <textarea
            value={previewPrompt}
            onChange={(event) => setPreviewPrompt(event.target.value)}
            disabled={disabled}
            rows={4}
            className="min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('openMythosRuntime.previewPrompt', { defaultValue: '预览提示词' })}
          />
          {previewCard ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">
                  {t('openMythosRuntime.frozenGoal', { defaultValue: '冻结目标' })}
                </div>
                <div className="mt-1 text-sm leading-5 text-foreground">{previewCard.goal}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">
                    {t('openMythosRuntime.previewEffort', { defaultValue: '推理强度' })}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{formatEffortLevel(previewCard.effort)}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">
                    {t('openMythosRuntime.loopBudget', { defaultValue: '循环预算' })}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{previewCard.loopBudget}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">
                    {t('openMythosRuntime.riskScore', { defaultValue: '风险分' })}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{previewCard.riskScore}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">
                    {t('openMythosRuntime.loopControl', { defaultValue: '循环控制' })}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{formatLoopControl(runtimeConfig.loopControl).label}</div>
                </div>
              </div>
              <PreviewList label={t('openMythosRuntime.phasePlan', { defaultValue: '阶段计划' })} values={[formatPhasePlan(previewCard.phasePlan)]} />
              <PreviewList label={t('openMythosRuntime.why', { defaultValue: '原因' })} values={previewCard.reasons} />
              {runtimeConfig.taskCard && (
                <>
                  <PreviewList label={t('openMythosRuntime.constraintsLabel', { defaultValue: '约束' })} values={previewCard.constraints} />
                  <PreviewList label={t('openMythosRuntime.acceptanceLabel', { defaultValue: '验收标准' })} values={previewCard.acceptance} />
                </>
              )}
              <PreviewList
                label={t('openMythosRuntime.routesLabel', { defaultValue: '路由建议' })}
                values={previewCard.routes.length > 0
                  ? previewCard.routes
                  : [t('openMythosRuntime.disabledValue', { defaultValue: '已关闭' })]}
              />
              <PreviewList
                label={t('openMythosRuntime.expertRoutesLabel', { defaultValue: '专家路由' })}
                values={previewCard.expertRoutes.length > 0
                  ? previewCard.expertRoutes
                  : [t('openMythosRuntime.disabledValue', { defaultValue: '已关闭' })]}
              />
              <PreviewList
                label={t('openMythosRuntime.workerPlanLabel', { defaultValue: 'Worker 计划' })}
                values={previewCard.workerPlan?.assignments.length
                  ? previewCard.workerPlan.assignments.map((task) => (
                    `${task.label}${task.role ? ` / ${task.role}` : ''}${task.required ? ` (${t('openMythosRuntime.requiredValue', { defaultValue: '必需' })})` : ''}: ${task.description}`
                  ))
                  : [t('openMythosRuntime.noDispatchValue', { defaultValue: '当前提示不会自动派发 worker' })]}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              {runtimeConfig.enabled
                ? t('openMythosRuntime.emptyPreview', { defaultValue: '输入提示词以预览运行时卡片。' })
                : t('openMythosRuntime.disabledPreview', { defaultValue: '运行时已关闭。' })}
            </div>
          )}
        </aside>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {status === 'success' && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {t('openMythosRuntime.saved', { defaultValue: '运行时设置已保存。' })}
            </span>
          )}
          {status === 'load-error' && (
            <span className="text-red-600 dark:text-red-400">
              {t('openMythosRuntime.loadFailed', { defaultValue: '无法加载运行时设置。' })}
            </span>
          )}
          {status === 'save-error' && (
            <span className="text-red-600 dark:text-red-400">
              {t('openMythosRuntime.saveFailed', { defaultValue: '无法保存运行时设置。' })}
            </span>
          )}
          {config.configPath && status === null && (
            <span className="text-muted-foreground">{config.configPath}</span>
          )}
        </div>

        <Button onClick={handleSave} disabled={disabled} className="h-10">
          <Save className="mr-2 h-4 w-4" />
          {isSaving
            ? t('openMythosRuntime.saving', { defaultValue: '保存中' })
            : t('openMythosRuntime.save', { defaultValue: '保存运行时' })}
        </Button>
      </div>
    </div>
  );
}
