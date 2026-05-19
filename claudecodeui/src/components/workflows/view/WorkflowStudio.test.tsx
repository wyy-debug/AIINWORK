import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('WorkflowStudio source contract', () => {
  it('exposes visual DAG editor, runner, approval, and history hooks', () => {
    const source = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8');

    expect(source).toContain('data-testid="workflow-studio"');
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
    expect(source).toContain('Agent Workflow Studio');
  });

  it('keeps legacy swarm language out of the workflow UI', () => {
    const source = readFileSync(resolve(currentDir, 'WorkflowStudio.tsx'), 'utf8').toLowerCase();

    expect(source).not.toContain('swarm');
    expect(source).not.toContain('message bus');
    expect(source).not.toContain('topology');
  });
});
