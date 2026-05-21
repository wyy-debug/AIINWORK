import type { LineRenderProps } from '@flowgram.ai/free-lines-plugin';
import type { NodePanelRenderProps } from '@flowgram.ai/free-node-panel-plugin';
import { Plus } from 'lucide-react';

import type { WorkflowNodeType } from '../../../../types/workflow';
import { cn } from '../../../../lib/utils';
import { createWorkflowNodeRegistry } from '../../model/workflowNodeRegistry';
import { buildFlowGramWorkflowNodeRegistries } from './FlowGramWorkflowNodeRegistry';
import type { WorkflowLineInsertRequest } from './FlowGramWorkflowTypes';
import { getWorkflowLineId } from './FlowGramWorkflowLineGuards';

export function FlowGramLineInsertButton({
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
  const edgeId = getWorkflowLineId(line);
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

export function FlowGramNodePanel({ onSelect, onClose }: NodePanelRenderProps) {
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
