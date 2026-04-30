import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { api } from '../utils/api';
import type {
  AppSocketMessage,
  AppTab,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
} from '../types/app';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster) ||
      serialize(nextProject.worktree) !== serialize(prevProject.worktree);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.cursorSessions) !== serialize(prevProject.cursorSessions) ||
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.geminiSessions) !== serialize(prevProject.geminiSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

const getProjectSessionsWithProviders = (project: Project): ProjectSession[] => [
  ...(project.sessions ?? []).map((session) => ({ ...session, __provider: session.__provider || 'claude' })),
  ...(project.codexSessions ?? []).map((session) => ({ ...session, __provider: session.__provider || 'codex' })),
  ...(project.cursorSessions ?? []).map((session) => ({ ...session, __provider: session.__provider || 'cursor' })),
  ...(project.geminiSessions ?? []).map((session) => ({ ...session, __provider: session.__provider || 'gemini' })),
];

type WorkspaceMode = 'projects' | 'conversations';

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'preview', 'agents']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('projects');
  const [conversationProject, setConversationProject] = useState<Project | null>(null);
  const [selectedConversationSession, setSelectedConversationSession] = useState<ProjectSession | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  const [quickStartAgentId, setQuickStartAgentId] = useState('');
  const [quickStartAgentRequestId, setQuickStartAgentRequestId] = useState(0);
  const [newConversationRequestId, setNewConversationRequestId] = useState(0);
  const [newProjectSessionRequestId, setNewProjectSessionRequestId] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeSessionModeSwitchRef = useRef(false);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}) => {
    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      const projectData = await response.json();
      if (!response.ok || !Array.isArray(projectData)) {
        throw new Error(
          typeof projectData?.error === 'string'
            ? projectData.error
            : `Failed to load projects: HTTP ${response.status}`,
        );
      }

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      if (showLoadingState) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  const fetchConversationProject = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const response = await api.conversations();
      const data = (await response.json()) as { project?: Project };
      if (!response.ok || !data.project) {
        throw new Error('Failed to load conversations');
      }
      setConversationProject((previous) => (
        serialize(previous) === serialize(data.project) ? previous : data.project || null
      ));
      return data.project;
    } catch (error) {
      console.error('Error fetching standalone conversations:', error);
      return null;
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    await Promise.all([
      fetchProjects({ showLoadingState: false }),
      fetchConversationProject(),
    ]);
  }, [fetchConversationProject, fetchProjects]);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
    void fetchConversationProject();
  }, [fetchConversationProject, fetchProjects]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (workspaceMode === 'projects' && !isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId, workspaceMode]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    const projectsMessage = latestMessage as ProjectsUpdatedMessage;
    void fetchConversationProject();

    if (projectsMessage.changedFile && selectedSession && selectedProject) {
      const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 2) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = filename.replace('.jsonl', '');

        if (changedSessionId === selectedSession.id) {
          const isSessionActive = activeSessions.has(selectedSession.id);

          if (!isSessionActive) {
            setExternalMessageUpdate((prev) => prev + 1);
          }
        }
      }
    }

    const hasActiveSession =
      (selectedSession && activeSessions.has(selectedSession.id)) ||
      (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

    const updatedProjects = projectsMessage.projects;

    if (
      hasActiveSession &&
      !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
    ) {
      return;
    }

    setProjects(updatedProjects);

    if (!selectedProject) {
      return;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === selectedProject.name,
    );

    if (!updatedSelectedProject) {
      return;
    }

    if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
      setSelectedProject(updatedSelectedProject);
    }

    if (!selectedSession) {
      return;
    }

    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => session.id === selectedSession.id,
    );

    if (!updatedSelectedSession) {
      setSelectedSession(null);
    }
  }, [fetchConversationProject, latestMessage, selectedProject, selectedSession, activeSessions, projects]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId) {
      routeSessionModeSwitchRef.current = false;
      return;
    }
    if (routeSessionModeSwitchRef.current) {
      return;
    }

    for (const project of projects) {
      const claudeSession = project.sessions?.find((session) => session.id === sessionId);
      if (claudeSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'claude';

        setWorkspaceMode('projects');
        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...claudeSession, __provider: 'claude' });
        }
        return;
      }

      const cursorSession = project.cursorSessions?.find((session) => session.id === sessionId);
      if (cursorSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'cursor';

        setWorkspaceMode('projects');
        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...cursorSession, __provider: 'cursor' });
        }
        return;
      }

      const codexSession = project.codexSessions?.find((session) => session.id === sessionId);
      if (codexSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'codex';

        setWorkspaceMode('projects');
        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...codexSession, __provider: 'codex' });
        }
        return;
      }

      const geminiSession = project.geminiSessions?.find((session) => session.id === sessionId);
      if (geminiSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'gemini';

        setWorkspaceMode('projects');
        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...geminiSession, __provider: 'gemini' });
        }
        return;
      }
    }

    if (conversationProject) {
      const conversationSession = getProjectSessionsWithProviders(conversationProject)
        .find((session) => session.id === sessionId);

      if (conversationSession) {
        setWorkspaceMode('conversations');
        if (selectedConversationSession?.id !== sessionId) {
          setSelectedConversationSession(conversationSession);
        }
        if (activeTab !== 'chat') {
          setActiveTab('chat');
        }
      }
    }
  }, [
    activeTab,
    conversationProject,
    projects,
    selectedConversationSession?.id,
    selectedProject?.name,
    selectedSession?.__provider,
    selectedSession?.id,
    sessionId,
  ]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      const worktreeSession = project.worktree?.sessionId
        ? getProjectSessionsWithProviders(project).find((session) => session.id === project.worktree?.sessionId)
          || {
            id: project.worktree.sessionId,
            title: project.worktree.displayName || project.worktree.taskPrompt || project.worktree.id,
            summary: project.worktree.displayName || project.worktree.taskPrompt || project.worktree.id,
            __provider: project.worktree.provider || 'claude',
            __projectName: project.name,
          }
        : null;

      setWorkspaceMode('projects');
      setSelectedProject(project);
      setSelectedSession(worktreeSession || null);
      setSelectedConversationSession(null);
      if (activeTab === 'agents') {
        setActiveTab('chat');
      }
      navigate(worktreeSession ? `/session/${worktreeSession.id}` : '/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [activeTab, isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setWorkspaceMode('projects');
      setSelectedSession(session);
      setSelectedConversationSession(null);

      if (activeTab === 'tasks' || activeTab === 'preview' || activeTab === 'agents') {
        setActiveTab('chat');
      }

      const provider = localStorage.getItem('selected-provider') || 'claude';
      if (provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setWorkspaceMode('projects');
      setSelectedProject(project);
      setSelectedSession(null);
      setSelectedConversationSession(null);
      setActiveTab('chat');
      setNewProjectSessionRequestId((previous) => previous + 1);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleShowAgents = useCallback(() => {
    setActiveTab('agents');
    setSelectedSession(null);
    setSelectedConversationSession(null);
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleWorkspaceModeChange = useCallback(
    (mode: WorkspaceMode) => {
      routeSessionModeSwitchRef.current = true;
      setWorkspaceMode(mode);
      if (mode === 'conversations') {
        setSelectedSession(null);
        if (activeTab !== 'chat' && activeTab !== 'agents') {
          setActiveTab('chat');
        }
        void fetchConversationProject();
      } else {
        setSelectedConversationSession(null);
      }
      navigate('/');
    },
    [activeTab, fetchConversationProject, navigate],
  );

  const handleConversationSessionSelect = useCallback(
    (session: ProjectSession) => {
      setWorkspaceMode('conversations');
      setSelectedSession(null);
      setSelectedConversationSession(session);
      setActiveTab('chat');

      const provider = session.__provider || localStorage.getItem('selected-provider') || 'claude';
      if (provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      if (isMobile) {
        setSidebarOpen(false);
      }

      navigate(`/session/${session.id}`);
    },
    [isMobile, navigate],
  );

  const handleNewConversation = useCallback(() => {
    routeSessionModeSwitchRef.current = true;
    setWorkspaceMode('conversations');
    setSelectedSession(null);
    setSelectedConversationSession(null);
    setActiveTab('chat');
    setQuickStartAgentId('');
    setNewConversationRequestId((previous) => previous + 1);
    void fetchConversationProject();
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [fetchConversationProject, isMobile, navigate]);

  const handleQuickStartAgent = useCallback(
    (agentId: string) => {
      if (!agentId) {
        return;
      }

      routeSessionModeSwitchRef.current = true;
      setWorkspaceMode('conversations');
      setSelectedSession(null);
      setSelectedConversationSession(null);
      setActiveTab('chat');
      setQuickStartAgentId(agentId);
      setQuickStartAgentRequestId((previous) => previous + 1);
      void fetchConversationProject();
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [fetchConversationProject, isMobile, navigate],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }
      if (selectedConversationSession?.id === sessionIdToDelete) {
        setSelectedConversationSession(null);
        navigate('/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
      setConversationProject((previous) => (
        previous
          ? {
            ...previous,
            sessions: previous.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
            codexSessions: previous.codexSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
            cursorSessions: previous.cursorSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
            geminiSessions: previous.geminiSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          }
          : previous
      ));
    },
    [navigate, selectedConversationSession?.id, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      await fetchConversationProject();
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [fetchConversationProject, selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const mainSelectedProject = workspaceMode === 'conversations' ? conversationProject : selectedProject;
  const mainSelectedSession = workspaceMode === 'conversations' ? selectedConversationSession : selectedSession;
  const isMainLoading = isLoadingProjects || (workspaceMode === 'conversations' && isLoadingConversations && !conversationProject);

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      workspaceMode,
      conversationProject,
      selectedConversationSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onWorkspaceModeChange: handleWorkspaceModeChange,
      onConversationSessionSelect: handleConversationSessionSelect,
      onNewConversation: handleNewConversation,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      activeTab,
      onShowAgents: handleShowAgents,
      onQuickStartAgent: handleQuickStartAgent,
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleShowAgents,
      handleQuickStartAgent,
      handleConversationSessionSelect,
      handleNewConversation,
      handleSidebarRefresh,
      handleWorkspaceModeChange,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      conversationProject,
      settingsInitialTab,
      activeTab,
      workspaceMode,
      selectedProject,
      selectedConversationSession,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject: mainSelectedProject,
    selectedSession: mainSelectedSession,
    projectSelectedProject: selectedProject,
    projectSelectedSession: selectedSession,
    conversationProject,
    selectedConversationSession,
    workspaceMode,
    isConversationSpace: workspaceMode === 'conversations',
    quickStartAgentId,
    quickStartAgentRequestId,
    newConversationRequestId,
    newProjectSessionRequestId,
    activeTab,
    sidebarOpen,
    isLoadingProjects: isMainLoading,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
