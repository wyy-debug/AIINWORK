import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  Command,
  ExternalLink,
  GitBranch,
  HelpCircle,
  History,
  Home,
  Keyboard,
  LibraryBig,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Save,
} from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { WorkflowDefinition, WorkflowRun } from '../../../types/workflow';

export type WorkflowCommandCenterView = 'Home' | 'Library' | 'Editor' | 'Runs';
export type WorkflowCommandCenterUiMode = 'simple' | 'advanced';

export type WorkflowCommandCenterDiagnostics = {
  workflowName: string;
  workGraphSchemaVersion: string | number;
  workGraphNodeCount: number;
  workGraphEdgeCount: number;
  compatibilityOk: boolean;
  compatibilityWarningCount: number;
  migrationDoctorStatus: string;
  migrationDoctorChecked: number;
  migrationDoctorFindingCount: number;
  runtimeLabel: string;
  releaseGates: Array<{ id: string; label: string; status: string }>;
};

type WorkflowCommandCenterProps = {
  activeView: WorkflowCommandCenterView;
  views: WorkflowCommandCenterView[];
  draft: WorkflowDefinition;
  selectedRunStatus?: WorkflowRun['status'] | null;
  uiMode: WorkflowCommandCenterUiMode;
  isSimpleMode: boolean;
  isBusy: boolean;
  isMoreOpen: boolean;
  isDiagnosticsOpen: boolean;
  isRunSetupOpen: boolean;
  runInputs: Record<string, string>;
  diagnostics: WorkflowCommandCenterDiagnostics;
  onSetActiveView: (view: WorkflowCommandCenterView) => void;
  onAddStep: () => void;
  onSaveWorkflow: () => void;
  onOpenRunSetup: () => void;
  onCloseRunSetup: () => void;
  onStartRun: () => void | Promise<void>;
  onRunInputChange: (inputId: string, value: string) => void;
  onToggleUiMode: () => void;
  onToggleMore: () => void;
  onOpenCommandPalette: () => void;
  onRefreshData: () => void | Promise<void>;
  onRunBenchmarks: () => void;
  onOpenHelp: () => void;
  onOpenShortcuts: () => void;
  onToggleDiagnostics: () => void;
  onOpenWorkflowDeepLink: (workflowId: string, view: WorkflowCommandCenterView) => void;
};

function viewIcon(view: WorkflowCommandCenterView) {
  if (view === 'Home') return Home;
  if (view === 'Library') return LibraryBig;
  if (view === 'Editor') return GitBranch;
  return History;
}

export function WorkflowCommandCenter({
  activeView,
  views,
  draft,
  selectedRunStatus,
  uiMode,
  isSimpleMode,
  isBusy,
  isMoreOpen,
  isDiagnosticsOpen,
  isRunSetupOpen,
  runInputs,
  diagnostics,
  onSetActiveView,
  onAddStep,
  onSaveWorkflow,
  onOpenRunSetup,
  onCloseRunSetup,
  onStartRun,
  onRunInputChange,
  onToggleUiMode,
  onToggleMore,
  onOpenCommandPalette,
  onRefreshData,
  onRunBenchmarks,
  onOpenHelp,
  onOpenShortcuts,
  onToggleDiagnostics,
  onOpenWorkflowDeepLink,
}: WorkflowCommandCenterProps) {
  return (
    <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-2.5 sm:px-5" data-testid="workflow-command-center">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" data-testid="workflow-modern-desktop-shell">
        <div className="min-w-0 flex-1" data-testid="workflow-quiet-default-header">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm">
              <GitBranch className="h-4 w-4 text-primary" />
            </span>
            <h1 className="text-base font-semibold leading-tight text-foreground sm:truncate">Agent Workflow Studio</h1>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                isSimpleMode ? 'border-slate-200 bg-white text-slate-600' : 'border-slate-300 bg-slate-100 text-slate-700',
              )}
              data-testid="workflow-simple-mode"
              data-mode={uiMode}
            >
              {isSimpleMode ? 'Simple Mode' : 'Advanced Mode'}
            </span>
            <span className="min-w-0 truncate text-xs text-slate-500" data-testid="workflow-quiet-meta">
              {draft.name} / {draft.profileId} / {draft.permissionPreset} / {selectedRunStatus || 'draft'}
            </span>
          </div>
          <div className="sr-only" data-testid="workflow-breadcrumb">
            <button type="button" onClick={() => onSetActiveView('Home')} className="hover:text-foreground">Workflows</button>
            <ChevronRight className="h-3 w-3" />
            <button type="button" onClick={() => onSetActiveView(activeView)} className="hover:text-foreground">{activeView}</button>
            <ChevronRight className="h-3 w-3" />
            <button type="button" onClick={() => onOpenWorkflowDeepLink(draft.id, activeView)} className="inline-flex min-w-0 items-center gap-1 hover:text-foreground">
              <span className="truncate">{draft.name}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </button>
          </div>
          <p className="sr-only">Build and run an agent workflow for this project.</p>
        </div>
        <div className="relative flex w-full flex-col items-stretch gap-2 sm:w-auto sm:max-w-xl sm:items-end" data-testid="workflow-command-rail">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 sm:flex sm:flex-wrap sm:justify-end">
            {activeView === 'Editor' && (
              <button type="button" data-testid="workflow-add-step-primary" onClick={onAddStep} className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm hover:bg-slate-50 sm:inline-flex">
                <Plus className="h-4 w-4" />
                Add step
              </button>
            )}
            {activeView === 'Editor' && (
              <button type="button" data-testid="workflow-save" onClick={onSaveWorkflow} disabled={isBusy} className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-50 sm:inline-flex">
                <Save className="h-4 w-4" />
                Save
              </button>
            )}
            <button type="button" data-testid="workflow-run" onClick={onOpenRunSetup} disabled={isBusy || draft.nodes.length === 0} className="hidden h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:inline-flex">
              <Play className="h-4 w-4" />
              Run
            </button>
            <button type="button" data-testid="workflow-mobile-run" onClick={onOpenRunSetup} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:hidden">
              <Play className="h-4 w-4" />
              Run
            </button>
            <button
              type="button"
              data-testid="workflow-advanced-toggle"
              onClick={onToggleUiMode}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm hover:bg-slate-50"
            >
              {isSimpleMode ? 'Advanced' : 'Simple'}
            </button>
            <button
              type="button"
              onClick={onToggleMore}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
              title="More workflow actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          {isMoreOpen && (
            <div className="absolute right-0 top-11 z-40 w-56 rounded-md border border-border bg-background p-2 text-sm shadow-xl">
              <button type="button" onClick={onOpenCommandPalette} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                <Command className="h-4 w-4" />
                Command palette
              </button>
              <button type="button" onClick={() => void onRefreshData()} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                <RefreshCw className="h-4 w-4" />
                Refresh data
              </button>
              <button type="button" data-testid="workflow-run-benchmarks" onClick={onRunBenchmarks} disabled={isBusy} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted disabled:opacity-50">
                <ClipboardCheck className="h-4 w-4" />
                Benchmarks
              </button>
              <button type="button" onClick={onOpenHelp} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                <HelpCircle className="h-4 w-4" />
                Help
              </button>
              <button type="button" onClick={onOpenShortcuts} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                <Keyboard className="h-4 w-4" />
                Shortcuts
              </button>
              <button type="button" onClick={onToggleDiagnostics} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted">
                <AlertTriangle className="h-4 w-4" />
                {isDiagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
              </button>
            </div>
          )}
        </div>
      </div>
      {isDiagnosticsOpen && (
        <div className="mt-4 rounded-md border border-border bg-card p-3" data-testid="workflow-diagnostics-drawer">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border bg-background px-2 py-1">Workflow: {diagnostics.workflowName}</span>
            <span className="rounded-md border border-border bg-background px-2 py-1" data-testid="workflow-flowgram-adapter">
              WorkGraph: {diagnostics.workGraphSchemaVersion} / {diagnostics.workGraphNodeCount} nodes / {diagnostics.workGraphEdgeCount} edges
            </span>
            <span className={cn('rounded-md border px-2 py-1', diagnostics.compatibilityOk ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')} data-testid="workflow-migration-compatibility">
              Compatibility: {diagnostics.compatibilityOk ? 'ready' : 'needs review'} ({diagnostics.compatibilityWarningCount})
            </span>
            <span className={cn('rounded-md border px-2 py-1', diagnostics.migrationDoctorStatus === 'pass' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : diagnostics.migrationDoctorStatus === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700')} data-testid="workflow-migration-doctor-local">
              Migration doctor: {diagnostics.migrationDoctorStatus} / {diagnostics.migrationDoctorChecked} checked / {diagnostics.migrationDoctorFindingCount} findings
            </span>
            <span className="rounded-md border border-border bg-background px-2 py-1" data-testid="workflow-runtime-state-bridge">
              Runtime: {diagnostics.runtimeLabel}
            </span>
            {diagnostics.releaseGates.map((gate) => (
              <span key={gate.id} className="rounded-md border border-border bg-background px-2 py-1" data-testid="workflow-release-readiness">
                {gate.label}: {gate.status}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm" data-testid="workflow-view-tabs">
        {views.map((view) => {
          const Icon = viewIcon(view);
          return (
            <button
              key={view}
              type="button"
              onClick={() => onSetActiveView(view)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded px-3 text-sm transition-colors',
                activeView === view ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon className="h-4 w-4" />
              {view}
            </button>
          );
        })}
      </div>
      {isRunSetupOpen && (
        <div className="mt-4 rounded-md border border-primary/30 bg-background p-3 shadow-sm" data-testid="workflow-run-setup-drawer">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Run setup</h3>
              <p className="text-xs text-muted-foreground">{draft.inputs.length} input field{draft.inputs.length === 1 ? '' : 's'} before execution.</p>
            </div>
            <button type="button" onClick={onCloseRunSetup} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Close</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="workflow-run-inputs">
            {draft.inputs.map((input) => (
              <label key={input.id} className="text-xs font-medium text-muted-foreground">
                {input.label || input.id}{input.required ? ' *' : ''}
                {input.type === 'textarea' ? (
                  <textarea
                    data-testid="workflow-run-input"
                    value={runInputs[input.id] ?? ''}
                    onChange={(event) => onRunInputChange(input.id, event.target.value)}
                    className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  />
                ) : (
                  <input
                    data-testid="workflow-run-input"
                    value={runInputs[input.id] ?? ''}
                    onChange={(event) => onRunInputChange(input.id, event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onCloseRunSetup} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">Cancel</button>
            <button type="button" onClick={() => void onStartRun()} disabled={isBusy || draft.nodes.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Play className="h-4 w-4" />
              Start run
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
