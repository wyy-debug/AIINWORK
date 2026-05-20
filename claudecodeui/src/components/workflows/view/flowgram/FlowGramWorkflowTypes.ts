import type { WorkflowDefinition, WorkflowNodeType, WorkflowRun } from '../../../../types/workflow';
import type { WorkflowFlowReference, WorkflowFlowValue } from '../../model/workflowGraphAdapter';

type WorkflowNode = WorkflowDefinition['nodes'][number];

export type WorkflowFlowGramEditorHandle = {
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  fitView: () => Promise<void>;
  zoomIn: () => Promise<void>;
  zoomOut: () => Promise<void>;
  autoLayout: () => Promise<void>;
  insertNodeOnEdge: (edgeId: string, nodeType: WorkflowNodeType) => Promise<boolean>;
};

export type WorkflowFlowGramFormValues = {
  title: string;
  description: string;
  agentId: string;
  toolName: string;
  command: string;
  prompt: string;
  condition: string;
  permission: string;
  retryLimit: number;
  timeoutMs: number;
  config: Record<string, unknown>;
  flowValues: Record<string, WorkflowFlowValue>;
  workflowNode: WorkflowNode;
};

export type WorkflowFlowGramVariableCatalog = WorkflowFlowReference & {
  token: string;
};

export type WorkflowRuntimeVisualState = {
  runId?: string;
  workflowId?: string;
  status?: WorkflowRun['status'];
  nodes: Record<string, {
    nodeId: string;
    status: string;
    attempt?: number;
    artifactCount?: number;
    checkpointCount?: number;
    error?: string;
    waitingReason?: string;
  }>;
  edges: Record<string, {
    edgeId: string;
    status: string;
  }>;
  summary: Record<string, number>;
};

export type WorkflowLineInsertRequest = {
  edgeId: string;
  nodeType: WorkflowNodeType;
};

export type FlowGramNodeData = {
  title?: string;
  description?: string;
  workflowNode?: WorkflowNode;
  flowValues?: Record<string, WorkflowFlowValue>;
};

export type FlowGramNodeLike = {
  id?: string;
  flowNodeType?: string | number;
  getJSONData?: () => FlowGramNodeData | { data?: FlowGramNodeData } | null | undefined;
};
