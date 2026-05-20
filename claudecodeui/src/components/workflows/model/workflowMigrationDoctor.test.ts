import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../../../types/workflow';
import { buildWorkflowMigrationDoctorReport } from './workflowMigrationDoctor';

const workflow: WorkflowDefinition = {
  id: 'wf-pass',
  name: 'Passing workflow',
  description: '',
  profileId: 'build',
  permissionPreset: 'auto-edit',
  inputs: [],
  outputs: [],
  nodes: [
    { id: 'agent-1', type: 'agent', title: 'Agent', agentId: 'build', prompt: 'Do work', position: { x: 0, y: 0 }, config: {} },
    { id: 'artifact-1', type: 'artifact', title: 'Artifact', prompt: '{{nodes.agent-1.output.summary}}', position: { x: 220, y: 0 }, config: {} },
  ],
  edges: [{ id: 'edge-1', from: 'agent-1', to: 'artifact-1', mode: 'success' }],
  maxConcurrency: 2,
};

describe('workflowMigrationDoctor', () => {
  it('passes when workflow can roundtrip through WorkGraph document shape', () => {
    const report = buildWorkflowMigrationDoctorReport([workflow]);

    expect(report).toEqual({
      status: 'pass',
      checked: 1,
      findings: [],
    });
  });

  it('warns for preserved legacy metadata and fails unsupported node types', () => {
    const legacyWorkflow: WorkflowDefinition = {
      ...workflow,
      id: 'wf-legacy',
      metadata: { legacyOnly: true },
    };
    const unsupportedWorkflow: WorkflowDefinition = {
      ...workflow,
      id: 'wf-unsupported',
      nodes: [{ ...workflow.nodes[0], type: 'unknown-node' as WorkflowDefinition['nodes'][number]['type'] }],
    };

    const report = buildWorkflowMigrationDoctorReport([legacyWorkflow, unsupportedWorkflow]);

    expect(report.status).toBe('fail');
    expect(report.checked).toBe(2);
    expect(report.findings.map((finding) => finding.message)).toContain('Preserved unknown metadata key: legacyOnly');
    expect(report.findings.map((finding) => finding.message)).toContain('Unsupported node type: unknown-node');
  });
});
