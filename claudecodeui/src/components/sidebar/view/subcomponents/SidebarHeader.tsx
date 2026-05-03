import { Folder, FolderPlus, MessageSquare, PanelLeftClose, RefreshCw, Search, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useRef } from 'react';

import { Button, Input } from '../../../../shared/view/ui';
import { IS_PLATFORM } from '../../../../constants/config';
import { cn } from '../../../../lib/utils';

type SearchMode = 'projects' | 'conversations';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onQuickChat: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onQuickChat,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const LogoBlock = () => (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/90 shadow-sm">
        <svg className="h-3.5 w-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">{t('app.title')}</h1>
    </div>
  );

  const focusProjectSearch = () => {
    onSearchModeChange('projects');
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  };
  const createButtonLabel = searchMode === 'conversations' ? '新建对话' : t('projects.newProject');

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden px-2 pb-2 pt-3 md:block"
        style={{}}
      >
        <div className="space-y-1">
          <button
            type="button"
            className="flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-foreground transition hover:bg-accent/60"
            onClick={onQuickChat}
          >
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span>快速对话</span>
          </button>
          <button
            type="button"
            className={cn(
              'flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition hover:bg-accent/60',
              searchFilter ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={focusProjectSearch}
          >
            <Search className="h-4 w-4" />
            <span>搜索</span>
          </button>
        </div>

        {!isLoading && (
          <div className="mt-2 grid grid-cols-2 rounded-xl bg-muted/45 p-1">
            <button
              type="button"
              onClick={() => onSearchModeChange('projects')}
              aria-pressed={searchMode === 'projects'}
              className={cn(
                'flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition',
                searchMode === 'projects'
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Folder className="h-3.5 w-3.5" />
              {t('search.modeProjects')}
            </button>
            <button
              type="button"
              onClick={() => onSearchModeChange('conversations')}
              aria-pressed={searchMode === 'conversations'}
              className={cn(
                'flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition',
                searchMode === 'conversations'
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {t('search.modeConversations')}
            </button>
          </div>
        )}

        {/* Search bar */}
        {!isLoading && (
          <div className="mt-2 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder={searchMode === 'conversations' ? t('search.conversationsPlaceholder') : t('projects.searchPlaceholder')}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-9 rounded-xl border-0 pl-9 pr-8 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            variant={searchMode === 'projects' ? 'default' : 'secondary'}
            size="sm"
            className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-xl px-3 text-xs font-medium"
            onClick={onCreateProject}
            title={createButtonLabel}
          >
            {searchMode === 'conversations' ? <MessageSquare className="h-3.5 w-3.5 shrink-0" /> : <FolderPlus className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{createButtonLabel}</span>
          </Button>
          <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            onClick={onRefresh}
            disabled={isRefreshing}
            title={t('tooltips.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            onClick={onCollapseSidebar}
            title={t('tooltips.hideSidebar')}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
          </div>
        </div>
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://github.com/mtl-code/mtl-code-ui"
              className="flex min-w-0 items-center gap-2.5 transition-opacity active:opacity-70"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
              onClick={onCreateProject}
            >
              {searchMode === 'conversations' ? <MessageSquare className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile search */}
        {!isLoading && (
          <div className="mt-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
              <div className="flex min-w-0 flex-1 rounded-lg bg-muted/50 p-0.5">
                <button
                  onClick={() => onSearchModeChange('projects')}
                  aria-pressed={searchMode === 'projects'}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                    searchMode === 'projects'
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Folder className="h-3 w-3" />
                  {t('search.modeProjects')}
                </button>
                <button
                  onClick={() => onSearchModeChange('conversations')}
                  aria-pressed={searchMode === 'conversations'}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                    searchMode === 'conversations'
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3 w-3" />
                  {t('search.modeConversations')}
                </button>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchMode === 'conversations' ? t('search.conversationsPlaceholder') : t('projects.searchPlaceholder')}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-10 rounded-xl border-0 pl-10 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
