import type { WorkflowDefinition, WorkflowRun } from '../../../../types/workflow';
import {
  buildWorkGraphRuntimeState,
  type WorkGraphRuntimeState,
} from '../../model/workflowRuntimeStateBridge';
import type { WorkflowRuntimeVisualState } from './FlowGramWorkflowTypes';

export function buildFlowGramRuntimeVisualState(
  workflow: WorkflowDefinition,
  run: WorkflowRun | null,
): WorkflowRuntimeVisualState | null {
  const state: WorkGraphRuntimeState | null = buildWorkGraphRuntimeState(workflow, run);
  if (!state) return null;
  return {
    runId: state.runId,
    workflowId: state.workflowId,
    status: state.status,
    nodes: Object.fromEntries(Object.entries(state.nodes).map(([nodeId, node]) => [nodeId, {
      nodeId,
      status: node.status,
      attempt: node.attempt,
      artifactCount: node.artifactCount,
      checkpointCount: node.checkpointCount,
      error: node.error,
      waitingReason: node.waitingReason,
    }])),
    edges: Object.fromEntries(Object.entries(state.edges).map(([edgeId, edge]) => [edgeId, {
      edgeId,
      status: edge.status,
    }])),
    summary: state.summary,
  };
}

export function getRuntimeNodeStatus(
  runtimeVisualState: WorkflowRuntimeVisualState | null | undefined,
  run: WorkflowRun | null,
  nodeId: string,
) {
  return runtimeVisualState?.nodes?.[nodeId]?.status || run?.nodeRuns?.[nodeId]?.status || 'idle';
}

export function isFlowingLine(runtimeVisualState: WorkflowRuntimeVisualState | null | undefined, edgeId: string) {
  return Boolean(edgeId && ['active', 'running', 'waiting_approval'].includes(runtimeVisualState?.edges?.[edgeId]?.status || ''));
}

export function isErrorLine(runtimeVisualState: WorkflowRuntimeVisualState | null | undefined, edgeId: string) {
  return Boolean(edgeId && runtimeVisualState?.edges?.[edgeId]?.status === 'failed');
}

export function isDisabledLine(runtimeVisualState: WorkflowRuntimeVisualState | null | undefined, edgeId: string) {
  return Boolean(edgeId && ['blocked', 'skipped', 'cancelled'].includes(runtimeVisualState?.edges?.[edgeId]?.status || ''));
}

export function setLineClassName(runtimeVisualState: WorkflowRuntimeVisualState | null | undefined, edgeId: string) {
  const status = edgeId ? runtimeVisualState?.edges?.[edgeId]?.status : '';
  return status ? `workflow-flowgram-line-state-${status}` : undefined;
}
