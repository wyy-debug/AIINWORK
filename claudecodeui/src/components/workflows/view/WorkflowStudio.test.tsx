import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('WorkflowStudio source contract', () => {
  it('exposes visual DAG editor, runner, approval, and history hooks', () => {
    const source = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');

    expect(source).toContain('data-testid="workflow-studio"');
    expect(source).toContain("from '@xyflow/react'");
    expect(source).toContain('ReactFlow');
    expect(source).toContain('MiniMap');
    expect(source).toContain('Controls');
    expect(source).toContain('Handle');
    expect(source).toContain('ReactFlowProvider');
    expect(source).toContain('data-testid="workflow-command-center"');
    expect(source).toContain('data-testid="workflow-react-flow-canvas"');
    expect(source).toContain('data-testid="workflow-run-setup-drawer"');
    expect(source).toContain('data-testid="workflow-library-gallery"');
    expect(source).toContain('data-testid="workflow-template-preview"');
    expect(source).toContain('data-testid="workflow-inspector-tabs"');
    expect(source).toContain('data-testid="workflow-approval-inbox-panel"');
    expect(source).toContain('data-testid="workflow-run-diagnosis-panel"');
    expect(source).toContain('data-testid="workflow-editor"');
    expect(source).toContain('data-testid="workflow-dag-canvas"');
    expect(source).toContain('data-testid="workflow-add-node"');
    expect(source).toContain('data-testid="workflow-connect-node"');
    expect(source).toContain('data-testid="workflow-approve-node"');
    expect(source).toContain('data-testid="workflow-run-card"');
    expect(source).toContain('data-testid="workflow-run-inputs"');
    expect(source).toContain('data-testid="workflow-run-input"');
    expect(source).toContain('data-testid="workflow-node-variables"');
    expect(source).toContain('data-testid="workflow-insert-variable"');
    expect(source).toContain('data-testid="workflow-invalid-variables"');
    expect(source).toContain('data-testid="workflow-node-run-details"');
    expect(source).toContain('data-testid="workflow-permission-source"');
    expect(source).toContain('data-testid="workflow-checkpoint-actions"');
    expect(source).toContain('rollbackCheckpoint');
    expect(source).toContain('data-testid="workflow-node-dependency-status"');
    expect(source).toContain('data-testid="workflow-dry-run-debugger"');
    expect(source).toContain('data-testid="workflow-run-console"');
    expect(source).toContain('data-testid="workflow-run-events"');
    expect(source).toContain('data-testid="workflow-node-logs"');
    expect(source).toContain('data-testid="workflow-retry-from-node"');
    expect(source).toContain('data-testid="workflow-template-manifest"');
    expect(source).toContain('data-testid="workflow-clone-template"');
    expect(source).toContain('data-testid="workflow-smoke-template"');
    expect(source).toContain('data-testid="workflow-template-smoke-status"');
    expect(source).toContain('data-testid="workflow-approval-inbox"');
    expect(source).toContain('data-testid="workflow-runtime-kernel"');
    expect(source).toContain('data-testid="workflow-failure-diagnosis"');
    expect(source).toContain('data-testid="workflow-release-readiness"');
    expect(source).toContain('data-testid="workflow-run-benchmarks"');
    expect(source).toContain('loadNodeTypes');
    expect(source).toContain('validateRun');
    expect(source).toContain('cloneWorkflow');
    expect(source).toContain('smokeTemplate');
    expect(source).toContain('runBenchmarks');
    expect(source).toContain('decideApproval');
    expect(source).toContain('workflowRunEvents');
    expect(source).toContain('workflowNodeLogs');
    expect(source).toContain('retryWorkflowFromNode');
    expect(source).toContain('data-testid="workflow-canvas-controls"');
    expect(source).toContain('data-testid="workflow-minimap"');
    expect(source).toContain('data-testid="workflow-edge-editor"');
    expect(source).toContain('data-testid="workflow-node-search"');
    expect(source).toContain('duplicateNode');
    expect(source).toContain('autoLayoutNodes');
    expect(source).toContain('workflow-mobile-run');
    expect(source).toContain('Agent Workflow Studio');
    expect(source).toContain('data-testid="workflow-home-overview"');
    expect(source).toContain('data-testid="workflow-empty-state-guide"');
    expect(source).toContain('data-testid="workflow-first-run-wizard"');
    expect(source).toContain('data-testid="workflow-command-palette"');
    expect(source).toContain('data-testid="workflow-recent-objects"');
    expect(source).toContain('data-testid="workflow-favorites"');
    expect(source).toContain('data-testid="workflow-breadcrumb"');
    expect(source).toContain('data-testid="workflow-status-taxonomy"');
    expect(source).toContain('data-testid="workflow-help-overlay"');
    expect(source).toContain('data-testid="workflow-keyboard-shortcuts"');
    expect(source).toContain('toggleFavoriteWorkflow');
    expect(source).toContain('openWorkflowDeepLink');
  });

  it('keeps legacy swarm language out of the workflow UI', () => {
    const source = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8').toLowerCase();

    expect(source).not.toContain('swarm');
    expect(source).not.toContain('message bus');
    expect(source).not.toContain('topology');
  });
});
