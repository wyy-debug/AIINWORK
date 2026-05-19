import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Button } from '../../../../shared/view/ui';
import { apiFetch } from '../../../../utils/api';
import type { SettingsProject } from '../../types/types';

import BrainRuntimeContent from './runtime-settings/BrainRuntimeContent';
import ObsidianBridgeSettingsContent from './runtime-settings/ObsidianBridgeSettingsContent';

type RuntimePermissions = {
  terminal: string;
  shell: string;
  allowWsl: boolean;
  wslDistro: string;
  allowedPaths: string[];
  confirmDangerousCommands: boolean;
};

const DEFAULT_PERMISSIONS: RuntimePermissions = {
  terminal: 'powershell',
  shell: 'powershell',
  allowWsl: false,
  wslDistro: '',
  allowedPaths: [],
  confirmDangerousCommands: true,
};

const parseJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

type RuntimeSettingsTabProps = {
  projects?: SettingsProject[];
  selectedProject?: SettingsProject | null;
  onOpenSmallModelSettings?: () => void;
};

type RuntimeSettingsSection = 'local-permissions' | 'obsidian' | 'brain';

const RUNTIME_SETTINGS_TABS: Array<{
  id: RuntimeSettingsSection;
  label: string;
  description: string;
}> = [
  {
    id: 'local-permissions',
    label: 'Local Permissions',
    description: 'Terminal, shell safety, and allowed local paths.',
  },
  {
    id: 'obsidian',
    label: 'Obsidian Wiki',
    description: 'Bridge connection, Wiki ingestion, and readback.',
  },
  {
    id: 'brain',
    label: 'Argus Brain',
    description: 'Task memory, context compaction, and work restore.',
  },
];

export default function RuntimeSettingsTab({
  projects = [],
  selectedProject = null,
}: RuntimeSettingsTabProps) {
  const [permissions, setPermissions] = useState<RuntimePermissions>(DEFAULT_PERMISSIONS);
  const [allowedPathsText, setAllowedPathsText] = useState('');
  const [message, setMessage] = useState('');
  const [selectedRuntimeTab, setSelectedRuntimeTab] =
    useState<RuntimeSettingsSection>('local-permissions');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const permissionsData = await parseJson<{ permissions: RuntimePermissions }>(
          await apiFetch('/api/settings/runtime-permissions'),
        );
        if (!cancelled) {
          const nextPermissions = { ...DEFAULT_PERMISSIONS, ...permissionsData.permissions };
          setPermissions(nextPermissions);
          setAllowedPathsText((nextPermissions.allowedPaths || []).join('\n'));
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Failed to load runtime permissions.');
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    try {
      const nextPermissions = {
        ...permissions,
        allowedPaths: allowedPathsText
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      };

      const permissionsData = await parseJson<{ permissions: RuntimePermissions }>(
        await apiFetch('/api/settings/runtime-permissions', {
          method: 'PUT',
          body: JSON.stringify(nextPermissions),
        }),
      );

      setPermissions(permissionsData.permissions);
      setAllowedPathsText((permissionsData.permissions.allowedPaths || []).join('\n'));
      setMessage('Runtime permissions saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save runtime permissions.');
    }
  };

  const renderLocalPermissionsTab = () => (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          <span>Local execution permissions</span>
        </div>
        <h3 className="mt-1 text-lg font-semibold text-foreground">Terminal and safety policy</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Controls the local terminal, allowed path scope, and confirmation behavior used by Argus helper commands.
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-card p-4">
        <label className="text-sm font-medium text-foreground">Default terminal</label>
        <select
          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={permissions.terminal}
          onChange={(event) => setPermissions((previous) => ({
            ...previous,
            terminal: event.target.value,
            shell: event.target.value,
          }))}
        >
          <option value="powershell">PowerShell</option>
          <option value="cmd">Command Prompt</option>
          <option value="wsl">WSL</option>
          <option value="git-bash">Git Bash</option>
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          Argus applies this setting to Shell, Run, worktree setup, preview helpers, and backend command execution.
        </p>
        {permissions.terminal === 'wsl' && (
          <div className="mt-3">
            <label className="text-xs font-medium text-muted-foreground">WSL distro</label>
            <input
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={permissions.wslDistro}
              onChange={(event) => setPermissions((previous) => ({ ...previous, wslDistro: event.target.value }))}
              placeholder="Ubuntu"
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border/70 bg-card p-4">
        <label className="text-sm font-medium text-foreground">Allowed paths</label>
        <textarea
          className="mt-2 min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={allowedPathsText}
          onChange={(event) => setAllowedPathsText(event.target.value)}
          placeholder="One absolute path per line"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Leave blank to allow the selected project path. Commands outside allowed paths are blocked.
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-card p-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={permissions.confirmDangerousCommands}
            onChange={(event) => setPermissions((previous) => ({
              ...previous,
              confirmDangerousCommands: event.target.checked,
            }))}
          />
          Confirm before running dangerous terminal or helper commands
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={permissions.allowWsl}
            onChange={(event) => setPermissions((previous) => ({ ...previous, allowWsl: event.target.checked }))}
          />
          Allow WSL runtime selection
        </label>
      </div>

      <div className="flex justify-end">
        <Button onClick={save}>Save Local Permissions</Button>
      </div>
    </div>
  );

  const renderObsidianTab = () => (
    <ObsidianBridgeSettingsContent
      projects={projects}
      selectedProject={selectedProject}
    />
  );

  const renderBrainTab = () => <BrainRuntimeContent selectedProject={selectedProject} />;

  return (
    <div className="max-w-none space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          <span>Runtime</span>
        </div>
        <h3 className="mt-1 text-xl font-semibold text-foreground">Argus Runtime</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage local execution permissions, Obsidian Wiki readback, and Argus Brain task memory.
        </p>
      </div>

      {message && (
        <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      )}

      <div className="border-b border-border bg-background/95">
        <div role="tablist" className="flex overflow-x-auto px-1">
          {RUNTIME_SETTINGS_TABS.map((tab) => {
            const isSelected = selectedRuntimeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={[
                  'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors duration-150',
                  isSelected
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
                onClick={() => setSelectedRuntimeTab(tab.id)}
                title={tab.description}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedRuntimeTab === 'local-permissions' && renderLocalPermissionsTab()}
      {selectedRuntimeTab === 'obsidian' && renderObsidianTab()}
      {selectedRuntimeTab === 'brain' && renderBrainTab()}
    </div>
  );
}

