import { WorkflowNodeRenderer, type WorkflowNodeEntity } from '@flowgram.ai/free-layout-editor';

import type { WorkflowRun } from '../../../../types/workflow';
import { cn } from '../../../../lib/utils';
import type { FlowGramNodeData, FlowGramNodeLike, WorkflowRuntimeVisualState } from './FlowGramWorkflowTypes';
import { getRuntimeNodeStatus } from './FlowGramRuntimeVisualBridge';

export function getFlowGramNodeJson(node: WorkflowNodeEntity) {
  const entity = node as unknown as FlowGramNodeLike;
  const rawData = entity.getJSONData?.();
  const data = rawData && typeof rawData === 'object' && 'data' in rawData
    ? rawData.data
    : rawData as FlowGramNodeData | undefined;
  return {
    id: String(entity.id || data?.workflowNode?.id || 'workflow-node'),
    type: String(entity.flowNodeType || data?.workflowNode?.type || 'tool'),
    data,
  };
}

export function FlowGramWorkflowNode({
  node,
  selectedNodeId,
  selectedRun,
  runtimeVisualState,
  onSelectNode,
}: {
  node: WorkflowNodeEntity;
  selectedNodeId: string;
  selectedRun: WorkflowRun | null;
  runtimeVisualState?: WorkflowRuntimeVisualState | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const json = getFlowGramNodeJson(node);
  const workflowNode = json.data?.workflowNode;
  const runtimeNode = runtimeVisualState?.nodes?.[json.id];
  const status = getRuntimeNodeStatus(runtimeVisualState, selectedRun, json.id);
  return (
    <WorkflowNodeRenderer node={node} className="workflow-flowgram-node-renderer">
      <div data-testid="workflow-node">
      <button
        type="button"
        className={cn(
          'w-[230px] rounded-[10px] border bg-white p-3 text-left shadow-sm transition hover:border-primary/60 hover:shadow-md',
          selectedNodeId === json.id ? 'border-primary ring-2 ring-primary/15' : 'border-border',
          status === 'running' && 'border-blue-400 bg-blue-50',
          status === 'waiting_approval' && 'border-amber-400 bg-amber-50',
          status === 'failed' && 'border-red-400 bg-red-50',
          status === 'completed' && 'border-emerald-400 bg-emerald-50',
        )}
        data-testid={`workflow-flowgram-node-${json.id}`}
        onClick={() => onSelectNode(json.id)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{json.data?.title || workflowNode?.title || json.type}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{json.type}</div>
          </div>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{status}</span>
        </div>
        <div className="sr-only" data-testid="workflow-flowgram-runtime-node-state">
          attempt {runtimeNode?.attempt ?? 0}, checkpoints {runtimeNode?.checkpointCount ?? 0}, artifacts {runtimeNode?.artifactCount ?? 0}
        </div>
        {json.data?.description || workflowNode?.description ? (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{json.data?.description || workflowNode?.description}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          {workflowNode?.permission ? <span className="rounded border border-border px-1.5 py-0.5">{workflowNode.permission}</span> : null}
          {workflowNode?.toolName ? <span className="rounded border border-border px-1.5 py-0.5">{workflowNode.toolName}</span> : null}
          {workflowNode?.agentId ? <span className="rounded border border-border px-1.5 py-0.5">{workflowNode.agentId}</span> : null}
          {runtimeNode?.checkpointCount ? <span className="rounded border border-border px-1.5 py-0.5">{runtimeNode.checkpointCount} checkpoints</span> : null}
          {runtimeNode?.artifactCount ? <span className="rounded border border-border px-1.5 py-0.5">{runtimeNode.artifactCount} artifacts</span> : null}
          {runtimeNode?.error ? <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-700">error</span> : null}
          {runtimeNode?.waitingReason ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700">approval</span> : null}
        </div>
      </button>
      </div>
    </WorkflowNodeRenderer>
  );
}
