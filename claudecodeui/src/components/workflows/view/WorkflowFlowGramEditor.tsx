import 'reflect-metadata';
import '@flowgram.ai/free-layout-editor/index.css';

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
import { createFreeLinesPlugin, type LineRenderProps } from '@flowgram.ai/free-lines-plugin';
import { createFreeNodePanelPlugin, type NodePanelRenderProps } from '@flowgram.ai/free-node-panel-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { createFreeStackPlugin } from '@flowgram.ai/free-stack-plugin';
import { createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { Plus } from 'lucide-react';

import type { WorkflowDefinition, WorkflowRun } from '../../../types/workflow';
import {
  buildWorkflowFlowReferenceCatalog,
  flowGramWorkflowJSONToWorkflowDefinition,
  type WorkflowFlowReference,
  type WorkflowFlowValue,
  workflowDefinitionToFlowGramWorkflowJSON,
} from '../model/workflowGraphAdapter';
import { cn } from '../../../lib/utils';

type WorkflowNode = WorkflowDefinition['nodes'][number];

export type WorkflowFlowGramEditorHandle = {
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  fitView: () => Promise<void>;
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
  summary?: Record<string, number>;
};

export type WorkflowLineInsertRequest = {
  edgeId: string;
  nodeType: WorkflowNode['type'];
};

type WorkflowFlowGramEditorProps = {
  workflow: WorkflowDefinition;
  selectedRun: WorkflowRun | null;
  runtimeVisualState?: WorkflowRuntimeVisualState | null;
  selectedNodeId: string;
  selectedEdgeId: string;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onInsertNodeOnEdge: (edgeId: string, type: WorkflowNode['type']) => void;
};

type FlowGramNodeData = {
  title?: string;
  description?: string;
  workflowNode?: WorkflowNode;
  flowValues?: Record<string, WorkflowFlowValue>;
};

type FlowGramNodeLike = {
  id?: string;
  flowNodeType?: string | number;
  getJSONData?: () => FlowGramNodeData | { data?: FlowGramNodeData } | null | undefined;
};

const nodePanelTypes: Array<WorkflowNode['type']> = ['agent', 'subagent', 'tool', 'approval', 'condition', 'artifact'];

const defaultFlowGramNodeMeta = {
  defaultExpanded: true,
  size: { width: 250, height: 112 },
  defaultPorts: [
    { type: 'input' },
    { type: 'output' },
  ],
} satisfies NonNullable<WorkflowNodeRegistry['meta']>;

function cloneRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function getNodeRunStatus(run: WorkflowRun | null, nodeId: string) {
  return run?.nodeRuns?.[nodeId]?.status || 'idle';
}

function getRuntimeNodeStatus(runtimeVisualState: WorkflowRuntimeVisualState | null | undefined, run: WorkflowRun | null, nodeId: string) {
  return runtimeVisualState?.nodes?.[nodeId]?.status || getNodeRunStatus(run, nodeId);
}

function getWorkflowNodeFromValue(value: unknown): WorkflowNode | null {
  const candidate = value && typeof value === 'object' ? value as { workflowNode?: WorkflowNode } : {};
  return candidate.workflowNode || null;
}

function getWorkflowNodeFromRawData(rawData: FlowGramNodeData | { data?: FlowGramNodeData } | null | undefined): WorkflowNode | null {
  const data = rawData && typeof rawData === 'object' && 'data' in rawData
    ? rawData.data
    : rawData as FlowGramNodeData | null | undefined;
  return data?.workflowNode || null;
}

function getWorkflowNodeFromContext(value: unknown, context?: { node?: FlowGramNodeLike }): WorkflowNode | null {
  return getWorkflowNodeFromValue(value) || getWorkflowNodeFromRawData(context?.node?.getJSONData?.()) || null;
}

export function buildWorkflowFlowGramFormValues(node: WorkflowNode | null | undefined): WorkflowFlowGramFormValues {
  const fallbackNode: WorkflowNode = node || {
    id: 'workflow-node',
    type: 'tool',
    title: 'Workflow node',
    description: '',
    agentId: '',
    toolName: '',
    command: '',
    prompt: '',
    condition: '',
    permission: '',
    retryLimit: 0,
    timeoutMs: 120000,
    config: {},
    position: { x: 0, y: 0 },
  };
  const config = cloneRecord(fallbackNode.config);
  return {
    title: fallbackNode.title || fallbackNode.id,
    description: fallbackNode.description || '',
    agentId: fallbackNode.agentId || '',
    toolName: fallbackNode.toolName || '',
    command: fallbackNode.command || '',
    prompt: fallbackNode.prompt || '',
    condition: fallbackNode.condition || '',
    permission: fallbackNode.permission || '',
    retryLimit: fallbackNode.retryLimit || 0,
    timeoutMs: fallbackNode.timeoutMs || 120000,
    config,
    flowValues: cloneRecord((fallbackNode as { flowValues?: unknown }).flowValues) as Record<string, WorkflowFlowValue>,
    workflowNode: fallbackNode,
  };
}

function submitWorkflowFlowGramFormValues(values: Partial<WorkflowFlowGramFormValues> = {}, context?: { node?: FlowGramNodeLike }) {
  const baseNode = values.workflowNode || getWorkflowNodeFromContext(values, context);
  const formValues = buildWorkflowFlowGramFormValues(baseNode);
  const config = cloneRecord(values.config ?? formValues.config);
  const flowValues = cloneRecord(values.flowValues ?? formValues.flowValues) as Record<string, WorkflowFlowValue>;
  const workflowNode: WorkflowNode = {
    ...formValues.workflowNode,
    title: values.title ?? formValues.title,
    description: values.description ?? formValues.description,
    agentId: values.agentId ?? formValues.agentId,
    toolName: values.toolName ?? formValues.toolName,
    command: values.command ?? formValues.command,
    prompt: values.prompt ?? formValues.prompt,
    condition: values.condition ?? formValues.condition,
    permission: (values.permission ?? formValues.permission) as WorkflowNode['permission'],
    retryLimit: Number(values.retryLimit ?? formValues.retryLimit),
    timeoutMs: Number(values.timeoutMs ?? formValues.timeoutMs),
    config,
  };
  return {
    title: workflowNode.title,
    description: workflowNode.description,
    workflowNode,
    config,
    flowValues,
    runtime: {
      permission: workflowNode.permission,
      retryLimit: workflowNode.retryLimit,
      timeoutMs: workflowNode.timeoutMs,
    },
  };
}

export function buildWorkflowFlowGramVariableCatalog(
  workflow: WorkflowDefinition,
  nodeId: string,
  runInputs: Record<string, unknown> = {},
): WorkflowFlowGramVariableCatalog[] {
  return buildWorkflowFlowReferenceCatalog(workflow, nodeId, [], runInputs).map((variable) => ({
    ...variable,
    token: `{{${variable.path}}}`,
  }));
}

const workflowNodeFormMeta = {
  render: ({ form }: { form?: { values?: Partial<WorkflowFlowGramFormValues> } }) => {
    const values = form?.values || {};
    return (
      <div className="space-y-1 rounded-md border border-border bg-background p-2 text-[10px] text-muted-foreground" data-testid="workflow-flowgram-form-inspector">
        <div className="font-semibold uppercase tracking-wide text-foreground">{values.title || values.workflowNode?.title || 'Workflow node form'}</div>
        <div>Config keys: {Object.keys(values.config || values.workflowNode?.config || {}).length}</div>
        <div>Flow values: {Object.keys(values.flowValues || {}).length}</div>
      </div>
    );
  },
  defaultValues: (context: { node?: FlowGramNodeLike }) => buildWorkflowFlowGramFormValues(getWorkflowNodeFromContext(undefined, context)),
  formatOnInit: (value: unknown, context: { node?: FlowGramNodeLike }) => buildWorkflowFlowGramFormValues(getWorkflowNodeFromContext(value, context)),
  formatOnSubmit: (value: Partial<WorkflowFlowGramFormValues>, context: { node?: FlowGramNodeLike }) => submitWorkflowFlowGramFormValues(value, context),
};

function getFlowGramNodeJson(node: WorkflowNodeEntity) {
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

function FlowGramWorkflowNode({
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
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]" data-testid="workflow-flowgram-runtime-node-state">
          <span className="rounded border border-border px-1.5 py-0.5">try {runtimeNode?.attempt ?? 0}</span>
          <span className="rounded border border-border px-1.5 py-0.5">ckpt {runtimeNode?.checkpointCount ?? 0}</span>
          <span className="rounded border border-border px-1.5 py-0.5">art {runtimeNode?.artifactCount ?? 0}</span>
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

function getFlowGramLineEdgeId(line: LineRenderProps['line']) {
  const lineJSON = line.toJSON?.() as { data?: { id?: string } } | undefined;
  return lineJSON?.data?.id || '';
}

function FlowGramLineInsertButton({
  line,
  selectedEdgeId,
  firstInsertableType,
  onSelectEdge,
  onInsertNodeOnEdge,
}: {
  line: LineRenderProps['line'];
  selectedEdgeId: string;
  firstInsertableType: WorkflowNode['type'];
  onSelectEdge: (edgeId: string) => void;
  onInsertNodeOnEdge: (edgeId: string, type: WorkflowNode['type']) => void;
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
        onInsertNodeOnEdge(request.edgeId, request.nodeType);
      }}
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
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

function hashFlowGramJSON(json: WorkflowJSON) {
  return JSON.stringify({
    nodes: json.nodes.map((node) => [node.id, node.type, node.meta?.position, node.data?.title]),
    edges: json.edges.map((edge) => [edge.data?.id, edge.sourceNodeID, edge.targetNodeID, edge.data?.mode]),
  });
}

const WorkflowFlowGramEditor = forwardRef<WorkflowFlowGramEditorHandle, WorkflowFlowGramEditorProps>(function WorkflowFlowGramEditor({
  workflow,
  selectedRun,
  runtimeVisualState,
  selectedNodeId,
  selectedEdgeId,
  onWorkflowChange,
  onSelectNode,
  onSelectEdge,
  onInsertNodeOnEdge,
}, ref) {
  const initialData = useMemo(() => workflowDefinitionToFlowGramWorkflowJSON(workflow), [workflow]);
  const flowGramContextRef = useRef<FreeLayoutPluginContext | null>(null);
  const lastContentHash = useRef(hashFlowGramJSON(initialData));
  const nodeRegistries = useMemo(() => buildNodeRegistries(workflow), [workflow]);
  const firstInsertableType = workflow.nodes.find((node) => node.type !== 'join')?.type || 'agent';
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
  }), [syncContextWorkflow]);

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
          runtimeVisualState={runtimeVisualState}
          onSelectNode={onSelectNode}
        />
      ),
    },
    isFlowingLine: (_ctx, line) => {
      const edgeId = getFlowGramLineEdgeId(line);
      return Boolean(edgeId && ['active', 'running', 'waiting_approval'].includes(runtimeVisualState?.edges?.[edgeId]?.status || ''));
    },
    isErrorLine: (_ctx, fromPort, toPort) => {
      const edge = workflow.edges.find((item) => item.from === fromPort?.node?.id && item.to === toPort?.node?.id);
      return Boolean(edge?.id && runtimeVisualState?.edges?.[edge.id]?.status === 'failed');
    },
    isDisabledLine: (_ctx, line) => {
      const edgeId = getFlowGramLineEdgeId(line);
      return Boolean(edgeId && ['blocked', 'skipped', 'cancelled'].includes(runtimeVisualState?.edges?.[edgeId]?.status || ''));
    },
    setLineClassName: (_ctx, line) => {
      const edgeId = getFlowGramLineEdgeId(line);
      const status = edgeId ? runtimeVisualState?.edges?.[edgeId]?.status : '';
      return status ? `workflow-flowgram-line-state-${status}` : undefined;
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
            onInsertNodeOnEdge={onInsertNodeOnEdge}
          />
        ),
      }),
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
  }), [firstInsertableType, handleContentChange, initialData, nodeRegistries, onInsertNodeOnEdge, onSelectEdge, onSelectNode, runtimeVisualState, selectedEdgeId, selectedNodeId, selectedRun, syncHistoryState, workflow]);

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
          <div key={variable.path} className="truncate">{variable.token} · {variable.valueType}</div>
        ))}
        {selectedVariableCatalog.length === 0 && <div>No upstream variables</div>}
      </div>
    </div>
  );
});

export default WorkflowFlowGramEditor;
