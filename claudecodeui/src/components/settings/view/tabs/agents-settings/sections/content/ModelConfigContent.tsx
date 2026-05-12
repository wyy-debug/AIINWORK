import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Gauge,
  KeyRound,
  Plus,
  Rocket,
  Save,
  Server,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../../../../shared/view/ui';
import { apiFetch } from '../../../../../../../utils/api';
import SettingsToggle from '../../../../SettingsToggle';

type ModelProfile = {
  id: string;
  name: string;
  provider: 'anthropic';
  protocol: 'anthropic' | 'openai-compatible' | 'openai-responses';
  apiKey: string;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  requestModel: string;
  contextWindowTokens: number;
  claudeNativeMemoryEnabled: boolean;
  bareMode: boolean;
};

type AnthropicModelConfig = {
  apiKey: string;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
};

type ModelPreset = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  contextWindowTokens: number;
};

type OpenMythosEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type OpenMythosLoopControl = 'advisory' | 'enforced';

type OpenMythosRuntimeConfig = {
  enabled: boolean;
  adaptiveEffort: boolean;
  taskCard: boolean;
  routingHints: boolean;
  loopControl: OpenMythosLoopControl;
  stableReinjection: boolean;
  phaseAdapter: boolean;
  expertRouting: boolean;
  contextCacheDiagnostics: boolean;
  minEffort: OpenMythosEffort;
  maxEffort: OpenMythosEffort;
};

type MtlCodeModelConfig = {
  provider: 'anthropic';
  activeProfileId: string;
  profiles: ModelProfile[];
  presets?: {
    mimo?: ModelPreset[];
    mimoTokenPlanBaseUrl?: string;
  };
  anthropic: AnthropicModelConfig;
  runtime: {
    claudeNativeMemoryEnabled: boolean;
    bareMode: boolean;
    contextWindowTokens: number;
  };
  openMythosRuntime: OpenMythosRuntimeConfig;
  configPath?: string;
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const MIMO_TOKEN_PLAN_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/anthropic';
const OPENMYTHOS_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const OPENMYTHOS_LOOP_CONTROLS = ['advisory', 'enforced'] as const;
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

const makeId = (prefix = 'model') => (
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);

const createProfile = (patch: Partial<ModelProfile> = {}): ModelProfile => ({
  id: patch.id || makeId(),
  name: patch.name ?? 'Custom model',
  provider: 'anthropic',
  protocol: patch.protocol === 'openai-compatible' || patch.protocol === 'openai-responses'
    ? patch.protocol
    : 'anthropic',
  apiKey: '',
  apiKeyConfigured: Boolean(patch.apiKeyConfigured),
  baseUrl: patch.baseUrl || '',
  model: patch.model || '',
  requestModel: patch.requestModel || '',
  contextWindowTokens: patch.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS,
  claudeNativeMemoryEnabled: patch.claudeNativeMemoryEnabled !== false,
  bareMode: patch.claudeNativeMemoryEnabled !== false ? false : patch.bareMode !== false,
});

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const normalizeEffort = (value: unknown, fallback: OpenMythosEffort): OpenMythosEffort => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OPENMYTHOS_EFFORT_LEVELS.includes(normalized as OpenMythosEffort)
    ? (normalized as OpenMythosEffort)
    : fallback;
};

const normalizeLoopControl = (value: unknown, fallback: OpenMythosLoopControl): OpenMythosLoopControl => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OPENMYTHOS_LOOP_CONTROLS.includes(normalized as OpenMythosLoopControl)
    ? (normalized as OpenMythosLoopControl)
    : fallback;
};

const normalizeOpenMythosRuntime = (value: unknown): OpenMythosRuntimeConfig => {
  const data = isObjectRecord(value) ? value : {};
  const minEffort = normalizeEffort(data.minEffort, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.minEffort);
  const maxEffort = normalizeEffort(data.maxEffort, DEFAULT_OPENMYTHOS_RUNTIME_CONFIG.maxEffort);
  const minIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(minEffort);
  const maxIndex = OPENMYTHOS_EFFORT_LEVELS.indexOf(maxEffort);

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
    minEffort: minIndex <= maxIndex ? minEffort : maxEffort,
    maxEffort: minIndex <= maxIndex ? maxEffort : minEffort,
  };
};

const createEmptyConfig = (): MtlCodeModelConfig => {
  const defaultProfile = createProfile({
    id: 'default',
    name: 'Default model',
  });

  return {
    provider: 'anthropic',
    activeProfileId: defaultProfile.id,
    profiles: [defaultProfile],
    presets: {
      mimo: [],
      mimoTokenPlanBaseUrl: MIMO_TOKEN_PLAN_BASE_URL,
    },
    anthropic: {
      apiKey: '',
      apiKeyConfigured: false,
      baseUrl: '',
      model: '',
    },
    runtime: {
      claudeNativeMemoryEnabled: true,
      bareMode: false,
      contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    },
    openMythosRuntime: DEFAULT_OPENMYTHOS_RUNTIME_CONFIG,
  };
};

const toProfile = (value: unknown, index: number): ModelProfile | null => {
  const data = value as Partial<ModelProfile> | undefined;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const contextWindowTokens = Number(data.contextWindowTokens);
  const claudeNativeMemoryEnabled = data.claudeNativeMemoryEnabled !== false;
  return createProfile({
    id: typeof data.id === 'string' && data.id ? data.id : makeId(`model-${index + 1}`),
    name: typeof data.name === 'string' && data.name ? data.name : data.model || `Model ${index + 1}`,
    protocol: data.protocol === 'openai-compatible' || data.protocol === 'openai-responses'
      ? data.protocol
      : 'anthropic',
    apiKeyConfigured: Boolean(data.apiKeyConfigured),
    baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '',
    model: typeof data.model === 'string' ? data.model : '',
    requestModel: typeof data.requestModel === 'string' ? data.requestModel : '',
    contextWindowTokens:
      Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
        ? contextWindowTokens
        : DEFAULT_CONTEXT_WINDOW_TOKENS,
    claudeNativeMemoryEnabled,
    bareMode: claudeNativeMemoryEnabled ? false : data.bareMode !== false,
  });
};

const toConfig = (value: unknown): MtlCodeModelConfig => {
  const data = value as Partial<MtlCodeModelConfig> | undefined;
  const fallback = createEmptyConfig();
  const profiles = Array.isArray(data?.profiles)
    ? data.profiles.map(toProfile).filter((profile): profile is ModelProfile => Boolean(profile))
    : [];
  const activeProfile = profiles.find((profile) => profile.id === data?.activeProfileId)
    || profiles[0]
    || createProfile({
      id: 'default',
      name: data?.anthropic?.model || 'Default model',
      apiKeyConfigured: Boolean(data?.anthropic?.apiKeyConfigured),
      baseUrl: data?.anthropic?.baseUrl || '',
      model: data?.anthropic?.model || '',
      protocol: 'anthropic',
      contextWindowTokens: data?.runtime?.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS,
      claudeNativeMemoryEnabled: data?.runtime?.claudeNativeMemoryEnabled !== false,
      bareMode: data?.runtime?.claudeNativeMemoryEnabled !== false ? false : data?.runtime?.bareMode !== false,
      requestModel: '',
    });
  const claudeNativeMemoryEnabled = activeProfile.claudeNativeMemoryEnabled !== false;

  return {
    provider: 'anthropic',
    activeProfileId: activeProfile.id,
    configPath: typeof data?.configPath === 'string' ? data.configPath : undefined,
    profiles: profiles.length > 0 ? profiles : [activeProfile],
    presets: {
      mimo: Array.isArray(data?.presets?.mimo) ? data.presets.mimo : [],
      mimoTokenPlanBaseUrl: data?.presets?.mimoTokenPlanBaseUrl || MIMO_TOKEN_PLAN_BASE_URL,
    },
    anthropic: {
      apiKey: '',
      apiKeyConfigured: activeProfile.apiKeyConfigured,
      baseUrl: activeProfile.baseUrl || fallback.anthropic.baseUrl,
      model: activeProfile.model || fallback.anthropic.model,
    },
    runtime: {
      claudeNativeMemoryEnabled,
      bareMode: !claudeNativeMemoryEnabled,
      contextWindowTokens: activeProfile.contextWindowTokens,
    },
    openMythosRuntime: normalizeOpenMythosRuntime(data?.openMythosRuntime),
  };
};

const readResponseError = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
    if (payload && typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    // The server may return an empty body for transport-level failures.
  }

  return fallback;
};

export default function ModelConfigContent() {
  const { t } = useTranslation('settings');
  const [config, setConfig] = useState<MtlCodeModelConfig>(() => createEmptyConfig());
  const [selectedProfileId, setSelectedProfileId] = useState('default');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setIsLoading(true);
      setStatus(null);
      setErrorMessage('');

      try {
        const response = await apiFetch('/api/settings/mtl-code-model');
        if (!response.ok) {
          throw new Error(await readResponseError(response, '加载 Argus 模型配置失败'));
        }

        const payload = await response.json();
        const nextConfig = toConfig(payload.config);
        if (!cancelled) {
          setConfig(nextConfig);
          setSelectedProfileId(nextConfig.activeProfileId);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : '加载 Argus 模型配置失败');
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

  const selectedProfile = useMemo(
    () => config.profiles.find((profile) => profile.id === selectedProfileId)
      || config.profiles[0]
      || createProfile(),
    [config.profiles, selectedProfileId],
  );

  const mergeProfilePatch = (profile: ModelProfile, patch: Partial<ModelProfile>): ModelProfile => {
    const next = { ...profile, ...patch };
    if (patch.bareMode === true) {
      next.claudeNativeMemoryEnabled = false;
    }
    if (patch.claudeNativeMemoryEnabled === true) {
      next.bareMode = false;
    }
    if (patch.claudeNativeMemoryEnabled === false) {
      next.bareMode = true;
    }
    if (next.claudeNativeMemoryEnabled !== false) {
      next.bareMode = false;
    }
    return next;
  };

  const updateProfile = (profileId: string, patch: Partial<ModelProfile>) => {
    setConfig((current) => ({
      ...current,
      profiles: current.profiles.map((profile) => (
        profile.id === profileId ? mergeProfilePatch(profile, patch) : profile
      )),
    }));
    setStatus(null);
    setErrorMessage('');
  };

  const addProfile = (profile: Partial<ModelProfile>) => {
    const nextProfile = createProfile(profile);
    setConfig((current) => ({
      ...current,
      profiles: [...current.profiles, nextProfile],
    }));
    setSelectedProfileId(nextProfile.id);
    setStatus(null);
    setErrorMessage('');
  };

  const removeProfile = (profileId: string) => {
    setConfig((current) => {
      if (current.profiles.length <= 1) {
        return current;
      }

      const nextProfiles = current.profiles.filter((profile) => profile.id !== profileId);
      const nextActiveProfileId = current.activeProfileId === profileId
        ? nextProfiles[0]?.id || ''
        : current.activeProfileId;
      setSelectedProfileId((previous) => (
        previous === profileId ? nextActiveProfileId : previous
      ));
      return {
        ...current,
        activeProfileId: nextActiveProfileId,
        profiles: nextProfiles,
      };
    });
    setStatus(null);
    setErrorMessage('');
  };

  const activateProfile = (profileId: string) => {
    setConfig((current) => ({
      ...current,
      activeProfileId: profileId,
    }));
    setSelectedProfileId(profileId);
    setStatus(null);
    setErrorMessage('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);
    setErrorMessage('');

    try {
      const activeProfile = config.profiles.find((profile) => profile.id === config.activeProfileId)
        || config.profiles[0];
      const payload = {
        provider: 'anthropic',
        activeProfileId: activeProfile?.id || selectedProfile.id,
        profiles: config.profiles,
        anthropic: {
          apiKey: activeProfile?.apiKey || '',
          baseUrl: activeProfile?.baseUrl || '',
          model: activeProfile?.model || '',
        },
        runtime: {
          claudeNativeMemoryEnabled: activeProfile?.claudeNativeMemoryEnabled !== false,
          bareMode: activeProfile?.claudeNativeMemoryEnabled === false,
          contextWindowTokens: activeProfile?.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS,
        },
        openMythosRuntime: config.openMythosRuntime,
      };
      const response = await apiFetch('/api/settings/mtl-code-model', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response, '保存 Argus 模型配置失败'));
      }

      const responsePayload = await response.json();
      const nextConfig = toConfig(responsePayload.config);
      setConfig(nextConfig);
      setSelectedProfileId(nextConfig.activeProfileId);
      setStatus('success');
      window.dispatchEvent(new Event('mtlCodeModelSettingsChanged'));
    } catch (error) {
      console.error(error);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '保存 Argus 模型配置失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-5 w-5 text-emerald-500" />
        <div>
          <h3 className="text-lg font-medium text-foreground">
            {t('mtlCodeModel.title', { defaultValue: 'Argus 模型' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('mtlCodeModel.subtitle', {
              defaultValue: '管理兼容 Anthropic 协议的模型配置，并选择当前运行时使用的模型。',
            })}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr] 2xl:grid-cols-[minmax(320px,420px)_1fr]">
        <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">
              {t('mtlCodeModel.profiles', { defaultValue: '模型配置' })}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isLoading || isSaving}
              onClick={() => addProfile({
                id: makeId('model'),
                name: '',
                baseUrl: '',
                model: '',
                protocol: 'anthropic',
                requestModel: '',
                contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
                claudeNativeMemoryEnabled: true,
                bareMode: false,
              })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('mtlCodeModel.add', { defaultValue: '添加' })}
            </Button>
          </div>

          <div className="space-y-2">
            {config.profiles.map((profile) => {
              const isSelected = profile.id === selectedProfile.id;
              const isActive = profile.id === config.activeProfileId;
              const profileName = profile.name || t('mtlCodeModel.unnamedProfile', { defaultValue: '未命名模型' });

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-background hover:bg-muted/60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Server className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{profileName}</span>
                        {isActive && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {profile.model || t('mtlCodeModel.noModel', { defaultValue: '未设置模型' })}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('mtlCodeModel.profileEditor', { defaultValue: '配置编辑器' })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedProfile.id === config.activeProfileId
                  ? t('mtlCodeModel.activeProfile', { defaultValue: '这个配置当前已启用。' })
                  : t('mtlCodeModel.inactiveProfile', { defaultValue: '启用并保存后才会应用到后端。' })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={selectedProfile.id === config.activeProfileId ? 'secondary' : 'outline'}
                disabled={isLoading || isSaving}
                onClick={() => activateProfile(selectedProfile.id)}
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                {t('mtlCodeModel.activate', { defaultValue: '使用此模型' })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isLoading || isSaving || config.profiles.length <= 1}
                onClick={() => removeProfile(selectedProfile.id)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t('mtlCodeModel.delete', { defaultValue: '删除' })}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t('mtlCodeModel.profileName', { defaultValue: '配置名称' })}
              </span>
              <Input
                value={selectedProfile.name}
                onChange={(event) => updateProfile(selectedProfile.id, { name: event.target.value })}
                placeholder={t('mtlCodeModel.profileNamePlaceholder', { defaultValue: '我的模型配置' })}
                disabled={isLoading || isSaving}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t('mtlCodeModel.model', { defaultValue: '模型' })}
              </span>
              <Input
                value={selectedProfile.model}
                onChange={(event) => updateProfile(selectedProfile.id, { model: event.target.value })}
                placeholder={t('mtlCodeModel.modelPlaceholder', { defaultValue: '模型 ID' })}
                disabled={isLoading || isSaving}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">请求协议</span>
              <select
                value={selectedProfile.protocol}
                onChange={(event) => updateProfile(selectedProfile.id, {
                  protocol: event.target.value === 'openai-compatible' || event.target.value === 'openai-responses'
                    ? event.target.value
                    : 'anthropic',
                })}
                disabled={isLoading || isSaving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="anthropic">Anthropic-compatible (/v1/messages)</option>
                <option value="openai-compatible">OpenAI-compatible (/v1/chat/completions)</option>
                <option value="openai-responses">OpenAI Responses (/v1/responses)</option>
              </select>
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-foreground">请求模型名覆盖</span>
              <Input
                value={selectedProfile.requestModel}
                onChange={(event) => updateProfile(selectedProfile.id, { requestModel: event.target.value })}
                placeholder={selectedProfile.model || '例如 obsidian-small-anthropic'}
                disabled={isLoading || isSaving}
              />
              <p className="text-xs text-muted-foreground">
                留空时使用上面的模型名；中转站按模型名分流时，可填一个实际走 Anthropic 通道的别名。
              </p>
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Server className="h-4 w-4" />
                {t('mtlCodeModel.baseUrl', { defaultValue: 'Base URL' })}
              </span>
              <Input
                value={selectedProfile.baseUrl}
                onChange={(event) => updateProfile(selectedProfile.id, { baseUrl: event.target.value })}
                placeholder="https://api.example.com/anthropic"
                disabled={isLoading || isSaving}
              />
              <p className="text-xs text-muted-foreground">
                {t('mtlCodeModel.baseUrlHelp', {
                  defaultValue: '填写供应商提供的 Anthropic 兼容 Base URL。',
                })}
              </p>
            </label>

            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound className="h-4 w-4" />
                {t('mtlCodeModel.apiKey', { defaultValue: 'API Key / Auth Token' })}
              </span>
              <Input
                type="password"
                value={selectedProfile.apiKey}
                onChange={(event) => updateProfile(selectedProfile.id, { apiKey: event.target.value })}
                placeholder={
                  selectedProfile.apiKeyConfigured
                    ? t('mtlCodeModel.apiKeyConfigured', { defaultValue: '已配置' })
                    : 'sk-... / tp-...'
                }
                disabled={isLoading || isSaving}
              />
            </label>

            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Gauge className="h-4 w-4" />
                {t('mtlCodeModel.contextWindowTokens', {
                  defaultValue: '上下文 tokens',
                })}
              </span>
              <Input
                type="number"
                min={1}
                step={1000}
                value={selectedProfile.contextWindowTokens}
                onChange={(event) => {
                  const contextWindowTokens = Number.parseInt(event.target.value, 10);
                  updateProfile(selectedProfile.id, {
                    contextWindowTokens:
                      Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
                        ? contextWindowTokens
                        : DEFAULT_CONTEXT_WINDOW_TOKENS,
                  });
                }}
                placeholder="1000000"
                disabled={isLoading || isSaving}
              />
            </label>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <BrainCircuit className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t('mtlCodeModel.claudeNativeMemory', { defaultValue: 'Claude 原生记忆' })}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('mtlCodeModel.claudeNativeMemoryDescription', {
                      defaultValue: '开启后不使用 --bare，以恢复 Claude memory、CLAUDE.md 和 topic recall 等原生上下文能力。',
                    })}
                  </p>
                  {selectedProfile.bareMode && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      {t('mtlCodeModel.claudeNativeMemoryUnavailableInBare', {
                        defaultValue: '轻量启动已开启，Claude 原生记忆不可用。',
                      })}
                    </p>
                  )}
                </div>
              </div>
              <SettingsToggle
                checked={selectedProfile.claudeNativeMemoryEnabled}
                onChange={(claudeNativeMemoryEnabled) => updateProfile(selectedProfile.id, {
                  claudeNativeMemoryEnabled,
                  bareMode: !claudeNativeMemoryEnabled,
                })}
                ariaLabel={t('mtlCodeModel.claudeNativeMemory', { defaultValue: 'Claude 原生记忆' })}
                disabled={isLoading || isSaving}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <Rocket className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t('mtlCodeModel.bareMode', { defaultValue: '轻量启动' })}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('mtlCodeModel.bareModeDescription', {
                      defaultValue: '使用 --bare 启动 Argus。开启后 Claude 原生记忆、CLAUDE.md 和 topic recall 不可用。',
                    })}
                  </p>
                </div>
              </div>
              <SettingsToggle
                checked={selectedProfile.bareMode}
                onChange={(bareMode) => updateProfile(selectedProfile.id, {
                  bareMode,
                  claudeNativeMemoryEnabled: !bareMode,
                })}
                ariaLabel={t('mtlCodeModel.bareMode', { defaultValue: '轻量启动' })}
                disabled={isLoading || isSaving}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {status === 'success' && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {t('mtlCodeModel.saved', { defaultValue: '已保存到 Argus 设置。' })}
            </span>
          )}
          {status === 'error' && (
            <span className="text-red-600 dark:text-red-400">
              {errorMessage || t('mtlCodeModel.saveFailed', { defaultValue: '无法保存模型设置。' })}
            </span>
          )}
          {config.configPath && status === null && (
            <span className="text-muted-foreground">{config.configPath}</span>
          )}
        </div>

        <Button onClick={handleSave} disabled={isLoading || isSaving} className="h-10">
          <Save className="mr-2 h-4 w-4" />
          {isSaving
            ? t('mtlCodeModel.saving', { defaultValue: '保存中' })
            : t('mtlCodeModel.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </div>
  );
}
