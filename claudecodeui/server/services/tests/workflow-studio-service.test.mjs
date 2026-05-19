import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createWorkflowStudioStore,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
} from '../workflow-studio-service.js';

const agentResolver = async (agentId) => ({
  id: agentId,
  name: agentId,
  mode: agentId.startsWith('subagent') ? 'subagent' : 'primary',
});

function createMemorySubagentStore() {
  let index = 0;
  return {
    async createRun(input = {}) {
      index += 1;
      return {
        id: `subagent-run-${index}`,
        status: 'running',
        agentId: input.agent?.id || 'subagent',
      };
    },
  };
}

describe('workflow studio service', () => {
  test('normalizes and validates workflow definitions', () => {
    const workflow = normalizeWorkflowDefinition({
      id: ' Review Delivery ',
      profileId: 'build',
      nodes: [
        { id: 'explore', type: 'subagent', agentId: 'subagent-explore' },
        { id: 'approval', type: 'approval' },
        { id: 'artifact', type: 'artifact' },
      ],
      edges: [
        { from: 'explore', to: 'approval' },
        { from: 'approval', to: 'artifact' },
      ],
    });

    const result = validateWorkflowDefinition(workflow);
    expect(workflow.id).toBe('review-delivery');
    expect(result.validation.valid).toBe(true);
  });

  test('rejects cycles, missing nodes, invalid node types, and privilege escalation', () => {
    const result = validateWorkflowDefinition({
      id: 'bad-dag',
      profileId: 'build',
      permissionPreset: 'suggest',
      nodes: [
        { id: 'a', type: 'shell', permission: 'allow' },
        { id: 'b', type: 'unknown' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'missing', to: 'a' },
      ],
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'permission_escalation',
      'invalid_node_type',
      'missing_edge_source',
    ]));
  });

  test('persists workflow CRUD and JSON export/import roundtrip', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-studio-'));
    const store = createWorkflowStudioStore({
      workflowsPath: path.join(rootDir, 'workflows.json'),
      runsPath: path.join(rootDir, 'runs.json'),
      agentResolver,
    });

    const saved = await store.upsertWorkflow({
      id: 'local-flow',
      name: 'Local Flow',
      profileId: 'build',
      nodes: [{ id: 'agent', type: 'agent', title: 'Build' }],
      edges: [],
    });
    const exported = await store.exportWorkflow(saved.id);
    const imported = await store.importWorkflow(exported);

    expect(store.getWorkflow('local-flow')?.name).toBe('Local Flow');
    expect(imported.id).toBe('local-flow');
    expect(store.listWorkflows().some((workflow) => workflow.id === 'local-flow')).toBe(true);

    const removed = await store.deleteWorkflow('local-flow');
    expect(removed.id).toBe('local-flow');
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test('runs a DAG, pauses on approval, continues, and records artifacts', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      subagentRunStore: createMemorySubagentStore(),
      now: (() => {
        let value = 1700000000000;
        return () => {
          value += 10;
          return value;
        };
      })(),
    });

    await store.upsertWorkflow({
      id: 'approval-flow',
      name: 'Approval Flow',
      profileId: 'build',
      permissionPreset: 'auto-edit',
      nodes: [
        { id: 'explore', type: 'subagent', agentId: 'subagent-explore' },
        { id: 'approval', type: 'approval' },
        { id: 'artifact', type: 'artifact' },
      ],
      edges: [
        { from: 'explore', to: 'approval' },
        { from: 'approval', to: 'artifact' },
      ],
    });

    const waiting = await store.createRun('approval-flow', {
      inputs: { change_request: 'Add workflow support' },
      projectPath: 'E:\\AIINWORK',
    });
    expect(waiting.status).toBe('waiting_approval');
    expect(waiting.nodeRuns.explore.status).toBe('completed');
    expect(waiting.nodeRuns.approval.status).toBe('waiting_approval');

    const completed = await store.controlNode(waiting.id, 'approval', { action: 'continue' });
    expect(completed.status).toBe('completed');
    expect(completed.nodeRuns.artifact.status).toBe('completed');
    expect(completed.artifacts).toHaveLength(1);
    expect(completed.timelineEvents.some((event) => event.type === 'workflow_node_completed')).toBe(true);
  });

  test('asks for risky nodes and supports approval continuation', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      subagentRunStore: createMemorySubagentStore(),
    });
    await store.upsertWorkflow({
      id: 'shell-flow',
      name: 'Shell Flow',
      profileId: 'build',
      permissionPreset: 'suggest',
      nodes: [
        { id: 'shell', type: 'shell', command: 'npm test' },
        { id: 'artifact', type: 'artifact' },
      ],
      edges: [{ from: 'shell', to: 'artifact' }],
    });

    const waiting = await store.createRun('shell-flow');
    expect(waiting.status).toBe('waiting_approval');
    expect(waiting.nodeRuns.shell.waitingReason).toMatch(/requires approval/i);

    const completed = await store.controlNode(waiting.id, 'shell', { action: 'approve' });
    expect(completed.status).toBe('completed');
  });
});
