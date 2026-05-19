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

  test('validates required workflow inputs before creating a run', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'input-flow',
      name: 'Input Flow',
      profileId: 'build',
      inputs: [{ id: 'change_request', label: 'Change request', type: 'textarea', required: true }],
      nodes: [{ id: 'agent', type: 'agent', prompt: 'Build {{inputs.change_request}}' }],
      edges: [],
    });

    await expect(store.createRun('input-flow', { inputs: {} })).rejects.toMatchObject({
      statusCode: 400,
      validation: {
        errors: [expect.objectContaining({ code: 'missing_required_input', inputId: 'change_request' })],
      },
    });
  });

  test('renders workflow input and upstream node output variables into node input', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      executors: {
        agent: async ({ nodeInput, node }) => ({
          summary: node.id === 'explore'
            ? `Explored ${nodeInput.prompt}`
            : `Reviewed ${nodeInput.prompt}`,
        }),
        artifact: async ({ run }) => ({
          summary: `Artifact: ${run.nodeRuns.review.output.summary}`,
        }),
      },
    });
    await store.upsertWorkflow({
      id: 'mapping-flow',
      name: 'Mapping Flow',
      profileId: 'build',
      inputs: [{ id: 'change_request', label: 'Change request', type: 'textarea', required: true }],
      nodes: [
        { id: 'explore', type: 'agent', prompt: 'Impact: {{inputs.change_request}}' },
        { id: 'review', type: 'agent', prompt: 'Review: {{nodes.explore.output.summary}}' },
        { id: 'artifact', type: 'artifact', prompt: 'Collect {{nodes.review.output.summary}}' },
      ],
      edges: [
        { from: 'explore', to: 'review' },
        { from: 'review', to: 'artifact' },
      ],
    });

    const run = await store.createRun('mapping-flow', { inputs: { change_request: 'workflow data flow' } });

    expect(run.status).toBe('completed');
    expect(run.nodeRuns.explore.input.prompt).toBe('Impact: workflow data flow');
    expect(run.nodeRuns.review.input.prompt).toContain('Explored Impact: workflow data flow');
    expect(run.nodeRuns.artifact.output.summary).toContain('Reviewed Review: Explored');
  });

  test('fails the node with a clear missing variable error', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'missing-var-flow',
      name: 'Missing Variable Flow',
      profileId: 'build',
      nodes: [{ id: 'agent', type: 'agent', prompt: 'Use {{inputs.missing}}' }],
      edges: [],
    });

    const run = await store.createRun('missing-var-flow');

    expect(run.status).toBe('failed');
    expect(run.nodeRuns.agent.error).toMatch(/inputs\.missing/);
  });

  test('uses execution bridges for agent, tool, shell, and mcp nodes', async () => {
    const calls = [];
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      executors: {
        agent: async ({ node }) => {
          calls.push(node.type);
          return { summary: 'agent done' };
        },
        tool: async ({ node }) => {
          calls.push(node.type);
          return { summary: 'tool done' };
        },
        shell: async ({ node }) => {
          calls.push(node.type);
          return { stdout: `ran ${node.command}` };
        },
        mcp: async ({ node }) => {
          calls.push(node.type);
          return { summary: `mcp ${node.toolName}` };
        },
      },
    });
    await store.upsertWorkflow({
      id: 'bridge-flow',
      name: 'Bridge Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      nodes: [
        { id: 'agent', type: 'agent' },
        { id: 'tool', type: 'tool', toolName: 'git-native-review' },
        { id: 'shell', type: 'shell', command: 'npm test' },
        { id: 'mcp', type: 'mcp', toolName: 'redmine.search' },
      ],
      edges: [
        { from: 'agent', to: 'tool' },
        { from: 'tool', to: 'shell' },
        { from: 'shell', to: 'mcp' },
      ],
    });

    const run = await store.createRun('bridge-flow');

    expect(run.status).toBe('completed');
    expect(calls).toEqual(['agent', 'tool', 'shell', 'mcp']);
    expect(run.nodeRuns.shell.output.stdout).toContain('npm test');
  });

  test('records checkpoint refs and exposes workflow timeline events', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      checkpointService: {
        async createCheckpoint({ node, phase }) {
          return { id: `checkpoint-${node.id}-${phase}`, phase };
        },
      },
    });
    await store.upsertWorkflow({
      id: 'timeline-flow',
      name: 'Timeline Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      nodes: [{ id: 'shell', type: 'shell', command: 'npm test' }],
      edges: [],
    });

    const run = await store.createRun('timeline-flow', { sessionId: 'session-1', projectPath: 'E:\\AIINWORK' });
    const timeline = store.listTimelineEvents({ sessionId: 'session-1' });

    expect(run.nodeRuns.shell.checkpoints.before.id).toBe('checkpoint-shell-before');
    expect(run.nodeRuns.shell.checkpoints.after.id).toBe('checkpoint-shell-after');
    expect(timeline.some((event) => event.category === 'workflow' && event.type === 'workflow_node_completed')).toBe(true);
  });

  test('exports shareable workflow packages with manifest metadata', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'package-flow',
      name: 'Package Flow',
      profileId: 'build',
      metadata: { version: '1.0.0', author: 'Argus', tags: ['workflow'], dependencies: { skills: ['playwright'] } },
      nodes: [{ id: 'agent', type: 'agent' }],
      edges: [],
    });

    const pkg = await store.exportWorkflowPackage(['package-flow']);

    expect(pkg.schemaVersion).toBe(1);
    expect(pkg.kind).toBe('workflow-package');
    expect(pkg.workflows[0].metadata.dependencies.skills).toEqual(['playwright']);
  });
});
