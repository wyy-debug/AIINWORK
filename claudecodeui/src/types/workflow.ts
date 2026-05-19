export type WorkflowNodeType =
  | 'agent'
  | 'subagent'
  | 'mcp'
  | 'tool'
  | 'shell'
  | 'artifact'
  | 'approval'
  | 'condition'
  | 'join';

export type WorkflowNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type WorkflowRunStatus = 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  description?: string;
  agentId?: string;
  toolName?: string;
  command?: string;
  prompt?: string;
  condition?: string;
  permission?: 'allow' | 'ask' | 'deny' | '';
  retryLimit?: number;
  timeoutMs?: number;
  config?: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  mode?: 'success' | 'failure' | 'always';
  condition?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  profileId: string;
  permissionPreset: string;
  inputs: Array<{ id: string; label: string; type: string; required?: boolean; defaultValue?: unknown }>;
  outputs: Array<{ id: string; label: string; type: string; required?: boolean; defaultValue?: unknown }>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  maxConcurrency: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowNodeRun {
  nodeId: string;
  type: WorkflowNodeType;
  title: string;
  status: WorkflowNodeStatus;
  attempt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number;
  logs?: string[];
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  error?: string;
  waitingReason?: string;
  permissionDecision?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  projectPath?: string;
  sessionId?: string;
  inputs?: Record<string, unknown>;
  profileSnapshot?: Record<string, unknown>;
  nodeRuns: Record<string, WorkflowNodeRun>;
  logs?: string[];
  artifacts?: Array<Record<string, unknown>>;
  timelineEvents?: Array<Record<string, unknown>>;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number | null;
  updatedAt?: number;
}
