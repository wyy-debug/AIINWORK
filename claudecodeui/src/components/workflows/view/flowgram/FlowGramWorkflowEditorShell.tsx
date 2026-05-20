import 'reflect-metadata';
import '@flowgram.ai/free-layout-editor/index.css';

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  FreeLayoutEditor,
  type FreeLayoutPluginContext,
  type FreeLayoutProps,
  type WorkflowContentChangeEvent,
  type WorkflowJSON,
  type WorkflowNodeEntity,
} from '@flowgram.ai/free-layout-editor';
import { createFreeLinesPlugin, type LineRenderProps } from '@flowgram.ai/free-lines-plugin';
import { createFreeNodePanelPlugin, WorkflowNodePanelService, type NodePanelRenderProps } from '@flowgram.ai/free-node-panel-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { createFreeStackPlugin } from '@flowgram.ai/free-stack-plugin';
import { createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { createNodeVariablePlugin } from '@flowgram.ai/node-variable-plugin';
import { Plus } from 'lucide-react';

import type { WorkflowDefinition, WorkflowNodeType, WorkflowRun } from '../../../../types/workflow';
import { createWorkflowNodeRegistry } from '../../model/workflowNodeRegistry';
import {
  flowGramWorkflowJSONToWorkflowDefinition,
  workflowDefinitionToFlowGramWorkflowJSON,
} from '../../model/workflowGraphAdapter';
import { cn } from '../../../../lib/utils';
import type {
  WorkflowFlowGramEditorHandle,
  WorkflowLineInsertRequest,
  WorkflowRuntimeVisualState,
} from './FlowGramWorkflowTypes';
import { buildWorkflowFlowGramVariableCatalog } from './FlowGramWorkflowVariableCatalog';
import {
  buildFlowGramWorkflowNodeRegistries,
  createFlowGramWorkflowNode,
  getFlowGramWorkflowNodeDefaultRegistry,
} from './FlowGramWorkflowNodeRegistry';
import { FlowGramWorkflowNode } from './FlowGramWorkflowNodeRenderer';
import {
  buildFlowGramRuntimeVisualState,
  isDisabledLine,
  isErrorLine,
  isFlowingLine,
  setLineClassName,
} from './FlowGramRuntimeVisualBridge';

type WorkflowFlowGramEditorProps = {
  workflow: WorkflowDefinition;
  selectedRun: WorkflowRun | null;
  runtimeVisualState?: WorkflowRuntimeVisualState | null;
  selectedNodeId: string;
  selectedEdgeId: string;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
};

function getFlowGramLineEdgeId(line: LineRenderProps['line']) {
  const lineJSON = line.toJSON?.() as { data?: { id?: string } } | undefined;
  return lineJSON?.data?.id || '';
}

function hashFlowGramJSON(json: WorkflowJSON) {
  return JSON.stringify({
    nodes: json.nodes.map((node) => [node.id, node.type, node.meta?.position, node.data?.title]),
    edges: json.edges.map((edge) => [edge.data?.id, edge.sourceNodeID, edge.targetNodeID, edge.data?.mode]),
  });
}

function insertNodeOnEdgeInWorkflow(
  workflow: WorkflowDefinition,
  edgeId: string,
  type: WorkflowNodeType,
) {
  const edge = workflow.edges.find((item) => item.id === edgeId);
  if (!edge) return workflow;
  const sourceNode = workflow.nodes.find((node) => node.id === edge.from);
  const targetNode = workflow.nodes.find((node) => node.id === edge.to);
  const position = sourceNode && targetNode
    ? {
      x: Math.round((sourceNode.position.x + targetNode.position.x) / 2),
      y: Math.round((sourceNode.position.y + targetNode.position.y) / 2),
    }
    : { x: 160 + workflow.nodes.length * 80, y: 160 };
  const flowNode = createFlowGramWorkflowNode(type, {
    nodeCount: workflow.nodes.length,
    position,
    registry: createWorkflowNodeRegistry(),
  });
  const node = flowNode.data?.workflowNode;
  if (!node) return workflow;
  const firstEdge = {
    ...edge,
    id: `${edge.from}-${node.id}`,
    to: node.id,
  };
  const secondEdge = {
    ...edge,
    id: `${node.id}-${edge.to}`,
    from: node.id,
    mode: 'success' as const,
    condition: '',
  };
  return {
    ...workflow,
    nodes: [...workflow.nodes, node],
    edges: workflow.edges.flatMap((item) => (item.id === edgeId ? [firstEdge, secondEdge] : [item])),
  };
}

function FlowGramLineInsertButton({
  line,
  selectedEdgeId,
  firstInsertableType,
  onSelectEdge,
  onInsert,
}: {
  line: LineRenderProps['line'];
  selectedEdgeId: string;
  firstInsertableType: WorkflowNodeType;
  onSelectEdge: (edgeId: string) => void;
  onInsert: (request: WorkflowLineInsertRequest) => void;
}) {
  const edgeId = getFlowGramLineEdgeId(line);
  if (!edgeId) return null;
  const lineGeometry = line as unknown as {
    center?: { x?: number; y?: number };
    bounds?: { x?: number; y?: number };
  };
  const absoluteCenter = lineGeometry.center || { x: 0, y: 0 };
  const bounds = lineGeometry.bounds || { x: 0, y: 0 };
  const center = {
    x: (absoluteCenter.x || 0) - (bounds.x || 0) + 12,
    y: (absoluteCenter.y || 0) - (bounds.y || 0) + 12,
  };
  const request: WorkflowLineInsertRequest = { edgeId, nodeType: firstInsertableType };

  return (
    <button
      type="button"
      className={cn(
        'absolute z-30 flex h-7 w-7 items-center justify-center rounded-full border bg-background text-primary shadow-sm transition hover:border-primary hover:bg-primary hover:text-primary-foreground',
        selectedEdgeId === edgeId && 'border-primary bg-primary text-primary-foreground',
      )}
      data-testid="workflow-flowgram-line-insert"
      title="Insert node on edge"
      style={{ left: (center.x || 0) - 14, top: (center.y || 0) - 14 }}
      onClick={(event) => {
        event.stopPropagation();
        onSelectEdge(request.edgeId);
        onInsert(request);
      }}
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );
}

function FlowGramNodePanel({ onSelect, onClose }: NodePanelRenderProps) {
  const registry = createWorkflowNodeRegistry();
  return (
    <div className="w-56 rounded-md border border-border bg-background p-2 shadow-xl" data-testid="workflow-flowgram-node-panel">
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add workflow node</div>
      <div className="grid gap-1">
        {buildFlowGramWorkflowNodeRegistries(registry).map((nodeRegistry, index) => (
          <button
            key={String(nodeRegistry.type)}
            type="button"
            className="rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
            onClick={(selectEvent) => onSelect({
              nodeType: String(nodeRegistry.type),
              nodeJSON: nodeRegistry.onAdd({ nodeCount: index }),
              selectEvent,
            })}
          >
            {String(nodeRegistry.type)}
          </button>
        ))}
      </div>
      <button type="button" className="mt-2 w-full rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

const FlowGramWorkflowEditorShell = forwardRef<WorkflowFlowGramEditorHandle, WorkflowFlowGramEditorProps>(function FlowGramWorkflowEditorShell({
  workflow,
  selectedRun,
  runtimeVisualState,
  selectedNodeId,
  selectedEdgeId,
  onWorkflowChange,
  onSelectNode,
  onSelectEdge,
}, ref) {
  const initialData = useMemo(() => workflowDefinitionToFlowGramWorkflowJSON(workflow), [workflow]);
  const flowGramContextRef = useRef<FreeLayoutPluginContext | null>(null);
  const lastContentHash = useRef(hashFlowGramJSON(initialData));
  const nodeRegistries = useMemo(() => buildFlowGramWorkflowNodeRegistries(createWorkflowNodeRegistry()), []);
  const firstInsertableType = workflow.nodes.find((node) => node.type !== 'join')?.type || 'agent';
  const resolvedRuntimeVisualState = useMemo(
    () => runtimeVisualState ?? buildFlowGramRuntimeVisualState(workflow, selectedRun),
    [runtimeVisualState, selectedRun, workflow],
  );
  const selectedVariableCatalog = useMemo(() => (
    selectedNodeId ? buildWorkflowFlowGramVariableCatalog(workflow, selectedNodeId) : []
  ), [selectedNodeId, workflow]);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const syncHistoryState = useCallback((ctx = flowGramContextRef.current) => {
    setHistoryState({
      canUndo: ctx ? Boolean(ctx.history.canUndo()) : false,
      canRedo: ctx ? Boolean(ctx.history.canRedo()) : false,
    });
  }, []);

  const syncContextWorkflow = useCallback((ctx: FreeLayoutPluginContext | null) => {
    if (!ctx || ctx.document.disposed) return;
    const json = ctx.document.toJSON() as WorkflowJSON;
    lastContentHash.current = hashFlowGramJSON(json);
    onWorkflowChange(flowGramWorkflowJSONToWorkflowDefinition(workflow, json));
    syncHistoryState(ctx);
  }, [onWorkflowChange, syncHistoryState, workflow]);

  const insertNodeOnEdge = useCallback(async (edgeId: string, nodeType: WorkflowNodeType) => {
    const nextWorkflow = insertNodeOnEdgeInWorkflow(workflow, edgeId, nodeType);
    if (nextWorkflow === workflow) return false;
    onWorkflowChange(nextWorkflow);
    onSelectNode(nextWorkflow.nodes.at(-1)?.id || '');
    onSelectEdge('');
    return true;
  }, [onSelectEdge, onSelectNode, onWorkflowChange, workflow]);

  useImperativeHandle(ref, () => ({
    async undo() {
      const ctx = flowGramContextRef.current;
      if (!ctx?.history?.canUndo?.()) return false;
      await ctx.history.undo();
      syncContextWorkflow(ctx);
      return true;
    },
    async redo() {
      const ctx = flowGramContextRef.current;
      if (!ctx?.history?.canRedo?.()) return false;
      await ctx.history.redo();
      syncContextWorkflow(ctx);
      return true;
    },
    canUndo() {
      return Boolean(flowGramContextRef.current?.history?.canUndo?.());
    },
    canRedo() {
      return Boolean(flowGramContextRef.current?.history?.canRedo?.());
    },
    async fitView() {
      await flowGramContextRef.current?.tools?.fitView?.(true);
    },
    insertNodeOnEdge,
  }), [insertNodeOnEdge, syncContextWorkflow]);

  const handleContentChange = useCallback((ctx: FreeLayoutPluginContext, _event: WorkflowContentChangeEvent) => {
    flowGramContextRef.current = ctx;
    if (ctx.document.disposed) return;
    const json = ctx.document.toJSON() as WorkflowJSON;
    const nextHash = hashFlowGramJSON(json);
    if (lastContentHash.current === nextHash) return;
    lastContentHash.current = nextHash;
    onWorkflowChange(flowGramWorkflowJSONToWorkflowDefinition(workflow, json));
    syncHistoryState(ctx);
  }, [onWorkflowChange, syncHistoryState, workflow]);

  const editorProps = useMemo<FreeLayoutProps>(() => ({
    initialData,
    nodeRegistries,
    getNodeDefaultRegistry(type) {
      return getFlowGramWorkflowNodeDefaultRegistry(String(type));
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
          runtimeVisualState={resolvedRuntimeVisualState}
          onSelectNode={onSelectNode}
        />
      ),
    },
    isFlowingLine: (_ctx, line) => isFlowingLine(resolvedRuntimeVisualState, getFlowGramLineEdgeId(line)),
    isErrorLine: (_ctx, fromPort, toPort) => {
      const edge = workflow.edges.find((item) => item.from === fromPort?.node?.id && item.to === toPort?.node?.id);
      return isErrorLine(resolvedRuntimeVisualState, edge?.id || '');
    },
    isDisabledLine: (_ctx, line) => isDisabledLine(resolvedRuntimeVisualState, getFlowGramLineEdgeId(line)),
    setLineClassName: (_ctx, line) => setLineClassName(resolvedRuntimeVisualState, getFlowGramLineEdgeId(line)),
    onDragLineEnd: async (ctx, params) => {
      const panel = ctx.get(WorkflowNodePanelService);
      await panel.call({
        panelPosition: (params as unknown as { position?: { x: number; y: number }; point?: { x: number; y: number } }).position
          || (params as unknown as { point?: { x: number; y: number } }).point
          || { x: 0, y: 0 },
        fromPort: (params as unknown as { fromPort?: never }).fromPort,
        toPort: (params as unknown as { toPort?: never }).toPort,
        enableBuildLine: true,
        enableSelectPosition: true,
      });
    },
    onContentChange: handleContentChange,
    onAllLayersRendered(ctx) {
      flowGramContextRef.current = ctx;
      syncHistoryState(ctx);
      void ctx.tools.fitView(false);
    },
    plugins: () => [
      createFreeStackPlugin({}),
      createFreeLinesPlugin({
        renderInsideLine: ({ line }: LineRenderProps) => (
          <FlowGramLineInsertButton
            line={line}
            selectedEdgeId={selectedEdgeId}
            firstInsertableType={firstInsertableType}
            onSelectEdge={onSelectEdge}
            onInsert={({ edgeId, nodeType }) => void insertNodeOnEdge(edgeId, nodeType)}
          />
        ),
      }),
      createFreeNodePanelPlugin({
        renderer: FlowGramNodePanel,
      }),
      createNodeVariablePlugin({}),
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
  }), [firstInsertableType, handleContentChange, initialData, insertNodeOnEdge, nodeRegistries, onSelectEdge, onSelectNode, resolvedRuntimeVisualState, selectedEdgeId, selectedNodeId, selectedRun, syncHistoryState, workflow]);

  return (
    <div
      className="relative h-[560px] min-w-0 overflow-hidden rounded-md border border-border bg-background"
      data-testid="workflow-dag-canvas"
    >
      <div className="h-full w-full" data-testid="workflow-flowgram-free-layout-editor">
        <FreeLayoutEditor ref={flowGramContextRef} key={`${workflow.id}:${workflow.nodes.map((node) => node.id).join(',')}:${workflow.edges.map((edge) => edge.id).join(',')}`} {...editorProps} />
      </div>
      <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md border border-emerald-200 bg-emerald-50/90 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-700 shadow-sm" data-testid="workflow-flowgram-runtime-boundary">
        FlowGram edits / MTL runtime executes
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground shadow-sm" data-testid="workflow-minimap">
        FlowGram minimap
      </div>
      <div className="pointer-events-none absolute left-3 bottom-3 z-20 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground shadow-sm" data-testid="workflow-flowgram-history-state">
        Undo {historyState.canUndo ? 'ready' : 'empty'} / Redo {historyState.canRedo ? 'ready' : 'empty'}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-20 max-w-xs rounded-md border border-border bg-background/90 p-2 text-[10px] text-muted-foreground shadow-sm" data-testid="workflow-flowgram-variable-catalog">
        <div className="font-semibold uppercase tracking-wide text-foreground">Variables</div>
        {selectedVariableCatalog.slice(0, 4).map((variable) => (
          <div key={variable.path} className="truncate">{variable.token} / {variable.valueType}</div>
        ))}
        {selectedVariableCatalog.length === 0 && <div>No upstream variables</div>}
      </div>
    </div>
  );
});

export default FlowGramWorkflowEditorShell;
