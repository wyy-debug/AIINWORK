import type { Dispatch, SetStateAction } from 'react';

import { cn } from '../../../lib/utils';
import type { WorkflowNode } from '../../../types/workflow';

export type WorkflowPermissionDryRunRow = {
  node: Partial<WorkflowNode> & { id: string; title: string; type: string };
  decision: string;
  reason: string;
  requestedCapabilities: string[];
  effectiveCapabilities: string[];
  riskReasons: string[];
};

type WorkflowPermissionPanelsProps = {
  permissionDryRunRows: WorkflowPermissionDryRunRow[];
  permissionOverrideRequest: string;
  setPermissionOverrideRequest: Dispatch<SetStateAction<string>>;
  createPermissionOverride: () => void | Promise<void>;
  isBusy: boolean;
  workflowSecurity: Record<string, any> | null;
  secretVaultRefs: string[];
  mcpAllowlistRows: string[];
  dangerousCommandPolicy: string;
};

export function WorkflowPermissionPanels({
  permissionDryRunRows,
  permissionOverrideRequest,
  setPermissionOverrideRequest,
  createPermissionOverride,
  isBusy,
  workflowSecurity,
  secretVaultRefs,
  mcpAllowlistRows,
  dangerousCommandPolicy,
}: WorkflowPermissionPanelsProps) {
  return (
    <>
      <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-permission-dry-run">
        <span className="block font-semibold text-foreground">Permission dry run</span>
        <div className="mt-2 max-h-32 space-y-1 overflow-auto">
          {permissionDryRunRows.map((row) => (
            <div key={row.node.id} className="rounded border border-border px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">{row.node.title}</span>
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', row.decision === 'deny' ? 'border-red-200 bg-red-50 text-red-700' : row.decision === 'ask' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{row.decision}</span>
              </div>
              <div className="mt-1 text-[11px]">{row.reason}</div>
              <div className="mt-1 font-mono text-[10px]">requested: {row.requestedCapabilities.join(', ') || 'none'}</div>
              <div className="mt-1 font-mono text-[10px]">effective: {row.effectiveCapabilities.join(', ') || 'none'}</div>
              <div className="mt-1 text-[10px]">risk: {row.riskReasons.join('; ') || 'none'}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-permission-override-request">
        <span className="block font-semibold text-foreground">Permission override request</span>
        <textarea value={permissionOverrideRequest} onChange={(event) => setPermissionOverrideRequest(event.target.value)} placeholder="Explain why this denied node needs elevation" className="mt-2 min-h-16 w-full rounded border border-border bg-background p-2 text-xs text-foreground" />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span>Requests are recorded, never auto-approved.</span>
          <button type="button" onClick={() => void createPermissionOverride()} disabled={!permissionOverrideRequest.trim() || isBusy} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">Create request</button>
        </div>
        {Array.isArray(workflowSecurity?.overrideRequests) && workflowSecurity.overrideRequests.length > 0 && (
          <div className="mt-2 space-y-1">
            {workflowSecurity.overrideRequests.slice(-3).map((request: any) => (
              <div key={request.id || request.reason} className="rounded border border-border px-2 py-1">{request.nodeId}: {request.status} - {request.reason}</div>
            ))}
          </div>
        )}
      </section>
      <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-secret-vault-integration">
        <span className="block font-semibold text-foreground">Secret vault</span>
        <div className="mt-2 space-y-1">
          {secretVaultRefs.map((secret) => (
            <div key={secret} className="rounded border border-border px-2 py-1 font-mono text-[11px]">{secret.replace(/[^/]+$/, '********')}</div>
          ))}
          {secretVaultRefs.length === 0 && <div className="rounded border border-border px-2 py-1">No secret refs configured.</div>}
        </div>
      </section>
      <section className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="workflow-mcp-allowlist-ui">
        <span className="block font-semibold text-foreground">MCP allowlist</span>
        <div className="mt-2 space-y-1">
          {mcpAllowlistRows.map((tool) => (
            <label key={tool} className="flex items-center gap-2 rounded border border-border px-2 py-1">
              <input type="checkbox" checked readOnly />
              <span className="font-mono text-[11px]">{tool}</span>
            </label>
          ))}
          {mcpAllowlistRows.length === 0 && <div className="rounded border border-border px-2 py-1">No MCP allowlist configured; workflow dry-run will surface missing policy.</div>}
        </div>
      </section>
      <section className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700" data-testid="workflow-dangerous-command-policy">
        <span className="block font-semibold">Dangerous command policy</span>
        <span className="mt-1 block">{dangerousCommandPolicy}</span>
      </section>
    </>
  );
}
