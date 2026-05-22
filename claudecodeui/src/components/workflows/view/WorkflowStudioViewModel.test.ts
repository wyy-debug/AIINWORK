import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition, WorkflowNode, WorkflowRun } from '../../../types/workflow';
import {
  buildWorkflowHumanNextAction,
  buildWorkflowPreviewConsistency,
  buildWorkflowReadinessSummaries,
  buildWorkflowRunStory,
} from './WorkflowStudioViewModel';

function makeWorkflow(nodes: WorkflowNode[] = []): WorkflowDefinition {
  return {
    id: 'workflow-view-model',
    name: 'Workflow View Model',
    description: '',
    profileId: 'build',
    permissionPreset: 'auto-edit',
    inputs: [],
    outputs: [],
    maxConcurrency: 2,
    nodes,
    edges: [],
  };
}

function makeRun(partial: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'workflow-view-model',
    workflowName: 'Workflow View Model',
    status: 'running',
    nodeRuns: {},
    ...partial,
  };
}

describe('WorkflowStudio view model', () => {
  it('guides the editor toward the next simple action', () => {
    expect(buildWorkflowHumanNextAction(makeWorkflow(), null)).toEqual({
      title: 'Start with one step',
      body: 'Add an Agent or Subagent step, then connect approval or artifact only when you need it.',
      actionLabel: 'Add step',
    });

    const shellNode: WorkflowNode = {
      id: 'shell',
      type: 'shell',
      title: 'Run command',
      command: 'npm test',
      position: { x: 0, y: 0 },
    };

    expect(buildWorkflowHumanNextAction(makeWorkflow([shellNode]), shellNode)).toEqual({
      title: 'Check risk before running',
      body: 'This step may need permission approval. Run a dry check before starting the workflow.',
      actionLabel: 'Dry check',
    });
  });

  it('turns selected run state into a human-readable run story', () => {
    const waiting = makeRun({
      status: 'waiting_approval',
      nodeRuns: {
        approval: {
          nodeId: 'approval',
          type: 'approval',
          title: 'Approve shell',
          status: 'waiting_approval',
          attempt: 0,
          waitingReason: 'Shell command needs approval.',
        },
      },
    });
    expect(buildWorkflowRunStory(waiting)).toEqual({
      title: 'Waiting for approval: Approve shell',
      body: 'Shell command needs approval.',
      actionLabel: 'Continue or reject',
    });

    const failed = makeRun({
      status: 'failed',
      nodeRuns: {
        shell: {
          nodeId: 'shell',
          type: 'shell',
          title: 'Run command',
          status: 'failed',
          attempt: 1,
          error: 'Command exited 1',
        },
      },
    });
    expect(buildWorkflowRunStory(failed).title).toBe('Stopped at Run command');
    expect(buildWorkflowRunStory(failed).body).toBe('Command exited 1');
  });

  it('summarizes preview consistency without reading React state', () => {
    expect(buildWorkflowPreviewConsistency(null).title).toBe('Preview not checked');

    const changed = makeRun({
      previewChanged: true,
      previewDiff: { changed: true, reasons: ['input changed'] },
    });

    expect(buildWorkflowPreviewConsistency(changed)).toEqual({
      title: 'Preview changed before execution',
      body: 'input changed',
      actionLabel: 'Review diff',
    });
  });

  it('summarizes production readiness with stable fallbacks', () => {
    const summaries = buildWorkflowReadinessSummaries({
      readinessState: {
        performance: { nodeCount: 12, edgeCount: 14, status: 'ok' },
        virtualizedLogs: { rows: [{ id: 'a' }, { id: 'b' }], total: 20 },
        smokeMatrix: { passed: 6, total: 7 },
        production: {
          status: 'blocked',
          releaseSmokeMatrix: { passed: 5, total: 7 },
          recentFailures: [{ id: 'run-failed' }],
          security: [{ id: 'policy' }],
        },
      },
      draftNodeCount: 3,
      streamingLogRowCount: 9,
    });

    expect(summaries.largeGraphPerformance).toBe('12/100 nodes, 14 edges, ok');
    expect(summaries.virtualizedRunLogs).toBe('2/20 virtualized log rows loaded');
    expect(summaries.releaseSmokeMatrix).toBe('6/7 release smoke gates passed');
    expect(summaries.releaseQualityGate).toContain('blocked: 5/7 gates');
    expect(summaries.productionReadinessDashboard).toBe('blocked: 1 recent failure(s), 1 security report(s)');
  });
});
