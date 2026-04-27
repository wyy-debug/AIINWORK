import { useEffect, useState } from 'react';
import { Bot, Gauge, KeyRound, Rocket, Save, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../../../../shared/view/ui';
import { apiFetch } from '../../../../../../../utils/api';
import SettingsToggle from '../../../../SettingsToggle';

type AnthropicModelConfig = {
  apiKey: string;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
};

type MtlCodeModelConfig = {
  provider: 'anthropic';
  anthropic: AnthropicModelConfig;
  runtime: {
    bareMode: boolean;
    contextWindowTokens: number;
  };
  configPath?: string;
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

const createEmptyConfig = (): MtlCodeModelConfig => ({
  provider: 'anthropic',
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
});

const toConfig = (value: unknown): MtlCodeModelConfig => {
  const data = value as Partial<MtlCodeModelConfig> | undefined;
  const fallback = createEmptyConfig();
  const contextWindowTokens = data?.runtime?.contextWindowTokens;

  return {
    provider: 'anthropic',
    configPath: typeof data?.configPath === 'string' ? data.configPath : undefined,
    anthropic: {
      apiKey: '',
      apiKeyConfigured: Boolean(data?.anthropic?.apiKeyConfigured),
      baseUrl: data?.anthropic?.baseUrl || fallback.anthropic.baseUrl,
      model: data?.anthropic?.model || fallback.anthropic.model,
    },
    runtime: {
      bareMode: data?.runtime?.bareMode !== false,
      contextWindowTokens:
        typeof contextWindowTokens === 'number' &&
        Number.isFinite(contextWindowTokens) &&
        contextWindowTokens > 0
          ? contextWindowTokens
          : fallback.runtime.contextWindowTokens,
    },
  };
};

export default function ModelConfigContent() {
  const { t } = useTranslation('settings');
  const [config, setConfig] = useState<MtlCodeModelConfig>(() => createEmptyConfig());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setIsLoading(true);
      setStatus(null);

      try {
        const response = await apiFetch('/api/settings/mtl-code-model');
        if (!response.ok) {
          throw new Error('Failed to load MTLCode model config');
        }

        const payload = await response.json();
        if (!cancelled) {
          setConfig(toConfig(payload.config));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setStatus('error');
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

  const updateAnthropic = (key: keyof AnthropicModelConfig, value: string) => {
    setConfig((current) => ({
      ...current,
      anthropic: {
        ...current.anthropic,
        [key]: value,
      },
    }));
    setStatus(null);
  };

  const updateBareMode = (bareMode: boolean) => {
    setConfig((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        bareMode,
      },
    }));
    setStatus(null);
  };

  const updateContextWindowTokens = (value: string) => {
    const contextWindowTokens = Number.parseInt(value, 10);
    setConfig((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        contextWindowTokens:
          Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
            ? contextWindowTokens
            : DEFAULT_CONTEXT_WINDOW_TOKENS,
      },
    }));
    setStatus(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await apiFetch('/api/settings/mtl-code-model', {
        method: 'PUT',
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error('Failed to save MTLCode model config');
      }

      const payload = await response.json();
      setConfig(toConfig(payload.config));
      setStatus('success');
    } catch (error) {
      console.error(error);
      setStatus('error');
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
            {t('mtlCodeModel.title', { defaultValue: 'MTLCode Model' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('mtlCodeModel.subtitle', {
              defaultValue: 'Configure the MTL-Code backend with the Anthropic Messages API format.',
            })}
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 md:col-span-2">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Server className="h-4 w-4" />
              {t('mtlCodeModel.baseUrl', { defaultValue: 'Base URL' })}
            </span>
            <Input
              value={config.anthropic.baseUrl}
              onChange={(event) => updateAnthropic('baseUrl', event.target.value)}
              placeholder="https://api.example.com/anthropic"
              disabled={isLoading || isSaving}
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">
              {t('mtlCodeModel.model', { defaultValue: 'Model' })}
            </span>
            <Input
              value={config.anthropic.model}
              onChange={(event) => updateAnthropic('model', event.target.value)}
              placeholder="claude-sonnet-4-5-20250929"
              disabled={isLoading || isSaving}
            />
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <KeyRound className="h-4 w-4" />
              {t('mtlCodeModel.apiKey', { defaultValue: 'API Key / Auth Token' })}
            </span>
            <Input
              type="password"
              value={config.anthropic.apiKey}
              onChange={(event) => updateAnthropic('apiKey', event.target.value)}
              placeholder={
                config.anthropic.apiKeyConfigured
                  ? t('mtlCodeModel.apiKeyConfigured', { defaultValue: 'Configured' })
                  : 'sk-...'
              }
              disabled={isLoading || isSaving}
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/50 p-4">
        <label className="space-y-2">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Gauge className="h-4 w-4" />
            {t('mtlCodeModel.contextWindowTokens', {
              defaultValue: 'Context window tokens',
            })}
          </span>
          <Input
            type="number"
            min={1}
            step={1000}
            value={config.runtime.contextWindowTokens}
            onChange={(event) => updateContextWindowTokens(event.target.value)}
            placeholder="200000"
            disabled={isLoading || isSaving}
          />
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card/50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <Rocket className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('mtlCodeModel.bareMode', { defaultValue: 'Lightweight startup' })}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('mtlCodeModel.bareModeDescription', {
                  defaultValue: 'Start MTL-Code with --bare for cleaner first-use sessions.',
                })}
              </p>
            </div>
          </div>
          <SettingsToggle
            checked={config.runtime.bareMode}
            onChange={updateBareMode}
            ariaLabel={t('mtlCodeModel.bareMode', { defaultValue: 'Lightweight startup' })}
            disabled={isLoading || isSaving}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {status === 'success' && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {t('mtlCodeModel.saved', { defaultValue: 'Saved to MTL-Code settings.' })}
            </span>
          )}
          {status === 'error' && (
            <span className="text-red-600 dark:text-red-400">
              {t('mtlCodeModel.saveFailed', { defaultValue: 'Could not save model settings.' })}
            </span>
          )}
          {config.configPath && status === null && (
            <span className="text-muted-foreground">{config.configPath}</span>
          )}
        </div>

        <Button onClick={handleSave} disabled={isLoading || isSaving} className="h-10">
          <Save className="mr-2 h-4 w-4" />
          {isSaving
            ? t('mtlCodeModel.saving', { defaultValue: 'Saving' })
            : t('mtlCodeModel.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}
