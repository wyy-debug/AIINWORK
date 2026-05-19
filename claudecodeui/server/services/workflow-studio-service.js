import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { listBuiltInRecipes, renderRecipePrompt } from '../../shared/recipes.js';
import { db } from '../database/db.js';
import { getAgentConfig } from './agent-config-service.js';
import { createCheckpointStore } from './checkpoint-service.js';
import { buildGitNativeReviewFlow } from './git-native-review-flow-service.js';
import { defaultSubagentRunStore } from './subagent-run-service.js';

const DATA_DIR = process.env.MTL_CODE_UI_DATA_DIR || path.join(os.homedir(), '.mtl-code-ui');
const DEFAULT_WORKFLOWS_PATH = path.join(DATA_DIR, 'workflows.json');
const DEFAULT_RUNS_PATH = path.join(DATA_DIR, 'workflow-runs.json');
const execAsync = promisify(execCallback);
const defaultWorkflowCheckpointStore = createCheckpointStore(db);

export const WORKFLOW_NODE_TYPES = Object.freeze([
  'agent',
  'subagent',
  'mcp',
  'tool',
  'shell',
  'artifact',
  'approval',
  'condition',
  'join',
]);

const NODE_TYPES = new Set(WORKFLOW_NODE_TYPES);
const NODE_STATUSES = new Set([
  'pending',
  'ready',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'skipped',
  'cancelled',
]);
const EDGE_MODES = new Set(['success', 'failure', 'always']);
const RISKY_NODE_TYPES = new Set(['shell', 'mcp', 'tool']);
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const PERMISSION_ACTIONS = new Set(['allow', 'ask', 'deny']);
const SUBAGENT_TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped', 'cancelled']);

function nowIso(now) {
  return new Date(now()).toISOString();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value, fallback = '', maxLength = 4000) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeId(value, fallback = 'workflow') {
  const id = normalizeText(value, '', 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || `${fallback}-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeInteger(value, fallback, min = 1, max = 32) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizePermission(value, fallback = '') {
  const normalized = normalizeText(value, fallback, 20).toLowerCase();
  return PERMISSION_ACTIONS.has(normalized) ? normalized : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInputOutput(entry, index, kind) {
  const item = asObject(entry);
  const id = normalizeId(item.id || item.name || `${kind}-${index + 1}`, `${kind}-${index + 1}`);
  return {
    id,
    label: normalizeText(item.label || item.name || id, id, 120),
    type: normalizeText(item.type, 'text', 40),
    required: Boolean(item.required),
    defaultValue: item.defaultValue ?? '',
  };
}

function normalizePosition(value, index) {
  const source = asObject(value);
  const x = Number(source.x);
  const y = Number(source.y);
  return {
    x: Number.isFinite(x) ? x : 80 + (index % 3) * 260,
    y: Number.isFinite(y) ? y : 80 + Math.floor(index / 3) * 150,
  };
}

export function normalizeWorkflowNode(entry, index = 0) {
  const node = asObject(entry);
  const requestedType = normalizeText(node.type, 'agent', 40).toLowerCase();
  const type = requestedType || 'agent';
  const id = normalizeId(node.id || node.name || `${type}-${index + 1}`, `${type}-${index + 1}`);
  return {
    id,
    type,
    title: normalizeText(node.title || node.name || id, id, 140),
    description: normalizeText(node.description, '', 500),
    agentId: normalizeText(node.agentId || node.agentProfile || node.profileId, '', 120),
    toolName: normalizeText(node.toolName || node.tool || node.mcpTool, '', 160),
    command: normalizeText(node.command, '', 2000),
    prompt: normalizeText(node.prompt || node.objective || node.message, '', 8000),
    condition: normalizeText(node.condition, '', 1000),
    permission: normalizePermission(node.permission, ''),
    retryLimit: normalizeInteger(node.retryLimit, 0, 0, 10),
    timeoutMs: normalizeInteger(node.timeoutMs, 120000, 1000, 30 * 60 * 1000),
    config: asObject(node.config),
    position: normalizePosition(node.position, index),
  };
}

export function normalizeWorkflowEdge(entry, index = 0) {
  const edge = asObject(entry);
  const from = normalizeText(edge.from || edge.source, '', 120);
  const to = normalizeText(edge.to || edge.target, '', 120);
  const mode = EDGE_MODES.has(edge.mode || edge.on) ? edge.mode || edge.on : 'success';
  return {
    id: normalizeId(edge.id || `${from}-${to}-${index + 1}`, `edge-${index + 1}`),
    from,
    to,
    mode,
    condition: normalizeText(edge.condition, '', 1000),
  };
}

export function normalizeWorkflowDefinition(input = {}, existing = null, now = () => Date.now()) {
  const source = asObject(input);
  const previous = asObject(existing);
  const timestamp = nowIso(now);
  const nodes = (Array.isArray(source.nodes) ? source.nodes : previous.nodes || [])
    .map((node, index) => normalizeWorkflowNode(node, index));
  const edges = (Array.isArray(source.edges) ? source.edges : previous.edges || [])
    .map((edge, index) => normalizeWorkflowEdge(edge, index));
  return {
    id: normalizeId(source.id || previous.id || source.name, 'workflow'),
    name: normalizeText(source.name || source.title || previous.name, 'Untitled workflow', 180),
    description: normalizeText(source.description || previous.description, '', 1000),
    profileId: normalizeText(source.profileId || source.defaultProfile || previous.profileId, 'build', 120),
    permissionPreset: normalizeText(source.permissionPreset || previous.permissionPreset, 'suggest', 80),
    inputs: (Array.isArray(source.inputs) ? source.inputs : previous.inputs || [])
      .map((entry, index) => normalizeInputOutput(entry, index, 'input')),
    outputs: (Array.isArray(source.outputs) ? source.outputs : previous.outputs || [])
      .map((entry, index) => normalizeInputOutput(entry, index, 'output')),
    nodes,
    edges,
    maxConcurrency: normalizeInteger(source.maxConcurrency ?? previous.maxConcurrency, 4, 1, 16),
    metadata: asObject(source.metadata || previous.metadata),
    createdAt: previous.createdAt || source.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

export function recipeToWorkflow(recipe) {
  const prompt = renderRecipePrompt(recipe, {});
  return normalizeWorkflowDefinition({
    id: `recipe-${recipe.id}`,
    name: recipe.title || recipe.id,
    description: recipe.description || '',
    profileId: recipe.defaultProfile || 'build',
    permissionPreset: recipe.permissionPreset || 'suggest',
    inputs: recipe.inputs || [],
    outputs: [{ id: 'artifact', label: 'Workflow artifact', type: 'markdown' }],
    nodes: [{
      id: 'run-recipe',
      type: 'agent',
      title: recipe.title || 'Run recipe',
      agentId: recipe.defaultProfile || 'build',
      prompt,
      position: { x: 120, y: 120 },
    }],
    edges: [],
    metadata: { source: 'recipe', recipeId: recipe.id },
  });
}

export function createStarterWorkflow() {
  return normalizeWorkflowDefinition({
    id: 'agent-review-delivery',
    name: 'Agent Review Delivery',
    description: 'Explore, review, approve, build, and collect an artifact through a reusable Agent workflow.',
    profileId: 'build',
    permissionPreset: 'auto-edit',
    inputs: [{ id: 'change_request', label: 'Change request', type: 'textarea', required: true }],
    outputs: [{ id: 'delivery_summary', label: 'Delivery summary', type: 'markdown' }],
    nodes: [
      { id: 'explore', type: 'subagent', title: 'Explore Subagent', agentId: 'subagent-explore', prompt: 'Explore impact and return evidence.', position: { x: 80, y: 140 } },
      { id: 'review', type: 'subagent', title: 'Reviewer Subagent', agentId: 'subagent-reviewer', prompt: 'Review risks and missing tests.', position: { x: 360, y: 140 } },
      { id: 'approval', type: 'approval', title: 'Human Approval', prompt: 'Confirm the plan before edits.', position: { x: 640, y: 140 } },
      { id: 'build', type: 'agent', title: 'Build Agent', agentId: 'build', prompt: 'Implement the approved change.', position: { x: 920, y: 140 } },
      { id: 'git-review', type: 'tool', title: 'Git Review', toolName: 'git-native-review', permission: 'ask', position: { x: 1200, y: 140 } },
      { id: 'artifact', type: 'artifact', title: 'Delivery Artifact', prompt: 'Collect summary, tests, and screenshots.', position: { x: 1480, y: 140 } },
    ],
    edges: [
      { from: 'explore', to: 'review' },
      { from: 'review', to: 'approval' },
      { from: 'approval', to: 'build' },
      { from: 'build', to: 'git-review' },
      { from: 'git-review', to: 'artifact' },
    ],
  });
}

export function validateWorkflowDefinition(input = {}) {
  const workflow = normalizeWorkflowDefinition(input);
  const errors = [];
  const warnings = [];
  const nodeIds = new Set();

  if (!workflow.profileId) {
    errors.push({ code: 'missing_profile', message: 'Workflow must bind an Agent Profile.' });
  }

  if (workflow.nodes.length === 0) {
    errors.push({ code: 'missing_nodes', message: 'Workflow must contain at least one node.' });
  }

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ code: 'duplicate_node', nodeId: node.id, message: `Duplicate node id: ${node.id}` });
    }
    nodeIds.add(node.id);
    if (!NODE_TYPES.has(node.type)) {
      errors.push({ code: 'invalid_node_type', nodeId: node.id, message: `Invalid node type: ${node.type}` });
    }
    if (node.permission === 'allow' && workflow.permissionPreset !== 'full-auto') {
      errors.push({
        code: 'permission_escalation',
        nodeId: node.id,
        message: `Node ${node.id} cannot allow more than workflow profile preset ${workflow.permissionPreset}.`,
      });
    }
  }

  const incoming = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const graph = new Map(workflow.nodes.map((node) => [node.id, []]));
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push({ code: 'missing_edge_source', edgeId: edge.id, message: `Edge ${edge.id} source node does not exist.` });
      continue;
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({ code: 'missing_edge_target', edgeId: edge.id, message: `Edge ${edge.id} target node does not exist.` });
      continue;
    }
    graph.get(edge.from).push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
  }

  const roots = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  if (workflow.nodes.length > 0 && roots.length === 0) {
    errors.push({ code: 'missing_entry_node', message: 'Workflow must have at least one entry node.' });
  }

  const indegree = new Map(incoming);
  const queue = roots.slice();
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    visited += 1;
    for (const next of graph.get(id) || []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (workflow.nodes.length > 0 && visited !== workflow.nodes.length && errors.every((error) => !/^missing_edge_/.test(error.code))) {
    errors.push({ code: 'cycle_detected', message: 'Workflow DAG contains a cycle.' });
  }

  for (const node of workflow.nodes) {
    if (RISKY_NODE_TYPES.has(node.type) && !node.permission && workflow.permissionPreset === 'suggest') {
      warnings.push({ code: 'risky_node_needs_approval', nodeId: node.id, message: `Node ${node.id} will ask before running.` });
    }
  }

  return {
    workflow,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

function createNodeRun(node, now) {
  return {
    nodeId: node.id,
    type: node.type,
    title: node.title,
    status: 'pending',
    attempt: 0,
    startedAt: null,
    completedAt: null,
    durationMs: 0,
    logs: [],
    input: {},
    output: {},
    artifacts: [],
    checkpoints: {},
    error: '',
    waitingReason: '',
    permissionDecision: '',
    updatedAt: now(),
  };
}

function createRunEvent(type, payload, now) {
  return {
    id: `workflow_event_${crypto.randomUUID()}`,
    category: 'workflow',
    type,
    payload: asObject(payload),
    createdAt: now(),
  };
}

function summarizeNode(node) {
  return {
    nodeId: node.id,
    type: node.type,
    title: node.title,
  };
}

function resolveNodePermission(workflow, node) {
  if (node.permission) return node.permission;
  if (workflow.permissionPreset === 'full-auto') return 'allow';
  if (workflow.permissionPreset === 'enterprise-safe') return RISKY_NODE_TYPES.has(node.type) ? 'deny' : 'allow';
  if (RISKY_NODE_TYPES.has(node.type)) return 'ask';
  return 'allow';
}

function terminalStatus(status) {
  return ['completed', 'failed', 'skipped', 'cancelled'].includes(status);
}

function nodeSucceededForEdge(status, mode) {
  if (mode === 'always') return terminalStatus(status);
  if (mode === 'failure') return status === 'failed';
  return status === 'completed';
}

function buildRunSummary(run) {
  const nodeRuns = Object.values(run.nodeRuns || {});
  return {
    totalNodes: nodeRuns.length,
    completed: nodeRuns.filter((node) => node.status === 'completed').length,
    failed: nodeRuns.filter((node) => node.status === 'failed').length,
    waitingApproval: nodeRuns.filter((node) => node.status === 'waiting_approval').length,
    cancelled: nodeRuns.filter((node) => node.status === 'cancelled').length,
  };
}

function getPathValue(source, dottedPath) {
  const segments = String(dottedPath || '').split('.').filter(Boolean);
  let current = source;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function stringifyTemplateValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function renderTemplate(text, context) {
  const source = typeof text === 'string' ? text : '';
  return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, expression) => {
    const result = getPathValue(context, expression);
    if (!result.found) {
      const error = new Error(`Workflow variable not found: ${expression}`);
      error.code = 'missing_variable';
      error.variable = expression;
      throw error;
    }
    return stringifyTemplateValue(result.value);
  });
}

function buildTemplateContext(run) {
  return {
    inputs: run.inputs || {},
    nodes: Object.fromEntries(Object.entries(run.nodeRuns || {}).map(([nodeId, nodeRun]) => [nodeId, {
      input: nodeRun.input || {},
      output: nodeRun.output || {},
      status: nodeRun.status,
      error: nodeRun.error || '',
    }])),
  };
}

function buildNodeInput(node, run) {
  const context = buildTemplateContext(run);
  return {
    prompt: renderTemplate(node.prompt || '', context),
    command: renderTemplate(node.command || '', context),
    condition: renderTemplate(node.condition || '', context),
    toolName: renderTemplate(node.toolName || '', context),
    config: clone(node.config || {}),
  };
}

async function waitForSubagentTerminal(store, initialRun, timeoutMs = 120000) {
  if (!initialRun?.id || SUBAGENT_TERMINAL_STATUSES.has(initialRun.status) || typeof store?.getRun !== 'function') {
    return initialRun;
  }
  const startedAt = Date.now();
  let last = initialRun;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    last = await store.getRun(initialRun.id) || last;
    if (SUBAGENT_TERMINAL_STATUSES.has(last.status)) return last;
  }
  return last;
}

function validateRunInputs(workflow, inputs) {
  const errors = [];
  const runInputs = asObject(inputs);
  for (const input of workflow.inputs || []) {
    const value = runInputs[input.id];
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (input.required && empty && input.defaultValue === '') {
      errors.push({
        code: 'missing_required_input',
        inputId: input.id,
        message: `Workflow input is required: ${input.label || input.id}`,
      });
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

async function safeExec(command, options = {}) {
  try {
    const result = await execAsync(command, {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return {
      ok: true,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || error?.message || ''),
    };
  }
}

async function collectGitReviewInput(projectPath = '') {
  const cwd = projectPath || process.cwd();
  const [branchResult, statusResult, diffResult] = await Promise.all([
    safeExec('git rev-parse --abbrev-ref HEAD', { cwd }),
    safeExec('git status --porcelain', { cwd }),
    safeExec('git diff --no-ext-diff --', { cwd, timeout: 30000 }),
  ]);
  const files = statusResult.stdout.split(/\r?\n/)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const filePath = line.slice(3).trim();
      if (!filePath) return null;
      const kind = status.includes('A') || status.includes('?')
        ? 'added'
        : status.includes('D')
          ? 'deleted'
          : 'modified';
      return { path: filePath.replace(/"/g, ''), kind, status };
    })
    .filter(Boolean);
  return {
    projectName: path.basename(cwd),
    branch: branchResult.stdout.trim() || 'unknown',
    files,
    diff: diffResult.stdout,
    diffSource: 'workflow',
  };
}

function createDefaultExecutors() {
  return {
    async agent({ node, nodeInput }) {
      return {
        summary: `${node.title} completed through the workflow agent bridge.`,
        prompt: nodeInput.prompt,
      };
    },
    async tool({ node, nodeInput, run }) {
      const toolName = nodeInput.toolName || node.toolName;
      if (toolName === 'git-native-review') {
        return buildGitNativeReviewFlow(await collectGitReviewInput(run.projectPath));
      }
      return {
        summary: `${node.title} completed through the workflow tool bridge.`,
        toolName,
      };
    },
    async shell({ node, nodeInput, run }) {
      const command = nodeInput.command || node.command;
      if (!command) {
        throw new Error(`Shell node ${node.id} has no command.`);
      }
      const result = await execAsync(command, {
        cwd: run.projectPath || process.cwd(),
        timeout: node.timeoutMs || 120000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return {
        stdout: String(result.stdout || '').slice(0, 12000),
        stderr: String(result.stderr || '').slice(0, 12000),
        command,
      };
    },
    async mcp({ node, nodeInput }) {
      const toolName = nodeInput.toolName || node.toolName;
      throw new Error(`MCP tool is not configured for workflow execution: ${toolName || node.id}`);
    },
    async artifact({ workflow, run, node, nodeInput }) {
      const content = nodeInput.prompt || [
        `Workflow ${workflow.name} completed node ${node.title}.`,
        '',
        'Node outputs:',
        ...Object.values(run.nodeRuns || {}).map((nodeRun) => `- ${nodeRun.title}: ${nodeRun.status}`),
      ].join('\n');
      const artifact = {
        id: `workflow_artifact_${crypto.randomUUID()}`,
        kind: 'workflow-summary',
        title: node.title,
        content,
      };
      run.artifacts.push(artifact);
      return {
        artifact,
        output: { artifactId: artifact.id, summary: artifact.content },
      };
    },
  };
}

function normalizeRun(input, now) {
  const source = asObject(input);
  const workflow = asObject(source.workflow);
  const timestamp = source.createdAt || now();
  const nodeRuns = asObject(source.nodeRuns);
  return {
    id: normalizeText(source.id, `workflow_run_${crypto.randomUUID()}`, 120),
    workflowId: normalizeText(source.workflowId || workflow.id, '', 120),
    workflowName: normalizeText(source.workflowName || workflow.name, 'Workflow', 180),
    status: NODE_STATUSES.has(source.status) || ['running', 'waiting_approval', 'completed', 'failed', 'cancelled'].includes(source.status)
      ? source.status
      : 'running',
    projectPath: normalizeText(source.projectPath, '', 1000),
    sessionId: normalizeText(source.sessionId, '', 240),
    inputs: asObject(source.inputs),
    profileSnapshot: asObject(source.profileSnapshot),
    nodeRuns,
    logs: Array.isArray(source.logs) ? source.logs : [],
    artifacts: Array.isArray(source.artifacts) ? source.artifacts : [],
    timelineEvents: Array.isArray(source.timelineEvents) ? source.timelineEvents : [],
    createdAt: timestamp,
    startedAt: source.startedAt || timestamp,
    completedAt: source.completedAt || null,
    updatedAt: source.updatedAt || timestamp,
  };
}

export function createWorkflowStudioStore({
  workflowsPath = DEFAULT_WORKFLOWS_PATH,
  runsPath = DEFAULT_RUNS_PATH,
  persist = true,
  now = () => Date.now(),
  subagentRunStore = defaultSubagentRunStore,
  agentResolver = getAgentConfig,
  executors = {},
  checkpointService = defaultWorkflowCheckpointStore,
} = {}) {
  let loaded = false;
  let workflows = [];
  let runs = [];
  const nodeExecutors = {
    ...createDefaultExecutors(),
    ...asObject(executors),
  };

  async function load() {
    if (loaded) return;
    loaded = true;
    if (persist) {
      try {
        const rawWorkflows = JSON.parse(await fs.readFile(workflowsPath, 'utf8'));
        workflows = Array.isArray(rawWorkflows.workflows)
          ? rawWorkflows.workflows.map((workflow) => normalizeWorkflowDefinition(workflow, workflow, now))
          : [];
      } catch {
        workflows = [];
      }
      try {
        const rawRuns = JSON.parse(await fs.readFile(runsPath, 'utf8'));
        runs = Array.isArray(rawRuns.runs) ? rawRuns.runs.map((run) => normalizeRun(run, now)) : [];
      } catch {
        runs = [];
      }
    }
    if (workflows.length === 0) {
      workflows = [
        createStarterWorkflow(),
        ...listBuiltInRecipes().slice(0, 3).map(recipeToWorkflow),
      ];
    }
  }

  async function saveWorkflows() {
    if (!persist) return;
    await fs.mkdir(path.dirname(workflowsPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(workflowsPath, JSON.stringify({ schemaVersion: 1, updatedAt: nowIso(now), workflows }, null, 2), {
      mode: 0o600,
    });
  }

  async function saveRuns() {
    if (!persist) return;
    await fs.mkdir(path.dirname(runsPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(runsPath, JSON.stringify({ schemaVersion: 1, updatedAt: nowIso(now), runs }, null, 2), {
      mode: 0o600,
    });
  }

  function listWorkflows() {
    return workflows
      .slice()
      .sort((left, right) => String(left.name).localeCompare(String(right.name)))
      .map(clone);
  }

  function getWorkflow(workflowId) {
    const id = normalizeText(workflowId);
    const workflow = workflows.find((item) => item.id === id);
    return workflow ? clone(workflow) : null;
  }

  async function upsertWorkflow(input = {}) {
    await load();
    const id = normalizeId(input.id || input.name, 'workflow');
    const index = workflows.findIndex((workflow) => workflow.id === id);
    const existing = index >= 0 ? workflows[index] : null;
    const normalized = normalizeWorkflowDefinition({ ...input, id }, existing, now);
    const validation = validateWorkflowDefinition(normalized).validation;
    if (!validation.valid) {
      const error = new Error(validation.errors.map((entry) => entry.message).join('; '));
      error.statusCode = 400;
      error.validation = validation;
      throw error;
    }
    if (index >= 0) {
      workflows[index] = normalized;
    } else {
      workflows.push(normalized);
    }
    await saveWorkflows();
    return clone(normalized);
  }

  async function deleteWorkflow(workflowId) {
    await load();
    const id = normalizeText(workflowId);
    const index = workflows.findIndex((workflow) => workflow.id === id);
    if (index < 0) return null;
    const [removed] = workflows.splice(index, 1);
    await saveWorkflows();
    return clone(removed);
  }

  function incomingEdges(workflow, nodeId) {
    return workflow.edges.filter((edge) => edge.to === nodeId);
  }

  function outgoingEdges(workflow, nodeId) {
    return workflow.edges.filter((edge) => edge.from === nodeId);
  }

  function canRunNode(workflow, run, node) {
    const nodeRun = run.nodeRuns[node.id];
    if (!nodeRun || nodeRun.status !== 'pending') return false;
    return incomingEdges(workflow, node.id).every((edge) => {
      const previous = run.nodeRuns[edge.from];
      return previous && nodeSucceededForEdge(previous.status, edge.mode);
    });
  }

  function markSkippedDownstream(workflow, run) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of workflow.nodes) {
        const nodeRun = run.nodeRuns[node.id];
        if (!nodeRun || nodeRun.status !== 'pending') continue;
        const incoming = incomingEdges(workflow, node.id);
        if (incoming.length === 0) continue;
        const allTerminal = incoming.every((edge) => terminalStatus(run.nodeRuns[edge.from]?.status));
        const anySatisfied = incoming.some((edge) => nodeSucceededForEdge(run.nodeRuns[edge.from]?.status, edge.mode));
        if (allTerminal && !anySatisfied) {
          nodeRun.status = 'skipped';
          nodeRun.updatedAt = now();
          nodeRun.logs.push('Skipped because upstream edge conditions were not satisfied.');
          changed = true;
        }
      }
    }
  }

  async function executeNode(workflow, run, node) {
    const nodeRun = run.nodeRuns[node.id];
    nodeRun.status = 'running';
    nodeRun.attempt += 1;
    nodeRun.startedAt = nodeRun.startedAt || now();
    nodeRun.updatedAt = now();
    nodeRun.logs.push(`Started ${node.type} node: ${node.title}`);
    run.timelineEvents.push(createRunEvent('workflow_node_started', summarizeNode(node), now));

    const permission = resolveNodePermission(workflow, node);
    if (permission === 'deny') {
      nodeRun.status = 'failed';
      nodeRun.error = 'Node denied by Agent Profile permission boundary.';
      nodeRun.completedAt = now();
      nodeRun.durationMs = nodeRun.completedAt - nodeRun.startedAt;
      nodeRun.permissionDecision = 'deny';
      run.timelineEvents.push(createRunEvent('workflow_node_failed', { ...summarizeNode(node), error: nodeRun.error }, now));
      return;
    }
    if (permission === 'ask' && RISKY_NODE_TYPES.has(node.type)) {
      nodeRun.status = 'waiting_approval';
      nodeRun.waitingReason = `${node.type} node requires approval before execution.`;
      nodeRun.permissionDecision = 'ask';
      nodeRun.logs.push(nodeRun.waitingReason);
      run.timelineEvents.push(createRunEvent('workflow_node_waiting_approval', summarizeNode(node), now));
      return;
    }

    if (node.type === 'approval') {
      nodeRun.status = 'waiting_approval';
      nodeRun.waitingReason = node.prompt || 'Waiting for approval.';
      nodeRun.permissionDecision = 'ask';
      nodeRun.logs.push(nodeRun.waitingReason);
      run.timelineEvents.push(createRunEvent('workflow_node_waiting_approval', summarizeNode(node), now));
      return;
    }

    try {
      nodeRun.input = buildNodeInput(node, run);
      const shouldCheckpoint = RISKY_NODE_TYPES.has(node.type) && run.sessionId && run.projectPath;
      if (shouldCheckpoint && checkpointService?.createCheckpoint) {
        nodeRun.checkpoints.before = await checkpointService.createCheckpoint({
          sessionId: run.sessionId,
          provider: 'workflow',
          projectPath: run.projectPath,
          phase: 'before',
          turnId: run.id,
          runtimeContext: {
            profileKind: workflow.profileId,
            permissionPreset: workflow.permissionPreset,
          },
          metadata: {
            workflowId: workflow.id,
            workflowName: workflow.name,
            nodeId: node.id,
            nodeType: node.type,
          },
          workflow,
          run,
          node,
          nodeRun,
        });
      }

      if (node.type === 'subagent') {
        const agent = await agentResolver(node.agentId || 'subagent-general');
        const subagentRun = await subagentRunStore.createRun({
          agent: agent || { id: node.agentId || 'subagent-general', name: node.title, mode: 'subagent' },
          objective: nodeRun.input.prompt || run.inputs.change_request || workflow.description,
          projectPath: run.projectPath,
          sessionId: run.sessionId,
          source: 'workflow',
        });
        const terminalRun = await waitForSubagentTerminal(subagentRunStore, subagentRun, Math.min(node.timeoutMs || 120000, 1000));
        nodeRun.output = {
          subagentRunId: terminalRun.id,
          status: terminalRun.status,
          result: terminalRun.result || terminalRun.output || null,
          error: terminalRun.error || '',
        };
        nodeRun.artifacts.push({ kind: 'subagent-run', refId: terminalRun.id, title: node.title });
        if (terminalRun.status === 'failed' || terminalRun.status === 'stopped' || terminalRun.status === 'cancelled') {
          throw new Error(terminalRun.error || `Subagent run failed: ${terminalRun.id}`);
        }
      } else if (node.type === 'condition') {
        nodeRun.output = { matched: true, condition: nodeRun.input.condition || 'always' };
      } else if (node.type === 'artifact') {
        const artifactResult = await nodeExecutors.artifact({
          workflow,
          run,
          node,
          nodeRun,
          nodeInput: nodeRun.input,
        });
        if (artifactResult?.artifact) {
          nodeRun.artifacts.push(artifactResult.artifact);
        }
        nodeRun.output = asObject(artifactResult?.output || artifactResult);
      } else {
        const executor = nodeExecutors[node.type];
        if (typeof executor === 'function') {
          nodeRun.output = asObject(await executor({
            workflow,
            run,
            node,
            nodeRun,
            nodeInput: nodeRun.input,
          }));
        } else {
          nodeRun.output = {
            summary: `${node.title} completed.`,
            nodeType: node.type,
            toolName: nodeRun.input.toolName || node.toolName,
            command: nodeRun.input.command || node.command,
          };
        }
      }

      if (shouldCheckpoint && checkpointService?.createCheckpoint) {
        nodeRun.checkpoints.after = await checkpointService.createCheckpoint({
          sessionId: run.sessionId,
          provider: 'workflow',
          projectPath: run.projectPath,
          phase: 'after',
          turnId: run.id,
          beforeCheckpointId: nodeRun.checkpoints.before?.id || null,
          runtimeContext: {
            profileKind: workflow.profileId,
            permissionPreset: workflow.permissionPreset,
          },
          metadata: {
            workflowId: workflow.id,
            workflowName: workflow.name,
            nodeId: node.id,
            nodeType: node.type,
          },
          workflow,
          run,
          node,
          nodeRun,
        });
      }

      nodeRun.status = 'completed';
      nodeRun.completedAt = now();
      nodeRun.durationMs = nodeRun.completedAt - nodeRun.startedAt;
      nodeRun.updatedAt = now();
      nodeRun.logs.push(`Completed ${node.type} node.`);
      run.timelineEvents.push(createRunEvent('workflow_node_completed', summarizeNode(node), now));
    } catch (error) {
      nodeRun.status = 'failed';
      nodeRun.error = error?.message || String(error);
      nodeRun.completedAt = now();
      nodeRun.durationMs = nodeRun.completedAt - nodeRun.startedAt;
      nodeRun.updatedAt = now();
      nodeRun.logs.push(nodeRun.error);
      run.timelineEvents.push(createRunEvent('workflow_node_failed', { ...summarizeNode(node), error: nodeRun.error }, now));
    }
  }

  async function executeReadyNodes(workflow, run) {
    let progressed = true;
    while (progressed && !TERMINAL_RUN_STATUSES.has(run.status)) {
      progressed = false;
      markSkippedDownstream(workflow, run);
      const ready = workflow.nodes.filter((node) => canRunNode(workflow, run, node)).slice(0, workflow.maxConcurrency);
      if (ready.length === 0) break;
      for (const node of ready) {
        run.nodeRuns[node.id].status = 'ready';
      }
      await Promise.all(ready.map((node) => executeNode(workflow, run, node)));
      progressed = true;
      if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === 'waiting_approval')) {
        run.status = 'waiting_approval';
        break;
      }
      if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === 'failed')) {
        run.status = 'failed';
        run.completedAt = now();
        break;
      }
    }

    const nodeRuns = Object.values(run.nodeRuns);
    if (run.status !== 'failed' && run.status !== 'cancelled') {
      if (nodeRuns.some((nodeRun) => nodeRun.status === 'waiting_approval')) {
        run.status = 'waiting_approval';
      } else if (nodeRuns.every((nodeRun) => terminalStatus(nodeRun.status))) {
        run.status = nodeRuns.some((nodeRun) => nodeRun.status === 'failed') ? 'failed' : 'completed';
        run.completedAt = now();
      } else {
        run.status = 'running';
      }
    }
    run.updatedAt = now();
    run.logs.push(`Run status: ${run.status}`);
    run.timelineEvents.push(createRunEvent('workflow_run_status', { status: run.status, summary: buildRunSummary(run) }, now));
    await saveRuns();
    return clone(run);
  }

  async function createRun(workflowId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) {
      const error = new Error('Workflow not found');
      error.statusCode = 404;
      throw error;
    }
    const validation = validateWorkflowDefinition(workflow).validation;
    if (!validation.valid) {
      const error = new Error(validation.errors.map((entry) => entry.message).join('; '));
      error.statusCode = 400;
      error.validation = validation;
      throw error;
    }
    const providedInputs = asObject(input.inputs);
    const runInputs = Object.fromEntries((workflow.inputs || []).map((entry) => [entry.id, entry.defaultValue]));
    Object.assign(runInputs, providedInputs);
    const inputValidation = validateRunInputs(workflow, runInputs);
    if (!inputValidation.valid) {
      const error = new Error(inputValidation.errors.map((entry) => entry.message).join('; '));
      error.statusCode = 400;
      error.validation = inputValidation;
      throw error;
    }

    const agent = await agentResolver(workflow.profileId);
    const timestamp = now();
    const run = normalizeRun({
      id: `workflow_run_${crypto.randomUUID()}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'running',
      projectPath: input.projectPath || '',
      sessionId: input.sessionId || '',
      inputs: runInputs,
      profileSnapshot: {
        profileId: workflow.profileId,
        permissionPreset: workflow.permissionPreset,
        agentName: agent?.name || workflow.profileId,
      },
      nodeRuns: Object.fromEntries(workflow.nodes.map((node) => [node.id, createNodeRun(node, now)])),
      logs: [`Created workflow run for ${workflow.name}.`],
      timelineEvents: [createRunEvent('workflow_run_created', { workflowId: workflow.id, workflowName: workflow.name }, now)],
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
    }, now);
    runs.push(run);
    await saveRuns();
    return executeReadyNodes(workflow, run);
  }

  function listRuns({ workflowId = '', status = '', limit = 50 } = {}) {
    const normalizedWorkflowId = normalizeText(workflowId).toLowerCase();
    const normalizedStatus = normalizeText(status).toLowerCase();
    return runs
      .filter((run) => !normalizedWorkflowId || run.workflowId.toLowerCase() === normalizedWorkflowId)
      .filter((run) => !normalizedStatus || run.status.toLowerCase() === normalizedStatus)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)))
      .map(clone);
  }

  function getRun(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    return run ? clone(run) : null;
  }

  async function controlRun(runId, input = {}) {
    await load();
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const action = normalizeText(input.action, 'resume', 40).toLowerCase();
    if (action === 'cancel') {
      run.status = 'cancelled';
      run.completedAt = now();
      for (const nodeRun of Object.values(run.nodeRuns)) {
        if (!terminalStatus(nodeRun.status)) nodeRun.status = 'cancelled';
      }
      run.timelineEvents.push(createRunEvent('workflow_run_cancelled', {}, now));
      await saveRuns();
      return clone(run);
    }
    if (action === 'resume' || action === 'continue') {
      const workflow = workflows.find((item) => item.id === run.workflowId);
      if (!workflow) return clone(run);
      run.status = 'running';
      return executeReadyNodes(workflow, run);
    }
    await saveRuns();
    return clone(run);
  }

  async function controlNode(runId, nodeId, input = {}) {
    await load();
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const workflow = workflows.find((item) => item.id === run.workflowId);
    if (!workflow) return clone(run);
    const nodeRun = run.nodeRuns[normalizeText(nodeId)];
    if (!nodeRun) return clone(run);
    const action = normalizeText(input.action, 'continue', 40).toLowerCase();

    if (action === 'reject') {
      nodeRun.status = 'cancelled';
      nodeRun.error = normalizeText(input.reason, 'Rejected by user.', 1000);
      nodeRun.completedAt = now();
      run.status = 'cancelled';
      run.completedAt = now();
      run.timelineEvents.push(createRunEvent('workflow_node_rejected', { nodeId }, now));
      await saveRuns();
      return clone(run);
    }

    if (action === 'retry') {
      nodeRun.status = 'pending';
      nodeRun.error = '';
      nodeRun.waitingReason = '';
      nodeRun.startedAt = null;
      nodeRun.completedAt = null;
      nodeRun.logs.push('Retry requested.');
      for (const edge of outgoingEdges(workflow, nodeId)) {
        const downstream = run.nodeRuns[edge.to];
        if (downstream && downstream.status !== 'completed') downstream.status = 'pending';
      }
      run.status = 'running';
      return executeReadyNodes(workflow, run);
    }

    if (action === 'continue' || action === 'approve') {
      nodeRun.status = 'completed';
      nodeRun.completedAt = now();
      nodeRun.durationMs = nodeRun.startedAt ? nodeRun.completedAt - nodeRun.startedAt : 0;
      nodeRun.output = { approved: true, decision: action };
      nodeRun.waitingReason = '';
      nodeRun.logs.push(`Approval decision: ${action}.`);
      run.timelineEvents.push(createRunEvent('workflow_node_approved', { nodeId }, now));
      run.status = 'running';
      return executeReadyNodes(workflow, run);
    }

    await saveRuns();
    return clone(run);
  }

  async function exportWorkflow(workflowId, format = 'json') {
    await load();
    const workflow = getWorkflow(workflowId);
    if (!workflow) return null;
    if (format === 'yaml') {
      return [
        `id: ${workflow.id}`,
        `name: ${workflow.name}`,
        `profileId: ${workflow.profileId}`,
        `permissionPreset: ${workflow.permissionPreset}`,
        `nodes: ${workflow.nodes.length}`,
        `edges: ${workflow.edges.length}`,
        `json: ${JSON.stringify(workflow)}`,
      ].join('\n');
    }
    return JSON.stringify(workflow, null, 2);
  }

  async function importWorkflow(content) {
    await load();
    const text = typeof content === 'string' ? content.trim() : JSON.stringify(content || {});
    const parsed = text.startsWith('{')
      ? JSON.parse(text)
      : JSON.parse((/^json:\s*(\{.*\})/ms.exec(text)?.[1]) || '{}');
    return upsertWorkflow(parsed);
  }

  function listTimelineEvents({ sessionId = '', projectPath = '', workflowId = '', runId = '', limit = 200 } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedProjectPath = normalizeText(projectPath);
    const normalizedWorkflowId = normalizeText(workflowId);
    const normalizedRunId = normalizeText(runId);
    return runs
      .filter((run) => !normalizedSessionId || run.sessionId === normalizedSessionId)
      .filter((run) => !normalizedProjectPath || run.projectPath === normalizedProjectPath)
      .filter((run) => !normalizedWorkflowId || run.workflowId === normalizedWorkflowId)
      .filter((run) => !normalizedRunId || run.id === normalizedRunId)
      .flatMap((run) => (run.timelineEvents || []).map((event) => ({
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        runId: run.id,
        sessionId: run.sessionId,
        projectPath: run.projectPath,
        ...event,
        category: event.category || 'workflow',
      })))
      .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0))
      .slice(0, Math.max(1, Math.min(Number(limit) || 200, 1000)))
      .map(clone);
  }

  async function exportWorkflowPackage(workflowIds = []) {
    await load();
    const ids = Array.isArray(workflowIds) ? workflowIds.map((id) => normalizeText(id)).filter(Boolean) : [];
    const selected = workflows.filter((workflow) => ids.length === 0 || ids.includes(workflow.id));
    return {
      schemaVersion: 1,
      kind: 'workflow-package',
      exportedAt: nowIso(now),
      workflows: selected.map(clone),
    };
  }

  return {
    async ready() {
      await load();
      return this;
    },
    listWorkflows() {
      return listWorkflows();
    },
    getWorkflow,
    upsertWorkflow,
    deleteWorkflow,
    validateWorkflowDefinition,
    createRun,
    listRuns,
    getRun,
    controlRun,
    controlNode,
    exportWorkflow,
    importWorkflow,
    exportWorkflowPackage,
    listTimelineEvents,
  };
}

export const defaultWorkflowStudioStore = createWorkflowStudioStore();
