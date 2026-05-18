import type { Dispatch, SetStateAction } from 'react';

import type { LLMProvider } from '../../../types/app';

export type SettingsMainTab = 'agents' | 'appearance' | 'runtime' | 'debug';
export type AgentProvider = LLMProvider;
export type AgentCategory = 'model' | 'small-model' | 'permissions' | 'mcp' | 'marketplace' | 'repository' | 'usage';
export type ProjectSortOrder = 'name' | 'date';
export type SaveStatus = 'success' | 'error' | null;
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';
export type GeminiPermissionMode = 'default' | 'auto_edit' | 'yolo';

export type SettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

export type ClaudePermissionsState = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
};

export type NotificationPreferencesState = {
  channels: {
    inApp: boolean;
    webPush: boolean;
  };
  events: {
    actionRequired: boolean;
    stop: boolean;
    error: boolean;
  };
};

export type CursorPermissionsState = {
  allowedCommands: string[];
  disallowedCommands: string[];
  skipPermissions: boolean;
};

export type CodeEditorSettingsState = {
  theme: 'dark' | 'light';
  wordWrap: boolean;
  showMinimap: boolean;
  lineNumbers: boolean;
  fontSize: string;
};

export type ArgusDebugSettings = {
  showPromptInjectionPanel: boolean;
};

export type SettingsStoragePayload = {
  claude: ClaudePermissionsState & { projectSortOrder: ProjectSortOrder; lastUpdated: string };
  cursor: CursorPermissionsState & { lastUpdated: string };
  codex: { permissionMode: CodexPermissionMode; lastUpdated: string };
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  selectedProject?: SettingsProject | null;
  initialTab?: string;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;
