import { Suspense, lazy, type Ref } from 'react';
import { Copy, GitBranch } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { WorkflowDefinition, WorkflowRun, WorkflowNodeType } from '../../../types/workflow';
import type {
  WorkflowFlowGramEditorHandle,
  WorkflowRuntimeVisualState,
} from './WorkflowFlowGramEditor';

const WorkflowFlowGramEditor = lazy(() => import('./WorkflowFlowGramEditor'));

type WorkflowEditorCanvasShellProps = {
  editorRef: Ref<WorkflowFlowGramEditorHandle>;
  workflow: WorkflowDefinition;
  selectedRun: WorkflowRun | null;
  runtimeVisualState: WorkflowRuntimeVisualState | null;
  selectedNodeId: string;
  selectedEdgeId: string;
  selectedCount: number;
  copiedNodeCount: number;
  canUndoWorkflow: boolean;
  canRedoWorkflow: boolean;
  isSimpleMode: boolean;
  isDiagnosticsOpen: boolean;
  layoutMode: string;
  layoutModes: string[];
  minimapFilter: string;
  minimapFilters: string[];
  selectedLayoutLocked: boolean;
  selectedNodeValidationBadges: string[];
  selectedNodeMissingVariableBadges: string[];
  onWorkflowChange: (next: WorkflowDefinition) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onAddNode: (type: WorkflowNodeType) => void;
  onCopySelection: () => void;
  onPasteSelection: () => void;
  onDuplicateSelection: () => void;
  onDeleteSelection: () => void;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
  onLayoutModeChange: (value: string) => void;
  onToggleLayoutLock: () => void;
  onMinimapFilterChange: (value: string) => void;
  onAutoLayout: () => void;
};

export function WorkflowEditorCanvasShell({
  editorRef,
  workflow,
  selectedRun,
  runtimeVisualState,
  selectedNodeId,
  selectedEdgeId,
  selectedCount,
  copiedNodeCount,
  canUndoWorkflow,
  canRedoWorkflow,
  isSimpleMode,
  isDiagnosticsOpen,
  layoutMode,
  layoutModes,
  minimapFilter,
  minimapFilters,
  selectedLayoutLocked,
  selectedNodeValidationBadges,
  selectedNodeMissingVariableBadges,
  onWorkflowChange,
  onSelectNode,
  onSelectEdge,
  onAddNode,
  onCopySelection,
  onPasteSelection,
  onDuplicateSelection,
  onDeleteSelection,
  onUndo,
  onRedo,
  onLayoutModeChange,
  onToggleLayoutLock,
  onMinimapFilterChange,
  onAutoLayout,
}: WorkflowEditorCanvasShellProps) {
  return (
    <div className="relative rounded-md border border-border bg-card/60 p-3 shadow-sm">
      {!isSimpleMode && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-testid="workflow-canvas-controls">
          <div className="text-xs text-muted-foreground" data-testid="workflow-multi-select">
            {workflow.nodes.length} nodes / {workflow.edges.length} edges
            <span className="ml-2 rounded border border-border bg-background px-2 py-1">{selectedCount} selected</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1" data-testid="workflow-copy-paste">
              <button type="button" onClick={onCopySelection} disabled={selectedCount === 0} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Copy</button>
              <button type="button" onClick={onPasteSelection} disabled={copiedNodeCount === 0} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Paste</button>
            </div>
            <button type="button" data-testid="workflow-duplicate-subgraph" onClick={onDuplicateSelection} disabled={selectedCount === 0} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-40">
              <Copy className="h-3.5 w-3.5" />
              Subgraph
            </button>
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1" data-testid="workflow-undo-redo">
              <button type="button" onClick={() => void onUndo()} disabled={!canUndoWorkflow} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Undo</button>
              <button type="button" onClick={() => void onRedo()} disabled={!canRedoWorkflow} className="h-7 rounded px-2 text-xs hover:bg-muted disabled:opacity-40">Redo</button>
            </div>
            <label className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs" data-testid="workflow-layout-mode">
              Layout
              <select value={layoutMode} onChange={(event) => onLayoutModeChange(event.target.value)} className="bg-transparent text-xs outline-none">
                {layoutModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </label>
            <button type="button" data-testid="workflow-layout-lock" onClick={onToggleLayoutLock} disabled={selectedCount === 0} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-40">
              {selectedLayoutLocked && selectedCount > 0 ? 'Unlock layout' : 'Lock layout'}
            </button>
            <label className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs" data-testid="workflow-minimap-filters">
              MiniMap
              <select value={minimapFilter} onChange={(event) => onMinimapFilterChange(event.target.value)} className="bg-transparent text-xs outline-none">
                {minimapFilters.map((filter) => <option key={filter} value={filter}>{filter}</option>)}
              </select>
            </label>
            <button type="button" onClick={onAutoLayout} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted" title="Auto layout">
              <GitBranch className="h-3.5 w-3.5" />
              Apply
            </button>
          </div>
        </div>
      )}
      {!isSimpleMode && (
        <div className="mb-3 grid gap-2 md:grid-cols-4" data-testid="workflow-flowing-lines">
          {[
            ['Running', runtimeVisualState?.summary.running || 0],
            ['Waiting', runtimeVisualState?.summary.waiting || 0],
            ['Failed', runtimeVisualState?.summary.failed || 0],
            ['Artifacts', runtimeVisualState?.summary.artifacts || 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
              <span className="block text-muted-foreground">{label}</span>
              <span className="mt-1 block text-base font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
      )}
      {!isSimpleMode && (
        <div className="mb-3 flex flex-wrap gap-1 text-[10px] text-muted-foreground" data-testid="workflow-graph-validation-badges">
          {selectedNodeMissingVariableBadges.map((badge) => (
            <span key={badge} data-testid="workflow-missing-variable-node-badge" className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{badge}</span>
          ))}
          {selectedNodeValidationBadges.map((badge) => (
            <span key={badge} className="rounded border border-border bg-background px-2 py-1">{badge}</span>
          ))}
        </div>
      )}
      <Suspense fallback={(
        <div className="flex h-[560px] min-w-0 items-center justify-center rounded-md border border-border bg-background text-sm text-muted-foreground" data-testid="workflow-flowgram-loading">
          Loading FlowGram editor...
        </div>
      )}
      >
        <WorkflowFlowGramEditor
          ref={editorRef}
          workflow={workflow}
          selectedRun={selectedRun}
          runtimeVisualState={runtimeVisualState}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onWorkflowChange={onWorkflowChange}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onAddNode={onAddNode}
          onCopySelection={onCopySelection}
          onDuplicateSelection={onDuplicateSelection}
          onDeleteSelection={onDeleteSelection}
          showDiagnostics={!isSimpleMode || isDiagnosticsOpen}
        />
      </Suspense>
    </div>
  );
}
