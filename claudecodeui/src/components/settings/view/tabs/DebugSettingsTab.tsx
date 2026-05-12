import { BugIcon, BracesIcon } from 'lucide-react';

import { saveArgusDebugSettings } from '../../../chat/utils/debugSettings';
import type { ArgusDebugSettings } from '../../types/types';

import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type DebugSettingsTabProps = {
  settings: ArgusDebugSettings;
  onSettingsChange: (settings: ArgusDebugSettings) => void;
};

export default function DebugSettingsTab({
  settings,
  onSettingsChange,
}: DebugSettingsTabProps) {
  const updateSettings = (patch: Partial<ArgusDebugSettings>) => {
    const nextSettings = {
      ...settings,
      ...patch,
    };
    onSettingsChange(nextSettings);
    saveArgusDebugSettings(nextSettings);
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="Debug">
        <SettingsCard divided>
          <SettingsRow
            label="Prompt injection panel"
            description="Show command rewrites, appendSystemPrompt, and launch flags on the right side of the chat."
          >
            <SettingsToggle
              checked={settings.showPromptInjectionPanel}
              onChange={(showPromptInjectionPanel) => updateSettings({ showPromptInjectionPanel })}
              ariaLabel="Prompt injection panel"
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BugIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Local runtime visibility</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This only exposes UI-injected prompt text in the local app. It does not dump the native Claude Code system prompt.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
              <BracesIcon className="h-3.5 w-3.5 text-primary" />
              prompt/debug stream
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
