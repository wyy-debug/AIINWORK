import type { WorkflowDefinition, WorkflowNodeStatus, WorkflowRun } from '../../../types/workflow';

export type WorkGraphRuntimeNodeState = {
  nodeId: string;
  status: WorkflowNodeStatus;
  attempt: number;
  durationMs?: number;
  inputKeys: string[];
  outputKeys: string[];
  artifactCount: number;
  checkpointCount: number;
  error?: string;
  waitingReason?: string;
};

export type WorkGraphRuntimeEdgeState = {
  edgeId: string;
  from: string;
  to: string;
  mode: string;
  status: 'idle' | 'active' | 'completed' | 'failed' | 'blocked' | 'skipped';
};

export type WorkGraphRuntimeState = {
  runId: string;
  workflowId: string;
  status: WorkflowRun['status'];
  nodes: Record<string, WorkGraphRuntimeNodeState>;
  edges: Record<string, WorkGraphRuntimeEdgeState>;
  summary: {
    running: number;
    waiting: number;
    completed: number;
    failed: number;
    artifacts: number;
    checkpoints: number;
  };
};

function mapEdgeStatus(targetStatus?: WorkflowNodeStatus): WorkGraphRuntimeEdgeState['status'] {
  if (targetStatus === 'running' || targetStatus === 'waiting_approval') return 'active';
  if (targetStatus === 'completed') return 'completed';
  if (targetStatus === 'failed') return 'failed';
  if (targetStatus === 'skipped' || targetStatus === 'cancelled') return 'skipped';
  if (targetStatus === 'pending' || targetStatus === 'ready') return 'idle';
  return 'idle';
}

export function buildWorkGraphRuntimeState(
  workflow: WorkflowDefinition,
  run: WorkflowRun | null,
): WorkGraphRuntimeState | null {
  if (!run) return null;
  const nodes = Object.fromEntries((workflow.nodes || []).map((node) => {
    const nodeRun = run.nodeRuns?.[node.id];
    const state: WorkGraphRuntimeNodeState = {
      nodeId: node.id,
      status: nodeRun?.status || 'pending',
      attempt: nodeRun?.attempt || 0,
      durationMs: nodeRun?.durationMs,
      inputKeys: Object.keys(nodeRun?.input || {}),
      outputKeys: Object.keys(nodeRun?.output || {}),
      artifactCount: nodeRun?.artifacts?.length || 0,
      checkpointCount: Object.keys(nodeRun?.checkpoints || {}).length,
      error: nodeRun?.error,
      waitingReason: nodeRun?.waitingReason,
    };
    return [node.id, state];
  }));
  const edges = Object.fromEntries((workflow.edges || []).map((edge) => {
    const targetState = nodes[edge.to]?.status;
    const edgeState: WorkGraphRuntimeEdgeState = {
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      mode: edge.mode || 'success',
      status: mapEdgeStatus(targetState),
    };
    return [edge.id, edgeState];
  }));
  const nodeStates = Object.values(nodes);
  return {
    runId: run.id,
    workflowId: run.workflowId,
    status: run.status,
    nodes,
    edges,
    summary: {
      running: nodeStates.filter((node) => node.status === 'running').length,
      waiting: nodeStates.filter((node) => node.status === 'waiting_approval').length,
      completed: nodeStates.filter((node) => node.status === 'completed').length,
      failed: nodeStates.filter((node) => node.status === 'failed').length,
      artifacts: nodeStates.reduce((total, node) => total + node.artifactCount, 0),
      checkpoints: nodeStates.reduce((total, node) => total + node.checkpointCount, 0),
    },
  };
}
