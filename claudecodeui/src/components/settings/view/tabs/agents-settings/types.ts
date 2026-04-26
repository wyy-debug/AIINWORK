import type {
  AgentProvider,
  AgentCategory,
  ClaudePermissionsState,
  CursorPermissionsState,
  CodexPermissionMode,
  GeminiPermissionMode,
  SettingsProject,
} from '../../../types/types';

export type AgentsSettingsTabProps = {
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  geminiPermissionMode: GeminiPermissionMode;
  onGeminiPermissionModeChange: (value: GeminiPermissionMode) => void;
  projects: SettingsProject[];
};

export type AgentCategoryTabsSectionProps = {
  selectedCategory: AgentCategory;
  onSelectCategory: (category: AgentCategory) => void;
};

export type AgentSelectorSectionProps = {
  agents: AgentProvider[];
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
};

export type AgentCategoryContentSectionProps = {
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  geminiPermissionMode: GeminiPermissionMode;
  onGeminiPermissionModeChange: (value: GeminiPermissionMode) => void;
  projects: SettingsProject[];
};
