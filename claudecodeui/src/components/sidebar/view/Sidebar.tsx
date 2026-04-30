import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import type { Project, LLMProvider } from '../../../types/app';
import type { MCPServerStatus, SessionWithProvider, SidebarProps } from '../types/types';

import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';
import ConversationGuideModal from './subcomponents/ConversationGuideModal';
import WorktreeDispatchModal from './subcomponents/WorktreeDispatchModal';
import WorktreeTasksModal from './subcomponents/WorktreeTasksModal';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  workspaceMode,
  conversationProject,
  selectedConversationSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onWorkspaceModeChange,
  onConversationSessionSelect,
  onNewConversation,
  onSessionDelete,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  activeTab,
  onShowAgents,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject, mcpServerStatus } = useTaskMaster() as TaskMasterSidebarContext;
  const { tasksEnabled } = useTasksSettings();
  const [worktreeDispatchSource, setWorktreeDispatchSource] = useState<{
    project: Project;
    session: SessionWithProvider;
  } | null>(null);
  const [worktreeTasksProject, setWorktreeTasksProject] = useState<Project | null>(null);
  const [conversationGuideSource, setConversationGuideSource] = useState<{
    project: Project;
    session: SessionWithProvider;
  } | null>(null);
  const {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    currentTime,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    loadMoreSessions,
    handleProjectSelect,
    refreshProjects,
    updateSessionSummary,
    togglePinSession,
    toggleArchiveSession,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    workspaceMode,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  const getConversationSessions = (project: Project | null): SessionWithProvider[] => {
    if (!project) {
      return [];
    }
    return [
      ...(project.sessions ?? []).map((session) => ({ ...session, __provider: (session.__provider || 'claude') as LLMProvider })),
      ...(project.codexSessions ?? []).map((session) => ({ ...session, __provider: (session.__provider || 'codex') as LLMProvider })),
      ...(project.cursorSessions ?? []).map((session) => ({ ...session, __provider: (session.__provider || 'cursor') as LLMProvider })),
      ...(project.geminiSessions ?? []).map((session) => ({ ...session, __provider: (session.__provider || 'gemini') as LLMProvider })),
    ].sort((left, right) => {
      const leftTime = new Date(left.lastActivity || left.updated_at || left.created_at || 0).getTime();
      const rightTime = new Date(right.lastActivity || right.updated_at || right.created_at || 0).getTime();
      return rightTime - leftTime;
    });
  };

  const conversationSessions = getConversationSessions(conversationProject);
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const handleProjectCreated = () => {
    if (window.refreshProjects) {
      void window.refreshProjects();
      return;
    }

    window.location.reload();
  };

  const handleWorktreeCreated = (
    createdProject: Project,
    options: {
      worktree?: NonNullable<Project['worktree']> | null;
      sourceSession?: SessionWithProvider | null;
      createNewSession: boolean;
    },
  ) => {
    setWorktreeDispatchSource(null);
    void Promise.resolve(onRefresh()).finally(() => {
      onProjectSelect(createdProject);
      if (options.sourceSession && options.worktree?.sessionId) {
        onSessionSelect({
          ...options.sourceSession,
          id: options.worktree.sessionId,
          __provider: options.worktree.provider || options.sourceSession.__provider || 'claude',
          __projectName: createdProject.name,
        });
        return;
      }
      if (options.createNewSession) {
        onNewSession(createdProject);
      }
    });
  };

  const handleOpenWorktree = (worktree: NonNullable<Project['worktree']>, openSession = false) => {
    setWorktreeTasksProject(null);
    const targetProject = projects.find((project) => project.name === worktree.projectName) || {
      name: worktree.projectName || worktree.id,
      displayName: worktree.displayName || worktree.projectName || worktree.id,
      fullPath: worktree.worktreePath,
      path: worktree.worktreePath,
      worktree,
    };
    onProjectSelect(targetProject);
    if (openSession && worktree.sessionId) {
      onSessionSelect({
        id: worktree.sessionId,
        title: worktree.displayName || worktree.taskPrompt || worktree.id,
        summary: worktree.displayName || worktree.taskPrompt || worktree.id,
        __provider: worktree.provider || 'claude',
        __projectName: targetProject.name,
      });
    }
  };

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    selectedProject,
    selectedSession,
    isLoading,
    loadingProgress,
    expandedProjects,
    editingProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    currentTime,
    editingSession,
    editingSessionName,
    deletingProjects,
    tasksEnabled,
    mcpServerStatus,
    getProjectSessions,
    isProjectStarred,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarProject,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    onShowWorktreeTasks: setWorktreeTasksProject,
    onDispatchSessionWorktree: (project, session) => setWorktreeDispatchSource({ project, session }),
    onSessionSelect: handleSessionClick,
    onDeleteSession: showDeleteSessionConfirmation,
    onLoadMoreSessions: (project) => {
      void loadMoreSessions(project);
    },
    onNewSession,
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    onTogglePinSession: togglePinSession,
    onToggleArchiveSession: toggleArchiveSession,
    onOpenConversationGuide: (project, session) => setConversationGuideSource({ project, session }),
    t,
  };

  return (
    <>
      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
        t={t}
      />

      {isSidebarCollapsed ? (
        <SidebarCollapsed
          onExpand={handleExpandSidebar}
          onShowSettings={onShowSettings}
          activeTab={activeTab}
          onShowAgents={onShowAgents}
          updateAvailable={updateAvailable}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />
      ) : (
        <>
          <SidebarContent
            isPWA={isPWA}
            isMobile={isMobile}
            isLoading={isLoading}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            onClearSearchFilter={() => setSearchFilter('')}
            searchMode={searchMode}
            onSearchModeChange={(mode: 'projects' | 'conversations') => {
              setSearchMode(mode);
              setSearchFilter('');
              onWorkspaceModeChange(mode);
              if (mode === 'projects') clearConversationResults();
            }}
            conversationProject={conversationProject}
            conversationSessions={conversationSessions}
            selectedConversationSession={selectedConversationSession}
            onConversationSessionSelect={onConversationSessionSelect}
            onRenameConversationSession={(session, currentName) => {
              const nextName = window.prompt('重命名会话', currentName);
              if (!nextName || !nextName.trim()) return;
              void updateSessionSummary(
                conversationProject?.name || '',
                session.id,
                nextName.trim(),
                session.__provider,
              );
            }}
            onDeleteConversationSession={(session, sessionTitle) => {
              showDeleteSessionConfirmation(
                conversationProject?.name || '',
                session.id,
                sessionTitle,
                session.__provider,
                true,
              );
            }}
            onTogglePinConversationSession={togglePinSession}
            onToggleArchiveConversationSession={toggleArchiveSession}
            conversationResults={conversationResults}
            isSearching={isSearching}
            searchProgress={searchProgress}
            onConversationResultClick={(projectName: string, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => {
              const resolvedProvider = (provider || 'claude') as LLMProvider;
              const searchTarget = { __searchTargetTimestamp: messageTimestamp || null, __searchTargetSnippet: messageSnippet || null };
              const sessionObj = {
                id: sessionId,
                __provider: resolvedProvider,
                __projectName: projectName,
                ...searchTarget,
              };
              const existing = conversationSessions.find(session => session.id === sessionId);
              if (existing) {
                onConversationSessionSelect({ ...existing, ...searchTarget });
              } else {
                onConversationSessionSelect(sessionObj);
              }
            }}
            onRefresh={() => {
              void refreshProjects();
            }}
            isRefreshing={isRefreshing}
            onCreateProject={() => {
              if (searchMode === 'conversations') {
                onNewConversation();
                return;
              }
              setShowNewProject(true);
            }}
            onCollapseSidebar={handleCollapseSidebar}
            updateAvailable={updateAvailable}
            releaseInfo={releaseInfo}
            latestVersion={latestVersion}
            currentVersion={currentVersion}
            onShowVersionModal={() => setShowVersionModal(true)}
            onShowSettings={onShowSettings}
            activeTab={activeTab}
            onShowAgents={onShowAgents}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

      {worktreeDispatchSource && (
        <WorktreeDispatchModal
          project={worktreeDispatchSource.project}
          sourceSession={worktreeDispatchSource.session}
          onClose={() => setWorktreeDispatchSource(null)}
          onCreated={handleWorktreeCreated}
        />
      )}

      {conversationGuideSource && (
        <ConversationGuideModal
          sourceProject={conversationGuideSource.project}
          sourceSession={conversationGuideSource.session}
          conversationSessions={conversationSessions}
          onClose={() => setConversationGuideSource(null)}
          onStartNewConversation={onNewConversation}
          onAppendToConversation={onConversationSessionSelect}
        />
      )}

      {worktreeTasksProject && (
        <WorktreeTasksModal
          project={worktreeTasksProject}
          onClose={() => setWorktreeTasksProject(null)}
          onOpenWorktree={handleOpenWorktree}
          onRefreshProjects={onRefresh}
        />
      )}
    </>
  );
}

export default Sidebar;
