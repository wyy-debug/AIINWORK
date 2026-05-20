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
  const statusClassName = status === 'running'
    ? 'bg-blue-500'
    : status === 'waiting_approval'
      ? 'bg-amber-500'
      : status === 'failed'
        ? 'bg-red-500'
        : status === 'completed'
          ? 'bg-emerald-500'
          : 'bg-slate-300';
  return (
    <WorkflowNodeRenderer node={node} className="workflow-flowgram-node-renderer">
      <div data-testid="workflow-node">
      <button
        type="button"
        className={cn(
          'w-[248px] rounded-md border bg-white p-3 text-left shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition hover:border-slate-400 hover:shadow-[0_14px_34px_rgba(15,23,42,0.12)]',
          selectedNodeId === json.id ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200',
          status === 'running' && 'border-blue-300 bg-blue-50/70',
          status === 'waiting_approval' && 'border-amber-300 bg-amber-50/70',
          status === 'failed' && 'border-red-300 bg-red-50/70',
          status === 'completed' && 'border-emerald-300 bg-emerald-50/70',
        )}
        data-testid={`workflow-flowgram-node-${json.id}`}
        onClick={() => onSelectNode(json.id)}
      >
        <div data-testid="workflow-node-modern-block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', statusClassName)} aria-label="workflow node status dot" />
              <div className="truncate text-sm font-semibold text-slate-950">{json.data?.title || workflowNode?.title || json.type}</div>
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{json.type}</div>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600">{status}</span>
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
        </div>
      </button>
      </div>
    </WorkflowNodeRenderer>
  );
}
