import { Bot, Settings, Sparkles, PanelLeftOpen } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { AppTab } from '../../../../types/app';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  activeTab: AppTab;
  onShowAgents: () => void;
  updateAvailable: boolean;
  onShowVersionModal: () => void;
  t: TFunction;
};

export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  activeTab,
  onShowAgents,
  updateAvailable,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  const isAgentsActive = activeTab === 'agents';
  const agentConfigLabel = t('actions.agentConfig', { defaultValue: 'Agent 配置' });

  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 bg-background/80 py-3 backdrop-blur-sm">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      <div className="nav-divider my-1 w-6" />

      <button
        onClick={onShowAgents}
        className={cn(
          'group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80',
          isAgentsActive && 'bg-primary/10 text-primary',
        )}
        aria-label={agentConfigLabel}
        title={agentConfigLabel}
        aria-current={isAgentsActive ? 'page' : undefined}
      >
        <Bot className={cn('h-4 w-4 transition-colors', isAgentsActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
      </button>

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {/* Update indicator */}
      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="h-4 w-4 text-blue-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        </button>
      )}
    </div>
  );
}
