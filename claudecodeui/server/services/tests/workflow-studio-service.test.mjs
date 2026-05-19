import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createWorkflowStudioStore,
  getWorkflowNodeTypeDefinitions,
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

  test('denies risky nodes under enterprise-safe permission preset', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      executors: {
        shell: async () => ({ stdout: 'should not run' }),
      },
    });
    await store.upsertWorkflow({
      id: 'enterprise-safe-shell-flow',
      name: 'Enterprise Safe Shell Flow',
      profileId: 'build',
      permissionPreset: 'enterprise-safe',
      nodes: [{ id: 'shell', type: 'shell', command: 'npm test' }],
      edges: [],
    });

    const run = await store.createRun('enterprise-safe-shell-flow');

    expect(run.status).toBe('failed');
    expect(run.nodeRuns.shell.permissionDecision).toBe('deny');
    expect(run.nodeRuns.shell.error).toMatch(/permission boundary/i);
    expect(run.timelineEvents.some((event) => event.type === 'workflow_node_failed')).toBe(true);
  });

  test('rejects node-level permission escalation during validation', () => {
    const result = validateWorkflowDefinition({
      id: 'escalation-flow',
      profileId: 'build',
      permissionPreset: 'auto-edit',
      nodes: [{ id: 'shell', type: 'shell', permission: 'allow', command: 'npm test' }],
      edges: [],
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'permission_escalation', nodeId: 'shell' }),
    ]));
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

  test('default shell bridge executes commands and captures stdout', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'shell-exec-flow',
      name: 'Shell Exec Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      nodes: [{ id: 'shell', type: 'shell', command: 'node -e "console.log(\'workflow-shell\')"' }],
      edges: [],
    });

    const run = await store.createRun('shell-exec-flow');

    expect(run.status).toBe('completed');
    expect(run.nodeRuns.shell.output.stdout).toContain('workflow-shell');
  });

  test('default git review tool bridge returns structured review output', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-git-review-'));
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'git-review-flow',
      name: 'Git Review Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      nodes: [{ id: 'review', type: 'tool', toolName: 'git-native-review' }],
      edges: [],
    });

    const run = await store.createRun('git-review-flow', { projectPath: rootDir });

    expect(run.status).toBe('completed');
    expect(run.nodeRuns.review.output).toMatchObject({ hasChanges: false });
    expect(run.nodeRuns.review.output.content).toMatch(/nothing to review/i);
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test('default mcp bridge fails with a clear missing tool error', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'missing-mcp-flow',
      name: 'Missing MCP Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      nodes: [{ id: 'mcp', type: 'mcp', toolName: 'redmine.search' }],
      edges: [],
    });

    const run = await store.createRun('missing-mcp-flow');

    expect(run.status).toBe('failed');
    expect(run.nodeRuns.mcp.error).toMatch(/MCP tool is not configured/i);
  });

  test('subagent bridge waits for terminal status and fails terminal errors', async () => {
    let pollCount = 0;
    const subagentStore = {
      async createRun() {
        return { id: 'subagent-run-terminal', status: 'running' };
      },
      async getRun() {
        pollCount += 1;
        return pollCount > 1
          ? { id: 'subagent-run-terminal', status: 'completed', result: 'terminal result' }
          : { id: 'subagent-run-terminal', status: 'running' };
      },
    };
    const store = createWorkflowStudioStore({ persist: false, agentResolver, subagentRunStore: subagentStore });
    await store.upsertWorkflow({
      id: 'subagent-terminal-flow',
      name: 'Subagent Terminal Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      nodes: [{ id: 'explore', type: 'subagent', agentId: 'subagent-explore', timeoutMs: 1000 }],
      edges: [],
    });

    const run = await store.createRun('subagent-terminal-flow');

    expect(run.status).toBe('completed');
    expect(run.nodeRuns.explore.output.status).toBe('completed');
    expect(run.nodeRuns.explore.output.result).toBe('terminal result');
    expect(run.nodeRuns.explore.output.sessionLink).toContain('subagent-run=');
  });

  test('exposes real agent bridge state, result contract, subagent cancellation, tool registry, mcp schemas, and browser screenshot artifacts', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-agent-bridge-'));
    const artifactsDir = path.join(rootDir, 'artifacts');
    const stopped = [];
    const subagentStore = {
      async createRun() {
        return { id: 'subagent-run-cancel-me', status: 'running' };
      },
      async getRun() {
        return { id: 'subagent-run-cancel-me', status: 'running' };
      },
      async controlRun(runId, input) {
        stopped.push({ runId, action: input.action });
        return { id: runId, status: 'stopped' };
      },
    };
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      subagentRunStore: subagentStore,
      artifactsDir,
    });
    await store.upsertWorkflow({
      id: 'agent-bridge-flow',
      name: 'Agent Bridge Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      maxConcurrency: 4,
      metadata: {
        agentBridge: { subagentPoolLimit: 1 },
        security: { mcpAllowlist: ['redmine.get_issue'] },
      },
      inputs: [{ id: 'change_request', label: 'Change request', type: 'text' }],
      nodes: [
        { id: 'agent', type: 'agent', prompt: 'Handle {{inputs.change_request}}' },
        { id: 'shot', type: 'tool', toolName: 'browser-screenshot' },
        { id: 'scout', type: 'subagent', agentId: 'subagent-scout', prompt: 'Scout {{inputs.change_request}}', timeoutMs: 1000 },
      ],
      edges: [{ from: 'agent', to: 'shot' }],
    });

    const bridge = store.getAgentBridgeState('agent-bridge-flow', { inputs: { change_request: 'preview me' } });
    expect(bridge.subagentPoolLimit).toBe(1);
    expect(bridge.agentNodes[0]).toMatchObject({
      nodeId: 'agent',
      promptPreview: 'Handle preview me',
      resultContract: expect.arrayContaining(['summary', 'sessionLink']),
    });

    const run = await store.createRun('agent-bridge-flow', {
      inputs: { change_request: 'ship bridge' },
      sessionId: 'session-agent-1',
      projectPath: rootDir,
    });
    expect(run.nodeRuns.agent.output).toMatchObject({
      summary: expect.any(String),
      status: 'completed',
      sessionId: 'session-agent-1',
      sessionLink: '#session=session-agent-1',
    });
    expect(run.nodeRuns.shot.output.screenshotPath).toMatch(/\.png$/);
    await expect(fs.stat(run.nodeRuns.shot.output.screenshotPath)).resolves.toMatchObject({ size: expect.any(Number) });

    const tools = store.getToolRegistry();
    expect(tools.map((tool) => tool.id)).toEqual(expect.arrayContaining(['git-native-review', 'browser-screenshot']));
    expect(store.getMcpToolCatalog('agent-bridge-flow')).toEqual([
      expect.objectContaining({ toolName: 'redmine.get_issue', enabled: true, argumentSchema: expect.any(Object) }),
    ]);
    expect(store.buildMcpArgumentSchema('redmine.get_issue').fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'arguments', type: 'json' }),
    ]));

    await store.controlRun(run.id, { action: 'cancel' });
    expect(stopped).toEqual([{ runId: 'subagent-run-cancel-me', action: 'stop' }]);

    await fs.rm(rootDir, { recursive: true, force: true });
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
      nodes: [{ id: 'shell', type: 'shell', command: 'node -e "console.log(\'checkpoint\')"' }],
      edges: [],
    });

    const run = await store.createRun('timeline-flow', { sessionId: 'session-1', projectPath: 'E:\\AIINWORK' });
    const timeline = store.listTimelineEvents({ sessionId: 'session-1' });

    expect(run.nodeRuns.shell.checkpoints.before.id).toBe('checkpoint-shell-before');
    expect(run.nodeRuns.shell.checkpoints.after.id).toBe('checkpoint-shell-after');
    expect(timeline.some((event) => event.category === 'workflow' && event.type === 'workflow_node_completed')).toBe(true);
  });

  test('exports and imports shareable workflow packages with manifest metadata', async () => {
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

    const imported = await store.importWorkflowPackage(pkg);
    expect(imported.imported).toContain('package-flow');
    expect(store.getWorkflow('package-flow')?.metadata?.dependencies?.skills).toEqual(['playwright']);
  });

  test('seeds enterprise recipe workflows as built-in templates', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.ready();

    const ids = store.listWorkflows().map((workflow) => workflow.id);

    expect(ids).toEqual(expect.arrayContaining([
      'recipe-crashsight-analysis',
      'recipe-redmine-review',
      'recipe-code-impact-analysis',
      'recipe-pr-description',
    ]));
  });

  test('exposes typed node definitions for the visual editor contract', () => {
    const definitions = getWorkflowNodeTypeDefinitions();

    expect(definitions.map((definition) => definition.type)).toEqual(expect.arrayContaining([
      'agent',
      'subagent',
      'mcp',
      'tool',
      'shell',
      'artifact',
      'approval',
      'condition',
      'join',
    ]));
    expect(definitions.find((definition) => definition.type === 'shell')).toMatchObject({
      label: 'Shell',
      permissions: expect.objectContaining({ risky: true, action: 'shell' }),
      configSchema: expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'command', required: true }),
          expect.objectContaining({ name: 'timeoutMs' }),
        ]),
      }),
      outputSchema: expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'stdout', type: 'text' }),
          expect.objectContaining({ name: 'exitCode', type: 'number' }),
        ]),
      }),
    });
  });

  test('validates run inputs, node mappings, dependencies, and permission blockers without executing', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'dry-run-flow',
      name: 'Dry Run Flow',
      profileId: 'build',
      permissionPreset: 'enterprise-safe',
      inputs: [{ id: 'change_request', label: 'Change request', type: 'text', required: true }],
      nodes: [
        { id: 'explore', type: 'agent', prompt: 'Explore {{inputs.change_request}}' },
        { id: 'review', type: 'agent', prompt: 'Review {{nodes.explore.output.summary}}' },
        { id: 'broken', type: 'agent', prompt: 'Missing {{nodes.review.output.not_here}}' },
        { id: 'shell', type: 'shell', command: 'npm test' },
      ],
      edges: [
        { from: 'explore', to: 'review' },
        { from: 'review', to: 'broken' },
        { from: 'broken', to: 'shell' },
      ],
    });

    const result = await store.validateRun('dry-run-flow', { inputs: {} });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_required_input', inputId: 'change_request' }),
      expect.objectContaining({ code: 'missing_output_field', nodeId: 'broken', field: 'prompt' }),
      expect.objectContaining({ code: 'permission_denied', nodeId: 'shell' }),
    ]));
    expect(result.availableVariables).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'inputs.change_request', type: 'text' }),
      expect.objectContaining({ path: 'nodes.explore.output.summary' }),
    ]));
  });

  test('clones workflow templates with manifest metadata into editable workflows', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.ready();

    const clone = await store.cloneWorkflow('recipe-redmine-review', {
      name: 'Project Redmine Review',
      projectPath: 'E:\\AIINWORK',
    });

    expect(clone.id).not.toBe('recipe-redmine-review');
    expect(clone.name).toBe('Project Redmine Review');
    expect(clone.metadata.templateManifest).toMatchObject({
      version: expect.any(String),
      dependencies: expect.any(Object),
      expectedOutputs: expect.any(Array),
    });
    expect(store.getWorkflow(clone.id)).toMatchObject({ id: clone.id, name: 'Project Redmine Review' });
  });

  test('lists run events and node logs, and retries from a failed node through downstream nodes', async () => {
    let failReview = true;
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      executors: {
        agent: async ({ node }) => {
          if (node.id === 'review' && failReview) {
            throw new Error('review failed');
          }
          return { summary: `${node.id} done` };
        },
      },
    });
    await store.upsertWorkflow({
      id: 'retry-from-flow',
      name: 'Retry From Flow',
      profileId: 'build',
      permissionPreset: 'full-auto',
      nodes: [
        { id: 'explore', type: 'agent' },
        { id: 'review', type: 'agent' },
        { id: 'artifact', type: 'artifact' },
      ],
      edges: [
        { from: 'explore', to: 'review' },
        { from: 'review', to: 'artifact' },
      ],
    });

    const failed = await store.createRun('retry-from-flow');
    expect(failed.status).toBe('failed');

    const events = store.listRunEvents(failed.id);
    const logs = store.listNodeLogs(failed.id, 'review');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['workflow_node_failed']));
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'error', message: 'review failed' }),
    ]));

    failReview = false;
    const retried = await store.retryFromNode(failed.id, 'review');

    expect(retried.status).toBe('completed');
    expect(retried.nodeRuns.explore.status).toBe('completed');
    expect(retried.nodeRuns.review.status).toBe('completed');
    expect(retried.nodeRuns.artifact.status).toBe('completed');
    expect(store.listRunEvents(failed.id).map((event) => event.type)).toEqual(expect.arrayContaining(['workflow_node_retry_from']));
  });

  test('queues workflow runs, exposes worker lease metadata, and recovers stale runs', async () => {
    let timestamp = 2000000000000;
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      autoExecute: false,
      now: () => {
        timestamp += 100;
        return timestamp;
      },
    });
    await store.upsertWorkflow({
      id: 'queued-flow',
      name: 'Queued Flow',
      profileId: 'build',
      maxConcurrency: 1,
      nodes: [{ id: 'agent', type: 'agent' }],
      edges: [],
    });

    const queued = await store.createRun('queued-flow');
    expect(queued.status).toBe('queued');
    expect(queued.queue).toMatchObject({ state: 'queued', maxConcurrency: 1 });

    const leased = await store.acquireNextRun({ workerId: 'worker-a', leaseMs: 500 });
    expect(leased.status).toBe('running');
    expect(leased.queue.workerId).toBe('worker-a');
    expect(leased.queue.leaseExpiresAt).toBeGreaterThan(leased.queue.heartbeatAt);

    timestamp += 1000;
    const recovered = await store.recoverStaleRuns({ nowMs: timestamp });
    expect(recovered.recovered).toBe(1);
    expect(store.getRun(queued.id).status).toBe('queued');
    expect(store.getRun(queued.id).queue.state).toBe('recovering');
  });

  test('captures node input/output snapshots and replays workflow state from events', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      executors: {
        agent: async ({ nodeInput }) => ({ summary: `done ${nodeInput.prompt}` }),
      },
    });
    await store.upsertWorkflow({
      id: 'io-replay-flow',
      name: 'IO Replay Flow',
      profileId: 'build',
      inputs: [{ id: 'change_request', label: 'Change request', type: 'text', required: true }],
      nodes: [{ id: 'agent', type: 'agent', prompt: 'Handle {{inputs.change_request}}' }],
      edges: [],
    });

    const run = await store.createRun('io-replay-flow', { inputs: { change_request: 'typed dataflow' } });
    const io = store.getNodeIo(run.id, 'agent');
    const replay = store.replayRun(run.id);

    expect(io).toMatchObject({
      nodeId: 'agent',
      input: { prompt: 'Handle typed dataflow' },
      output: { summary: 'done Handle typed dataflow' },
      inputSchema: expect.objectContaining({ fields: expect.any(Array) }),
      outputSchema: expect.objectContaining({ fields: expect.any(Array) }),
    });
    expect(replay.status).toBe('completed');
    expect(replay.nodes.agent.status).toBe('completed');
    expect(replay.events.map((event) => event.type)).toEqual(expect.arrayContaining(['workflow_node_started', 'workflow_node_completed']));
  });

  test('lists approval inbox requests and records audited decisions', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'approval-inbox-flow',
      name: 'Approval Inbox Flow',
      profileId: 'build',
      permissionPreset: 'suggest',
      nodes: [{ id: 'shell', type: 'shell', title: 'Risky Shell', command: 'npm test' }],
      edges: [],
    });

    const waiting = await store.createRun('approval-inbox-flow');
    const approvals = store.listApprovalRequests();
    expect(approvals).toEqual([
      expect.objectContaining({
        runId: waiting.id,
        nodeId: 'shell',
        riskLevel: 'high',
        status: 'pending',
      }),
    ]);

    const decided = await store.decideApproval(approvals[0].id, { decision: 'approve', reason: 'verified by reviewer', approver: 'qa' });
    expect(decided.status).toBe('completed');
    const events = store.listRunEvents(waiting.id);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'workflow_approval_decision',
        payload: expect.objectContaining({ decision: 'approve', approver: 'qa' }),
      }),
    ]));
  });

  test('builds real workflow security state, permission dry-run, override requests, and audit export', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.upsertWorkflow({
      id: 'security-flow',
      name: 'Security Flow',
      profileId: 'build',
      permissionPreset: 'auto-edit',
      metadata: {
        security: {
          timeoutPolicy: { action: 'fail', timeoutMinutes: 20, escalateAfterMinutes: 5 },
          delegation: { target: 'security-reviewer', allowedTargets: ['local-owner', 'security-reviewer'] },
          secretRefs: ['secret://workflow/github-token'],
          mcpAllowlist: ['redmine.get_issue'],
        },
      },
      nodes: [
        { id: 'mcp', type: 'mcp', toolName: 'redmine.get_issue' },
        { id: 'shell', type: 'shell', command: 'git reset --hard HEAD' },
      ],
      edges: [{ from: 'mcp', to: 'shell' }],
    });

    const security = store.getWorkflowSecurityState('security-flow');
    expect(security).toMatchObject({
      workflowId: 'security-flow',
      timeoutPolicy: { action: 'fail', timeoutMinutes: 20, escalateAfterMinutes: 5 },
      delegation: { target: 'security-reviewer' },
      secretRefs: ['secret://workflow/github-token'],
      mcpAllowlist: ['redmine.get_issue'],
    });

    const dryRun = store.permissionDryRun('security-flow');
    expect(dryRun.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'mcp', decision: 'ask' }),
      expect.objectContaining({
        nodeId: 'shell',
        decision: 'ask',
        riskLevel: 'critical',
        dangerousCommand: expect.objectContaining({ reason: 'destructive git workspace operation' }),
      }),
    ]));

    const request = await store.createPermissionOverrideRequest('security-flow', {
      nodeId: 'shell',
      requestedDecision: 'allow',
      reason: 'maintenance window',
      requester: 'qa',
    });
    expect(request).toMatchObject({ status: 'requested', nodeId: 'shell', requester: 'qa' });
    expect(store.getWorkflowSecurityState('security-flow').overrideRequests).toEqual([
      expect.objectContaining({ id: request.id, reason: 'maintenance window' }),
    ]);

    const waiting = await store.createRun('security-flow');
    const approval = store.listApprovalRequests()[0];
    expect(approval).toMatchObject({
      workflowId: 'security-flow',
      timeoutPolicy: { timeoutMinutes: 20 },
      delegation: { target: 'security-reviewer' },
      riskExplanation: expect.objectContaining({ permissionDecision: 'ask' }),
      diffSummary: expect.objectContaining({ summary: expect.any(String) }),
    });

    await store.decideApproval(approval.id, {
      decision: 'reject',
      reason: 'dangerous command',
      approver: 'security',
      delegatedTo: 'security-reviewer',
    });
    const audit = store.exportApprovalAudit({ workflowId: 'security-flow', runId: waiting.id });
    expect(audit.records).toEqual([
      expect.objectContaining({
        workflowId: 'security-flow',
        nodeId: 'mcp',
        decision: 'reject',
        approver: 'security',
        delegatedTo: 'security-reviewer',
        reason: 'dangerous command',
      }),
    ]);
  });

  test('registers workflow node packages and validates missing dependencies', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    const registered = await store.installNodePackage({
      id: 'crashsight-node',
      type: 'crashsight-analysis',
      label: 'CrashSight Analysis',
      version: '1.0.0',
      configSchema: { fields: [{ name: 'crashId', label: 'Crash ID', type: 'text', required: true }] },
      outputSchema: { fields: [{ name: 'summary', type: 'markdown' }] },
      permissions: { risky: true, action: 'mcp' },
      dependencies: { mcpServers: ['crashsight'] },
    });

    expect(registered.status).toBe('missing_dependencies');
    expect(store.listNodePackages()).toEqual([
      expect.objectContaining({ id: 'crashsight-node', enabled: false, status: 'missing_dependencies' }),
    ]);
    expect(store.getWorkflowNodeTypeDefinitions().map((definition) => definition.type)).toContain('crashsight-analysis');
  });

  test('smokes workflow templates and exposes benchmark release readiness results', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.ready();

    const smoke = await store.smokeTemplate('recipe-code-impact-analysis', {
      inputs: { change_request: 'smoke code impact' },
    });
    const benchmarks = await store.runBenchmarks({ limit: 3 });
    const readiness = store.getReleaseReadiness();

    expect(smoke).toMatchObject({ templateId: 'recipe-code-impact-analysis', status: 'passed' });
    expect(benchmarks.results.length).toBeGreaterThan(0);
    expect(benchmarks.results[0]).toEqual(expect.objectContaining({ workflowId: expect.any(String), status: expect.any(String) }));
    expect(readiness.workflowBenchmarks.total).toBeGreaterThan(0);
    expect(readiness.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workflow-benchmarks' }),
    ]));
  });

  test('productizes workflow templates with detail, dependency checks, fork, package previews, trust, and upgrade metadata', async () => {
    const store = createWorkflowStudioStore({ persist: false, agentResolver });
    await store.ready();

    const detail = store.getTemplateDetail('recipe-redmine-review');
    expect(detail).toMatchObject({
      manifest: expect.objectContaining({ id: 'redmine-review', version: expect.any(String) }),
      trust: 'built-in',
      dag: expect.objectContaining({ nodes: expect.any(Array), edges: expect.any(Array) }),
    });

    const dependencyReport = store.checkTemplateDependencies('recipe-redmine-review');
    expect(dependencyReport).toMatchObject({ templateId: 'recipe-redmine-review', ready: expect.any(Boolean), missing: expect.any(Array) });

    const fork = await store.forkTemplate('recipe-redmine-review', { name: 'Private Redmine Review' });
    expect(fork).toMatchObject({
      name: 'Private Redmine Review',
      metadata: expect.objectContaining({ forkedFrom: 'recipe-redmine-review', visibility: 'project-private', trust: 'local' }),
    });

    const exportPreview = await store.exportWorkflowPackagePreview([fork.id]);
    expect(exportPreview).toMatchObject({
      workflowCount: 1,
      workflows: [expect.objectContaining({ id: fork.id, dependencyReport: expect.any(Object) })],
      packageSizeEstimateBytes: expect.any(Number),
    });

    const pkg = await store.exportWorkflowPackage([fork.id]);
    const importPreview = store.importWorkflowPackagePreview(pkg);
    expect(importPreview.changes).toEqual([
      expect.objectContaining({ id: fork.id, action: 'overwrite' }),
    ]);

    await store.upsertWorkflow({
      id: 'template-source',
      name: 'Template Source',
      profileId: 'build',
      metadata: {
        templateManifest: {
          id: 'template-source',
          version: '2.0.0',
          migrationNotes: ['Re-map output.summary to output.report'],
          changelog: ['Added approval node'],
        },
      },
      nodes: [{ id: 'agent', type: 'agent', prompt: 'source' }],
      edges: [],
    });
    await store.upsertWorkflow({
      id: 'template-installed',
      name: 'Template Installed',
      profileId: 'build',
      metadata: {
        clonedFrom: 'template-source',
        templateManifest: { id: 'template-source', version: '1.0.0' },
      },
      nodes: [{ id: 'agent', type: 'agent', prompt: 'installed' }],
      edges: [],
    });
    const upgrade = store.getTemplateUpgradeStatus('template-installed');
    expect(upgrade).toMatchObject({
      updateAvailable: true,
      currentVersion: '1.0.0',
      latestVersion: '2.0.0',
      migrationNotes: ['Re-map output.summary to output.report'],
    });
    const upgraded = await store.upgradeTemplateWorkflow('template-installed');
    expect(upgraded.upgraded).toBe(true);
    expect(store.getTemplateUpgradeStatus('template-installed').updateAvailable).toBe(false);
  });

  test('exports real observability, replay, failure, artifact, screenshot, benchmark, coverage, and evidence data', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-observe-'));
    const screenshotDir = path.join(rootDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });
    await fs.writeFile(path.join(screenshotDir, 'REQ-157-workflow-screenshot-evidence-viewer.png'), 'png');
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      screenshotDir,
      executors: {
        agent: async () => {
          throw new Error('schema invalid: missing output.summary');
        },
      },
    });
    await store.upsertWorkflow({
      id: 'observe-flow',
      name: 'Observe Flow',
      profileId: 'build',
      nodes: [
        { id: 'agent', type: 'agent', prompt: 'fail' },
        { id: 'artifact', type: 'artifact' },
      ],
      edges: [],
    });

    const run = await store.createRun('observe-flow');
    const failures = store.classifyRunFailures(run.id);
    const recovery = store.getRecommendedRecoveryActions(run.id);
    const artifacts = store.listRunArtifacts(run.id);
    const evidence = await store.listRunEvidence(run.id);
    const bundle = await store.exportEvidenceBundle(run.id);
    await store.runBenchmarks({ limit: 1 });
    const trend = store.getBenchmarkTrend();
    const coverage = store.getTestCoverageMap();

    expect(store.replayRun(run.id).events.map((event) => event.type)).toEqual(expect.arrayContaining(['workflow_node_failed']));
    expect(failures.failures).toEqual([expect.objectContaining({ nodeId: 'agent', category: 'schema' })]);
    expect(recovery.actions[0].recommendations).toEqual(expect.arrayContaining(['fix node mapping']));
    expect(artifacts.artifacts.length).toBeGreaterThan(0);
    expect(evidence.screenshots).toEqual([
      expect.objectContaining({ name: 'REQ-157-workflow-screenshot-evidence-viewer.png', kind: 'playwright-screenshot' }),
    ]);
    expect(bundle).toMatchObject({
      run: expect.objectContaining({ id: run.id }),
      replay: expect.objectContaining({ runId: run.id }),
      releaseReadiness: expect.any(Object),
      coverageMap: expect.any(Object),
    });
    expect(trend.results.length).toBeGreaterThan(0);
    expect(coverage.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'server/services/tests/workflow-studio-service.test.mjs' }),
    ]));

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test('tracks workflow governance history, publish snapshots, reviews, audit, analytics, visibility, compliance, and policy reports', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      autoExecute: false,
    });
    await store.upsertWorkflow({
      id: 'governed-flow',
      name: 'Governed Flow',
      profileId: 'build',
      permissionPreset: 'suggest',
      nodes: [
        { id: 'agent', type: 'agent', prompt: 'draft prompt' },
        { id: 'shell', type: 'shell', command: 'npm test' },
      ],
      edges: [{ from: 'agent', to: 'shell' }],
      actor: 'alice',
    });
    await store.upsertWorkflow({
      id: 'governed-flow',
      name: 'Governed Flow Updated',
      profileId: 'build',
      permissionPreset: 'suggest',
      nodes: [
        { id: 'agent', type: 'agent', prompt: 'updated prompt' },
        { id: 'shell', type: 'shell', command: 'npm test' },
        { id: 'artifact', type: 'artifact' },
      ],
      edges: [{ from: 'agent', to: 'shell' }, { from: 'shell', to: 'artifact' }],
      actor: 'alice',
    });

    await store.updateWorkflowGovernance('governed-flow', {
      actor: 'alice',
      ownership: { owner: 'workflow-platform', team: 'agent-tools', maintainer: 'bob', supportContact: 'ops@example.test' },
      visibility: { roles: ['owner', 'maintainer', 'viewer'], defaultRole: 'viewer' },
      complianceLabels: ['data-sensitive', 'code-write', 'not-supported'],
    });
    const review = await store.requestWorkflowReview('governed-flow', { requester: 'alice', reviewer: 'bob' });
    const published = await store.publishWorkflow('governed-flow', { actor: 'bob' });
    const run = await store.createRun('governed-flow');
    const deprecated = await store.deprecateWorkflow('governed-flow', { actor: 'bob', reason: 'Use newer template', replacementWorkflowId: 'replacement-flow' });
    const history = store.getWorkflowHistory('governed-flow');
    const analytics = store.getWorkflowUsageAnalytics('governed-flow');
    const audit = store.searchWorkflowAudit({ workflowId: 'governed-flow', query: 'published' });
    const policy = store.getWorkflowPolicyReport('governed-flow');

    expect(history.revisions.length).toBeGreaterThanOrEqual(2);
    expect(history.revisions[0].diff.nodes.after).toBe(3);
    expect(review).toMatchObject({
      status: 'requested',
      reviewer: 'bob',
      dagDiff: expect.objectContaining({ nodes: expect.any(Object), edges: expect.any(Object) }),
      riskChanges: expect.arrayContaining([expect.objectContaining({ nodeId: 'shell' })]),
    });
    expect(published).toMatchObject({
      status: 'published',
      publishedRevisionId: expect.stringMatching(/^workflow_revision_/),
      ownership: expect.objectContaining({ owner: 'workflow-platform', maintainer: 'bob' }),
      complianceLabels: ['data-sensitive', 'code-write'],
    });
    expect(run.profileSnapshot.governanceStatus).toBe('published');
    expect(deprecated).toMatchObject({
      status: 'deprecated',
      deprecated: expect.objectContaining({ enabled: true, replacementWorkflowId: 'replacement-flow' }),
    });
    expect(analytics[0]).toMatchObject({ workflowId: 'governed-flow', runCount: 1 });
    expect(audit.some((record) => record.type === 'workflow_published')).toBe(true);
    expect(policy.workflows[0]).toMatchObject({
      workflowId: 'governed-flow',
      status: 'deprecated',
      owner: 'workflow-platform',
      complianceLabels: ['data-sensitive', 'code-write'],
      riskyNodes: [expect.objectContaining({ nodeId: 'shell' })],
    });
  });

  test('reports workflow production readiness, virtualized logs, offline snapshots, sandbox import, backup restore, retention, size guard, smoke matrix, and migration doctor', async () => {
    const store = createWorkflowStudioStore({
      persist: false,
      agentResolver,
      autoExecute: false,
    });
    await store.upsertWorkflow({
      id: 'ready-flow',
      name: 'Ready Flow',
      profileId: 'build',
      nodes: Array.from({ length: 5 }, (_, index) => ({
        id: `node-${index + 1}`,
        type: index === 0 ? 'agent' : 'artifact',
        prompt: `step ${index + 1}`,
        position: { x: index * 100, y: 100 },
      })),
      edges: Array.from({ length: 4 }, (_, index) => ({ from: `node-${index + 1}`, to: `node-${index + 2}` })),
    });
    const run = await store.createRun('ready-flow');
    const performance = store.getLargeGraphPerformanceReport('ready-flow');
    const virtualLogs = store.listVirtualizedRunLogs(run.id, { limit: 2 });
    const offline = store.getOfflineReadSnapshot();
    const pkg = await store.exportWorkflowPackage(['ready-flow']);
    const sandbox = store.validateWorkflowPackageSandbox(pkg);
    const backup = await store.exportStorageBackup();
    const retention = await store.updateRetentionPolicy({ maxRuns: 1, maxLogEntriesPerNode: 1 });
    const applied = await store.applyRetentionPolicy();
    const sizeGuard = store.getPackageSizeGuard(['ready-flow']);
    await store.runBenchmarks({ limit: 1 });
    const smokeMatrix = store.getReleaseSmokeMatrix();
    const doctor = store.getMigrationDoctor();
    const dashboard = store.getProductionReadinessDashboard();
    const restored = await store.restoreStorageBackup(backup);

    expect(performance).toMatchObject({ workflowId: 'ready-flow', nodeCount: 5, status: 'within_target' });
    expect(virtualLogs).toMatchObject({ runId: run.id, limit: 2, rows: expect.any(Array) });
    expect(offline.workflows.some((workflow) => workflow.id === 'ready-flow')).toBe(true);
    expect(sandbox).toMatchObject({ valid: true, isolated: true, changes: expect.any(Array) });
    expect(retention).toMatchObject({ maxRuns: 1, maxLogEntriesPerNode: 1 });
    expect(applied).toMatchObject({ removedRuns: expect.any(Number), policy: expect.objectContaining({ maxRuns: 1 }) });
    expect(sizeGuard).toMatchObject({ workflowCount: 1, status: 'ok', estimatedBytes: expect.any(Number) });
    expect(smokeMatrix).toMatchObject({ total: 5, matrix: expect.any(Array) });
    expect(doctor).toMatchObject({ status: expect.stringMatching(/passed|warning|failed/), findings: expect.any(Array) });
    expect(dashboard).toMatchObject({
      status: expect.stringMatching(/ready|needs_attention/),
      performance: expect.any(Array),
      quality: expect.any(Object),
      migrationDoctor: expect.any(Object),
      releaseSmokeMatrix: expect.any(Object),
    });
    expect(restored).toMatchObject({ workflowCount: expect.any(Number), runCount: expect.any(Number) });
  });
});
