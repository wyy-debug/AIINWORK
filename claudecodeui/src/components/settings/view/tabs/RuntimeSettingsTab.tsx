import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Button } from '../../../../shared/view/ui';
import { apiFetch } from '../../../../utils/api';
import type { SettingsProject } from '../../types/types';

import OpenMythosRuntimeContent from './agents-settings/sections/content/OpenMythosRuntimeContent';
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

type RuntimeSettingsSection = 'local-permissions' | 'obsidian' | 'openmythos';

const RUNTIME_SETTINGS_TABS: Array<{
  id: RuntimeSettingsSection;
  label: string;
  description: string;
}> = [
  {
    id: 'local-permissions',
    label: '本地执行权限',
    description: '终端、安全确认和可执行路径。',
  },
  {
    id: 'obsidian',
    label: 'Obsidian 知识库',
    description: 'Bridge 连接、Wiki 上传和回读注入。',
  },
  {
    id: 'openmythos',
    label: 'OpenMythos 运行时',
    description: '推理运行时和子智能体分发。',
  },
];

export default function RuntimeSettingsTab({
  projects = [],
  selectedProject = null,
  onOpenSmallModelSettings,
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
          setMessage(error instanceof Error ? error.message : '加载运行时设置失败。');
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
      setMessage('运行时设置已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存运行时设置失败。');
    }
  };

  const renderLocalPermissionsTab = () => (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          <span>本地执行权限</span>
        </div>
        <h3 className="mt-1 text-lg font-semibold text-foreground">终端与安全策略</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          控制 Argus 可以使用的本地终端、路径范围和危险命令确认策略。
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-card p-4">
        <label className="text-sm font-medium text-foreground">默认终端</label>
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
          <option value="cmd">命令提示符</option>
          <option value="wsl">WSL</option>
          <option value="git-bash">Git Bash</option>
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          Argus 会在 Shell、Run、Worktree setup、Preview 辅助命令和后端运行命令执行前应用本地权限策略。
        </p>
        {permissions.terminal === 'wsl' && (
          <div className="mt-3">
            <label className="text-xs font-medium text-muted-foreground">WSL 发行版</label>
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
        <label className="text-sm font-medium text-foreground">允许路径</label>
        <textarea
          className="mt-2 min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={allowedPathsText}
          onChange={(event) => setAllowedPathsText(event.target.value)}
          placeholder="每行一个绝对路径"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          留空时默认允许当前项目路径；超出允许路径的本地命令会被阻止。
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
          终端或运行任务执行危险命令前需要确认
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={permissions.allowWsl}
            onChange={(event) => setPermissions((previous) => ({ ...previous, allowWsl: event.target.checked }))}
          />
          允许选择 WSL 运行时
        </label>
      </div>

      <div className="flex justify-end">
        <Button onClick={save}>保存本地执行权限</Button>
      </div>
    </div>
  );

  const renderObsidianTab = () => (
    <ObsidianBridgeSettingsContent
      projects={projects}
      selectedProject={selectedProject}
      onOpenSmallModelSettings={onOpenSmallModelSettings}
    />
  );

  const renderOpenMythosTab = () => <OpenMythosRuntimeContent />;

  return (
    <div className="max-w-none space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          <span>运行时</span>
        </div>
        <h3 className="mt-1 text-xl font-semibold text-foreground">Argus 运行时</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          分页管理本地执行权限、Obsidian 知识库和 OpenMythos 运行时。
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
      {selectedRuntimeTab === 'openmythos' && renderOpenMythosTab()}
    </div>
  );
}
