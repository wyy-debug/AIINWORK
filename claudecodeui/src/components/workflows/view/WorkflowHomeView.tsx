import { Command, HelpCircle, History, LibraryBig, Plus, Star, Upload, Wand2 } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { WorkflowDefinition, WorkflowRun } from '../../../types/workflow';

type WorkflowStatusTaxonomyItem = {
  status: string;
  label: string;
  description: string;
};

type WorkflowHomeViewProps = {
  workflows: WorkflowDefinition[];
  runs: WorkflowRun[];
  failedRuns: WorkflowRun[];
  pendingApprovalRuns: WorkflowRun[];
  draft: WorkflowDefinition;
  recentWorkflows: WorkflowDefinition[];
  favoriteWorkflows: WorkflowDefinition[];
  statusTaxonomy: WorkflowStatusTaxonomyItem[];
  statusTone: Record<string, string>;
  onOpenLibrary: () => void;
  onCreateBlankWorkflow: () => void;
  onImportPackage: () => void;
  onOpenRunSetup: () => void;
  onOpenWorkflow: (workflowId: string) => void;
  onOpenCommandPalette: () => void;
  onOpenRuns: () => void;
  onOpenHelp: () => void;
};

export function WorkflowHomeView({
  workflows,
  runs,
  failedRuns,
  pendingApprovalRuns,
  draft,
  recentWorkflows,
  favoriteWorkflows,
  statusTaxonomy,
  statusTone,
  onOpenLibrary,
  onCreateBlankWorkflow,
  onImportPackage,
  onOpenRunSetup,
  onOpenWorkflow,
  onOpenCommandPalette,
  onOpenRuns,
  onOpenHelp,
}: WorkflowHomeViewProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5" data-testid="workflow-home-overview">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-4">
          <section className="grid gap-3 md:grid-cols-4">
            {[
              ['Workflows', workflows.length],
              ['Recent runs', runs.length],
              ['Failed work', failedRuns.length],
              ['Approvals', pendingApprovalRuns.length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border bg-card p-4 shadow-sm">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
              </div>
            ))}
          </section>

          {workflows.length === 0 && (
            <section className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-4" data-testid="workflow-empty-state-guide">
              <h2 className="text-sm font-semibold text-foreground">Start your first workflow</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose the fastest path for this project: template, blank workflow, or package import.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={onOpenLibrary} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                  <LibraryBig className="h-4 w-4" />
                  Start from template
                </button>
                <button type="button" onClick={onCreateBlankWorkflow} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                  <Plus className="h-4 w-4" />
                  New blank
                </button>
                <button type="button" onClick={onImportPackage} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                  <Upload className="h-4 w-4" />
                  Import package
                </button>
              </div>
            </section>
          )}

          <section className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-first-run-wizard">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">First run wizard</h2>
                <p className="mt-1 text-sm text-muted-foreground">Pick a workflow, confirm profile and inputs, then run a minimal approval-to-artifact path.</p>
              </div>
              <button type="button" onClick={onOpenRunSetup} disabled={draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                <Wand2 className="h-4 w-4" />
                Prepare first run
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded border border-border bg-background p-3 text-xs">
                <span className="font-semibold text-foreground">1. Workflow</span>
                <span className="mt-1 block text-muted-foreground">{draft.name}</span>
              </div>
              <div className="rounded border border-border bg-background p-3 text-xs">
                <span className="font-semibold text-foreground">2. Profile</span>
                <span className="mt-1 block text-muted-foreground">{draft.profileId} / {draft.permissionPreset}</span>
              </div>
              <div className="rounded border border-border bg-background p-3 text-xs">
                <span className="font-semibold text-foreground">3. Inputs</span>
                <span className="mt-1 block text-muted-foreground">{draft.inputs.length} field{draft.inputs.length === 1 ? '' : 's'} required before run.</span>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-recent-objects">
              <h2 className="text-sm font-semibold text-foreground">Recent objects</h2>
              <div className="mt-3 space-y-2">
                {recentWorkflows.map((workflow) => (
                  <button key={workflow.id} type="button" onClick={() => onOpenWorkflow(workflow.id)} className="flex w-full items-center justify-between rounded border border-border px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="truncate">{workflow.name}</span>
                    <span className="text-xs text-muted-foreground">{workflow.nodes.length} nodes</span>
                  </button>
                ))}
                {recentWorkflows.length === 0 && <div className="rounded border border-dashed border-border p-4 text-sm text-muted-foreground">Recent workflows appear after you open or run one.</div>}
              </div>
            </div>
            <div className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-favorites">
              <h2 className="text-sm font-semibold text-foreground">Favorites</h2>
              <div className="mt-3 space-y-2">
                {favoriteWorkflows.map((workflow) => (
                  <button key={workflow.id} type="button" onClick={() => onOpenWorkflow(workflow.id)} className="flex w-full items-center justify-between rounded border border-border px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="truncate">{workflow.name}</span>
                    <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                  </button>
                ))}
                {favoriteWorkflows.length === 0 && <div className="rounded border border-dashed border-border p-4 text-sm text-muted-foreground">Star workflows in Library to keep them here.</div>}
              </div>
            </div>
          </section>
        </main>

        <aside className="space-y-4">
          <section className="rounded-md border border-border bg-card p-4 shadow-sm" data-testid="workflow-status-taxonomy">
            <h2 className="text-sm font-semibold text-foreground">Status taxonomy</h2>
            <div className="mt-3 space-y-2">
              {statusTaxonomy.map((item) => (
                <div key={item.status} className="rounded border border-border bg-background p-2 text-xs">
                  <span className={cn('inline-flex rounded-full border px-2 py-0.5', statusTone[item.status] || statusTone.pending)}>{item.label}</span>
                  <p className="mt-1 text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-md border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">Next actions</h2>
            <div className="mt-3 grid gap-2">
              <button type="button" onClick={onOpenCommandPalette} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                <Command className="h-4 w-4" />
                Search commands
              </button>
              <button type="button" onClick={onOpenRuns} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                <History className="h-4 w-4" />
                Review failed work
              </button>
              <button type="button" onClick={onOpenHelp} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                <HelpCircle className="h-4 w-4" />
                Open help
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
