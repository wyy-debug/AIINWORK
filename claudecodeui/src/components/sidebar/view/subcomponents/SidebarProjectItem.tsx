import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ClipboardList, Edit3, Folder, FolderOpen, GitBranch, Loader2, SquarePen, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import { getTaskIndicatorStatus } from '../../utils/utils';
import { apiFetch } from '../../../../utils/api';

import TaskIndicator from './TaskIndicator';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onShowWorktreeTasks: (project: Project) => void;
  onDispatchSessionWorktree: (project: Project, session: SessionWithProvider) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onTogglePinSession: (session: SessionWithProvider) => void;
  onToggleArchiveSession: (session: SessionWithProvider) => void;
  onToggleUnreadSession: (session: SessionWithProvider) => void;
  onOpenConversationGuide: (project: Project, session: SessionWithProvider) => void;
  t: TFunction;
};

const getSessionCountDisplay = (sessions: SessionWithProvider[], hasMoreSessions: boolean): string => {
  const sessionCount = sessions.length;
  if (hasMoreSessions && sessionCount >= 5) {
    return `${sessionCount}+`;
  }

  return `${sessionCount}`;
};

type CodeGraphBuildStatus = {
  state?: string;
  progress?: {
    stage?: string;
    percent?: number;
    label?: string;
  };
  lastError?: string;
  lastExport?: {
    documents?: number;
    written?: number;
    skippedUnchanged?: number;
  };
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onShowWorktreeTasks,
  onDispatchSessionWorktree,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onTogglePinSession,
  onToggleArchiveSession,
  onToggleUnreadSession,
  onOpenConversationGuide,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.name === project.name;
  const isEditing = editingProject === project.name;
  const hasMoreSessions = project.sessionMeta?.hasMore === true;
  const sessionCountDisplay = getSessionCountDisplay(sessions, hasMoreSessions);
  const sessionCountLabel = `${sessionCountDisplay} session${sessions.length === 1 ? '' : 's'}`;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  const canDispatchWorktree = !project.worktree;
  const [isBuildingCodeGraph, setIsBuildingCodeGraph] = useState(false);
  const [codeGraphBuildStatus, setCodeGraphBuildStatus] = useState<CodeGraphBuildStatus | null>(null);
  const codeGraphPollTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const projectRoot = project.fullPath || project.path || '';
  const codeGraphProgressPercent = Math.max(
    0,
    Math.min(100, Math.round(Number(codeGraphBuildStatus?.progress?.percent) || 0)),
  );
  const codeGraphProgressLabel = codeGraphBuildStatus?.progress?.label
    || (codeGraphBuildStatus?.state === 'queued' ? 'CodeGraph 已排队'
      : codeGraphBuildStatus?.state === 'syncing' ? '正在检查整个项目'
        : codeGraphBuildStatus?.state === 'success' ? 'CodeGraph 已写入 Obsidian'
          : codeGraphBuildStatus?.state === 'error' ? codeGraphBuildStatus.lastError || 'CodeGraph 构建失败'
            : '');
  const showCodeGraphProgress = codeGraphBuildStatus !== null && (
    isBuildingCodeGraph
    || codeGraphBuildStatus.state === 'queued'
    || codeGraphBuildStatus.state === 'syncing'
    || codeGraphBuildStatus.state === 'success'
    || codeGraphBuildStatus.state === 'error'
  );

  useEffect(() => () => {
    mountedRef.current = false;
    codeGraphPollTokenRef.current += 1;
  }, []);

  const toggleProject = () => onToggleProject(project.name);
  const toggleStarProject = () => onToggleStarProject(project.name);

  const saveProjectName = () => {
    onSaveProjectName(project.name);
  };

  const readCodeGraphStatus = async (): Promise<CodeGraphBuildStatus | null> => {
    const params = new URLSearchParams({
      projectName: project.name,
    });
    if (projectRoot) params.set('projectRoot', projectRoot);
    const response = await apiFetch(`/api/codegraph/status?${params.toString()}`);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    return payload?.status || null;
  };

  const pollCodeGraphStatus = async (token: number) => {
    let sawActiveState = false;
    for (let attempt = 0; attempt < 720; attempt += 1) {
      if (!mountedRef.current || codeGraphPollTokenRef.current !== token) return;
      const status = await readCodeGraphStatus().catch(() => null);
      if (status && mountedRef.current && codeGraphPollTokenRef.current === token) {
        setCodeGraphBuildStatus(status);
        sawActiveState = sawActiveState || status.state === 'queued' || status.state === 'syncing';
        if (status.state === 'success' || status.state === 'error' || (sawActiveState && status.state === 'idle')) {
          setIsBuildingCodeGraph(false);
          return;
        }
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, attempt < 8 ? 800 : 1500);
      });
    }
    if (mountedRef.current && codeGraphPollTokenRef.current === token) {
      setIsBuildingCodeGraph(false);
    }
  };

  const selectCodeGraphScopePaths = async (): Promise<string[] | null> => {
    const selectCodeGraphScope = window.argusDesktop?.selectCodeGraphScope;
    if (!selectCodeGraphScope) {
      throw new Error('当前环境不支持 Windows 原生脚本选择窗口，请使用桌面版 Argus。');
    }
    const result = await selectCodeGraphScope({
      title: '选择要构建 CodeGraph 的 C# 脚本或目录',
      buttonLabel: '构建所选脚本',
      defaultPath: projectRoot || undefined,
    });
    if (result.error) {
      throw new Error(result.error);
    }
    if (result.canceled) {
      return null;
    }
    const selectedPaths = (Array.isArray(result.paths) && result.paths.length > 0
      ? result.paths
      : [result.path || ''])
      .map((entry) => entry.trim())
      .filter(Boolean);
    return selectedPaths.length > 0 ? selectedPaths : null;
  };

  const buildCodeGraphAndImportObsidian = async () => {
    if (isBuildingCodeGraph) return;
    let scopePaths: string[] | null = null;
    try {
      scopePaths = await selectCodeGraphScopePaths();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '打开 Windows 原生脚本选择窗口失败');
      return;
    }
    if (!scopePaths) return;
    const token = codeGraphPollTokenRef.current + 1;
    codeGraphPollTokenRef.current = token;
    setIsBuildingCodeGraph(true);
    setCodeGraphBuildStatus({
      state: 'queued',
      progress: {
        stage: 'queued',
        percent: 5,
        label: `CodeGraph 已排队，准备构建 ${scopePaths.length} 个脚本范围`,
      },
    });
    try {
      const response = await apiFetch('/api/codegraph/build-obsidian', {
        method: 'POST',
        body: JSON.stringify({
          projectName: project.name,
          projectRoot,
          scopePaths,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `CodeGraph build failed with HTTP ${response.status}`);
      }
      void pollCodeGraphStatus(token);
    } catch (error) {
      console.error('[CodeGraph] Failed to queue build/import:', error);
      setCodeGraphBuildStatus({
        state: 'error',
        lastError: error instanceof Error ? error.message : 'CodeGraph 构建失败',
        progress: {
          stage: 'error',
          percent: 100,
          label: error instanceof Error ? error.message : 'CodeGraph 构建失败',
        },
      });
      window.alert(error instanceof Error ? error.message : 'CodeGraph 构建失败');
      setIsBuildingCodeGraph(false);
    }
  };

  const CodeGraphProgress = () => {
    if (!showCodeGraphProgress) return null;
    const isError = codeGraphBuildStatus?.state === 'error';
    const exportStats = codeGraphBuildStatus?.lastExport?.documents
      ? ` · ${codeGraphBuildStatus.lastExport.documents} notes`
      : '';
    return (
      <div className="mx-3 mt-1 rounded-md border border-emerald-500/15 bg-emerald-500/5 px-2 py-1.5 text-[11px] text-muted-foreground md:mx-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={cn('truncate', isError && 'text-red-600 dark:text-red-400')}>
            {codeGraphProgressLabel || 'CodeGraph 处理中'}
            {exportStats}
          </span>
          <span className="tabular-nums">{codeGraphProgressPercent}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-background/80">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isError ? 'bg-red-500' : 'bg-emerald-500',
            )}
            style={{ width: `${codeGraphProgressPercent}%` }}
          />
        </div>
      </div>
    );
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.name !== project.name) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      <div className="md:group group">
        <div className="md:hidden">
          <div
            className={cn(
              'p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              isSelected && 'bg-primary/5 border-primary/20',
              isStarred &&
                !isSelected &&
                'bg-yellow-50/50 dark:bg-yellow-900/5 border-yellow-200/30 dark:border-yellow-800/30',
            )}
            onClick={toggleProject}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                    isExpanded ? 'bg-primary/10' : 'bg-muted',
                  )}
                >
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 text-primary" />
                  ) : (
                    <Folder className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center justify-between">
                        <h3 className="truncate text-sm font-medium text-foreground">{project.displayName}</h3>
                        {tasksEnabled && (
                          <TaskIndicator
                            status={taskStatus}
                            size="xs"
                            className="ml-2 hidden flex-shrink-0 md:inline-flex"
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4 text-white" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onProjectSelect(project);
                        onNewSession(project);
                      }}
                      title={t('sessions.newSession')}
                    >
                      <SquarePen className="h-4 w-4 text-primary" />
                    </button>

                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-500/10 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-900/30"
                      disabled={isBuildingCodeGraph}
                      onClick={(event) => {
                        event.stopPropagation();
                        void buildCodeGraphAndImportObsidian();
                      }}
                      title="构建 CodeGraph 并导入 Obsidian"
                    >
                      {isBuildingCodeGraph ? (
                        <Loader2 className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-300" />
                      ) : (
                        <GitBranch className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                      )}
                    </button>

                    <button
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all duration-150 border',
                        isStarred
                          ? 'bg-yellow-500/10 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'
                          : 'bg-gray-500/10 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800',
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleStarProject();
                      }}
                      title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                    >
                      <Star
                        className={cn(
                          'w-4 h-4 transition-colors',
                          isStarred
                            ? 'text-yellow-600 dark:text-yellow-400 fill-current'
                            : 'text-gray-600 dark:text-gray-400',
                        )}
                      />
                    </button>

                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-500/10 active:scale-90 dark:border-red-800 dark:bg-red-900/30"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteProject(project);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>

                    {canDispatchWorktree && (
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-500/10 active:scale-90 dark:border-slate-800 dark:bg-slate-900/30"
                        onClick={(event) => {
                          event.stopPropagation();
                          onShowWorktreeTasks(project);
                        }}
                        title="工作树任务"
                      >
                        <ClipboardList className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                      </button>
                    )}

                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartEditingProject(project);
                      }}
                    >
                      <Edit3 className="h-4 w-4 text-primary" />
                    </button>

                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          className={cn(
            'hidden md:flex h-9 w-full justify-between rounded-lg px-2 py-1.5 font-normal hover:bg-accent/55',
            isSelected && 'bg-accent text-accent-foreground',
            isStarred &&
              !isSelected &&
              'bg-yellow-50/50 dark:bg-yellow-900/10 hover:bg-yellow-100/50 dark:hover:bg-yellow-900/20',
          )}
          onClick={selectAndToggleProject}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1 text-left">
              {isEditing ? (
                <div className="flex min-w-0 items-center gap-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => onEditingNameChange(event.target.value)}
                    className="h-7 w-full rounded border border-border bg-background px-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        saveProjectName();
                      }
                      if (event.key === 'Escape') {
                        onCancelEditingProject();
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="truncate text-sm font-medium text-foreground" title={project.displayName}>
                  {project.displayName}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="h-3 w-3" />
                </div>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-gray-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="h-3 w-3" />
                </div>
              </>
            ) : (
              <>
                <div
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    onProjectSelect(project);
                    onNewSession(project);
                  }}
                  title={t('sessions.newSession')}
                >
                  <SquarePen className="h-3.5 w-3.5" />
                </div>
                <div
                  className={cn(
                    'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-emerald-600 transition-all duration-150 hover:bg-emerald-500/10 hover:text-emerald-700',
                    isBuildingCodeGraph && 'pointer-events-none opacity-60',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    void buildCodeGraphAndImportObsidian();
                  }}
                  title="构建 CodeGraph 并导入 Obsidian"
                >
                  {isBuildingCodeGraph ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitBranch className="h-3.5 w-3.5" />
                  )}
                </div>
              </>
            )}
          </div>
        </Button>
      </div>

      <CodeGraphProgress />

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        isLoadingSessions={isLoadingSessions}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onTogglePinSession={onTogglePinSession}
        onToggleArchiveSession={onToggleArchiveSession}
        onToggleUnreadSession={onToggleUnreadSession}
        onOpenConversationGuide={onOpenConversationGuide}
        onDispatchSessionWorktree={onDispatchSessionWorktree}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        t={t}
      />
    </div>
  );
}
