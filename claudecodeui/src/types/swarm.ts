import type { AgentTemplateDialogs, AgentTemplateSelectedDependencies } from './agent';

export type SwarmTopologyType = 'queen' | 'mesh' | 'pipeline' | 'committee' | 'map_reduce';

export type SwarmRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type SwarmRuntimeStatus = 'starting' | 'spawning' | 'running' | 'degraded' | 'completed' | 'failed' | 'cancelled';

export type SwarmAgentStatus = 'queued' | 'running' | 'degraded' | 'completed' | 'failed' | 'cancelled' | 'control_failed';

export type SwarmMessageStatus =
  | 'published'
  | 'retry_scheduled'
  | 'delivered'
  | 'acknowledged'
  | 'expired'
  | 'dead_lettered'
  | 'failed'
  | 'replayed';

export type SwarmMessageDeliveryMode = 'direct' | 'topic' | 'broadcast';

export interface SwarmTopologyEdge {
  from: string;
  to: string;
  topic: string;
}

export interface SwarmTopology {
  type: SwarmTopologyType;
  coordinatorRoleId?: string;
  edges: SwarmTopologyEdge[];
}

export interface SwarmRole {
  id: string;
  label: string;
  agentTemplateId: string;
  count: number;
  topics?: string[];
  runtime?: {
    tools?: string[];
    model?: string;
    permissionMode?: string;
  };
  dependencies?: AgentTemplateSelectedDependencies;
  dialogs?: AgentTemplateDialogs;
}

export interface SwarmTemplateManifest {
  schemaVersion: number;
  id: string;
  version: string;
  kind: 'swarm-template';
  topology: SwarmTopology;
  roles: SwarmRole[];
  routing?: {
    topics?: Array<{ name: string; subscribers?: string[]; ackPolicy?: string }>;
  };
  bus?: {
    provider?: string;
    ackPolicy?: string;
    retryLimit?: number;
    ttlMs?: number;
  };
  memory?: {
    enabled?: boolean;
    promotion?: string;
    scopes?: string[];
  };
  policies?: {
    maxAgents?: number;
    maxDepth?: number;
    tokenBudget?: number;
    timeoutMs?: number;
    messageSizeLimit?: number;
  };
  dialogs?: AgentTemplateDialogs;
  dependencies?: AgentTemplateSelectedDependencies;
  examples?: Array<{ title?: string; transcript?: Array<{ role: string; content: string }> }>;
  compat?: Record<string, string>;
}

export interface SwarmRunAgent {
  id: string;
  runId?: string;
  roleId: string;
  roleIndex?: number;
  label?: string;
  status: SwarmAgentStatus | string;
  runtimeStatus?: SwarmRuntimeStatus | string;
  taskId?: string;
  threadId?: string;
  agentTemplateId?: string;
  runtimeMode?: string;
  lastControl?: Record<string, unknown> | null;
  lastWaitResult?: Record<string, unknown> | null;
  transcriptSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface SwarmMessage {
  id: string;
  runId: string;
  fromAgentId?: string;
  toAgentId?: string;
  topic?: string;
  type: string;
  payload?: Record<string, unknown>;
  attempts?: number;
  deliveryAttempts?: number;
  nextAttemptAt?: number | null;
  deliveryMode?: SwarmMessageDeliveryMode | string;
  status: SwarmMessageStatus | string;
  error?: string;
  lastDeliveryError?: string;
  deliveredTo?: string;
  ackedBy?: string;
  correlationId?: string;
  causationId?: string;
  createdAt?: number;
}

export interface SwarmDeliveryTrace {
  id: string;
  runId: string;
  messageId: string;
  agentId?: string;
  status: string;
  error?: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
}

export interface SwarmEvent {
  id: string;
  runId: string;
  agentId?: string;
  messageId?: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
}

export interface SwarmRunSnapshot {
  id: string;
  templateId: string;
  status: SwarmRunStatus | string;
  runtimeMode?: string;
  runtimeStatus?: SwarmRuntimeStatus | string;
  coordinatorSessionId?: string;
  objective?: string;
  sessionId?: string;
  projectPath?: string;
  template?: SwarmTemplateManifest | null;
  topology?: SwarmTopology | null;
  agents: SwarmRunAgent[];
  messages: SwarmMessage[];
  events: SwarmEvent[];
  memory?: SwarmRunMemory[];
}

export interface SwarmRunMemory {
  id: string;
  runId: string;
  agentId?: string;
  scope: string;
  title: string;
  content: string;
  promoteable?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: number;
}
