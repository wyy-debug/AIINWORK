import { Check, ClipboardCheck, Copy, Play, Plus, Star, Upload } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { WorkflowDefinition } from '../../../types/workflow';

export type WorkflowLibraryFilter = 'All' | 'Built-in' | 'Enterprise' | 'Needs setup' | 'Recently used';

type WorkflowLibraryViewProps = {
  draft: WorkflowDefinition;
  filteredWorkflows: WorkflowDefinition[];
  selectedWorkflowId: string;
  favoriteWorkflowIds: string[];
  libraryFilters: WorkflowLibraryFilter[];
  libraryFilter: WorkflowLibraryFilter;
  templateSmokeStatusById: Record<string, string>;
  getTemplateManifest: (workflow: WorkflowDefinition) => Record<string, any>;
  onSelectWorkflow: (workflow: WorkflowDefinition) => void;
  onCreateBlankWorkflow: () => void;
  onDuplicateWorkflow: () => void;
  onImportPackage: () => void;
  onSetLibraryFilter: (filter: WorkflowLibraryFilter) => void;
  onToggleFavoriteWorkflow: (workflowId: string) => void;
  onRunWorkflow: (workflow: WorkflowDefinition) => void;
  onCloneWorkflow: (workflow: WorkflowDefinition) => void | Promise<void>;
  onSmokeTemplate: (workflow: WorkflowDefinition) => void | Promise<void>;
};

export function WorkflowLibraryView({
  draft,
  filteredWorkflows,
  selectedWorkflowId,
  favoriteWorkflowIds,
  libraryFilters,
  libraryFilter,
  templateSmokeStatusById,
  getTemplateManifest,
  onSelectWorkflow,
  onCreateBlankWorkflow,
  onDuplicateWorkflow,
  onImportPackage,
  onSetLibraryFilter,
  onToggleFavoriteWorkflow,
  onRunWorkflow,
  onCloneWorkflow,
  onSmokeTemplate,
}: WorkflowLibraryViewProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5" data-testid="workflow-library">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Template gallery</h2>
          <p className="text-sm text-muted-foreground">Choose a workflow, inspect dependencies, then run or clone it into this project.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCreateBlankWorkflow} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
            <Plus className="h-4 w-4" />
            New workflow
          </button>
          <button type="button" onClick={onDuplicateWorkflow} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
            <ClipboardCheck className="h-4 w-4" />
            Duplicate
          </button>
          <button type="button" onClick={onImportPackage} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
            <Upload className="h-4 w-4" />
            Import
          </button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {libraryFilters.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => onSetLibraryFilter(filter)}
            className={cn('rounded-md border px-3 py-1.5 text-xs', libraryFilter === filter ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}
          >
            {filter}
          </button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="workflow-library-gallery">
          {filteredWorkflows.map((workflow) => {
            const manifest = getTemplateManifest(workflow);
            const tags = Array.isArray(manifest.tags) ? manifest.tags.slice(0, 2).join(', ') : 'workflow';
            return (
              <div
                role="button"
                tabIndex={0}
                key={workflow.id}
                data-testid="workflow-library-item"
                onClick={() => onSelectWorkflow(workflow)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectWorkflow(workflow);
                }}
                className={cn(
                  'rounded-md border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40',
                  workflow.id === selectedWorkflowId ? 'border-primary' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">{workflow.name}</h3>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavoriteWorkflow(workflow.id);
                    }}
                    className="rounded border border-border p-1 hover:bg-muted"
                    title={favoriteWorkflowIds.includes(workflow.id) ? 'Remove favorite' : 'Add favorite'}
                  >
                    <Star className={cn('h-3.5 w-3.5', favoriteWorkflowIds.includes(workflow.id) ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
                  </button>
                </div>
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{workflow.description || 'No description.'}</p>
                <div className="mt-3 rounded border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid="workflow-template-manifest">
                  <span className="font-semibold text-foreground">Template</span>
                  <span className="ml-2">{String(manifest.version || workflow.metadata?.version || 'local')}</span>
                  <span className="ml-2">{tags}</span>
                  <span className="ml-2" data-testid="workflow-template-smoke-status">
                    smoke: {templateSmokeStatusById[workflow.id] || 'not run'}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded border border-border px-2 py-1">{workflow.nodes.length} nodes</span>
                  <span className="rounded border border-border px-2 py-1">{workflow.edges.length} edges</span>
                  <span className="rounded border border-border px-2 py-1">{workflow.profileId}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRunWorkflow(workflow);
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run
                  </button>
                  <button
                    type="button"
                    data-testid="workflow-clone-template"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCloneWorkflow(workflow);
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs hover:bg-muted"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Clone
                  </button>
                  <button
                    type="button"
                    data-testid="workflow-smoke-template"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onSmokeTemplate(workflow);
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs hover:bg-muted"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Smoke
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <aside className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-template-preview">
          <h3 className="text-sm font-semibold text-foreground">{draft.name}</h3>
          <p className="mt-2 text-xs text-muted-foreground">{draft.description || 'No description.'}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <span className="rounded border border-border px-2 py-1">{draft.nodes.length} nodes</span>
            <span className="rounded border border-border px-2 py-1">{draft.edges.length} edges</span>
            <span className="rounded border border-border px-2 py-1">{draft.permissionPreset}</span>
            <span className="rounded border border-border px-2 py-1">{draft.inputs.length} inputs</span>
          </div>
          <div className="mt-4 rounded border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            Expected outputs: {(draft.outputs || []).map((output) => output.label || output.id).join(', ') || 'summary'}
          </div>
        </aside>
      </div>
    </div>
  );
}
