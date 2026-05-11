import {
  FileText,
  Globe2,
  MessageSquare,
  Terminal,
  Folder,
  ClipboardCheck,
  FileDiff,
  Play,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { Tooltip, PillBar, Pill } from '../../../../shared/view/ui';
import type { AppTab, Project } from '../../../../types/app';
import { apiFetch } from '../../../../utils/api';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  selectedProject: Project;
};

type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

const PRIMARY_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat', label: 'Chat', icon: MessageSquare },
  { kind: 'builtin', id: 'files', label: 'Files', icon: Folder },
  { kind: 'builtin', id: 'shell', label: 'Shell', icon: Terminal },
];

const TASKS_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'tasks',
  label: 'Tasks',
  icon: ClipboardCheck,
};

const CONTEXT_PANEL_LABELS: Record<string, string> = {
  chat: 'Chat',
  review: 'Changes',
  shell: 'Shell',
  files: 'Files',
  actions: 'Run',
  automations: 'Automations',
  browser: 'Preview',
  artifacts: 'Results',
  tasks: 'Tasks',
  preview: 'Preview',
  agents: 'Agents',
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  selectedProject,
}: MainContentTabSwitcherProps) {
  const [changeCount, setChangeCount] = useState(0);
  const [resultCount, setResultCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadContextCounts = async () => {
      const projectName = selectedProject.name;

      try {
        const statusResponse = await apiFetch(`/api/git/status?project=${encodeURIComponent(projectName)}`);
        const statusData = await statusResponse.json();
        if (!cancelled) {
          setChangeCount(Array.isArray(statusData?.files) ? statusData.files.length : 0);
        }
      } catch {
        if (!cancelled) setChangeCount(0);
      }

      try {
        const artifactsParams = new URLSearchParams({ projectName });
        const artifactsResponse = await apiFetch(`/api/artifacts?${artifactsParams.toString()}`);
        const artifactsData = await artifactsResponse.json();
        if (!cancelled) {
          setResultCount(Array.isArray(artifactsData?.artifacts) ? artifactsData.artifacts.length : 0);
        }
      } catch {
        if (!cancelled) setResultCount(0);
      }
    };

    void loadContextCounts();
    const handleRefresh = () => void loadContextCounts();
    window.addEventListener('argus-refresh-workflow-counts', handleRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('argus-refresh-workflow-counts', handleRefresh);
    };
  }, [selectedProject.name]);

  const primaryTabs: BuiltInTab[] = shouldShowTasksTab ? [...PRIMARY_TABS, TASKS_TAB] : PRIMARY_TABS;
  const contextTabs: BuiltInTab[] = [
    ...(changeCount > 0 || activeTab === 'review'
      ? [{ kind: 'builtin' as const, id: 'review' as AppTab, label: 'Changes', icon: FileDiff, badge: changeCount }]
      : []),
    { kind: 'builtin', id: 'actions', label: 'Run', icon: Play },
    { kind: 'builtin', id: 'browser', label: 'Preview', icon: Globe2 },
    ...(resultCount > 0 || activeTab === 'artifacts'
      ? [{ kind: 'builtin' as const, id: 'artifacts' as AppTab, label: 'Results', icon: FileText, badge: resultCount }]
      : []),
  ];

  const renderTab = (tab: BuiltInTab) => {
    const isActive = tab.id === activeTab;
    const displayLabel = tab.label || CONTEXT_PANEL_LABELS[tab.id] || tab.id;

    return (
      <Tooltip key={tab.id} content={displayLabel} position="bottom">
        <Pill
          isActive={isActive}
          onClick={() => {
            setActiveTab(tab.id);
            window.dispatchEvent(new CustomEvent('argus-open-panel', {
              detail: { panel: tab.id },
            }));
          }}
          className="px-2.5 py-[5px]"
        >
          <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
          <span className="hidden lg:inline">{displayLabel}</span>
          {typeof tab.badge === 'number' && tab.badge > 0 && (
            <span className="ml-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {tab.badge}
            </span>
          )}
        </Pill>
      </Tooltip>
    );
  };

  return (
    <div className="flex items-center gap-2">
      <PillBar>{primaryTabs.map(renderTab)}</PillBar>
      <PillBar className="bg-transparent p-0">{contextTabs.map(renderTab)}</PillBar>
    </div>
  );
}
