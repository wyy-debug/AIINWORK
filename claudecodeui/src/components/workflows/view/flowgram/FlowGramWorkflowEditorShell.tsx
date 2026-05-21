import 'reflect-metadata';
import '@flowgram.ai/free-layout-editor/index.css';

import { forwardRef, useImperativeHandle } from 'react';
import { FreeLayoutEditor } from '@flowgram.ai/free-layout-editor';

import type { WorkflowDefinition, WorkflowRun } from '../../../../types/workflow';
import type {
  WorkflowFlowGramEditorHandle,
  WorkflowRuntimeVisualState,
} from './FlowGramWorkflowTypes';
import { useWorkflowFlowGramEditorProps } from './FlowGramWorkflowEditorProps';
import { FlowGramNativeOperationLayer } from './FlowGramWorkflowOperations';

type WorkflowFlowGramEditorProps = {
  workflow: WorkflowDefinition;
  selectedRun: WorkflowRun | null;
  runtimeVisualState?: WorkflowRuntimeVisualState | null;
  selectedNodeId: string;
  selectedEdgeId: string;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onAddNode?: (type: WorkflowDefinition['nodes'][number]['type']) => void;
  onCopySelection?: () => void;
  onDuplicateSelection?: () => void;
  onDeleteSelection?: () => void;
  showDiagnostics?: boolean;
};

const FlowGramWorkflowEditorShell = forwardRef<WorkflowFlowGramEditorHandle, WorkflowFlowGramEditorProps>(function FlowGramWorkflowEditorShell(props, ref) {
  const {
    workflow,
  } = props;
  const {
    editorProps,
    flowGramContextRef,
    historyState,
    syncContextWorkflow,
    insertNodeOnEdge,
    variablePanelState,
  } = useWorkflowFlowGramEditorProps(props);

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
    async zoomIn() {
      const playgroundConfig = (flowGramContextRef.current as unknown as { playground?: { config?: { zoomin?: (easing?: boolean) => void } } } | null)?.playground?.config;
      playgroundConfig?.zoomin?.(true);
    },
    async zoomOut() {
      const playgroundConfig = (flowGramContextRef.current as unknown as { playground?: { config?: { zoomout?: (easing?: boolean) => void } } } | null)?.playground?.config;
      playgroundConfig?.zoomout?.(true);
    },
    async autoLayout() {
      await flowGramContextRef.current?.tools?.autoLayout?.({});
      syncContextWorkflow(flowGramContextRef.current);
    },
    insertNodeOnEdge,
  }), [flowGramContextRef, insertNodeOnEdge, syncContextWorkflow]);

  return (
    <div
      className="relative h-[680px] min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-950/5 shadow-sm"
      data-testid="workflow-dag-canvas"
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.12)_1px,transparent_0)] [background-size:22px_22px]"
        data-testid="workflow-canvas-surface-modern"
      />
      <div className="absolute left-3 right-3 top-3 z-20 flex h-10 items-center justify-between rounded-md border border-slate-200 bg-white/92 px-3 shadow-sm backdrop-blur" data-testid="workflow-canvas-surface-titlebar">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{workflow.name}</div>
          <div className="text-[11px] text-slate-500">{workflow.nodes.length} steps / {workflow.edges.length} connections</div>
        </div>
        <div className="hidden items-center gap-1 text-[11px] text-slate-500 md:flex">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">FlowGram canvas</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{props.selectedRun?.status || 'draft'}</span>
        </div>
      </div>
      <div className="h-full w-full pt-10" data-testid="workflow-flowgram-free-layout-editor">
        <FreeLayoutEditor ref={flowGramContextRef} key={`${workflow.id}:${workflow.nodes.map((node) => node.id).join(',')}:${workflow.edges.map((edge) => edge.id).join(',')}`} {...editorProps}>
          <FlowGramNativeOperationLayer
            workflow={workflow}
            selectedNodeId={props.selectedNodeId}
            selectedEdgeId={props.selectedEdgeId}
            onAddNodeFallback={props.onAddNode}
            onCopySelection={props.onCopySelection}
            onDuplicateSelection={props.onDuplicateSelection}
            onDeleteSelection={props.onDeleteSelection}
            onFitSelection={() => void flowGramContextRef.current?.tools?.fitView?.(true)}
            onOperationComplete={syncContextWorkflow}
          />
        </FreeLayoutEditor>
      </div>
      {props.showDiagnostics && (
        <div data-testid="workflow-flowgram-diagnostics-layer">
          <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md border border-emerald-200 bg-emerald-50/90 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-700 shadow-sm" data-testid="workflow-flowgram-runtime-boundary">
            Diagnostics: editor boundary / runtime executes
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground shadow-sm" data-testid="workflow-minimap">
            FlowGram minimap
          </div>
          <div className="pointer-events-none absolute left-3 bottom-3 z-20 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground shadow-sm" data-testid="workflow-flowgram-history-state">
            Undo {historyState.canUndo ? 'ready' : 'empty'} / Redo {historyState.canRedo ? 'ready' : 'empty'}
          </div>
          <div className="pointer-events-none absolute right-3 top-3 z-20 max-w-xs rounded-md border border-border bg-background/90 p-2 text-[10px] text-muted-foreground shadow-sm" data-testid="workflow-flowgram-variable-catalog">
            <div className="font-semibold uppercase tracking-wide text-foreground">Variables</div>
            {variablePanelState.variables.slice(0, 4).map((variable) => (
              <div key={variable.path} className="truncate">{variable.token} / {variable.valueType}</div>
            ))}
            {variablePanelState.variables.length === 0 && <div>No upstream variables</div>}
          </div>
        </div>
      )}
    </div>
  );
});

export default FlowGramWorkflowEditorShell;
