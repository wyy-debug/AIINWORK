import { AlertTriangle, Download, LibraryBig, Plus, Save, Wand2 } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { AgentConfig } from '../../../types/agent';
import type { WorkflowDefinition } from '../../../types/workflow';
import type { WorkflowHumanHint } from './WorkflowStudioViewModel';

type WorkflowDryRunPreview = {
  workflowId?: string;
  nodeCount?: number;
  blockedCount?: number;
  nodes?: Array<{
    nodeId?: string;
    type?: string;
    title?: string;
    resolvedInput?: Record<string, unknown>;
    permissionDecision?: string;
    upstream?: Array<{ nodeId?: string; mode?: string }>;
    blocked?: boolean;
    errors?: Array<{
      code?: string;
      message?: string;
    }>;
  }>;
};

type WorkflowMissingVariableDiagnostic = {
  nodeId: string;
  nodeTitle: string;
  field: string;
  variable: string;
  code: string;
  message: string;
};

type WorkflowEditorSetupStripProps = {
  isSimpleMode: boolean;
  isDiagnosticsOpen: boolean;
  isBusy: boolean;
  draft: WorkflowDefinition;
  humanNextAction: WorkflowHumanHint;
  agentOptions: AgentConfig[];
  validationMessages: string[];
  dryRunMessages: string[];
  missingVariableDiagnostics: WorkflowMissingVariableDiagnostic[];
  dryRunPreview: WorkflowDryRunPreview | null;
  stringifyValue: (value: unknown) => string;
  onAddAgentStep: () => void;
  onOpenCustomNodeReview: () => void;
  onOpenLibrary: () => void;
  onUpdateDraft: (patch: Partial<WorkflowDefinition>) => void;
  onSaveWorkflow: () => void;
  onValidateRun: () => void | Promise<void>;
  onExportDraft: () => void | Promise<void>;
  onSelectMissingVariableDiagnostic: (diagnostic: WorkflowMissingVariableDiagnostic) => void;
};

export function WorkflowEditorSetupStrip({
  isSimpleMode,
  isDiagnosticsOpen,
  isBusy,
  draft,
  humanNextAction,
  agentOptions,
  validationMessages,
  dryRunMessages,
  missingVariableDiagnostics,
  dryRunPreview,
  stringifyValue,
  onAddAgentStep,
  onOpenCustomNodeReview,
  onOpenLibrary,
  onUpdateDraft,
  onSaveWorkflow,
  onValidateRun,
  onExportDraft,
  onSelectMissingVariableDiagnostic,
}: WorkflowEditorSetupStripProps) {
  return (
    <>
      {isSimpleMode ? (
        <section className="mb-2 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" data-testid="workflow-guided-builder">
          <div className="flex min-h-12 items-center justify-between gap-3 border-l-4 border-slate-900 px-3 py-2" data-testid="workflow-editor-setup-strip" data-density="compact">
            <div className="min-w-0" data-testid="workflow-canvas-first-rail">
              <div data-testid="workflow-editor-quick-path">
                <div data-testid="workflow-human-next-action" className="flex min-w-0 items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Next</span>
                  <h2 className="truncate text-sm font-semibold text-foreground">{humanNextAction.title}</h2>
                  <span className="hidden truncate text-sm text-muted-foreground xl:inline">{humanNextAction.body}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={onAddAgentStep} className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                <Plus className="h-3.5 w-3.5" />
                Add step
              </button>
              <button type="button" data-testid="workflow-generate-custom-node" onClick={onOpenCustomNodeReview} className="inline-flex h-8 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-700 hover:bg-violet-100">
                <Wand2 className="h-3.5 w-3.5" />
                Generate node
              </button>
              <button type="button" onClick={onOpenLibrary} className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs hover:bg-muted">
                <LibraryBig className="h-3.5 w-3.5" />
                Templates
              </button>
            </div>
          </div>
          <details className="border-t border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600" data-testid="workflow-editor-metadata-details">
            <summary className="cursor-pointer font-medium text-slate-700">Workflow settings · {draft.profileId} · {draft.permissionPreset}</summary>
            <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1.35fr)_140px_160px]">
              <label className="text-[11px] font-medium text-muted-foreground">
                Workflow name
                <input value={draft.name} onChange={(event) => onUpdateDraft({ name: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground" />
              </label>
              <label className="text-[11px] font-medium text-muted-foreground">
                Profile
                <select value={draft.profileId} onChange={(event) => onUpdateDraft({ profileId: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground">
                  <option value="build">build</option>
                  <option value="plan">plan</option>
                  {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-medium text-muted-foreground">
                Permission preset
                <select value={draft.permissionPreset} onChange={(event) => onUpdateDraft({ permissionPreset: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground">
                  <option value="suggest">Suggest</option>
                  <option value="auto-edit">Auto Edit</option>
                  <option value="full-auto">Full Auto</option>
                  <option value="enterprise-safe">Enterprise Safe</option>
                </select>
              </label>
            </div>
          </details>
        </section>
      ) : (
        <>
          <section className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3" data-testid="workflow-guided-builder">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-blue-950">{humanNextAction.title}</div>
                <p className="mt-1 text-sm text-blue-700">{humanNextAction.body}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onAddAgentStep} className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                  <Plus className="h-3.5 w-3.5" />
                  Add step
                </button>
                <button type="button" data-testid="workflow-generate-custom-node" onClick={onOpenCustomNodeReview} className="inline-flex h-8 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-700 hover:bg-violet-100">
                  <Wand2 className="h-3.5 w-3.5" />
                  Generate node
                </button>
                <button type="button" onClick={onOpenLibrary} className="inline-flex h-8 items-center gap-2 rounded-md border border-blue-200 bg-background px-3 text-xs hover:bg-blue-100">
                  <LibraryBig className="h-3.5 w-3.5" />
                  Templates
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-blue-800 sm:grid-cols-4">
              {['Choose', 'Configure', 'Run', 'Review'].map((step, index) => (
                <div key={step} className={cn('rounded-md border px-2 py-1', index === 1 ? 'border-blue-300 bg-background text-blue-900' : 'border-blue-200 bg-blue-100/60')}>
                  {index + 1}. {step}
                </div>
              ))}
            </div>
          </section>
          <div className="mb-3 grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium text-muted-foreground">
              Name
              <input value={draft.name} onChange={(event) => onUpdateDraft({ name: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground" />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Agent Profile
              <select value={draft.profileId} onChange={(event) => onUpdateDraft({ profileId: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                <option value="build">build</option>
                <option value="plan">plan</option>
                {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Permission preset
              <select value={draft.permissionPreset} onChange={(event) => onUpdateDraft({ permissionPreset: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
                <option value="suggest">Suggest</option>
                <option value="auto-edit">Auto Edit</option>
                <option value="full-auto">Full Auto</option>
                <option value="enterprise-safe">Enterprise Safe</option>
              </select>
            </label>
          </div>
        </>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {!isSimpleMode && (
          <button type="button" data-testid="workflow-save" onClick={onSaveWorkflow} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <Save className="h-4 w-4" />
            Save
          </button>
        )}
        {(!isSimpleMode || isDiagnosticsOpen) && (
          <button type="button" data-testid="workflow-dry-run-debugger" onClick={onValidateRun} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50">
            <AlertTriangle className="h-4 w-4" />
            Dry run
          </button>
        )}
        {!isSimpleMode && (
          <button type="button" onClick={onExportDraft} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
            <Download className="h-4 w-4" />
            Export
          </button>
        )}
      </div>
      {validationMessages.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {validationMessages.map((message) => <div key={message} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{message}</div>)}
        </div>
      )}
      {dryRunMessages.length > 0 && (
        <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" data-testid="workflow-dry-run-debugger">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Dry run debugger</h3>
          {dryRunMessages.map((message) => <div key={message} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{message}</div>)}
        </div>
      )}
      {missingVariableDiagnostics.length > 0 && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="workflow-missing-variable-diagnostics">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-red-700">Missing variable diagnostics</h3>
            <span className="rounded border border-red-200 bg-white px-2 py-0.5 text-[10px] text-red-700">{missingVariableDiagnostics.length} blockers</span>
          </div>
          <div className="grid gap-2">
            {missingVariableDiagnostics.map((diagnostic) => (
              <button
                key={`${diagnostic.nodeId}-${diagnostic.field}-${diagnostic.variable}`}
                type="button"
                data-testid="workflow-missing-variable-jump"
                onClick={() => onSelectMissingVariableDiagnostic(diagnostic)}
                className="rounded border border-red-200 bg-white px-2 py-2 text-left text-xs text-red-800 hover:bg-red-50"
              >
                <span className="block font-semibold">{diagnostic.nodeTitle} / {diagnostic.field}</span>
                <span className="mt-1 block font-mono text-[11px]">{diagnostic.variable || diagnostic.code}</span>
                <span className="mt-1 block text-red-700">{diagnostic.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {dryRunPreview?.nodes && dryRunPreview.nodes.length > 0 && (
        <div className="mb-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700" data-testid="workflow-dry-run-preview">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-950">Dry run preview</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
              {dryRunPreview.blockedCount || 0} blocked / {dryRunPreview.nodeCount || dryRunPreview.nodes.length} nodes
            </span>
          </div>
          <div className="grid gap-2">
            {dryRunPreview.nodes.slice(0, 6).map((node) => (
              <div key={node.nodeId || node.title} className={cn('rounded-md border p-2', node.blocked ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{node.title || node.nodeId}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">{node.permissionDecision || 'allow'}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {node.type} / upstream {(node.upstream || []).map((edge) => `${edge.nodeId}:${edge.mode}`).join(', ') || 'entry'}
                </div>
                {node.errors && node.errors.length > 0 && (
                  <div className="mt-1 text-[11px] text-amber-700">{node.errors.map((item) => item.message || item.code).join('; ')}</div>
                )}
                {node.resolvedInput && (
                  <pre className="mt-2 max-h-20 overflow-auto rounded bg-white/80 p-2 text-[10px] text-slate-600">{stringifyValue(node.resolvedInput)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
