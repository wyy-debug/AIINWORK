export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'gemini';

export type AppTab =
  | 'chat'
  | 'review'
  | 'shell'
  | 'files'
  | 'actions'
  | 'automations'
  | 'browser'
  | 'artifacts'
  | 'subagents'
  | 'tasks'
  | 'preview'
  | 'agents'
  | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  isPinned?: boolean;
  pinnedAt?: string | null;
  isArchived?: boolean;
  archivedAt?: string | null;
  isUnread?: boolean;
  unreadAt?: string | null;
  __provider?: LLMProvider;
  __projectName?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorktreeDispatchMeta {
  id: string;
  projectName?: string;
  sessionId?: string | null;
  provider?: LLMProvider;
  parentProjectName: string;
  parentProjectPath: string;
  worktreePath: string;
  baseRef: string;
  baseCommit: string;
  mode: 'managed' | 'permanent';
  status: 'created' | 'running' | 'done' | 'failed' | 'archived';
  agentId?: string;
  skills?: string[];
  appBindings?: Array<{ slot: string; app: string; status: string }>;
  taskPrompt?: string;
  displayName?: string;
  branchName?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  worktree?: WorktreeDispatchMeta;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | { type?: string;[key: string]: unknown };
