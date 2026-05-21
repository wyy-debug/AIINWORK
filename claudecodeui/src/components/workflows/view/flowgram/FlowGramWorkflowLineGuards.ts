import type { WorkflowDefinition } from '../../../../types/workflow';

type WorkflowPortLike = {
  node?: { id?: string };
  nodeId?: string;
  nodeID?: string;
};

type WorkflowLineLike = {
  id?: string;
  toJSON?: () => { data?: { id?: string } } | undefined;
};

export function getWorkflowPortNodeId(port: unknown) {
  const candidate = port as WorkflowPortLike | null | undefined;
  return String(candidate?.node?.id || candidate?.nodeId || candidate?.nodeID || '');
}

export function getWorkflowLineId(line: unknown) {
  const candidate = line as WorkflowLineLike | null | undefined;
  return String(candidate?.toJSON?.()?.data?.id || candidate?.id || '');
}

function workflowHasPath(workflow: WorkflowDefinition, from: string, to: string, ignoredEdgeId = '') {
  const visited = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === to) return true;
    visited.add(current);
    workflow.edges
      .filter((edge) => edge.id !== ignoredEdgeId && edge.from === current)
      .forEach((edge) => stack.push(edge.to));
  }
  return false;
}

export function canAddWorkflowLine(workflow: WorkflowDefinition, fromNodeId: string, toNodeId: string, ignoredEdgeId = '') {
  if (!fromNodeId || !toNodeId) return false;
  if (fromNodeId === toNodeId) return false;
  if (!workflow.nodes.some((node) => node.id === fromNodeId)) return false;
  if (!workflow.nodes.some((node) => node.id === toNodeId)) return false;
  if (workflow.edges.some((edge) => edge.id !== ignoredEdgeId && edge.from === fromNodeId && edge.to === toNodeId)) return false;
  return !workflowHasPath(workflow, toNodeId, fromNodeId, ignoredEdgeId);
}

export function canDeleteWorkflowLine(workflow: WorkflowDefinition, edgeId: string) {
  return workflow.edges.some((edge) => edge.id === edgeId);
}

export function canDeleteWorkflowNode(workflow: WorkflowDefinition, nodeId: string) {
  return workflow.nodes.some((node) => node.id === nodeId);
}

export function canResetWorkflowLine(workflow: WorkflowDefinition, edgeId: string, fromNodeId: string, toNodeId: string) {
  const currentEdge = workflow.edges.find((edge) => edge.id === edgeId);
  if (!currentEdge) return false;
  if (currentEdge.from === toNodeId && currentEdge.to === fromNodeId) return false;
  return canAddWorkflowLine(workflow, fromNodeId, toNodeId, edgeId);
}
