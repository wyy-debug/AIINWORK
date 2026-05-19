import { useEffect, useState } from 'react';
import { BrainCircuit, RotateCcw, Save, ShieldCheck } from 'lucide-react';

import { Button, Input } from '../../../../../shared/view/ui';
import { apiFetch } from '../../../../../utils/api';
import SettingsToggle from '../../SettingsToggle';
import type { SettingsProject } from '../../../types/types';

type BrainRuntimeConfig = {
  enabled: boolean;
  captureRawRefs: boolean;
  compactEventThreshold: number;
  compactTextThreshold: number;
  maxInjectedTokens: number;
  recallTimeoutMs: number;
  retention: {
    perSessionMaxEvents: number;
    perProjectMaxCompactions: number;
    rawRefsMaxSizeBytes: number;
  };
};

type ModelProfile = {
  id?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  [key: string]: unknown;
};

type ModelConfig = {
  provider?: 'anthropic';
  activeProfileId: string;
  profiles: ModelProfile[];
  anthropic?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  subagents?: Record<string, unknown>;
  goals?: Record<string, unknown>;
  brainRuntime: BrainRuntimeConfig;
};

const DEFAULT_BRAIN_RUNTIME: BrainRuntimeConfig = {
  enabled: true,
  captureRawRefs: true,
  compactEventThreshold: 18,
  compactTextThreshold: 12000,
  maxInjectedTokens: 1200,
  recallTimeoutMs: 800,
  retention: {
    perSessionMaxEvents: 1000,
    perProjectMaxCompactions: 80,
    rawRefsMaxSizeBytes: 5000000,
  },
};

const readNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBrainRuntime = (value?: Partial<BrainRuntimeConfig>): BrainRuntimeConfig => ({
  ...DEFAULT_BRAIN_RUNTIME,
  ...(value || {}),
  enabled: value?.enabled !== false,
  captureRawRefs: value?.captureRawRefs !== false,
  compactEventThreshold: readNumber(value?.compactEventThreshold, DEFAULT_BRAIN_RUNTIME.compactEventThreshold),
  compactTextThreshold: readNumber(value?.compactTextThreshold, DEFAULT_BRAIN_RUNTIME.compactTextThreshold),
  maxInjectedTokens: readNumber(value?.maxInjectedTokens, DEFAULT_BRAIN_RUNTIME.maxInjectedTokens),
  recallTimeoutMs: readNumber(value?.recallTimeoutMs, DEFAULT_BRAIN_RUNTIME.recallTimeoutMs),
  retention: {
    ...DEFAULT_BRAIN_RUNTIME.retention,
    ...(value?.retention || {}),
    perSessionMaxEvents: readNumber(value?.retention?.perSessionMaxEvents, DEFAULT_BRAIN_RUNTIME.retention.perSessionMaxEvents),
    perProjectMaxCompactions: readNumber(value?.retention?.perProjectMaxCompactions, DEFAULT_BRAIN_RUNTIME.retention.perProjectMaxCompactions),
    rawRefsMaxSizeBytes: readNumber(value?.retention?.rawRefsMaxSizeBytes, DEFAULT_BRAIN_RUNTIME.retention.rawRefsMaxSizeBytes),
  },
});

const normalizeConfig = (value?: Partial<ModelConfig>): ModelConfig => ({
  provider: 'anthropic',
  activeProfileId: value?.activeProfileId || String(value?.profiles?.[0]?.id || 'default'),
  profiles: Array.isArray(value?.profiles) ? value.profiles : [],
  anthropic: value?.anthropic || {},
  runtime: value?.runtime || {},
  subagents: value?.subagents || {},
  goals: value?.goals || {},
  brainRuntime: normalizeBrainRuntime(value?.brainRuntime),
});

const parseError = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
};

export default function BrainRuntimeContent({
  selectedProject,
}: {
  selectedProject?: SettingsProject | null;
}) {
  const [config, setConfig] = useState<ModelConfig>(() => normalizeConfig());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setMessage('');
      try {
        const response = await apiFetch('/api/settings/mtl-code-model');
        if (!response.ok) {
          throw new Error(await parseError(response, 'Failed to load Argus Brain settings.'));
        }
        const payload = await response.json();
        if (!cancelled) {
          setConfig(normalizeConfig(payload.config));
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Failed to load Argus Brain settings.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateBrainRuntime = (patch: Partial<BrainRuntimeConfig>) => {
    setConfig((current) => ({
      ...current,
      brainRuntime: normalizeBrainRuntime({
        ...current.brainRuntime,
        ...patch,
      }),
    }));
    setMessage('');
  };

  const updateRetention = (patch: Partial<BrainRuntimeConfig['retention']>) => {
    updateBrainRuntime({
      retention: {
        ...config.brainRuntime.retention,
        ...patch,
      },
    });
  };

  const save = async () => {
    setIsSaving(true);
    setMessage('');
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
            apiKey: String(activeProfile?.apiKey || ''),
            baseUrl: String(activeProfile?.baseUrl || config.anthropic?.baseUrl || ''),
            model: String(activeProfile?.model || config.anthropic?.model || ''),
          },
          runtime: config.runtime,
          subagents: config.subagents,
          goals: config.goals,
          brainRuntime: config.brainRuntime,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response, 'Failed to save Argus Brain settings.'));
      }
      const payload = await response.json();
      setConfig(normalizeConfig(payload.config));
      setMessage('Argus Brain settings saved.');
      window.dispatchEvent(new Event('mtlCodeModelSettingsChanged'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save Argus Brain settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const clearProjectBrain = async () => {
    if (!selectedProject?.name) {
      setMessage('Select a project before clearing project Brain data.');
      return;
    }
    const response = await apiFetch(`/api/brain/project/${encodeURIComponent(selectedProject.name)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      setMessage(await parseError(response, 'Failed to clear project Brain data.'));
      return;
    }
    const payload = await response.json();
    setMessage(`Cleared ${payload.deleted || 0} Brain record(s) for this project.`);
  };

  const brain = config.brainRuntime;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BrainCircuit className="h-4 w-4" />
          <span>Argus Brain</span>
        </div>
        <h3 className="mt-1 text-lg font-semibold text-foreground">Task memory and context restore</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Stores local task events, compacts long work into a small canvas, and restores the current goal, decisions, risks, and next step.
        </p>
      </div>

      {message && (
        <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      )}

      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-foreground">Enable Argus Brain</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              When disabled, chat skips Brain capture, compaction, recall, and diagnostics.
            </p>
          </div>
          <SettingsToggle
            checked={brain.enabled}
            onChange={(enabled) => updateBrainRuntime({ enabled })}
            ariaLabel="Enable Argus Brain"
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">Capture raw refs</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Keeps local evidence links for checkpoints, diffs, runtime events, and artifacts.
              </p>
            </div>
            <SettingsToggle
              checked={brain.captureRawRefs}
              onChange={(captureRawRefs) => updateBrainRuntime({ captureRawRefs })}
              ariaLabel="Capture raw refs"
              disabled={isLoading || !brain.enabled}
            />
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <div className="flex items-start gap-2 text-sm font-medium text-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
            Brain is separate from model memory
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Native model memory handles preferences. Brain remembers local task state and asks the model to verify current files before acting.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <NumberField label="Compact after events" value={brain.compactEventThreshold} onChange={(compactEventThreshold) => updateBrainRuntime({ compactEventThreshold })} />
        <NumberField label="Compact after text chars" value={brain.compactTextThreshold} onChange={(compactTextThreshold) => updateBrainRuntime({ compactTextThreshold })} />
        <NumberField label="Max injected tokens" value={brain.maxInjectedTokens} onChange={(maxInjectedTokens) => updateBrainRuntime({ maxInjectedTokens })} />
        <NumberField label="Recall timeout ms" value={brain.recallTimeoutMs} onChange={(recallTimeoutMs) => updateBrainRuntime({ recallTimeoutMs })} />
        <NumberField label="Per-session max events" value={brain.retention.perSessionMaxEvents} onChange={(perSessionMaxEvents) => updateRetention({ perSessionMaxEvents })} />
        <NumberField label="Per-project max compactions" value={brain.retention.perProjectMaxCompactions} onChange={(perProjectMaxCompactions) => updateRetention({ perProjectMaxCompactions })} />
        <NumberField label="Raw refs max bytes" value={brain.retention.rawRefsMaxSizeBytes} onChange={(rawRefsMaxSizeBytes) => updateRetention({ rawRefsMaxSizeBytes })} />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={clearProjectBrain} disabled={isLoading || !selectedProject?.name}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Clear Project Brain
        </Button>
        <Button onClick={save} disabled={isLoading || isSaving}>
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Argus Brain'}
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-lg border border-border/70 bg-card p-4 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <Input
        className="mt-2"
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(readNumber(event.target.value, value))}
      />
    </label>
  );
}
