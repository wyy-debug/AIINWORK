import { useEffect, useState } from 'react';
import {
  BrainCircuit,
  Gauge,
  Route,
  Save,
  ShieldCheck,
  Snowflake,
  type LucideIcon,
} from 'lucide-react';

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
  minEffort: EffortLevel;
  maxEffort: EffortLevel;
};

type SubagentRuntimeConfig = {
  enabled: boolean;
  maxConcurrentThreadsPerSession: number;
  maxDepth: number;
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
  subagents: SubagentRuntimeConfig;
  configPath?: string;
};

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[];
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

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
};

const DEFAULT_SUBAGENT_RUNTIME_CONFIG: SubagentRuntimeConfig = {
  enabled: false,
  maxConcurrentThreadsPerSession: 3,
  maxDepth: 1,
};

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极深',
  max: '最大',
};

const LOOP_CONTROL_OPTIONS: Record<LoopControl, { label: string; description: string }> = {
  enforced: {
    label: '强制',
    description: '把 OpenMythos 的循环预算映射到运行时最大轮次。',
  },
  advisory: {
    label: '建议',
    description: '只作为提示约束，不强制改写运行轮次。',
  },
};

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
    contextCacheDiagnostics: normalizeBoolean(
      data.contextCacheDiagnostics,
      DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.contextCacheDiagnostics,
    ),
    minEffort,
    maxEffort,
  };
};

const normalizeSubagentRuntimeConfig = (value: unknown): SubagentRuntimeConfig => {
  const data = isObjectRecord(value) ? value : {};
  return {
    enabled: normalizeBoolean(data.enabled, DEFAULT_SUBAGENT_RUNTIME_CONFIG.enabled),
    maxConcurrentThreadsPerSession: normalizePositiveInteger(
      data.maxConcurrentThreadsPerSession,
      DEFAULT_SUBAGENT_RUNTIME_CONFIG.maxConcurrentThreadsPerSession,
      16,
    ),
    maxDepth: normalizePositiveInteger(
      data.maxDepth,
      DEFAULT_SUBAGENT_RUNTIME_CONFIG.maxDepth,
      4,
    ),
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
    subagents: DEFAULT_SUBAGENT_RUNTIME_CONFIG,
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
    subagents: normalizeSubagentRuntimeConfig(data.subagents),
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
}: {
  label: string;
  value: EffortLevel;
  disabled?: boolean;
  onChange: (value: EffortLevel) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="grid grid-cols-5 rounded-lg border border-border bg-muted/30 p-1">
        {EFFORT_LEVELS.map((level) => {
          const active = level === value;
          return (
            <button
              key={level}
              type="button"
              disabled={disabled}
              onClick={() => onChange(level)}
              className={cn(
                'h-9 min-w-0 rounded-md px-2 text-xs font-medium transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {EFFORT_LABELS[level]}
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
}: {
  value: LoopControl;
  disabled?: boolean;
  onChange: (value: LoopControl) => void;
}) {
  const options: LoopControl[] = ['enforced', 'advisory'];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const optionText = LOOP_CONTROL_OPTIONS[option];
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

export default function OpenMythosRuntimeContent() {
  const [config, setConfig] = useState<MtlCodeModelConfig>(() => createEmptyConfig());
  const [runtimeConfig, setRuntimeConfig] = useState<OpenMythosRuntimeConfig>(DEFAULT_OPENMYTHOS_RUNTIME_CONFIG);
  const [subagentConfig, setSubagentConfig] = useState<SubagentRuntimeConfig>(DEFAULT_SUBAGENT_RUNTIME_CONFIG);
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
          setSubagentConfig(nextConfig.subagents);
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

  const updateRuntimeConfig = (patch: Partial<OpenMythosRuntimeConfig>) => {
    setRuntimeConfig((current) => normalizeRuntimeConfig({ ...current, ...patch }));
    setStatus(null);
  };

  const updateSubagentConfig = (patch: Partial<SubagentRuntimeConfig>) => {
    setSubagentConfig((current) => normalizeSubagentRuntimeConfig({ ...current, ...patch }));
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
        subagents: subagentConfig,
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
      setSubagentConfig(nextConfig.subagents);
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
          <h3 className="text-lg font-medium text-foreground">OpenMythos 运行时</h3>
          <p className="text-sm text-muted-foreground">
            配置 Argus 会话的任务卡、推理强度、路线建议和 Codex 风格子智能体工具。
          </p>
        </div>
      </div>

      <RuntimeToggleRow
        icon={BrainCircuit}
        title="OpenMythos 运行时"
        description="为每轮任务注入运行时引导，并按任务复杂度给出推理强度和路线建议。"
        checked={runtimeConfig.enabled}
        disabled={disabled}
        onChange={(enabled) => updateRuntimeConfig({ enabled })}
      />

      <div className={cn('grid gap-4 md:grid-cols-2', !runtimeConfig.enabled && 'opacity-60')}>
        <RuntimeToggleRow
          icon={Gauge}
          title="自适应推理强度"
          description="未显式指定推理强度时，根据任务复杂度在低到最大之间自动选择。"
          checked={runtimeConfig.adaptiveEffort}
          disabled={disabled || !runtimeConfig.enabled}
          onChange={(adaptiveEffort) => updateRuntimeConfig({ adaptiveEffort })}
        />

        <RuntimeToggleRow
          icon={Snowflake}
          title="冻结任务卡"
          description="把目标、约束和验收标准作为隐藏提醒随每轮任务携带。"
          checked={runtimeConfig.taskCard}
          disabled={disabled || !runtimeConfig.enabled}
          onChange={(taskCard) => updateRuntimeConfig({ taskCard })}
        />

        <RuntimeToggleRow
          icon={Route}
          title="路线建议"
          description="为高风险任务建议最小必要的技能或子智能体路线，但不自动派发。"
          checked={runtimeConfig.routingHints}
          disabled={disabled || !runtimeConfig.enabled}
          onChange={(routingHints) => updateRuntimeConfig({ routingHints })}
        />

        <RuntimeToggleRow
          icon={ShieldCheck}
          title="稳定重注入"
          description="在工具结果和子智能体上下文后重新注入任务目标、约束和验收标准。"
          checked={runtimeConfig.stableReinjection}
          disabled={disabled || !runtimeConfig.enabled}
          onChange={(stableReinjection) => updateRuntimeConfig({ stableReinjection })}
        />

        <RuntimeToggleRow
          icon={BrainCircuit}
          title="阶段适配器"
          description="使用定位、计划、实现、验证和收尾阶段；早期阶段保持只读。"
          checked={runtimeConfig.phaseAdapter}
          disabled={disabled || !runtimeConfig.enabled}
          onChange={(phaseAdapter) => updateRuntimeConfig({ phaseAdapter })}
        />

        <RuntimeToggleRow
          icon={Route}
          title="专家路线"
          description="按任务信号建议安全、验证、性能、架构或前端专家路线。"
          checked={runtimeConfig.expertRouting}
          disabled={disabled || !runtimeConfig.enabled}
          onChange={(expertRouting) => updateRuntimeConfig({ expertRouting })}
        />

        <RuntimeToggleRow
          icon={Gauge}
          title="上下文诊断"
          description="在运行诊断中显示压缩、检索增强和工具摘要账本，不伪装成 KV 缓存。"
          checked={runtimeConfig.contextCacheDiagnostics}
          disabled={disabled || !runtimeConfig.enabled}
          onChange={(contextCacheDiagnostics) => updateRuntimeConfig({ contextCacheDiagnostics })}
        />

        <div className="space-y-4 rounded-lg border border-border bg-background p-4">
          <RuntimeToggleRow
            icon={Route}
            title="启用子智能体工具"
            description="开启后下一次新会话会暴露 spawn_agent、wait_agent、send_input 等 Codex 风格协作工具；当前会话不会热切换。"
            checked={subagentConfig.enabled}
            disabled={disabled}
            onChange={(enabled) => updateSubagentConfig({ enabled })}
          />
          <div className={cn('grid gap-3 sm:grid-cols-2', !subagentConfig.enabled && 'opacity-60')}>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-foreground">单会话最大并发</span>
              <input
                type="number"
                min={1}
                max={16}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subagentConfig.maxConcurrentThreadsPerSession}
                disabled={disabled || !subagentConfig.enabled}
                onChange={(event) => updateSubagentConfig({
                  maxConcurrentThreadsPerSession: Number(event.target.value),
                })}
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-foreground">最大嵌套深度</span>
              <input
                type="number"
                min={1}
                max={4}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subagentConfig.maxDepth}
                disabled={disabled || !subagentConfig.enabled}
                onChange={(event) => updateSubagentConfig({
                  maxDepth: Number(event.target.value),
                })}
              />
              <span className="block text-xs leading-5 text-muted-foreground">
                默认 1 表示禁止子智能体继续派生子智能体。
              </span>
            </label>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            OpenMythos 只给出任务拆分建议，不再生成 ticket、worker plan，也不会自动启动 worker。
            真正派发必须由模型在用户明确要求协作、委派或并行工作时调用 spawn_agent。
          </p>
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            推理强度范围
          </div>
          <EffortSegmentedControl
            label="最低推理强度"
            value={runtimeConfig.minEffort}
            disabled={disabled || !runtimeConfig.enabled}
            onChange={handleMinEffortChange}
          />
          <EffortSegmentedControl
            label="最高推理强度"
            value={runtimeConfig.maxEffort}
            disabled={disabled || !runtimeConfig.enabled}
            onChange={handleMaxEffortChange}
          />
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Gauge className="h-4 w-4 text-primary" />
            循环控制
          </div>
          <LoopControlSegmentedControl
            value={runtimeConfig.loopControl}
            disabled={disabled || !runtimeConfig.enabled}
            onChange={(loopControl) => updateRuntimeConfig({ loopControl })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {status === 'success' && (
            <span className="text-emerald-600 dark:text-emerald-400">运行时设置已保存。</span>
          )}
          {status === 'load-error' && (
            <span className="text-red-600 dark:text-red-400">无法加载运行时设置。</span>
          )}
          {status === 'save-error' && (
            <span className="text-red-600 dark:text-red-400">无法保存运行时设置。</span>
          )}
          {config.configPath && status === null && (
            <span className="text-muted-foreground">配置文件：{config.configPath}</span>
          )}
        </div>

        <Button onClick={handleSave} disabled={disabled} className="h-10">
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? '保存中' : '保存运行时'}
        </Button>
      </div>
    </div>
  );
}
