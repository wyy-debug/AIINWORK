import { Check, MoreHorizontal, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { memo, useMemo, useState, type MouseEvent } from 'react';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { api } from '../../../../utils/api';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';

import SessionContextMenu from './SessionContextMenu';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onTogglePinSession: (session: SessionWithProvider) => void;
  onToggleArchiveSession: (session: SessionWithProvider) => void;
  onToggleUnreadSession: (session: SessionWithProvider) => void;
  onOpenConversationGuide: (project: Project, session: SessionWithProvider) => void;
  onDispatchSessionWorktree: (project: Project, session: SessionWithProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  t: TFunction;
};

function SidebarSessionItem({
  project,
  session,
  selectedSession,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onTogglePinSession,
  onToggleArchiveSession,
  onToggleUnreadSession,
  onOpenConversationGuide,
  onDispatchSessionWorktree,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = useMemo(
    () => createSessionViewModel(session, currentTime, t),
    [currentTime, session, t],
  );
  const isSelected = selectedSession?.id === session.id;
  const isPinned = Boolean(session.isPinned);
  const isArchived = Boolean(session.isArchived);
  const isUnread = Boolean(session.isUnread);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const projectPath = String(project.fullPath || project.path || '');

  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.name);
  };

  const selectLocalSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.name);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.name, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.name, session.id, sessionView.sessionName, session.__provider);
  };

  const openContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const openProjectDirectory = async () => {
    if (!projectPath) return;
    const response = await api.openLocalPath({ filePath: projectPath, projectName: project.name });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data?.error || '无法在资源管理器中打开工作目录');
    }
  };

  const copyProjectDirectory = () => {
    void copyTextToClipboard(projectPath);
  };

  const copySessionId = () => {
    void copyTextToClipboard(session.id);
  };

  const copyDeepLink = () => {
    const url = new URL(`/session/${encodeURIComponent(session.id)}`, window.location.href);
    void copyTextToClipboard(url.toString());
  };

  const openMiniWindow = () => {
    const url = `/session/${encodeURIComponent(session.id)}?mini=1`;
    const popup = window.open(url, `mtl-session-${session.id}`, 'popup,width=980,height=760');
    if (popup) {
      popup.opener = null;
    }
  };

  return (
    <div className="group relative [contain-intrinsic-size:1px_48px] [content-visibility:auto]" onContextMenu={openContextMenu}>
      {sessionView.isActive && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'relative mx-3 my-0.5 rounded-lg px-3 py-2 active:scale-[0.98] transition-all duration-150',
            isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
            isArchived && 'opacity-60',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                <div className="truncate text-sm font-medium text-foreground">{sessionView.sessionName}</div>
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
            </span>

            <button
              type="button"
              className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95"
              onClick={openContextMenu}
              aria-label="打开对话菜单"
              title="打开对话菜单"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'h-8 w-full justify-start rounded-lg px-3 py-1.5 pr-12 font-normal text-left hover:bg-accent/55 transition-colors duration-150',
            isSelected && 'bg-accent text-accent-foreground',
            isArchived && 'opacity-60',
          )}
          onClick={selectLocalSession}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
              <div className="truncate text-sm font-medium leading-5 text-foreground">{sessionView.sessionName}</div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
            </span>
          </div>
        </Button>

        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 transform items-center gap-1 opacity-0 transition-all duration-200 focus-within:opacity-100 group-hover:opacity-100">
            {editingSession === session.id ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                </button>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:bg-muted hover:text-foreground"
                onClick={openContextMenu}
                title="打开对话菜单"
                aria-label="打开对话菜单"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          </div>
      </div>
      {contextMenuPosition && (
        <SessionContextMenu
          position={contextMenuPosition}
          isPinned={isPinned}
          isArchived={isArchived}
          isUnread={isUnread}
          canOpenWorkdir={Boolean(projectPath)}
          canDispatchLocal
          canDispatchWorktree={!project.worktree}
          onClose={() => setContextMenuPosition(null)}
          onRename={() => onStartEditingSession(session.id, sessionView.sessionName)}
          onTogglePin={() => onTogglePinSession(session)}
          onToggleArchive={() => onToggleArchiveSession(session)}
          onToggleUnread={() => onToggleUnreadSession(session)}
          onOpenWorkdir={() => { void openProjectDirectory(); }}
          onCopyWorkdir={copyProjectDirectory}
          onCopySessionId={copySessionId}
          onCopyDeepLink={copyDeepLink}
          onOpenConversationGuide={() => onOpenConversationGuide(project, session)}
          onDispatchLocal={selectLocalSession}
          onDispatchWorktree={() => onDispatchSessionWorktree(project, session)}
          onOpenMiniWindow={openMiniWindow}
          onDelete={requestDeleteSession}
        />
      )}
    </div>
  );
}

export default memo(SidebarSessionItem);
