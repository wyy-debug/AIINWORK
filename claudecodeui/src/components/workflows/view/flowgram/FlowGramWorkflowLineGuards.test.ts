import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../../../../types/workflow';
import {
  canAddWorkflowLine,
  canDeleteWorkflowLine,
  canDeleteWorkflowNode,
  canResetWorkflowLine,
} from './FlowGramWorkflowLineGuards';

function makeWorkflow(): WorkflowDefinition {
  return {
    id: 'guard-workflow',
    name: 'Guard Workflow',
    description: '',
    profileId: 'build',
    permissionPreset: 'auto-edit',
    inputs: [],
    outputs: [],
    maxConcurrency: 2,
    nodes: [
      { id: 'explore', type: 'subagent', title: 'Explore', position: { x: 0, y: 0 } },
      { id: 'review', type: 'subagent', title: 'Review', position: { x: 280, y: 0 } },
      { id: 'artifact', type: 'artifact', title: 'Artifact', position: { x: 560, y: 0 } },
    ],
    edges: [
      { id: 'explore-review', from: 'explore', to: 'review', mode: 'success' },
      { id: 'review-artifact', from: 'review', to: 'artifact', mode: 'success' },
    ],
  };
}

describe('FlowGram workflow line guards', () => {
  it('rejects self loops and cycles before FlowGram creates a line', () => {
    const workflow = makeWorkflow();

    expect(canAddWorkflowLine(workflow, 'explore', 'explore')).toBe(false);
    expect(canAddWorkflowLine(workflow, 'artifact', 'explore')).toBe(false);
    expect(canAddWorkflowLine(workflow, 'explore', 'artifact')).toBe(true);
  });

  it('keeps delete and reset guards conservative around graph shape', () => {
    const workflow = makeWorkflow();

    expect(canDeleteWorkflowLine(workflow, 'explore-review')).toBe(true);
    expect(canDeleteWorkflowLine(workflow, 'missing-edge')).toBe(false);
    expect(canDeleteWorkflowNode(workflow, 'review')).toBe(true);
    expect(canDeleteWorkflowNode(workflow, 'missing-node')).toBe(false);
    expect(canResetWorkflowLine(workflow, 'explore-review', 'review', 'explore')).toBe(false);
    expect(canResetWorkflowLine(workflow, 'explore-review', 'explore', 'artifact')).toBe(true);
  });
});
