import { useCallback, useMemo, useState } from 'react';
import {
  type FreeLayoutPluginContext,
  useClientContext,
  usePlaygroundTools,
} from '@flowgram.ai/free-layout-editor';
import { WorkflowNodePanelService } from '@flowgram.ai/free-node-panel-plugin';
import {
  Clipboard,
  Copy,
  GitBranch,
  Keyboard,
  LayoutGrid,
  LocateFixed,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Route,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import type { WorkflowDefinition, WorkflowNodeType } from '../../../../types/workflow';
import { cn } from '../../../../lib/utils';

type WorkflowNode = WorkflowDefinition['nodes'][number];
type WorkflowEdge = WorkflowDefinition['edges'][number];

type FlowGramNativeOperationLayerProps = {
  workflow: WorkflowDefinition;
  selectedNodeId: string;
  selectedEdgeId: string;
  onAddNodeFallback?: (type: WorkflowNodeType) => void;
  onCopySelection?: () => void;
  onDuplicateSelection?: () => void;
  onDeleteSelection?: () => void;
  onFitSelection?: () => void;
  onOperationComplete?: (ctx: FreeLayoutPluginContext | null) => void;
};

type FlowGramOperationToolbarProps = {
  zoomPercent: number;
  lineType: string;
  interactionMode: string;
  operationFeedback: string;
  humanFeedback: string;
  isMoreOpen: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onAutoLayout: () => void;
  onSwitchLineType: () => void;
  onOpenNodePanel: () => void;
  onToggleMore: () => void;
};

type FlowGramSelectionOperationPanelProps = {
  selectedNode: WorkflowNode | null;
  selectedEdge: WorkflowEdge | null;
  onCopySelection?: () => void;
  onDuplicateSelection?: () => void;
  onDeleteSelection?: () => void;
  onFitSelection?: () => void;
};

function operationLabel(value: unknown) {
  return String(value || 'default').replace(/[_-]+/g, ' ');
}

function OperationButton({
  testId,
  title,
  onClick,
  disabled,
  children,
}: {
  testId: string;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-primary disabled:pointer-events-none disabled:opacity-35"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function FlowGramOperationToolbar({
  zoomPercent,
  lineType,
  interactionMode,
  operationFeedback,
  humanFeedback,
  isMoreOpen,
  onZoomIn,
  onZoomOut,
  onFitView,
  onAutoLayout,
  onSwitchLineType,
  onOpenNodePanel,
  onToggleMore,
}: FlowGramOperationToolbarProps) {
  return (
    <div className="pointer-events-auto flex flex-col gap-1.5" data-testid="workflow-canvas-operation-polish">
      <div
        className="flex h-10 items-center gap-1 rounded-md border border-slate-200 bg-white/90 px-1.5 shadow-[0_1px_4px_rgba(15,23,42,0.05)] backdrop-blur"
        data-testid="workflow-flowgram-primary-actions"
      >
        <button
          type="button"
          data-testid="workflow-flowgram-add-node-operation"
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
          onClick={(event) => {
            event.stopPropagation();
            onOpenNodePanel();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
        <OperationButton testId="workflow-flowgram-fit-view" title="Fit view" onClick={onFitView}>
          <LocateFixed className="h-4 w-4" />
        </OperationButton>
        <div className="hidden h-7 min-w-[46px] items-center justify-center rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 md:flex" data-testid="workflow-flowgram-zoom-state">
          {zoomPercent}%
        </div>
        <OperationButton testId="workflow-flowgram-more-toggle" title="More canvas actions" onClick={onToggleMore}>
          <MoreHorizontal className="h-4 w-4" />
        </OperationButton>
      </div>
      <div className="inline-flex h-7 max-w-[260px] items-center rounded-md border border-slate-200 bg-white/80 px-2 text-[11px] text-slate-500 shadow-[0_1px_3px_rgba(15,23,42,0.04)]" data-testid="workflow-flowgram-operation-toolbar">
        <span className="truncate">{humanFeedback} / {operationFeedback}</span>
      </div>
      {isMoreOpen && (
        <div
          className="flex w-fit items-center gap-0.5 rounded-md border border-slate-200 bg-white p-1 shadow-[0_6px_18px_rgba(15,23,42,0.08)]"
          data-testid="workflow-flowgram-more-actions"
        >
          <OperationButton testId="workflow-flowgram-zoom-in" title="Zoom in" onClick={onZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </OperationButton>
          <OperationButton testId="workflow-flowgram-zoom-out" title="Zoom out" onClick={onZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </OperationButton>
          <OperationButton testId="workflow-flowgram-auto-layout" title="Auto layout" onClick={onAutoLayout}>
            <LayoutGrid className="h-4 w-4" />
          </OperationButton>
          <OperationButton testId="workflow-flowgram-line-type" title={`Switch line type: ${operationLabel(lineType)}`} onClick={onSwitchLineType}>
            <Route className="h-4 w-4" />
          </OperationButton>
          <div className="mx-1 h-4 w-px bg-[rgba(68,83,130,0.18)]" />
          <div className="max-w-[72px] truncate rounded-lg px-2 text-[11px] text-slate-500" data-testid="workflow-flowgram-line-type-state">
            {operationLabel(lineType)}
          </div>
          <div className="hidden items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-slate-500 lg:flex" data-testid="workflow-flowgram-interaction-mode">
            <MousePointer2 className="h-3 w-3" />
            <span>{operationLabel(interactionMode)}</span>
          </div>
          <div className="hidden h-7 items-center gap-2 rounded-[8px] px-1 text-[10px] text-slate-500 xl:flex" data-testid="workflow-flowgram-shortcut-hints">
            <Keyboard className="h-3.5 w-3.5" />
            <span>Del</span>
            <span>Cmd+D</span>
            <span>Cmd+0</span>
          </div>
        </div>
      )}
      <div className="sr-only" data-testid="workflow-flowgram-operation-feedback">
        {operationFeedback}
      </div>
    </div>
  );
}

export function FlowGramSelectionOperationPanel({
  selectedNode,
  selectedEdge,
  onCopySelection,
  onDuplicateSelection,
  onDeleteSelection,
  onFitSelection,
}: FlowGramSelectionOperationPanelProps) {
  const selectedLabel = selectedNode
    ? `Node selected: ${selectedNode.title || selectedNode.id}`
    : selectedEdge
      ? `Connection selected: ${selectedEdge.from} -> ${selectedEdge.to}`
      : 'No node selected';
  const hasSelection = Boolean(selectedNode || selectedEdge);
  if (!hasSelection) return null;

  return (
    <div
      className={cn(
        'pointer-events-auto flex h-10 max-w-[420px] items-center gap-1 rounded-md border border-slate-200 bg-white/95 px-2 text-xs shadow-[0_1px_5px_rgba(15,23,42,0.07)] backdrop-blur',
      )}
      data-testid="workflow-selection-helper"
    >
      {selectedEdge ? <GitBranch className="h-4 w-4 shrink-0 text-primary" /> : <MousePointer2 className="h-4 w-4 shrink-0 text-primary" />}
      <div className="min-w-0 max-w-[180px] truncate text-[11px] font-medium text-slate-700" data-testid="workflow-flowgram-selection-label">
        {selectedLabel}
      </div>
      <div className="mx-1 h-4 w-px shrink-0 bg-[rgba(68,83,130,0.18)]" />
      <div className="flex items-center gap-0.5">
        <OperationButton testId="workflow-flowgram-selection-fit" title="Locate selection" onClick={onFitSelection}>
          <LocateFixed className="h-3.5 w-3.5" />
        </OperationButton>
        <OperationButton testId="workflow-flowgram-selection-copy" title="Copy selection" disabled={!selectedNode} onClick={onCopySelection}>
          <Clipboard className="h-3.5 w-3.5" />
        </OperationButton>
        <OperationButton testId="workflow-flowgram-selection-duplicate" title="Duplicate selection" disabled={!selectedNode} onClick={onDuplicateSelection}>
          <Copy className="h-3.5 w-3.5" />
        </OperationButton>
        <OperationButton testId="workflow-flowgram-selection-delete" title="Delete selection" onClick={onDeleteSelection}>
          <Trash2 className="h-3.5 w-3.5" />
        </OperationButton>
      </div>
    </div>
  );
}

export function FlowGramNativeOperationLayer({
  workflow,
  selectedNodeId,
  selectedEdgeId,
  onAddNodeFallback,
  onCopySelection,
  onDuplicateSelection,
  onDeleteSelection,
  onFitSelection,
  onOperationComplete,
}: FlowGramNativeOperationLayerProps) {
  const ctx = useClientContext();
  const tools = usePlaygroundTools({ minZoom: 0.25, maxZoom: 2 });
  const [operationFeedback, setOperationFeedback] = useState('Canvas ready');
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const selectedNode = useMemo(
    () => workflow.nodes.find((node) => node.id === selectedNodeId) || null,
    [selectedNodeId, workflow.nodes],
  );
  const selectedEdge = useMemo(
    () => workflow.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [selectedEdgeId, workflow.edges],
  );

  const completeOperation = useCallback((label: string) => {
    setOperationFeedback(label);
    onOperationComplete?.(ctx);
  }, [ctx, onOperationComplete]);

  const zoomIn = useCallback(() => {
    tools.zoomin(true);
    completeOperation('Zoomed in');
  }, [completeOperation, tools]);

  const zoomOut = useCallback(() => {
    tools.zoomout(true);
    completeOperation('Zoomed out');
  }, [completeOperation, tools]);

  const fitView = useCallback(() => {
    tools.fitView(true);
    completeOperation('Fit view');
  }, [completeOperation, tools]);

  const autoLayout = useCallback(() => {
    void tools.autoLayout({}).then(() => completeOperation('Auto layout applied'));
  }, [completeOperation, tools]);

  const switchLineType = useCallback(() => {
    const nextType = tools.switchLineType();
    completeOperation(`Line type: ${operationLabel(nextType)}`);
  }, [completeOperation, tools]);

  const openNodePanel = useCallback(() => {
    try {
      const panel = ctx.get(WorkflowNodePanelService);
      void panel.call({
        panelPosition: { x: 280, y: 160 },
        enableSelectPosition: true,
      });
      completeOperation('Node panel opened');
    } catch {
      onAddNodeFallback?.('agent');
      completeOperation('Agent node added');
    }
  }, [completeOperation, ctx, onAddNodeFallback]);

  const humanFeedback = selectedNode
    ? `Node selected: ${selectedNode.title || selectedNode.id}`
    : selectedEdge
      ? 'Connection selected'
      : 'No node selected';

  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-testid="workflow-flowgram-operation-layer">
      <div className="absolute left-3 top-3">
        <FlowGramOperationToolbar
          zoomPercent={Math.round((tools.zoom || 1) * 100)}
          lineType={String(tools.lineType || 'default')}
          interactionMode={String(tools.interactiveType || 'mouse')}
          operationFeedback={operationFeedback}
          humanFeedback={humanFeedback}
          isMoreOpen={isMoreOpen}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFitView={fitView}
          onAutoLayout={autoLayout}
          onSwitchLineType={switchLineType}
          onOpenNodePanel={openNodePanel}
          onToggleMore={() => setIsMoreOpen((current) => !current)}
        />
      </div>
      <div className="absolute bottom-4 right-4">
        <FlowGramSelectionOperationPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onCopySelection={() => {
            onCopySelection?.();
            setOperationFeedback('Selection copied');
          }}
          onDuplicateSelection={() => {
            onDuplicateSelection?.();
            setOperationFeedback('Selection duplicated');
          }}
          onDeleteSelection={() => {
            onDeleteSelection?.();
            setOperationFeedback('Selection deleted');
          }}
          onFitSelection={() => {
            onFitSelection?.();
            fitView();
          }}
        />
      </div>
    </div>
  );
}
