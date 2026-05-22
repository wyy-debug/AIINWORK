import type { Dispatch, SetStateAction } from 'react';
import { Check, Square } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { WorkflowNodeRun, WorkflowRun } from '../../../types/workflow';
import type { WorkflowHumanHint } from './WorkflowStudioViewModel';

export type WorkflowRunSnapshotDetails = {
  hasSnapshot: boolean;
  workflowName: string;
  capturedAt: string;
  resolverVersion: string;
  profileId: string;
  permissionPreset: string;
  nodeCount: number;
  packageCount: number;
  inputKeys: string[];
  packageLabels: string[];
};

type WorkflowRunConsoleProps = {
  selectedRun: WorkflowRun | null;
  runStory: WorkflowHumanHint;
  selectedRunSnapshotDetails: WorkflowRunSnapshotDetails;
  selectedRunDefinitionChanged: boolean;
  selectedRunDefinitionDriftReasons: string[];
  previewConsistency: WorkflowHumanHint;
  previewChangedNodes: Array<{ nodeId: string; fields?: string[]; reasons?: string[] }>;
  activeApprovalNode: WorkflowNodeRun | null;
  approvalRequests: Array<Record<string, unknown>>;
  approvalRiskExplanation: string;
  approvalRequestedCapabilities: string;
  approvalRiskReasons: string;
  approvalDiffSummary: string;
  effectiveApprovalTimeoutPolicy: string;
  effectiveApprovalDelegationTargets: string[];
  approvalDelegationTarget: string;
  setApprovalDelegationTarget: Dispatch<SetStateAction<string>>;
  approvalAuditExport: Record<string, unknown>;
  onSaveApprovalDelegation: () => void | Promise<void>;
  onDecideApproval: (approvalId: string, decision: string) => void | Promise<void>;
  onControlNode: (run: WorkflowRun, nodeId: string, action: string) => void | Promise<void>;
  isBusy: boolean;
  isSimpleMode: boolean;
  isRunAdvancedOpen: boolean;
  setIsRunAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  streamingLogRows: Array<{ run: WorkflowRun; nodeRun: WorkflowNodeRun; message: string }>;
  runLogQuery: string;
  setRunLogQuery: Dispatch<SetStateAction<string>>;
  stringifyValue: (value: unknown) => string;
};

export function WorkflowRunConsole({
  selectedRun,
  runStory,
  selectedRunSnapshotDetails,
  selectedRunDefinitionChanged,
  selectedRunDefinitionDriftReasons,
  previewConsistency,
  previewChangedNodes,
  activeApprovalNode,
  approvalRequests,
  approvalRiskExplanation,
  approvalRequestedCapabilities,
  approvalRiskReasons,
  approvalDiffSummary,
  effectiveApprovalTimeoutPolicy,
  effectiveApprovalDelegationTargets,
  approvalDelegationTarget,
  setApprovalDelegationTarget,
  approvalAuditExport,
  onSaveApprovalDelegation,
  onDecideApproval,
  onControlNode,
  isBusy,
  isSimpleMode,
  isRunAdvancedOpen,
  setIsRunAdvancedOpen,
  streamingLogRows,
  runLogQuery,
  setRunLogQuery,
  stringifyValue,
}: WorkflowRunConsoleProps) {
  return (
    <div data-testid="workflow-run-console">
      <section className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3" data-testid="workflow-run-story">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-blue-950">{runStory.title}</h3>
            <p className="mt-1 text-sm text-blue-800">{runStory.body}</p>
          </div>
          <span className="shrink-0 rounded-full border border-blue-200 bg-background px-2 py-0.5 text-[11px] text-blue-700">{runStory.actionLabel}</span>
        </div>
        {selectedRun && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-blue-800">
            <div className="rounded border border-blue-200 bg-background px-2 py-1">{Object.keys(selectedRun.nodeRuns || {}).length} nodes</div>
            <div className="rounded border border-blue-200 bg-background px-2 py-1">{selectedRun.artifacts?.length || 0} artifacts</div>
            <div className="rounded border border-blue-200 bg-background px-2 py-1">{selectedRun.status}</div>
          </div>
        )}
      </section>
      {selectedRun && selectedRunSnapshotDetails.hasSnapshot && (
        <section className="mb-4 rounded-md border border-slate-200 bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-run-snapshot-badge">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-background px-2 py-0.5 text-[11px] font-semibold text-foreground">Historical snapshot</span>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px]',
                    selectedRunDefinitionChanged
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800',
                  )}
                  data-testid="workflow-run-definition-drift"
                >
                  {selectedRunDefinitionChanged ? `Changed since run: ${selectedRunDefinitionDriftReasons.join(', ')}` : 'Current definition matches snapshot'}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground">{selectedRunSnapshotDetails.workflowName}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Captured {selectedRunSnapshotDetails.capturedAt || 'at run start'} · {selectedRunSnapshotDetails.resolverVersion || 'resolver snapshot'}
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-1 text-[11px]">
              <span className="rounded border border-border bg-background px-2 py-1">{selectedRunSnapshotDetails.nodeCount} nodes</span>
              <span className="rounded border border-border bg-background px-2 py-1">{selectedRunSnapshotDetails.packageCount} packages</span>
            </div>
          </div>
          <details className="mt-3 rounded-md border border-border bg-background p-2" data-testid="workflow-run-snapshot-details" open>
            <summary className="cursor-pointer font-semibold text-foreground">Snapshot details</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-border bg-muted/20 px-2 py-1">
                <span className="block font-semibold text-foreground">Workflow</span>
                <span className="block">{selectedRunSnapshotDetails.workflowName}</span>
              </div>
              <div className="rounded border border-border bg-muted/20 px-2 py-1">
                <span className="block font-semibold text-foreground">Profile</span>
                <span className="block">{selectedRunSnapshotDetails.profileId || 'None'} / {selectedRunSnapshotDetails.permissionPreset || 'None'}</span>
              </div>
              <div className="rounded border border-border bg-muted/20 px-2 py-1">
                <span className="block font-semibold text-foreground">Inputs</span>
                <span className="block">{selectedRunSnapshotDetails.inputKeys.join(', ') || 'No inputs'}</span>
              </div>
              <div className="rounded border border-border bg-muted/20 px-2 py-1">
                <span className="block font-semibold text-foreground">Packages</span>
                <span className="block">{selectedRunSnapshotDetails.packageLabels.join(', ') || 'No custom packages'}</span>
              </div>
            </div>
          </details>
        </section>
      )}
      {selectedRun && (
        <section
          className={cn(
            'mb-4 rounded-md border p-3 text-xs',
            selectedRun.previewChanged || selectedRun.previewDiff?.changed
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800',
          )}
          data-testid="workflow-preview-diff-panel"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Preview consistency</h3>
              <p className="mt-1">{previewConsistency.body}</p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full border bg-background px-2 py-0.5 text-[11px]',
                selectedRun.previewChanged || selectedRun.previewDiff?.changed
                  ? 'border-amber-300 text-amber-800'
                  : 'border-emerald-300 text-emerald-800',
              )}
              data-testid="workflow-preview-consistency-chip"
            >
              {previewConsistency.actionLabel}
            </span>
          </div>
          {previewChangedNodes.length > 0 && (
            <div className="mt-3 space-y-1">
              {previewChangedNodes.slice(0, 4).map((node) => (
                <div key={node.nodeId} className="rounded border border-amber-200 bg-background px-2 py-1">
                  <span className="font-medium text-foreground">{node.nodeId}</span>
                  <span className="ml-2">{(node.fields || []).join(', ') || 'node'} changed</span>
                  {(node.reasons || []).length > 0 && (
                    <span className="ml-2 text-muted-foreground">({node.reasons?.join(', ')})</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {selectedRun && activeApprovalNode && (
        <section className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 shadow-sm" data-testid="workflow-runs-approval-focus">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="rounded-full border border-amber-200 bg-background px-2 py-0.5 text-[11px] font-medium text-amber-700">Action needed</span>
              <h3 className="mt-2 text-base font-semibold text-amber-950">{activeApprovalNode.title}</h3>
              <p className="mt-1 text-sm text-amber-800">{activeApprovalNode.waitingReason || 'Review the node context and decide whether this workflow can continue.'}</p>
            </div>
            <span className="shrink-0 rounded-md border border-amber-200 bg-background px-2 py-1 text-xs text-amber-700">{selectedRun.status}</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-amber-800 sm:grid-cols-3">
            <div className="rounded border border-amber-200 bg-background px-2 py-1">Permission: {activeApprovalNode.permissionDecision || 'ask'}</div>
            <div className="rounded border border-amber-200 bg-background px-2 py-1">Node: {activeApprovalNode.nodeId}</div>
            <div className="rounded border border-amber-200 bg-background px-2 py-1">Artifacts: {selectedRun.artifacts?.length || 0}</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => onControlNode(selectedRun, activeApprovalNode.nodeId, 'continue')} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Check className="h-4 w-4" />
              Continue
            </button>
            <button type="button" onClick={() => onControlNode(selectedRun, activeApprovalNode.nodeId, 'reject')} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300 bg-background px-3 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              <Square className="h-4 w-4" />
              Reject
            </button>
          </div>
        </section>
      )}
      {approvalRequests.length > 0 && (
        <section className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="workflow-approval-inbox">
          <div data-testid="workflow-approval-inbox-panel">
            <h3 className="text-sm font-semibold text-amber-900">Approval Inbox</h3>
            <div className="mt-2 grid gap-2">
              <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-risk-explanation">
                <span className="block font-semibold text-foreground">Risk explanation</span>
                <span className="mt-1 block text-amber-800">{approvalRiskExplanation}</span>
              </div>
              <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-requested-capabilities">
                <span className="block font-semibold text-foreground">Requested capability</span>
                <span className="mt-1 block font-mono text-[11px] text-amber-800">{approvalRequestedCapabilities}</span>
              </div>
              <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-risk-reasons">
                <span className="block font-semibold text-foreground">Risk reasons</span>
                <span className="mt-1 block text-amber-800">{approvalRiskReasons}</span>
              </div>
              <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-diff-summary">
                <span className="block font-semibold text-foreground">Diff summary</span>
                <span className="mt-1 block text-amber-800">{approvalDiffSummary}</span>
              </div>
              <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-timeout-policy">
                <span className="block font-semibold text-foreground">Timeout policy</span>
                <span className="mt-1 block text-amber-800">{effectiveApprovalTimeoutPolicy}</span>
              </div>
              <label className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-delegation">
                <span className="block font-semibold text-foreground">Delegation</span>
                <select value={approvalDelegationTarget} onChange={(event) => setApprovalDelegationTarget(event.target.value)} className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground">
                  {effectiveApprovalDelegationTargets.map((target: string) => (
                    <option key={target} value={target}>{target}</option>
                  ))}
                </select>
                <button type="button" onClick={() => void onSaveApprovalDelegation()} className="mt-2 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">Save delegation</button>
              </label>
              <div className="rounded border border-amber-200 bg-background p-2 text-xs" data-testid="workflow-approval-audit-export">
                <span className="block font-semibold text-foreground">Audit export</span>
                <span className="mt-1 block text-amber-800">{stringifyValue(approvalAuditExport)}</span>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {approvalRequests.map((approval) => (
                <div key={String(approval.id)} className="rounded border border-amber-200 bg-background p-2 text-xs">
                  <div className="font-semibold text-foreground">{String(approval.nodeTitle || approval.nodeId)}</div>
                  <div className="mt-1 text-amber-700">{String(approval.riskLevel || 'medium')} - {String(approval.reason || 'Waiting for approval')}</div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => void onDecideApproval(String(approval.id), 'approve')} className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground">Approve</button>
                    <button type="button" onClick={() => void onDecideApproval(String(approval.id), 'reject')} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      <details className="mb-4 rounded-md border border-border bg-card p-3" data-testid="workflow-run-advanced-tabs" open={!isSimpleMode || isRunAdvancedOpen}>
        <summary className="cursor-pointer text-sm font-semibold text-foreground" onClick={(event) => {
          if (isSimpleMode) {
            event.preventDefault();
            setIsRunAdvancedOpen((current) => !current);
          }
        }}>
          Advanced run details
        </summary>
        <section className="mt-3 rounded-md border border-border bg-background p-3" data-testid="workflow-run-streaming-logs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Streaming logs</h3>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">tailing</span>
          </div>
          <label className="mt-2 block text-xs text-muted-foreground" data-testid="workflow-run-log-search">
            Search logs
            <input value={runLogQuery} onChange={(event) => setRunLogQuery(event.target.value)} placeholder="node, status, error" className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground" />
          </label>
          <div className="mt-2 max-h-28 space-y-1 overflow-auto">
            {streamingLogRows.slice(0, 8).map((row, index) => (
              <div key={`${row.run.id}-${row.nodeRun.nodeId}-${index}`} className="rounded border border-border bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{row.nodeRun.title}</span>: {row.message}
              </div>
            ))}
          </div>
        </section>
      </details>
    </div>
  );
}
