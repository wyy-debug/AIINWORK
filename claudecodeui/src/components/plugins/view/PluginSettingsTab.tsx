import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { BookOpen, ExternalLink, Loader2, Trash2 } from 'lucide-react';

import { usePlugins } from '../../../contexts/PluginsContext';
import type { Plugin } from '../../../contexts/PluginsContext';

import PluginIcon from './PluginIcon';

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <label className="relative inline-flex cursor-pointer select-none items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
      />
      <div
        className="
          relative h-5 w-9 rounded-full bg-muted transition-colors duration-200
          after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4
          after:rounded-full after:bg-white after:shadow-sm after:transition-transform
          after:duration-200 after:content-[''] peer-checked:bg-emerald-500
          peer-checked:after:translate-x-4
        "
      />
    </label>
  );
}

function ServerDot({ running, t }: { running: boolean; t: TFunction<'settings'> }) {
  if (!running) {
    return null;
  }

  return (
    <span className="relative flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        {t('pluginSettings.runningStatus')}
      </span>
    </span>
  );
}

type PluginCardProps = {
  plugin: Plugin;
  index: number;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
  confirmingUninstall: boolean;
  onCancelUninstall: () => void;
};

function PluginCard({
  plugin,
  index,
  onToggle,
  onUninstall,
  confirmingUninstall,
  onCancelUninstall,
}: PluginCardProps) {
  const { t } = useTranslation('settings');
  const accentColor = plugin.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/20';

  return (
    <div
      className="relative flex overflow-hidden rounded-lg border border-border bg-card transition-opacity duration-200"
      style={{
        opacity: plugin.enabled ? 1 : 0.65,
        animationDelay: `${index * 40}ms`,
      }}
    >
      <div className={`w-[3px] flex-shrink-0 ${accentColor} transition-colors duration-300`} />

      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="h-5 w-5 flex-shrink-0 text-foreground/80">
              <PluginIcon
                pluginName={plugin.name}
                iconFile={plugin.icon}
                className="h-5 w-5 [&>svg]:h-full [&>svg]:w-full"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold leading-none text-foreground">
                  {plugin.displayName}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  v{plugin.version}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {plugin.slot}
                </span>
                <ServerDot running={!!plugin.serverRunning} t={t} />
              </div>
              {plugin.description && (
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {plugin.description}
                </p>
              )}
              <div className="mt-1 flex items-center gap-3">
                {plugin.author && (
                  <span className="text-xs text-muted-foreground/60">
                    {plugin.author}
                  </span>
                )}
                {plugin.repoUrl && (
                  <a
                    href={plugin.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="max-w-[200px] truncate">
                      {plugin.repoUrl}
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              onClick={onUninstall}
              title={confirmingUninstall ? t('pluginSettings.confirmUninstall') : t('pluginSettings.uninstallPlugin')}
              aria-label={t('pluginSettings.uninstallPlugin')}
              className={`rounded p-1.5 transition-colors ${
                confirmingUninstall
                  ? 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30'
                  : 'text-muted-foreground hover:bg-muted hover:text-red-500'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            <ToggleSwitch
              checked={plugin.enabled}
              onChange={onToggle}
              ariaLabel={`${plugin.enabled ? t('pluginSettings.disable') : t('pluginSettings.enable')} ${plugin.displayName}`}
            />
          </div>
        </div>

        {confirmingUninstall && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/50 dark:bg-red-950/30">
            <span className="text-sm text-red-600 dark:text-red-400">
              {t('pluginSettings.confirmUninstallMessage', { name: plugin.displayName })}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={onCancelUninstall}
                className="rounded border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t('pluginSettings.cancel')}
              </button>
              <button
                onClick={onUninstall}
                className="rounded border border-red-300 px-2.5 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                {t('pluginSettings.remove')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PluginSettingsTab() {
  const { t } = useTranslation('settings');
  const { plugins, loading, pluginsError, uninstallPlugin, togglePlugin } = usePlugins();
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);

  const handleUninstall = async (name: string) => {
    if (confirmUninstall !== name) {
      setConfirmUninstall(name);
      return;
    }

    const result = await uninstallPlugin(name);
    if (result.success) {
      setConfirmUninstall(null);
      setActionError(null);
      return;
    }

    setActionError(result.error || t('pluginSettings.uninstallFailed'));
    setConfirmUninstall(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-base font-semibold text-foreground">
          {t('pluginSettings.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('pluginSettings.description')}
        </p>
      </div>

      {(actionError || pluginsError) && (
        <p className="text-sm text-red-500">{actionError || pluginsError}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('pluginSettings.scanningPlugins')}
        </div>
      ) : plugins.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('pluginSettings.noPluginsInstalled')}
        </p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin, index) => {
            const handleToggle = async (enabled: boolean) => {
              const result = await togglePlugin(plugin.name, enabled);
              if (result.success) {
                setActionError(null);
                return;
              }

              setActionError(result.error || t('pluginSettings.toggleFailed'));
            };

            return (
              <PluginCard
                key={plugin.name}
                plugin={plugin}
                index={index}
                onToggle={(enabled) => void handleToggle(enabled)}
                onUninstall={() => void handleUninstall(plugin.name)}
                confirmingUninstall={confirmUninstall === plugin.name}
                onCancelUninstall={() => setConfirmUninstall(null)}
              />
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-center gap-3 border-t border-border/50 pt-2">
        <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
        <a
          href="https://github.com/mtl-code/mtl-code-ui"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          {t('pluginSettings.docs')} <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}
