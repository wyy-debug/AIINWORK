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

export type AgentKnowledgeSourceType = 'file' | 'folder';

export type AgentKnowledgeSourceStatus = 'mock' | 'pending' | 'indexed' | 'failed';

export interface AgentKnowledgeSource {
  id: string;
  type: AgentKnowledgeSourceType;
  name: string;
  path?: string;
  status: AgentKnowledgeSourceStatus;
  storageKey?: string;
  fileCount?: number;
  chunkCount?: number;
  addedAt?: string;
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
  status: AgentStatus;
  scope: AgentScope;
  modelConfig: AgentModelConfig;
  repository: string;
  systemPrompt: string;
  channels: AgentChannel[];
  appBindings: AgentAppBinding[];
  skills: string[];
  knowledgeSources: AgentKnowledgeSource[];
  memory: AgentMemoryConfig;
  tools: string[];
  guardrails: string[];
  triggerRules: AgentTriggerRules;
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
