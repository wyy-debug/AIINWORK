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

export type WorkflowRunStatus = 'queued' | 'running' | 'recovering' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type WorkflowQueueState = 'queued' | 'running' | 'recovering' | 'stale' | 'completed' | string;

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
  routeStyle?: 'smoothstep' | 'straight' | 'step';
}

export interface WorkflowNodeConfigField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
}

export interface WorkflowNodeTypeDefinition {
  type: WorkflowNodeType;
  label: string;
  description: string;
  ports?: { inputs?: string[]; outputs?: string[] };
  configSchema?: { fields?: WorkflowNodeConfigField[] };
  permissions?: { risky?: boolean; action?: string };
  outputSchema?: { fields?: Array<{ name: string; type: string; label?: string }> };
  ui?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

export interface WorkflowRunEvent {
  id: string;
  category?: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
  runId?: string;
  workflowId?: string;
}

export interface WorkflowNodeLog {
  timestamp?: number;
  level: 'info' | 'warn' | 'error' | string;
  message: string;
  payload?: Record<string, unknown>;
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
  inputLineage?: Record<string, unknown>;
  output?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  checkpoints?: Record<string, Record<string, unknown>>;
  error?: string;
  waitingReason?: string;
  permissionDecision?: string;
  permissionExplanation?: {
    nodeId?: string;
    title?: string;
    type?: string;
    permissionPreset?: string;
    permissionDecision?: string;
    decision?: string;
    requestedCapabilities?: string[];
    effectiveCapabilities?: string[];
    riskLevel?: string;
    riskReasons?: string[];
    reason?: string;
    explain?: string;
    requiresApproval?: boolean;
    dangerousCommand?: Record<string, unknown> | null;
    command?: string;
    toolName?: string;
  } | null;
}

export interface WorkflowPreviewDiff {
  matched?: boolean;
  changed?: boolean;
  reasons?: string[];
  changedNodes?: Array<{
    nodeId: string;
    fields?: string[];
    reasons?: string[];
  }>;
}

export interface WorkflowRunSnapshot {
  snapshotVersion?: number;
  capturedAt?: string;
  workflowId?: string;
  workflowName?: string;
  runnableWorkflowId?: string;
  runnableWorkflowName?: string;
  workflowDigest?: string;
  resolverVersion?: string;
  definitionSnapshot?: WorkflowDefinition;
  profileSnapshot?: Record<string, unknown>;
  permissionSnapshot?: Record<string, unknown>;
  nodePackageSnapshots?: Array<Record<string, unknown>>;
  runInputsSnapshot?: Record<string, unknown>;
  previewSnapshot?: Record<string, unknown>;
  executionInputSnapshot?: Record<string, unknown>;
  dependencyRefs?: Record<string, unknown>;
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
  runSnapshot?: WorkflowRunSnapshot;
  previewSnapshot?: Record<string, unknown>;
  executionInputSnapshot?: Record<string, unknown>;
  previewDiff?: WorkflowPreviewDiff;
  previewMatched?: boolean;
  previewChanged?: boolean;
  resolverVersion?: string;
  queue?: {
    state?: WorkflowQueueState;
    workerId?: string;
    heartbeatAt?: number | null;
    leaseExpiresAt?: number | null;
    maxConcurrency?: number;
    recoveredAt?: number | null;
    updatedAt?: number;
  };
  nodeRuns: Record<string, WorkflowNodeRun>;
  logs?: string[];
  artifacts?: Array<Record<string, unknown>>;
  timelineEvents?: Array<Record<string, unknown>>;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number | null;
  updatedAt?: number;
}
