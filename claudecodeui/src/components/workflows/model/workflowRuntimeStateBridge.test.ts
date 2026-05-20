import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition, WorkflowRun } from '../../../types/workflow';
import { buildWorkGraphRuntimeState } from './workflowRuntimeStateBridge';

const workflow: WorkflowDefinition = {
  id: 'wf-runtime',
  name: 'Runtime test',
  description: '',
  profileId: 'build',
  permissionPreset: 'auto-edit',
  inputs: [],
  outputs: [],
  nodes: [
    { id: 'explore', type: 'subagent', title: 'Explore', agentId: 'explore', position: { x: 0, y: 0 }, config: {} },
    { id: 'approval', type: 'approval', title: 'Approval', position: { x: 220, y: 0 }, config: {} },
    { id: 'artifact', type: 'artifact', title: 'Artifact', position: { x: 440, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'edge-explore-approval', from: 'explore', to: 'approval', mode: 'success' },
    { id: 'edge-approval-artifact', from: 'approval', to: 'artifact', mode: 'success' },
  ],
  maxConcurrency: 2,
};

const run: WorkflowRun = {
  id: 'run-1',
  workflowId: 'wf-runtime',
  workflowName: 'Runtime test',
  status: 'waiting_approval',
  nodeRuns: {
    explore: {
      nodeId: 'explore',
      type: 'subagent',
      title: 'Explore',
      status: 'completed',
      attempt: 1,
      output: { summary: 'found files' },
      artifacts: [{ id: 'artifact-1' }],
      checkpoints: { after: { id: 'checkpoint-after' } },
    },
    approval: {
      nodeId: 'approval',
      type: 'approval',
      title: 'Approval',
      status: 'waiting_approval',
      attempt: 1,
      input: { summary: 'found files' },
      waitingReason: 'high-risk shell',
    },
    artifact: {
      nodeId: 'artifact',
      type: 'artifact',
      title: 'Artifact',
      status: 'pending',
      attempt: 0,
    },
  },
};

describe('workflowRuntimeStateBridge', () => {
  it('hydrates graph node and edge runtime state from real WorkflowRun data', () => {
    const state = buildWorkGraphRuntimeState(workflow, run);

    expect(state?.nodes.explore).toMatchObject({
      status: 'completed',
      outputKeys: ['summary'],
      artifactCount: 1,
      checkpointCount: 1,
    });
    expect(state?.nodes.approval).toMatchObject({
      status: 'waiting_approval',
      inputKeys: ['summary'],
      waitingReason: 'high-risk shell',
    });
    expect(state?.edges['edge-explore-approval'].status).toBe('active');
    expect(state?.edges['edge-approval-artifact'].status).toBe('idle');
    expect(state?.summary).toMatchObject({
      waiting: 1,
      completed: 1,
      artifacts: 1,
      checkpoints: 1,
    });
  });
});
