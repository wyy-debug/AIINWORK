import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BrainCircuit, CheckCircle2, Clock, Save, Sparkles, Wand2 } from 'lucide-react';

import { Button, Input } from '../../../../../../../shared/view/ui';
import { apiFetch } from '../../../../../../../utils/api';
import SettingsToggle from '../../../../SettingsToggle';

type ModelProfile = {
  id: string;
  name: string;
  provider?: 'anthropic';
  protocol?: 'anthropic' | 'openai-compatible' | 'openai-responses';
  apiKey?: string;
  apiKeyConfigured?: boolean;
  baseUrl: string;
  model: string;
  requestModel?: string;
  contextWindowTokens?: number;
  bareMode?: boolean;
};

type SmallModelRuntime = {
  enabled: boolean;
  profileId: string;
  timeoutMs: number;
  useForWikiRouting: boolean;
  useForWikiReadback: boolean;
  resolvedProfile?: {
    id: string;
    name: string;
    model: string;
    baseUrl: string;
    tokenConfigured: boolean;
  } | null;
};

type ModelConfig = {
  provider?: 'anthropic';
  activeProfileId: string;
  profiles: ModelProfile[];
  anthropic?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  runtime?: Record<string, unknown>;
  subagents?: Record<string, unknown>;
  goals?: Record<string, unknown>;
  brainRuntime?: Record<string, unknown>;
  smallModelRuntime: SmallModelRuntime;
};

const DEFAULT_SMALL_MODEL_RUNTIME: SmallModelRuntime = {
  enabled: true,
  profileId: 'auto',
  timeoutMs: 2500,
  useForWikiRouting: true,
  useForWikiReadback: true,
  resolvedProfile: null,
};

const normalizeSmallModelRuntime = (value: Partial<SmallModelRuntime> | undefined): SmallModelRuntime => ({
  ...DEFAULT_SMALL_MODEL_RUNTIME,
  ...(value || {}),
  profileId: typeof value?.profileId === 'string' && value.profileId.trim() ? value.profileId.trim() : 'auto',
  timeoutMs: Number.isFinite(Number(value?.timeoutMs)) ? Number(value?.timeoutMs) : 2500,
});

const normalizeConfig = (value: Partial<ModelConfig> | undefined): ModelConfig => ({
  provider: 'anthropic',
  activeProfileId: value?.activeProfileId || value?.profiles?.[0]?.id || 'default',
  profiles: Array.isArray(value?.profiles) ? value.profiles : [],
  anthropic: value?.anthropic || {},
  runtime: value?.runtime || {},
  subagents: value?.subagents || {},
  goals: value?.goals || {},
  brainRuntime: value?.brainRuntime || {},
  smallModelRuntime: normalizeSmallModelRuntime(value?.smallModelRuntime),
});

const readResponseError = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json();
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Ignore response parsing failures.
  }
  return fallback;
};

export default function SmallModelConfigContent() {
  const [config, setConfig] = useState<ModelConfig>(() => normalizeConfig(undefined));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [testPrompt, setTestPrompt] = useState('请判断这段内容是否适合进入 Wiki，并返回 JSON。');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      setIsLoading(true);
      setStatus(null);
      setErrorMessage('');
      try {
        const response = await apiFetch('/api/settings/mtl-code-model');
        if (!response.ok) {
          throw new Error(await readResponseError(response, '加载小模型配置失败'));
        }
        const payload = await response.json();
        if (!cancelled) {
          setConfig(normalizeConfig(payload.config));
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : '加载小模型配置失败');
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

  const smallModelRuntime = config.smallModelRuntime;
  const selectedProfile = useMemo(() => (
    smallModelRuntime.profileId === 'auto'
      ? null
      : config.profiles.find((profile) => profile.id === smallModelRuntime.profileId) || null
  ), [config.profiles, smallModelRuntime.profileId]);
  const resolvedProfile = smallModelRuntime.resolvedProfile || selectedProfile || null;
  const resolvedTokenConfigured = Boolean(
    smallModelRuntime.resolvedProfile?.tokenConfigured
      || selectedProfile?.apiKeyConfigured,
  );

  const updateSmallModelRuntime = (patch: Partial<SmallModelRuntime>) => {
    setConfig((current) => ({
      ...current,
      smallModelRuntime: normalizeSmallModelRuntime({
        ...current.smallModelRuntime,
        ...patch,
      }),
    }));
    setStatus(null);
    setErrorMessage('');
    setTestResult(null);
  };

  const saveConfig = async () => {
    setIsSaving(true);
    setStatus(null);
    setErrorMessage('');
    try {
      const activeProfile = config.profiles.find((profile) => profile.id === config.activeProfileId)
        || config.profiles[0];
      const response = await apiFetch('/api/settings/mtl-code-model', {
        method: 'PUT',
        body: JSON.stringify({
          provider: 'anthropic',
          activeProfileId: config.activeProfileId,
          profiles: config.profiles,
          anthropic: {
            apiKey: activeProfile?.apiKey || '',
            baseUrl: activeProfile?.baseUrl || config.anthropic?.baseUrl || '',
            model: activeProfile?.model || config.anthropic?.model || '',
          },
          runtime: config.runtime,
          subagents: config.subagents,
          goals: config.goals,
          brainRuntime: config.brainRuntime,
          smallModelRuntime: config.smallModelRuntime,
        }),
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response, '保存小模型配置失败'));
      }
      const payload = await response.json();
      setConfig(normalizeConfig(payload.config));
      setStatus('success');
      window.dispatchEvent(new Event('mtlCodeModelSettingsChanged'));
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '保存小模型配置失败');
    } finally {
      setIsSaving(false);
    }
  };

  const testSmallModel = async () => {
    setIsTesting(true);
    setTestResult(null);
    setStatus(null);
    try {
      const response = await apiFetch('/api/settings/small-model/test', {
        method: 'POST',
        body: JSON.stringify({ prompt: testPrompt }),
      });
      const payload = await response.json();
      setTestResult(payload);
      if (!response.ok || payload?.success === false) {
        setStatus('error');
        setErrorMessage(String(payload?.error || payload?.reason || '小模型测试失败'));
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '小模型测试失败');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BrainCircuit className="h-5 w-5 text-sky-500" />
        <div>
          <h3 className="text-lg font-medium text-foreground">小模型</h3>
          <p className="text-sm text-muted-foreground">
            用轻量模型辅助 Wiki/Obsidian 自动分类和回读注入筛选，失败时自动回退规则逻辑。
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">启用小模型</div>
              <p className="mt-1 text-sm text-muted-foreground">
                开启后会优先用小模型判断知识分类和筛选 Wiki 上下文。
              </p>
            </div>
            <SettingsToggle
              checked={smallModelRuntime.enabled}
              onChange={(enabled) => updateSmallModelRuntime({ enabled })}
              ariaLabel="启用小模型"
              disabled={isLoading || isSaving}
            />
          </div>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4" />
              模型配置
            </span>
            <select
              value={smallModelRuntime.profileId}
              onChange={(event) => updateSmallModelRuntime({ profileId: event.target.value })}
              disabled={isLoading || isSaving}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="auto">自动选择</option>
              {config.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name || profile.model || profile.id}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Clock className="h-4 w-4" />
              超时时间 ms
            </span>
            <Input
              type="number"
              min={1000}
              max={15000}
              step={500}
              value={smallModelRuntime.timeoutMs}
              onChange={(event) => updateSmallModelRuntime({ timeoutMs: Number(event.target.value) })}
              disabled={isLoading || isSaving}
            />
          </label>
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-background p-3">
              <div className="text-xs text-muted-foreground">当前命中配置</div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {resolvedProfile?.name || '未命中'}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {resolvedProfile?.model || '未设置模型'}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <div className="text-xs text-muted-foreground">连接状态</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                {resolvedTokenConfigured
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <AlertCircle className="h-4 w-4 text-amber-500" />}
                {resolvedTokenConfigured ? 'Token 已配置' : 'Token 未配置'}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {resolvedProfile?.baseUrl || '未设置 Base URL'}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">用于 Wiki/Obsidian 自动分类</div>
                <p className="mt-1 text-sm text-muted-foreground">辅助判断 Projects、SecondBrain、AIMemory 和 Wiki topic。</p>
              </div>
              <SettingsToggle
                checked={smallModelRuntime.useForWikiRouting}
                onChange={(useForWikiRouting) => updateSmallModelRuntime({ useForWikiRouting })}
                ariaLabel="用于 Wiki/Obsidian 自动分类"
                disabled={isLoading || isSaving}
              />
            </div>
            <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
              <div>
                <div className="text-sm font-medium text-foreground">用于 Wiki 回读注入筛选</div>
                <p className="mt-1 text-sm text-muted-foreground">在注入前筛掉噪声，并保留来源路径和命中原因。</p>
              </div>
              <SettingsToggle
                checked={smallModelRuntime.useForWikiReadback}
                onChange={(useForWikiReadback) => updateSmallModelRuntime({ useForWikiReadback })}
                ariaLabel="用于 Wiki 回读注入筛选"
                disabled={isLoading || isSaving}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border bg-background p-3">
            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Wand2 className="h-4 w-4" />
                测试小模型
              </span>
              <textarea
                value={testPrompt}
                onChange={(event) => setTestPrompt(event.target.value)}
                className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                disabled={isTesting}
              />
            </label>
            <Button type="button" variant="outline" onClick={testSmallModel} disabled={isTesting || !smallModelRuntime.enabled}>
              <Wand2 className="mr-2 h-4 w-4" />
              {isTesting ? '测试中' : '测试小模型'}
            </Button>
            {testResult && (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {status === 'success' && <span className="text-emerald-600 dark:text-emerald-400">小模型配置已保存。</span>}
          {status === 'error' && <span className="text-red-600 dark:text-red-400">{errorMessage || '小模型配置失败。'}</span>}
        </div>
        <Button onClick={saveConfig} disabled={isLoading || isSaving} className="h-10">
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? '保存中' : '保存'}
        </Button>
      </div>
    </div>
  );
}
