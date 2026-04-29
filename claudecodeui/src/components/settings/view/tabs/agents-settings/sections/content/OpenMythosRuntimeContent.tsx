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

type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh';

type OpenMythosRuntimeConfig = {
  enabled: boolean;
  adaptiveEffort: boolean;
  taskCard: boolean;
  routingHints: boolean;
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
};

type RuntimeTranslator = (key: string, defaultValue: string) => string;

type PreviewCard = {
  goal: string;
  effort: EffortLevel;
  loopBudget: number;
  reasons: string[];
  constraints: string[];
  acceptance: string[];
  routes: string[];
};

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const satisfies readonly EffortLevel[];
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_PREVIEW_PROMPT = 'Implement an auth database migration with rollback tests and CI verification';
const DEFAULT_OPENMYTHOS_RUNTIME_CONFIG: OpenMythosRuntimeConfig = {
  enabled: true,
  adaptiveEffort: true,
  taskCard: true,
  routingHints: true,
  minEffort: 'low',
  maxEffort: 'xhigh',
};

const HIGH_RISK_SIGNALS: Signal[] = [
  {
    pattern: /\b(security|auth|permission|secret|token|credential|privacy|hipaa|soc2)\b/i,
    reasonKey: 'reasons.security',
    reasonDefault: 'security or privacy sensitive work',
    weight: 5,
    routeKey: 'routes.security',
    routeDefault: 'Use a security-focused skill or reviewer before reporting completion.',
  },
  {
    pattern: /\b(migration|schema|database|sql|backfill|rollback|deploy|release|ci|production)\b/i,
    reasonKey: 'reasons.deployment',
    reasonDefault: 'deployment, data, or CI risk',
    weight: 4,
    routeKey: 'routes.verification',
    routeDefault: 'Use a verification pass for migration, rollout, or CI-sensitive changes.',
  },
  {
    pattern: /\b(concurrency|async|race|deadlock|performance|memory|latency|benchmark)\b/i,
    reasonKey: 'reasons.performance',
    reasonDefault: 'performance or concurrency-sensitive work',
    weight: 4,
    routeKey: 'routes.performance',
    routeDefault: 'Route to a performance, async, or profiling skill when available.',
  },
  {
    pattern: /\b(refactor|architecture|design|redesign|multi[- ]?module|cross[- ]?module)\b/i,
    reasonKey: 'reasons.architecture',
    reasonDefault: 'broad architectural change',
    weight: 3,
    routeKey: 'routes.architecture',
    routeDefault: 'Use Explore/Plan agents for broad codebase research before edits.',
  },
];

const IMPLEMENTATION_SIGNALS: Signal[] = [
  {
    pattern: /\b(implement|build|add|fix|change|update|wire|integrate)\b/i,
    reasonKey: 'reasons.implementation',
    reasonDefault: 'implementation requested',
    weight: 2,
  },
  {
    pattern: /\b(test|typecheck|lint|verify|benchmark|coverage)\b/i,
    reasonKey: 'reasons.verification',
    reasonDefault: 'verification requested',
    weight: 2,
    routeKey: 'routes.test',
    routeDefault: 'Run focused tests or a verification agent after edits.',
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

const buildPreviewCard = (
  input: string,
  runtimeConfig: OpenMythosRuntimeConfig,
  translate: RuntimeTranslator,
): PreviewCard | null => {
  if (!runtimeConfig.enabled || !input.trim()) {
    return null;
  }

  const normalized = input.replace(/\s+/g, ' ').trim();
  const signals = [...HIGH_RISK_SIGNALS, ...IMPLEMENTATION_SIGNALS].filter((signal) => (
    signal.pattern.test(normalized)
  ));
  const score = signals.reduce((sum, signal) => sum + signal.weight, 0)
    + Math.min(3, Math.floor(normalized.length / 600));
  const inferredEffort: EffortLevel = score >= 8
    ? 'xhigh'
    : score >= 4
      ? 'high'
      : score >= 2
        ? 'medium'
        : 'low';
  const effort = clampEffort(inferredEffort, runtimeConfig.minEffort, runtimeConfig.maxEffort);
  const loopBudget = effort === 'xhigh' ? 5 : effort === 'high' ? 4 : effort === 'medium' ? 3 : 2;
  const reasons = unique(signals.map((signal) => (
    translate(signal.reasonKey, signal.reasonDefault)
  ))).slice(0, 4);
  if (reasons.length === 0) {
    reasons.push(translate('reasons.small', 'small or conversational task'));
  }

  return {
    goal: truncate(normalized, 260),
    effort,
    loopBudget,
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
          throw new Error('Failed to load MTLCode runtime config');
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
        throw new Error('Failed to save MTLCode runtime config');
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
            {t('openMythosRuntime.title', { defaultValue: 'OpenMythos Runtime' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('openMythosRuntime.subtitle', {
              defaultValue: 'Tune adaptive effort, frozen task cards, and skill routing hints for MTL-Code sessions.',
            })}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-4">
          <RuntimeToggleRow
            icon={BrainCircuit}
            title={t('openMythosRuntime.enabled', { defaultValue: 'OpenMythos Runtime' })}
            description={t('openMythosRuntime.enabledDescription', {
              defaultValue: 'Attach runtime guidance to each turn and allow adaptive effort decisions.',
            })}
            checked={runtimeConfig.enabled}
            disabled={disabled}
            onChange={(enabled) => updateRuntimeConfig({ enabled })}
          />

          <div className={cn('grid gap-4 md:grid-cols-2', !runtimeConfig.enabled && 'opacity-60')}>
            <RuntimeToggleRow
              icon={Gauge}
              title={t('openMythosRuntime.adaptiveEffort', { defaultValue: 'Adaptive effort' })}
              description={t('openMythosRuntime.adaptiveEffortDescription', {
                defaultValue: 'Select low to xhigh effort from task complexity when no explicit effort is set.',
              })}
              checked={runtimeConfig.adaptiveEffort}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(adaptiveEffort) => updateRuntimeConfig({ adaptiveEffort })}
            />

            <RuntimeToggleRow
              icon={Snowflake}
              title={t('openMythosRuntime.taskCard', { defaultValue: 'Frozen task card' })}
              description={t('openMythosRuntime.taskCardDescription', {
                defaultValue: 'Carry goal, constraints, and acceptance criteria as a hidden reminder.',
              })}
              checked={runtimeConfig.taskCard}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(taskCard) => updateRuntimeConfig({ taskCard })}
            />

            <RuntimeToggleRow
              icon={Route}
              title={t('openMythosRuntime.routingHints', { defaultValue: 'Skill routing hints' })}
              description={t('openMythosRuntime.routingHintsDescription', {
                defaultValue: 'Suggest the smallest useful skill or subagent route for risky work.',
              })}
              checked={runtimeConfig.routingHints}
              disabled={disabled || !runtimeConfig.enabled}
              onChange={(routingHints) => updateRuntimeConfig({ routingHints })}
            />

            <div className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                {t('openMythosRuntime.effortBounds', { defaultValue: 'Effort bounds' })}
              </div>
              <EffortSegmentedControl
                label={t('openMythosRuntime.minEffort', { defaultValue: 'Minimum effort' })}
                value={runtimeConfig.minEffort}
                disabled={disabled || !runtimeConfig.enabled}
                onChange={handleMinEffortChange}
                formatEffortLevel={formatEffortLevel}
              />
              <EffortSegmentedControl
                label={t('openMythosRuntime.maxEffort', { defaultValue: 'Maximum effort' })}
                value={runtimeConfig.maxEffort}
                disabled={disabled || !runtimeConfig.enabled}
                onChange={handleMaxEffortChange}
                formatEffortLevel={formatEffortLevel}
              />
            </div>
          </div>
        </div>

        <aside className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {t('openMythosRuntime.preview', { defaultValue: 'Runtime preview' })}
          </div>
          <textarea
            value={previewPrompt}
            onChange={(event) => setPreviewPrompt(event.target.value)}
            disabled={disabled}
            rows={4}
            className="min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('openMythosRuntime.previewPrompt', { defaultValue: 'Preview prompt' })}
          />
          {previewCard ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">
                  {t('openMythosRuntime.frozenGoal', { defaultValue: 'Frozen goal' })}
                </div>
                <div className="mt-1 text-sm leading-5 text-foreground">{previewCard.goal}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">
                    {t('openMythosRuntime.previewEffort', { defaultValue: 'Effort' })}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{formatEffortLevel(previewCard.effort)}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">
                    {t('openMythosRuntime.loopBudget', { defaultValue: 'Loop budget' })}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{previewCard.loopBudget}</div>
                </div>
              </div>
              <PreviewList label={t('openMythosRuntime.why', { defaultValue: 'Why' })} values={previewCard.reasons} />
              {runtimeConfig.taskCard && (
                <>
                  <PreviewList label={t('openMythosRuntime.constraintsLabel', { defaultValue: 'Constraints' })} values={previewCard.constraints} />
                  <PreviewList label={t('openMythosRuntime.acceptanceLabel', { defaultValue: 'Acceptance' })} values={previewCard.acceptance} />
                </>
              )}
              <PreviewList
                label={t('openMythosRuntime.routesLabel', { defaultValue: 'Routes' })}
                values={previewCard.routes.length > 0
                  ? previewCard.routes
                  : [t('openMythosRuntime.disabledValue', { defaultValue: 'disabled' })]}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              {runtimeConfig.enabled
                ? t('openMythosRuntime.emptyPreview', { defaultValue: 'Enter a prompt to preview the runtime card.' })
                : t('openMythosRuntime.disabledPreview', { defaultValue: 'Runtime is disabled.' })}
            </div>
          )}
        </aside>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {status === 'success' && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {t('openMythosRuntime.saved', { defaultValue: 'Runtime settings saved.' })}
            </span>
          )}
          {status === 'load-error' && (
            <span className="text-red-600 dark:text-red-400">
              {t('openMythosRuntime.loadFailed', { defaultValue: 'Could not load runtime settings.' })}
            </span>
          )}
          {status === 'save-error' && (
            <span className="text-red-600 dark:text-red-400">
              {t('openMythosRuntime.saveFailed', { defaultValue: 'Could not save runtime settings.' })}
            </span>
          )}
          {config.configPath && status === null && (
            <span className="text-muted-foreground">{config.configPath}</span>
          )}
        </div>

        <Button onClick={handleSave} disabled={disabled} className="h-10">
          <Save className="mr-2 h-4 w-4" />
          {isSaving
            ? t('openMythosRuntime.saving', { defaultValue: 'Saving' })
            : t('openMythosRuntime.save', { defaultValue: 'Save runtime' })}
        </Button>
      </div>
    </div>
  );
}
