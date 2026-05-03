import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';

export type ProjectSortOrder = 'name' | 'date';
export type WorkspaceMode = 'projects' | 'conversations';

export type SessionWithProvider = ProjectSession & {
  __provider: LLMProvider;
};

export type AdditionalSessionsByProject = Record<string, ProjectSession[]>;
export type LoadingSessionsByProject = Record<string, boolean>;

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

export type SessionDeleteConfirmation = {
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  provider: LLMProvider;
  isConversation?: boolean;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  workspaceMode: WorkspaceMode;
  conversationProject: Project | null;
  selectedConversationSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  onConversationSessionSelect: (session: ProjectSession) => void;
  onNewConversation: () => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
};

export type SessionViewModel = {
  isCursorSession: boolean;
  isCodexSession: boolean;
  isGeminiSession: boolean;
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};

export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

export type SettingsProject = Pick<Project, 'name' | 'displayName' | 'fullPath' | 'path'>;
