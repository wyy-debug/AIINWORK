import type {
  AgentCategory,
  AgentProvider,
  CodeEditorSettingsState,
  CursorPermissionsState,
  ProjectSortOrder,
  SettingsMainTab,
} from '../types/types';

export const SETTINGS_MAIN_TABS: SettingsMainTab[] = [
  'agents',
  'runtime',
  'appearance',
];

export const AGENT_PROVIDERS: AgentProvider[] = ['claude'];
export const AGENT_CATEGORIES: AgentCategory[] = ['model', 'permissions', 'mcp', 'repository', 'usage'];

export const DEFAULT_PROJECT_SORT_ORDER: ProjectSortOrder = 'name';
export const DEFAULT_SAVE_STATUS = null;
export const DEFAULT_CODE_EDITOR_SETTINGS: CodeEditorSettingsState = {
  theme: 'dark',
  wordWrap: false,
  showMinimap: true,
  lineNumbers: true,
  fontSize: '14',
};

export const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};

