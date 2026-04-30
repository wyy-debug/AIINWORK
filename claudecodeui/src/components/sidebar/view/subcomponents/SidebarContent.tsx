import { type ReactNode, useMemo } from 'react';
import { Archive, ArchiveRestore, Edit2, MessageSquare, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ScrollArea } from '../../../../shared/view/ui';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { ConversationSearchResults, SearchProgress } from '../../hooks/useSidebarController';
import type { SessionWithProvider } from '../../types/types';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { createSessionViewModel, getSessionDate } from '../../utils/utils';

import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

type SearchMode = 'projects' | 'conversations';

function HighlightedSnippet({
  snippet,
  highlights,
}: {
  snippet: string;
  highlights: { start: number; end: number }[];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const h of highlights) {
    if (h.start > cursor) {
      parts.push(snippet.slice(cursor, h.start));
    }
    parts.push(
      <mark key={h.start} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-800">
        {snippet.slice(h.start, h.end)}
      </mark>,
    );
    cursor = h.end;
  }

  if (cursor < snippet.length) {
    parts.push(snippet.slice(cursor));
  }

  return (
    <span className="text-xs leading-relaxed text-muted-foreground">
      {parts}
    </span>
  );
}

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  conversationProject: Project | null;
  conversationSessions: SessionWithProvider[];
  selectedConversationSession: ProjectSession | null;
  onConversationSessionSelect: (session: ProjectSession) => void;
  onRenameConversationSession: (session: SessionWithProvider, currentName: string) => void;
  onDeleteConversationSession: (session: SessionWithProvider, sessionTitle: string) => void;
  onTogglePinConversationSession: (session: SessionWithProvider) => void;
  onToggleArchiveConversationSession: (session: SessionWithProvider) => void;
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  onConversationResultClick: (
    projectName: string,
    sessionId: string,
    provider: string,
    messageTimestamp?: string | null,
    messageSnippet?: string | null,
  ) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  activeTab: AppTab;
  onShowAgents: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  conversationProject,
  conversationSessions,
  selectedConversationSession,
  onConversationSessionSelect,
  onRenameConversationSession,
  onDeleteConversationSession,
  onTogglePinConversationSession,
  onToggleArchiveConversationSession,
  conversationResults,
  isSearching,
  searchProgress,
  onConversationResultClick,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  updateAvailable,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  activeTab,
  onShowAgents,
  projectListProps,
  t,
}: SidebarContentProps) {
  const showConversationSearch = searchMode === 'conversations' && searchFilter.trim().length >= 2;
  const hasPartialResults = conversationResults && conversationResults.results.length > 0;
  const conversationItems = useMemo(() => {
    const normalizedQuery = searchFilter.trim().toLowerCase();
    return conversationSessions
      .map((session) => ({
        session,
        sessionView: createSessionViewModel(session, projectListProps.currentTime, t),
      }))
      .filter((item) => {
        if (!normalizedQuery || normalizedQuery.length >= 2) {
          return true;
        }

        const sessionText = `${item.sessionView.sessionName} ${item.session.id}`.toLowerCase();
        return sessionText.includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (Boolean(left.session.isPinned) !== Boolean(right.session.isPinned)) {
          return left.session.isPinned ? -1 : 1;
        }
        if (Boolean(left.session.isArchived) !== Boolean(right.session.isArchived)) {
          return left.session.isArchived ? 1 : -1;
        }
        return getSessionDate(right.session).getTime() - getSessionDate(left.session).getTime();
      });
  }, [conversationSessions, projectListProps.currentTime, searchFilter, t]);

  return (
    <div
      className="flex h-full flex-col bg-background/80 backdrop-blur-sm md:w-72 md:select-none"
      style={{}}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain md:px-1.5 md:py-2">
        {searchMode === 'conversations' ? (
          showConversationSearch ? (
            isSearching && !hasPartialResults ? (
              <div className="px-4 py-12 text-center md:py-8">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                </div>
                <p className="text-sm text-muted-foreground">{t('search.searching')}</p>
                {searchProgress && (
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {t('search.projectsScanned', { count: searchProgress.scannedProjects })}
                    /{searchProgress.totalProjects}
                  </p>
                )}
              </div>
            ) : !isSearching && conversationResults && conversationResults.results.length === 0 ? (
              <div className="px-4 py-12 text-center md:py-8">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                  {t('search.noResults')}
                </h3>
                <p className="text-sm text-muted-foreground">{t('search.tryDifferentQuery')}</p>
              </div>
            ) : hasPartialResults ? (
              <div className="space-y-3 px-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs text-muted-foreground">
                    {t('search.matches', { count: conversationResults.totalMatches })}
                  </p>
                  {isSearching && searchProgress && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary" />
                      <p className="text-[10px] text-muted-foreground/60">
                        {searchProgress.scannedProjects}/{searchProgress.totalProjects}
                      </p>
                    </div>
                  )}
                </div>
                {isSearching && searchProgress && (
                  <div className="mx-1 h-0.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/60 transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          (searchProgress.scannedProjects / searchProgress.totalProjects) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                )}
                {conversationResults.results.map((projectResult) => (
                  <div key={projectResult.projectName} className="space-y-1">
                    {projectResult.sessions.map((session) => (
                      <button
                        key={`${projectResult.projectName}-${session.sessionId}`}
                        className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
                        onClick={() => onConversationResultClick(
                          projectResult.projectName,
                          session.sessionId,
                          session.provider || session.matches[0]?.provider || 'claude',
                          session.matches[0]?.timestamp,
                          session.matches[0]?.snippet,
                        )}
                      >
                        <div className="mb-1 flex items-center gap-1.5">
                          <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
                          <span className="truncate text-xs font-medium text-foreground">
                            {session.sessionSummary}
                          </span>
                          {session.provider && session.provider !== 'claude' && (
                            <span className="flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                              {session.provider}
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 pl-4">
                          {session.matches.map((match, idx) => (
                            <div key={idx} className="flex items-start gap-1">
                              <span className="mt-0.5 flex-shrink-0 text-[10px] font-medium uppercase text-muted-foreground/60">
                                {match.role === 'user' ? 'U' : 'A'}
                              </span>
                              <HighlightedSnippet
                                snippet={match.snippet}
                                highlights={match.highlights}
                              />
                            </div>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null
          ) : conversationItems.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">暂无独立对话</h3>
              <p className="text-sm text-muted-foreground">新建对话后会显示在这里</p>
            </div>
          ) : (
            <div className="space-y-1 px-2">
              {conversationItems.map(({ session, sessionView }) => (
                <div
                  key={`${conversationProject?.name || 'conversation'}-${session.__provider}-${session.id}`}
                  className="group relative"
                >
                  <button
                    type="button"
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/55 ${
                      selectedConversationSession?.id === session.id ? 'bg-accent/65' : ''
                    } ${session.isArchived ? 'opacity-60' : ''}`}
                    onClick={() => onConversationSessionSelect(session)}
                  >
                    <div className="flex items-start gap-2">
                      <SessionProviderLogo provider={session.__provider} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 break-words text-xs font-medium leading-4 text-foreground">{sessionView.sessionName}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="truncate">独立对话</span>
                          {sessionView.messageCount > 0 && (
                            <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px]">
                              {sessionView.messageCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                  {session.__provider !== 'cursor' && (
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/95 p-0.5 opacity-0 shadow-sm transition focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        title="重命名"
                        aria-label="重命名"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRenameConversationSession(session, sessionView.sessionName);
                        }}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        title={session.isPinned ? '取消置顶' : '置顶'}
                        aria-label={session.isPinned ? '取消置顶' : '置顶'}
                        onClick={(event) => {
                          event.stopPropagation();
                          onTogglePinConversationSession(session);
                        }}
                      >
                        {session.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        title={session.isArchived ? '恢复会话' : '归档会话'}
                        aria-label={session.isArchived ? '恢复会话' : '归档会话'}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleArchiveConversationSession(session);
                        }}
                      >
                        {session.isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        title={t('actions.delete')}
                        aria-label={t('actions.delete')}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteConversationSession(session, sessionView.sessionName);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <SidebarProjectList {...projectListProps} />
        )}
      </ScrollArea>

      <SidebarFooter
        updateAvailable={updateAvailable}
        releaseInfo={releaseInfo}
        latestVersion={latestVersion}
        currentVersion={currentVersion}
        onShowVersionModal={onShowVersionModal}
        onShowSettings={onShowSettings}
        activeTab={activeTab}
        onShowAgents={onShowAgents}
        t={t}
      />
    </div>
  );
}
