export type AgentStatus = 'enabled' | 'draft' | 'paused';

export type AgentScope = 'global' | 'project';

export type AgentAppBindingStatus = 'connected' | 'optional' | 'disabled';

export type AgentChannelType = 'chat' | 'dingtalk' | 'slack' | 'webhook';

export interface AgentChannel {
  id: string;
  type: AgentChannelType;
  name: string;
  description: string;
  enabled: boolean;
}

export interface AgentAppBinding {
  slot: string;
  app: string;
  status: AgentAppBindingStatus;
}

export interface AgentModelConfig {
  provider: string;
  model: string;
  contextWindowTokens: number;
  temperature: number;
}

export interface AgentTriggerRules {
  mode: 'manual' | 'suggest' | 'auto';
  keywords: string[];
  confidenceThreshold: number;
}

export type AgentTemplateDialogFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'number'
  | 'path'
  | 'mcpServer'
  | 'skill'
  | 'modelProfile';

export interface AgentTemplateDialogField {
  id: string;
  label: string;
  type: AgentTemplateDialogFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: string | number | boolean;
  options?: string[];
}

export interface AgentTemplateDialogPreset {
  id: string;
  label: string;
  description?: string;
  answers: Record<string, string | number | boolean | string[]>;
}

export interface AgentTemplateDialogSchema {
  title?: string;
  description?: string;
  fields: AgentTemplateDialogField[];
  presets?: AgentTemplateDialogPreset[];
  defaultPresetId?: string;
}

export interface AgentTemplateDialogs {
  setup?: AgentTemplateDialogSchema;
  launch?: AgentTemplateDialogSchema;
  result?: AgentTemplateDialogSchema;
}

export interface AgentTemplatePackageMetadata {
  packageId?: string;
  packageVersion?: string;
  repoId?: string;
  itemId?: string;
}

export interface AgentTemplateSelectedDependencies {
  skills?: string[];
  mcpServers?: string[];
  modelProfiles?: string[];
}

export interface AgentMemoryConfig {
  enabled: boolean;
  namespace: string;
  privacy: 'private' | 'shared';
  description: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  shortName: string;
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  hidden?: boolean;
  color?: string;
  maxTurns?: number;
  permission?: Record<string, unknown>;
  profileKind?: 'plan' | 'build' | 'explore' | 'review' | 'debug' | 'docs' | '';
  permissionPreset?: 'suggest' | 'auto-edit' | 'full-auto' | 'enterprise-safe' | '';
  modelProfileId?: string;
  defaultSkills?: string[];
  mcpServers?: string[];
  status: AgentStatus;
  scope: AgentScope;
  modelConfig: AgentModelConfig;
  repository: string;
  systemPrompt: string;
  channels: AgentChannel[];
  appBindings: AgentAppBinding[];
  skills: string[];
  memory: AgentMemoryConfig;
  tools: string[];
  guardrails: string[];
  triggerRules: AgentTriggerRules;
  templatePackage?: AgentTemplatePackageMetadata;
  templateDialogs?: AgentTemplateDialogs;
  templateRuntime?: {
    tools?: string[];
    allowedTools?: string[];
    disallowedTools?: string[];
    model?: string;
    permissionMode?: string;
    mcpServers?: Record<string, unknown>;
  };
  templateCompat?: Record<string, string>;
  templateSelectedDependencies?: AgentTemplateSelectedDependencies;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstalledSkill {
  id?: string;
  name: string;
  title: string;
  description?: string;
  scope: 'user' | 'project';
  provider: string;
  source?: string;
  workspacePath?: string;
  path: string;
  skillPath: string;
  callable: boolean;
  fileCount?: number;
  folders?: string[];
  updatedAt?: string;
}

export interface RepositorySkillItem {
  id: string;
  repoId: string;
  repoName?: string;
  name: string;
  title: string;
  description?: string;
  author?: string;
  version?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  sourceUrl?: string | null;
}
