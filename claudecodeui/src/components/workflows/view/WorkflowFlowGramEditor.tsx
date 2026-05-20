import 'reflect-metadata';
import '@flowgram.ai/free-layout-editor/index.css';

import { useCallback, useMemo, useRef } from 'react';
import {
  FreeLayoutEditor,
  WorkflowNodeRenderer,
  type FreeLayoutPluginContext,
  type FreeLayoutProps,
  type WorkflowContentChangeEvent,
  type WorkflowJSON,
  type WorkflowNodeEntity,
  type WorkflowNodeRegistry,
} from '@flowgram.ai/free-layout-editor';
import { createFreeLinesPlugin } from '@flowgram.ai/free-lines-plugin';
import { createFreeNodePanelPlugin, type NodePanelRenderProps } from '@flowgram.ai/free-node-panel-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { createFreeStackPlugin } from '@flowgram.ai/free-stack-plugin';
import { createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { Plus } from 'lucide-react';

import type { WorkflowDefinition, WorkflowEdge, WorkflowRun } from '../../../types/workflow';
import {
  flowGramWorkflowJSONToWorkflowDefinition,
  workflowDefinitionToFlowGramWorkflowJSON,
} from '../model/workflowGraphAdapter';
import { cn } from '../../../lib/utils';

type WorkflowFlowGramEditorProps = {
  workflow: WorkflowDefinition;
  selectedRun: WorkflowRun | null;
  selectedNodeId: string;
  selectedEdgeId: string;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onInsertNodeOnEdge: (edgeId: string, type: WorkflowDefinition['nodes'][number]['type']) => void;
};

type FlowGramNodeData = {
  title?: string;
  description?: string;
  workflowNode?: WorkflowDefinition['nodes'][number];
};

const nodePanelTypes: Array<WorkflowDefinition['nodes'][number]['type']> = ['agent', 'subagent', 'tool', 'approval', 'condition', 'artifact'];

const defaultFlowGramNodeMeta = {
  defaultExpanded: true,
  size: { width: 250, height: 112 },
  defaultPorts: [
    { type: 'input' },
    { type: 'output' },
  ],
} satisfies NonNullable<WorkflowNodeRegistry['meta']>;

const workflowNodeFormMeta = {
  render: () => <div className="hidden" data-testid="workflow-flowgram-form-meta" />,
  defaultValues: {},
  formatOnInit: (value: unknown) => value || {},
  formatOnSubmit: (value: unknown) => value || {},
};

function getNodeRunStatus(run: WorkflowRun | null, nodeId: string) {
  return run?.nodeRuns?.[nodeId]?.status || 'idle';
}

function getFlowGramNodeJson(node: WorkflowNodeEntity) {
  return node.toJSON() as { id: string; type: string; data?: FlowGramNodeData };
}

function FlowGramWorkflowNode({
  node,
  selectedNodeId,
  selectedRun,
  onSelectNode,
}: {
  node: WorkflowNodeEntity;
  selectedNodeId: string;
  selectedRun: WorkflowRun | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const json = getFlowGramNodeJson(node);
  const workflowNode = json.data?.workflowNode;
  const status = getNodeRunStatus(selectedRun, json.id);
  return (
    <WorkflowNodeRenderer node={node} className="workflow-flowgram-node-renderer">
      <button
        type="button"
        className={cn(
          'w-[250px] rounded-lg border bg-background p-3 text-left shadow-sm transition hover:border-primary/60 hover:shadow-md',
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
            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{json.type}</div>
          </div>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{status}</span>
        </div>
        {json.data?.description || workflowNode?.description ? (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{json.data?.description || workflowNode?.description}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          {workflowNode?.permission ? <span className="rounded border border-border px-1.5 py-0.5">{workflowNode.permission}</span> : null}
          {workflowNode?.toolName ? <span className="rounded border border-border px-1.5 py-0.5">{workflowNode.toolName}</span> : null}
          {workflowNode?.agentId ? <span className="rounded border border-border px-1.5 py-0.5">{workflowNode.agentId}</span> : null}
        </div>
      </button>
    </WorkflowNodeRenderer>
  );
}

function buildNodeRegistries(workflow: WorkflowDefinition): WorkflowNodeRegistry[] {
  const types = Array.from(new Set(workflow.nodes.map((node) => node.type)));
  return types.map((type) => ({
    type,
    meta: defaultFlowGramNodeMeta,
    formMeta: workflowNodeFormMeta,
  }));
}

function FlowGramNodePanel({ onSelect, onClose }: NodePanelRenderProps) {
  return (
    <div className="w-56 rounded-md border border-border bg-background p-2 shadow-xl" data-testid="workflow-flowgram-node-panel">
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add workflow node</div>
      <div className="grid gap-1">
        {nodePanelTypes.map((type) => (
          <button
            key={type}
            type="button"
            className="rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
            onClick={(selectEvent) => onSelect({ nodeType: type, selectEvent })}
          >
            {type}
          </button>
        ))}
      </div>
      <button type="button" className="mt-2 w-full rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function edgeMidpoint(workflow: WorkflowDefinition, edge: WorkflowEdge) {
  const from = workflow.nodes.find((node) => node.id === edge.from);
  const to = workflow.nodes.find((node) => node.id === edge.to);
  if (!from || !to) return { x: 320, y: 120 };
  return {
    x: ((from.position?.x || 0) + (to.position?.x || 0)) / 2 + 125,
    y: ((from.position?.y || 0) + (to.position?.y || 0)) / 2 + 56,
  };
}

function hashFlowGramJSON(json: WorkflowJSON) {
  return JSON.stringify({
    nodes: json.nodes.map((node) => [node.id, node.type, node.meta?.position, node.data?.title]),
    edges: json.edges.map((edge) => [edge.data?.id, edge.sourceNodeID, edge.targetNodeID, edge.data?.mode]),
  });
}

export default function WorkflowFlowGramEditor({
  workflow,
  selectedRun,
  selectedNodeId,
  selectedEdgeId,
  onWorkflowChange,
  onSelectNode,
  onSelectEdge,
  onInsertNodeOnEdge,
}: WorkflowFlowGramEditorProps) {
  const initialData = useMemo(() => workflowDefinitionToFlowGramWorkflowJSON(workflow), [workflow]);
  const lastContentHash = useRef(hashFlowGramJSON(initialData));
  const nodeRegistries = useMemo(() => buildNodeRegistries(workflow), [workflow]);
  const firstInsertableType = workflow.nodes.find((node) => node.type !== 'join')?.type || 'agent';

  const handleContentChange = useCallback((ctx: FreeLayoutPluginContext, _event: WorkflowContentChangeEvent) => {
    if (ctx.document.disposed) return;
    const json = ctx.document.toJSON() as WorkflowJSON;
    const nextHash = hashFlowGramJSON(json);
    if (lastContentHash.current === nextHash) return;
    lastContentHash.current = nextHash;
    onWorkflowChange(flowGramWorkflowJSONToWorkflowDefinition(workflow, json));
  }, [onWorkflowChange, workflow]);

  const editorProps = useMemo<FreeLayoutProps>(() => ({
    initialData,
    nodeRegistries,
    getNodeDefaultRegistry(type) {
      return {
        type,
        meta: defaultFlowGramNodeMeta,
        formMeta: workflowNodeFormMeta,
      };
    },
    background: true,
    readonly: false,
    twoWayConnection: true,
    enableReadonlyNodeDragging: false,
    allNodesDefaultExpanded: true,
    history: {
      enable: true,
      enableChangeNode: true,
    },
    scroll: {
      enableScrollLimit: false,
    },
    nodeEngine: {
      enable: true,
    },
    variableEngine: {
      enable: true,
    },
    lineColor: {
      hidden: 'transparent',
      default: 'rgba(37, 99, 235, 0.72)',
      drawing: 'rgba(14, 165, 233, 1)',
      selected: 'rgba(37, 99, 235, 1)',
      hovered: 'rgba(14, 165, 233, 1)',
      flowing: 'rgba(16, 185, 129, 1)',
      error: 'rgba(239, 68, 68, 1)',
    },
    materials: {
      renderDefaultNode: ({ node }: { node: WorkflowNodeEntity }) => (
        <FlowGramWorkflowNode
          node={node}
          selectedNodeId={selectedNodeId}
          selectedRun={selectedRun}
          onSelectNode={onSelectNode}
        />
      ),
    },
    isFlowingLine: (_ctx, line) => {
      const lineJSON = line.toJSON?.() as { data?: { id?: string } } | undefined;
      const edgeId = lineJSON?.data?.id;
      if (!edgeId || !selectedRun) return false;
      const edge = workflow.edges.find((item) => item.id === edgeId);
      if (!edge) return false;
      return ['running', 'waiting_approval'].includes(getNodeRunStatus(selectedRun, edge.from))
        || ['running', 'waiting_approval'].includes(getNodeRunStatus(selectedRun, edge.to));
    },
    onContentChange: handleContentChange,
    onAllLayersRendered(ctx) {
      void ctx.tools.fitView(false);
    },
    plugins: () => [
      createFreeStackPlugin({}),
      createFreeLinesPlugin({}),
      createFreeNodePanelPlugin({
        renderer: FlowGramNodePanel,
      }),
      createFreeSnapPlugin({
        edgeColor: 'rgba(37, 99, 235, 0.55)',
        alignColor: 'rgba(16, 185, 129, 0.7)',
      }),
      createMinimapPlugin({
        canvasStyle: {
          canvasWidth: 180,
          canvasHeight: 112,
          canvasPadding: 48,
          canvasBackground: 'rgba(248, 250, 252, 0.96)',
          canvasBorderRadius: 8,
          viewportBackground: 'rgba(255, 255, 255, 0.85)',
          viewportBorderRadius: 4,
          viewportBorderColor: 'rgba(37, 99, 235, 0.35)',
          nodeColor: 'rgba(37, 99, 235, 0.22)',
          overlayColor: 'rgba(255, 255, 255, 0.42)',
        },
      }),
    ],
  }), [handleContentChange, initialData, nodeRegistries, onSelectNode, selectedNodeId, selectedRun, workflow]);

  return (
    <div
      className="relative h-[560px] min-w-0 overflow-hidden rounded-md border border-border bg-background"
      data-testid="workflow-dag-canvas"
    >
      <div className="h-full w-full" data-testid="workflow-flowgram-free-layout-editor">
        <FreeLayoutEditor key={`${workflow.id}:${workflow.nodes.map((node) => node.id).join(',')}:${workflow.edges.map((edge) => edge.id).join(',')}`} {...editorProps} />
      </div>
      <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md border border-emerald-200 bg-emerald-50/90 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-700 shadow-sm" data-testid="workflow-flowgram-runtime-boundary">
        FlowGram edits / MTL runtime executes
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground shadow-sm" data-testid="workflow-minimap">
        FlowGram minimap
      </div>
      <div className="pointer-events-none absolute inset-0 z-10" data-testid="workflow-line-add-node-overlay">
        {workflow.edges.map((edge) => {
          const midpoint = edgeMidpoint(workflow, edge);
          return (
            <button
              key={edge.id}
              type="button"
              className={cn(
                'pointer-events-auto absolute flex h-7 w-7 items-center justify-center rounded-full border bg-background text-primary shadow-sm transition hover:border-primary hover:bg-primary hover:text-primary-foreground',
                selectedEdgeId === edge.id && 'border-primary bg-primary text-primary-foreground',
              )}
              style={{ left: midpoint.x, top: midpoint.y }}
              data-testid="workflow-line-add-node"
              title="Insert node on edge"
              onClick={() => {
                onSelectEdge(edge.id);
                onInsertNodeOnEdge(edge.id, firstInsertableType);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
