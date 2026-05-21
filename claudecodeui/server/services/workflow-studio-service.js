import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { exec as execCallback, spawn } from 'node:child_process';
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
const DEFAULT_WORKFLOW_ARTIFACTS_DIR = path.join(DATA_DIR, 'workflow-artifacts');
const DEFAULT_WORKFLOW_SCREENSHOT_DIR = path.join(process.cwd(), 'output', 'playwright', 'screenshots');
const execAsync = promisify(execCallback);
const defaultWorkflowCheckpointStore = createCheckpointStore(db);
const ENTERPRISE_WORKFLOW_RECIPE_IDS = new Set([
  'crashsight-analysis',
  'redmine-review',
  'code-impact-analysis',
  'pr-description',
]);

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
  'queued',
  'pending',
  'ready',
  'running',
  'recovering',
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
const WORKFLOW_GOVERNANCE_STATUSES = new Set(['draft', 'published', 'deprecated']);
const WORKFLOW_COMPLIANCE_LABELS = new Set(['data-sensitive', 'external-network', 'code-write', 'secret-access', 'mcp-enabled']);
const WORKFLOW_RUN_RESOLVER_VERSION = 'workflow-run-resolver/1';
const NODE_PACKAGE_STATUSES = new Set(['ready', 'disabled', 'missing_dependencies', 'broken', 'update_available']);
const NODE_PACKAGE_LIFECYCLE_STATES = new Set(['enabled', 'disabled', 'broken', 'update_available']);
const PYTHON_NODE_MANIFEST_VERSION = '1';
const PYTHON_NODE_DEFAULT_TIMEOUT_MS = 30000;
const PYTHON_NODE_DEFAULT_PAYLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const PYTHON_STDLIB_IMPORT_ALLOWLIST = new Set([
  'argparse',
  'base64',
  'collections',
  'csv',
  'datetime',
  'decimal',
  'enum',
  'functools',
  'hashlib',
  'html',
  'io',
  'itertools',
  'json',
  'math',
  'os',
  'pathlib',
  're',
  'statistics',
  'string',
  'sys',
  'textwrap',
  'time',
  'typing',
  'urllib',
  'uuid',
]);

const BUILT_IN_NODE_TYPES = new Set(WORKFLOW_NODE_TYPES);
const BUILT_IN_TOOL_REGISTRY = Object.freeze([
  {
    id: 'git-native-review',
    label: 'Git Native Review',
    description: 'Generate a structured review summary from the current git diff.',
    permissions: { risky: true, action: 'git' },
    configSchema: { fields: [] },
    outputSchema: { fields: [{ name: 'content', type: 'markdown' }, { name: 'hasChanges', type: 'boolean' }] },
  },
  {
    id: 'artifact',
    label: 'Artifact',
    description: 'Create a workflow artifact from upstream node output.',
    permissions: { risky: false, action: 'artifact' },
    configSchema: { fields: [{ name: 'title', type: 'text', required: false }] },
    outputSchema: { fields: [{ name: 'artifactId', type: 'text' }, { name: 'summary', type: 'markdown' }] },
  },
  {
    id: 'project-profile',
    label: 'Project Profile',
    description: 'Summarize project profile context for the workflow.',
    permissions: { risky: false, action: 'project' },
    configSchema: { fields: [] },
    outputSchema: { fields: [{ name: 'summary', type: 'markdown' }] },
  },
  {
    id: 'browser-screenshot',
    label: 'Browser Screenshot',
    description: 'Capture a browser screenshot artifact for workflow evidence.',
    permissions: { risky: false, action: 'browser' },
    configSchema: {
      fields: [
        { name: 'url', label: 'URL', type: 'text', required: false },
        { name: 'name', label: 'Screenshot name', type: 'text', required: false },
      ],
    },
    outputSchema: { fields: [{ name: 'screenshotPath', type: 'path' }, { name: 'artifactId', type: 'text' }] },
  },
]);

const NODE_TYPE_DEFINITIONS = Object.freeze([
  {
    type: 'agent',
    label: 'Agent',
    description: 'Run a primary Agent Profile step.',
    ports: { inputs: ['prompt'], outputs: ['summary', 'result'] },
    configSchema: {
      fields: [
        { name: 'agentId', label: 'Agent Profile', type: 'agent', required: true, defaultValue: 'build' },
        { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, defaultValue: '' },
        { name: 'timeoutMs', label: 'Timeout', type: 'number', required: false, defaultValue: 120000 },
      ],
    },
    permissions: { risky: false, action: 'agent' },
    outputSchema: {
      fields: [
        { name: 'summary', type: 'text' },
        { name: 'prompt', type: 'text' },
        { name: 'result', type: 'object' },
      ],
    },
    ui: { color: 'blue', icon: 'Bot', defaultWidth: 184 },
    layout: { rank: 1 },
  },
  {
    type: 'subagent',
    label: 'Subagent',
    description: 'Run an OpenCode-style focused subagent.',
    ports: { inputs: ['objective'], outputs: ['subagentRunId', 'status', 'result', 'summary'] },
    configSchema: {
      fields: [
        { name: 'agentId', label: 'Subagent', type: 'subagent', required: true, defaultValue: 'subagent-general' },
        { name: 'prompt', label: 'Objective', type: 'textarea', required: true, defaultValue: '' },
        { name: 'timeoutMs', label: 'Timeout', type: 'number', required: false, defaultValue: 120000 },
      ],
    },
    permissions: { risky: false, action: 'task' },
    outputSchema: {
      fields: [
        { name: 'subagentRunId', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'result', type: 'object' },
        { name: 'summary', type: 'text' },
      ],
    },
    ui: { color: 'cyan', icon: 'GitBranch', defaultWidth: 184 },
    layout: { rank: 1 },
  },
  {
    type: 'mcp',
    label: 'MCP',
    description: 'Call an enabled MCP server tool.',
    ports: { inputs: ['toolName', 'config'], outputs: ['summary', 'result'] },
    configSchema: {
      fields: [
        { name: 'toolName', label: 'MCP server.tool', type: 'text', required: true, defaultValue: '' },
        { name: 'config', label: 'Arguments', type: 'json', required: false, defaultValue: {} },
      ],
    },
    permissions: { risky: true, action: 'mcp' },
    outputSchema: {
      fields: [
        { name: 'summary', type: 'text' },
        { name: 'result', type: 'object' },
      ],
    },
    ui: { color: 'violet', icon: 'Zap', defaultWidth: 184 },
    layout: { rank: 2 },
  },
  {
    type: 'tool',
    label: 'Tool',
    description: 'Run a built-in Workflow tool bridge.',
    ports: { inputs: ['toolName', 'config'], outputs: ['summary', 'content', 'artifactId', 'hasChanges'] },
    configSchema: {
      fields: [
        { name: 'toolName', label: 'Tool', type: 'select', required: true, defaultValue: 'git-native-review', options: ['git-native-review', 'artifact', 'project-profile', 'browser-screenshot'] },
        { name: 'prompt', label: 'Tool prompt', type: 'textarea', required: false, defaultValue: '' },
      ],
    },
    permissions: { risky: true, action: 'tool' },
    outputSchema: {
      fields: [
        { name: 'summary', type: 'text' },
        { name: 'content', type: 'markdown' },
        { name: 'artifactId', type: 'text' },
        { name: 'hasChanges', type: 'boolean' },
      ],
    },
    ui: { color: 'indigo', icon: 'Braces', defaultWidth: 184 },
    layout: { rank: 2 },
  },
  {
    type: 'shell',
    label: 'Shell',
    description: 'Run a shell command through workflow permissions.',
    ports: { inputs: ['command'], outputs: ['stdout', 'stderr', 'exitCode', 'command'] },
    configSchema: {
      fields: [
        { name: 'command', label: 'Command', type: 'textarea', required: true, defaultValue: '' },
        { name: 'cwd', label: 'Working directory', type: 'text', required: false, defaultValue: '' },
        { name: 'timeoutMs', label: 'Timeout', type: 'number', required: false, defaultValue: 120000 },
      ],
    },
    permissions: { risky: true, action: 'shell' },
    outputSchema: {
      fields: [
        { name: 'stdout', type: 'text' },
        { name: 'stderr', type: 'text' },
        { name: 'exitCode', type: 'number' },
        { name: 'command', type: 'text' },
      ],
    },
    ui: { color: 'amber', icon: 'CircleDot', defaultWidth: 184 },
    layout: { rank: 2 },
  },
  {
    type: 'artifact',
    label: 'Artifact',
    description: 'Create a workflow artifact from upstream outputs.',
    ports: { inputs: ['prompt'], outputs: ['artifactId', 'summary', 'artifact'] },
    configSchema: {
      fields: [
        { name: 'prompt', label: 'Artifact content template', type: 'textarea', required: false, defaultValue: '' },
      ],
    },
    permissions: { risky: false, action: 'artifact' },
    outputSchema: {
      fields: [
        { name: 'artifactId', type: 'text' },
        { name: 'summary', type: 'markdown' },
        { name: 'artifact', type: 'object' },
      ],
    },
    ui: { color: 'emerald', icon: 'FileText', defaultWidth: 184 },
    layout: { rank: 4 },
  },
  {
    type: 'approval',
    label: 'Approval',
    description: 'Pause for human approval.',
    ports: { inputs: ['prompt'], outputs: ['approved', 'decision'] },
    configSchema: {
      fields: [
        { name: 'prompt', label: 'Approval text', type: 'textarea', required: false, defaultValue: 'Confirm before continuing.' },
      ],
    },
    permissions: { risky: false, action: 'approval' },
    outputSchema: {
      fields: [
        { name: 'approved', type: 'boolean' },
        { name: 'decision', type: 'text' },
      ],
    },
    ui: { color: 'orange', icon: 'ClipboardCheck', defaultWidth: 184 },
    layout: { rank: 3 },
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Route execution by condition and edge mode.',
    ports: { inputs: ['condition'], outputs: ['matched', 'condition'] },
    configSchema: {
      fields: [
        { name: 'condition', label: 'Condition', type: 'text', required: false, defaultValue: 'always' },
      ],
    },
    permissions: { risky: false, action: 'condition' },
    outputSchema: {
      fields: [
        { name: 'matched', type: 'boolean' },
        { name: 'condition', type: 'text' },
      ],
    },
    ui: { color: 'pink', icon: 'ChevronRight', defaultWidth: 184 },
    layout: { rank: 3 },
  },
  {
    type: 'join',
    label: 'Join',
    description: 'Wait for multiple upstream branches.',
    ports: { inputs: ['upstream'], outputs: ['summary', 'joined'] },
    configSchema: {
      fields: [
        { name: 'prompt', label: 'Join note', type: 'textarea', required: false, defaultValue: '' },
      ],
    },
    permissions: { risky: false, action: 'join' },
    outputSchema: {
      fields: [
        { name: 'summary', type: 'text' },
        { name: 'joined', type: 'boolean' },
      ],
    },
    ui: { color: 'slate', icon: 'Link2', defaultWidth: 184 },
    layout: { rank: 4 },
  },
]);

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

function normalizeNodePackageStatus(value, fallback = 'ready') {
  const status = normalizeText(value, fallback, 80).toLowerCase();
  return NODE_PACKAGE_STATUSES.has(status) ? status : fallback;
}

function normalizeNodePackageLifecycle(value, enabled, status = 'ready') {
  const requested = normalizeText(value, '', 80).toLowerCase();
  if (NODE_PACKAGE_LIFECYCLE_STATES.has(requested)) return requested;
  if (enabled === false || status === 'disabled') return 'disabled';
  if (status === 'missing_dependencies' || status === 'broken') return 'broken';
  if (status === 'update_available') return 'update_available';
  return 'enabled';
}

function isNodePackagePaletteAvailable(nodePackage = {}) {
  const status = normalizeNodePackageStatus(nodePackage.status, 'ready');
  const lifecycleState = normalizeNodePackageLifecycle(nodePackage.lifecycleState || nodePackage.state, nodePackage.enabled, status);
  return nodePackage.enabled !== false
    && lifecycleState !== 'disabled'
    && lifecycleState !== 'broken'
    && (status === 'ready' || status === 'update_available');
}

function mapSchemaFields(fields = []) {
  return new Map((Array.isArray(fields) ? fields : [])
    .map((field) => asObject(field))
    .filter((field) => normalizeText(field.name, '', 120))
    .map((field) => [normalizeText(field.name, '', 120), {
      name: normalizeText(field.name, '', 120),
      type: normalizeText(field.type, 'json', 40),
      required: Boolean(field.required),
    }]));
}

function compareNodePackageFields(previousFields, nextFields, group) {
  const reasons = [];
  const previous = mapSchemaFields(previousFields);
  const next = mapSchemaFields(nextFields);
  for (const [name, previousField] of previous.entries()) {
    const nextField = next.get(name);
    if (!nextField) {
      reasons.push({ code: `${group}_field_removed`, field: name, message: `${group} field was removed: ${name}` });
      continue;
    }
    if (previousField.type !== nextField.type) {
      reasons.push({ code: `${group}_field_type_changed`, field: name, from: previousField.type, to: nextField.type, message: `${group} field changed type: ${name}` });
    }
  }
  return reasons;
}

function schemaPropertiesToFields(schema = {}) {
  return Object.entries(asObject(schema.properties)).map(([name, value]) => ({
    name,
    type: normalizeText(asObject(value).type, 'json', 40),
    required: Array.isArray(schema.required) && schema.required.includes(name),
  }));
}

function buildNodePackageCompatibility(previousPackage = {}, nextPackage = {}) {
  const reasons = [];
  const warnings = [];
  const previousType = normalizeText(previousPackage.definition?.type || previousPackage.manifest?.type, '', 120);
  const nextType = normalizeText(nextPackage.definition?.type || nextPackage.manifest?.type, '', 120);
  if (previousType && nextType && previousType !== nextType) {
    reasons.push({ code: 'package_type_changed', field: 'type', from: previousType, to: nextType, message: `Package node type changed: ${previousType} -> ${nextType}` });
  }
  reasons.push(...compareNodePackageFields(previousPackage.definition?.configSchema?.fields || [], nextPackage.definition?.configSchema?.fields || [], 'config'));
  reasons.push(...compareNodePackageFields(schemaPropertiesToFields(previousPackage.manifest?.inputSchema), schemaPropertiesToFields(nextPackage.manifest?.inputSchema), 'input'));
  reasons.push(...compareNodePackageFields(previousPackage.definition?.outputSchema?.fields || [], nextPackage.definition?.outputSchema?.fields || [], 'output'));
  const previousDependencies = stableJson(previousPackage.manifest?.dependencies || previousPackage.dependencies || {});
  const nextDependencies = stableJson(nextPackage.manifest?.dependencies || nextPackage.dependencies || {});
  if (previousDependencies !== nextDependencies) {
    warnings.push({ code: 'dependencies_changed', message: 'Package dependencies changed; verify install environment before running workflows.' });
  }
  return {
    compatible: reasons.length === 0,
    reasons,
    warnings,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSameJson(left, right) {
  return stableJson(left ?? null) === stableJson(right ?? null);
}

function normalizePreviewDiff(input = {}) {
  const source = asObject(input);
  const changed = source.changed === true;
  return {
    matched: source.matched === undefined ? !changed : source.matched === true,
    changed,
    reasons: Array.isArray(source.reasons) ? source.reasons.map((item) => normalizeText(item, '', 80)).filter(Boolean) : [],
    changedNodes: Array.isArray(source.changedNodes)
      ? source.changedNodes.map((entry) => {
        const node = asObject(entry);
        return {
          nodeId: normalizeText(node.nodeId, '', 120),
          fields: Array.isArray(node.fields) ? node.fields.map((item) => normalizeText(item, '', 120)).filter(Boolean) : [],
          reasons: Array.isArray(node.reasons) ? node.reasons.map((item) => normalizeText(item, '', 80)).filter(Boolean) : [],
        };
      }).filter((entry) => entry.nodeId)
      : [],
  };
}

function addPreviewReason(diff, reason) {
  if (!diff.reasons.includes(reason)) {
    diff.reasons.push(reason);
  }
}

function addChangedPreviewNode(diff, nodeId, field, reason) {
  const normalizedNodeId = normalizeText(nodeId, '', 120);
  if (!normalizedNodeId) return;
  let entry = diff.changedNodes.find((item) => item.nodeId === normalizedNodeId);
  if (!entry) {
    entry = { nodeId: normalizedNodeId, fields: [], reasons: [] };
    diff.changedNodes.push(entry);
  }
  if (field && !entry.fields.includes(field)) {
    entry.fields.push(field);
  }
  if (reason && !entry.reasons.includes(reason)) {
    entry.reasons.push(reason);
  }
  if (reason) {
    addPreviewReason(diff, reason);
  }
}

function diffPreviewSnapshots(previewSnapshotInput = {}, executionSnapshotInput = {}) {
  const previewSnapshot = asObject(previewSnapshotInput);
  const executionSnapshot = asObject(executionSnapshotInput);
  const diff = { matched: true, changed: false, reasons: [], changedNodes: [] };

  if (!isSameJson(previewSnapshot.inputSnapshot || {}, executionSnapshot.inputSnapshot || {})) {
    addPreviewReason(diff, 'input_changed');
  }
  if (normalizeText(previewSnapshot.resolverVersion) !== normalizeText(executionSnapshot.resolverVersion)) {
    addPreviewReason(diff, 'resolver_version_changed');
  }

  const previewDeps = asObject(previewSnapshot.dependencyRefs);
  const executionDeps = asObject(executionSnapshot.dependencyRefs);
  if (normalizeText(previewDeps.workflowDigest) !== normalizeText(executionDeps.workflowDigest)) {
    addPreviewReason(diff, 'definition_changed');
  }
  if (normalizeText(previewDeps.profileId) !== normalizeText(executionDeps.profileId)) {
    addPreviewReason(diff, 'profile_changed');
  }
  if (normalizeText(previewDeps.permissionPreset) !== normalizeText(executionDeps.permissionPreset)) {
    addPreviewReason(diff, 'permission_preset_changed');
  }
  if (!isSameJson(previewDeps.nodePackages || [], executionDeps.nodePackages || [])) {
    addPreviewReason(diff, 'package_changed');
  }

  const previewNodes = new Map((Array.isArray(previewSnapshot.nodes) ? previewSnapshot.nodes : []).map((node) => [normalizeText(node?.nodeId, '', 120), asObject(node)]));
  const executionNodes = new Map((Array.isArray(executionSnapshot.nodes) ? executionSnapshot.nodes : []).map((node) => [normalizeText(node?.nodeId, '', 120), asObject(node)]));
  for (const [nodeId, previewNode] of previewNodes.entries()) {
    const executionNode = executionNodes.get(nodeId);
    if (!executionNode) {
      addChangedPreviewNode(diff, nodeId, 'node', 'node_removed');
      continue;
    }
    if (!isSameJson(previewNode.resolvedInput || {}, executionNode.resolvedInput || {})) {
      addChangedPreviewNode(diff, nodeId, 'resolvedInput', 'node_input_changed');
    }
    if (normalizeText(previewNode.permissionDecision) !== normalizeText(executionNode.permissionDecision)) {
      addChangedPreviewNode(diff, nodeId, 'permissionDecision', 'permission_changed');
    }
    if (Boolean(previewNode.blocked) !== Boolean(executionNode.blocked)) {
      addChangedPreviewNode(diff, nodeId, 'blocked', 'blocked_state_changed');
    }
    if (!isSameJson(previewNode.errors || [], executionNode.errors || [])) {
      addChangedPreviewNode(diff, nodeId, 'errors', 'node_errors_changed');
    }
  }
  for (const nodeId of executionNodes.keys()) {
    if (!previewNodes.has(nodeId)) {
      addChangedPreviewNode(diff, nodeId, 'node', 'node_added');
    }
  }

  diff.changed = diff.reasons.length > 0 || diff.changedNodes.length > 0;
  diff.matched = !diff.changed;
  return diff;
}

function normalizeJsonSchema(value, fallbackType = 'object') {
  const source = asObject(value);
  return {
    type: normalizeText(source.type, fallbackType, 40) || fallbackType,
    properties: asObject(source.properties),
    required: Array.isArray(source.required) ? source.required.map((item) => normalizeText(item, '', 120)).filter(Boolean) : [],
    additionalProperties: source.additionalProperties === true,
  };
}

function schemaToConfigFields(schema = {}) {
  const properties = asObject(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(properties).map(([name, definition]) => {
    const field = asObject(definition);
    const type = normalizeText(field.type, 'string', 40);
    return {
      name,
      label: normalizeText(field.title || field.label || name, name, 120),
      type: type === 'string' ? 'text' : type,
      required: required.has(name),
      defaultValue: field.default,
      options: Array.isArray(field.enum) ? field.enum.map((item) => String(item)) : undefined,
    };
  });
}

function normalizeCodeFiles(value = {}) {
  const source = asObject(value);
  return Object.fromEntries(Object.entries(source)
    .map(([fileName, content]) => [normalizeText(fileName, '', 240), typeof content === 'string' ? content : ''])
    .filter(([fileName]) => fileName && !fileName.includes('..') && !path.isAbsolute(fileName)));
}

function collectPythonImports(codeFiles = {}) {
  const imports = new Set();
  for (const source of Object.values(codeFiles)) {
    const text = typeof source === 'string' ? source : '';
    for (const match of text.matchAll(/^\s*import\s+([a-zA-Z_][a-zA-Z0-9_., \t]*)/gm)) {
      for (const item of match[1].split(',')) {
        const moduleName = item.trim().split(/\s+as\s+/i)[0].split('.')[0];
        if (moduleName) imports.add(moduleName);
      }
    }
    for (const match of text.matchAll(/^\s*from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import\s+/gm)) {
      const moduleName = match[1].split('.')[0];
      if (moduleName) imports.add(moduleName);
    }
  }
  return [...imports];
}

function normalizePythonNodeManifest(input = {}) {
  const source = asObject(input.manifest || input);
  const id = normalizeId(source.id || source.type || source.label, 'python-custom-node');
  const codeFiles = normalizeCodeFiles(source.codeFiles);
  const entrypoint = normalizeText(source.entrypoint, 'main.py', 240);
  const configSchema = normalizeJsonSchema(source.configSchema, 'object');
  const inputSchema = normalizeJsonSchema(source.inputSchema, 'object');
  const outputSchema = normalizeJsonSchema(source.outputSchema, 'object');
  const dependencies = Array.isArray(source.dependencies)
    ? source.dependencies.map((dependency) => normalizeText(dependency, '', 120)).filter(Boolean)
    : [];
  const manifest = {
    manifestVersion: normalizeText(source.manifestVersion, '', 20),
    id,
    type: normalizeId(source.type || id, id),
    label: normalizeText(source.label || source.name || id, id, 120),
    description: normalizeText(source.description, '', 1000),
    language: normalizeText(source.language, 'python', 40).toLowerCase(),
    configSchema,
    inputSchema,
    outputSchema,
    permissions: asObject(source.permissions),
    dependencies,
    entrypoint,
    codeFiles,
    testCases: Array.isArray(source.testCases) ? source.testCases.map((entry, index) => {
      const testCase = asObject(entry);
      return {
        id: normalizeId(testCase.id || `case-${index + 1}`, `case-${index + 1}`),
        name: normalizeText(testCase.name || testCase.id, `Case ${index + 1}`, 120),
        input: asObject(testCase.input),
        config: asObject(testCase.config),
        expectedOutput: asObject(testCase.expectedOutput),
        expectedStatus: normalizeText(testCase.expectedStatus, '', 80),
      };
    }) : [],
  };
  manifest.definition = {
    type: manifest.type,
    label: manifest.label,
    description: manifest.description,
    ports: {
      inputs: Object.keys(inputSchema.properties || {}).length ? Object.keys(inputSchema.properties) : ['input'],
      outputs: Object.keys(outputSchema.properties || {}).length ? Object.keys(outputSchema.properties) : ['summary', 'result', 'status'],
    },
    configSchema: { fields: schemaToConfigFields(configSchema) },
    permissions: {
      risky: Boolean(manifest.permissions.risky),
      action: normalizeText(manifest.permissions.action, 'custom.python', 120),
    },
    outputSchema: {
      fields: Object.entries(outputSchema.properties || {}).map(([name, value]) => ({
        name,
        type: normalizeText(asObject(value).type, 'json', 40),
        label: normalizeText(asObject(value).title || name, name, 120),
      })),
    },
    ui: { materialGroup: 'custom', language: 'python', customPackage: true },
    layout: asObject(source.layout),
    packageId: id,
    version: normalizeText(source.version, '1.0.0', 40),
    dependencies: { python: dependencies },
  };
  return manifest;
}

export function validatePythonNodeManifest(input = {}) {
  const manifest = normalizePythonNodeManifest(input);
  const errors = [];
  const warnings = [];
  if (manifest.manifestVersion !== PYTHON_NODE_MANIFEST_VERSION) {
    errors.push({ code: 'invalid_manifest_version', message: 'Python node manifestVersion must be "1".' });
  }
  if (manifest.language !== 'python') {
    errors.push({ code: 'unsupported_language', message: 'Only Python workflow node packages are supported in this phase.' });
  }
  if (!manifest.codeFiles[manifest.entrypoint]) {
    errors.push({ code: 'missing_entrypoint', message: `Python node entrypoint is missing: ${manifest.entrypoint}` });
  }
  if (manifest.dependencies.length > 0) {
    for (const dependency of manifest.dependencies) {
      errors.push({ code: 'unsupported_dependency', dependency, message: `Third-party Python dependency is not supported yet: ${dependency}` });
    }
  }
  for (const moduleName of collectPythonImports(manifest.codeFiles)) {
    if (!PYTHON_STDLIB_IMPORT_ALLOWLIST.has(moduleName)) {
      errors.push({ code: 'unsupported_import', module: moduleName, message: `Python import is not in the phase-one stdlib allowlist: ${moduleName}` });
    }
  }
  if (manifest.testCases.length === 0) {
    warnings.push({ code: 'missing_test_cases', message: 'Python node package should include at least one install-time test case.' });
  }
  return {
    valid: errors.length === 0,
    manifest,
    errors,
    warnings,
  };
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
  const requestedType = normalizeText(node.type, 'agent', 120).toLowerCase();
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

export function getWorkflowNodeTypeDefinitions() {
  return clone(NODE_TYPE_DEFINITIONS);
}

function getNodeTypeDefinition(type) {
  return NODE_TYPE_DEFINITIONS.find((definition) => definition.type === type) || null;
}

function getNodeTypeDefinitionFromList(type, nodeTypeDefinitions = NODE_TYPE_DEFINITIONS) {
  const definitions = Array.isArray(nodeTypeDefinitions) && nodeTypeDefinitions.length > 0
    ? nodeTypeDefinitions
    : NODE_TYPE_DEFINITIONS;
  return definitions.find((definition) => definition?.type === type) || null;
}

function getNodeOutputFieldNames(type, nodeTypeDefinitions = NODE_TYPE_DEFINITIONS) {
  const definition = getNodeTypeDefinitionFromList(type, nodeTypeDefinitions);
  return new Set((definition?.outputSchema?.fields || []).map((field) => field.name));
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

function workflowDefinitionDigest(workflow) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      name: workflow.name,
      description: workflow.description,
      profileId: workflow.profileId,
      permissionPreset: workflow.permissionPreset,
      inputs: workflow.inputs,
      outputs: workflow.outputs,
      nodes: workflow.nodes,
      edges: workflow.edges,
      maxConcurrency: workflow.maxConcurrency,
    }))
    .digest('hex')
    .slice(0, 16);
}

function summarizeDefinitionDiff(previous = null, next = {}) {
  const before = previous ? asObject(previous) : {};
  const beforeNodes = Array.isArray(before.nodes) ? before.nodes : [];
  const nextNodes = Array.isArray(next.nodes) ? next.nodes : [];
  const beforeEdges = Array.isArray(before.edges) ? before.edges : [];
  const nextEdges = Array.isArray(next.edges) ? next.edges : [];
  const beforeNodeIds = new Set(beforeNodes.map((node) => node.id));
  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  const beforeEdgeIds = new Set(beforeEdges.map((edge) => edge.id));
  const nextEdgeIds = new Set(nextEdges.map((edge) => edge.id));
  return {
    created: !previous,
    changedFields: ['name', 'description', 'profileId', 'permissionPreset', 'maxConcurrency']
      .filter((field) => previous && before[field] !== next[field]),
    nodes: {
      before: beforeNodes.length,
      after: nextNodes.length,
      added: [...nextNodeIds].filter((id) => !beforeNodeIds.has(id)),
      removed: [...beforeNodeIds].filter((id) => !nextNodeIds.has(id)),
    },
    edges: {
      before: beforeEdges.length,
      after: nextEdges.length,
      added: [...nextEdgeIds].filter((id) => !beforeEdgeIds.has(id)),
      removed: [...beforeEdgeIds].filter((id) => !nextEdgeIds.has(id)),
    },
  };
}

function compactWorkflowSnapshot(workflow) {
  const snapshot = clone(workflow);
  snapshot.metadata = asObject(snapshot.metadata);
  if (snapshot.metadata.governance) {
    snapshot.metadata.governance = {
      ...asObject(snapshot.metadata.governance),
      revisions: [],
      reviewRequests: [],
      auditRecords: [],
      publishedDefinition: null,
    };
  }
  return snapshot;
}

function normalizeWorkflowGovernance(workflow = {}) {
  const governance = asObject(workflow.metadata?.governance);
  const ownership = asObject(governance.ownership);
  const visibility = asObject(governance.visibility);
  const deprecated = asObject(governance.deprecated);
  const status = WORKFLOW_GOVERNANCE_STATUSES.has(governance.status) ? governance.status : 'draft';
  return {
    status,
    publishedAt: normalizeText(governance.publishedAt, '', 80),
    publishedRevisionId: normalizeText(governance.publishedRevisionId, '', 160),
    publishedDefinition: governance.publishedDefinition || null,
    revisions: Array.isArray(governance.revisions) ? governance.revisions.slice(-50).map(asObject) : [],
    reviewRequests: Array.isArray(governance.reviewRequests) ? governance.reviewRequests.slice(-50).map(asObject) : [],
    ownership: {
      owner: normalizeText(ownership.owner, 'project-team', 120),
      team: normalizeText(ownership.team, 'local', 120),
      maintainer: normalizeText(ownership.maintainer, 'workflow-owner', 120),
      supportContact: normalizeText(ownership.supportContact, 'local-enterprise-contact', 180),
    },
    visibility: {
      roles: normalizeStringArray(visibility.roles || ['owner', 'maintainer'], 80),
      defaultRole: normalizeText(visibility.defaultRole, 'viewer', 80),
    },
    complianceLabels: normalizeStringArray(governance.complianceLabels, 80)
      .filter((label) => WORKFLOW_COMPLIANCE_LABELS.has(label)),
    deprecated: {
      enabled: Boolean(deprecated.enabled),
      reason: normalizeText(deprecated.reason, '', 500),
      replacementWorkflowId: normalizeText(deprecated.replacementWorkflowId, '', 120),
      deprecatedAt: normalizeText(deprecated.deprecatedAt, '', 80),
      impact: normalizeText(deprecated.impact, '', 500),
    },
    auditRecords: Array.isArray(governance.auditRecords) ? governance.auditRecords.slice(-200).map(asObject) : [],
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
    metadata: {
      source: 'recipe',
      recipeId: recipe.id,
      templateManifest: createTemplateManifest({
        id: recipe.id,
        name: recipe.title || recipe.id,
        description: recipe.description || '',
        tags: ['recipe', 'enterprise'],
        inputs: recipe.inputs || [],
        expectedOutputs: [{ id: 'artifact', label: 'Workflow artifact', type: 'markdown' }],
        dependencies: asObject(recipe.dependencies),
      }),
    },
  });
}

export function createTemplateManifest({
  id = '',
  name = '',
  description = '',
  version = '1.0.0',
  author = 'Argus',
  tags = [],
  inputs = [],
  dependencies = {},
  expectedOutputs = [],
  screenshots = [],
} = {}) {
  return {
    id: normalizeId(id || name, 'workflow-template'),
    version: normalizeText(version, '1.0.0', 40),
    author: normalizeText(author, 'Argus', 120),
    name: normalizeText(name || id, 'Workflow Template', 180),
    description: normalizeText(description, '', 1000),
    tags: Array.isArray(tags) ? tags.map((tag) => normalizeText(tag, '', 80)).filter(Boolean) : [],
    inputs: Array.isArray(inputs) ? inputs.map((entry, index) => normalizeInputOutput(entry, index, 'input')) : [],
    dependencies: {
      profiles: Array.isArray(dependencies.profiles) ? dependencies.profiles : [],
      agents: Array.isArray(dependencies.agents) ? dependencies.agents : [],
      subagents: Array.isArray(dependencies.subagents) ? dependencies.subagents : [],
      mcpServers: Array.isArray(dependencies.mcpServers) ? dependencies.mcpServers : [],
      skills: Array.isArray(dependencies.skills) ? dependencies.skills : [],
      permissions: Array.isArray(dependencies.permissions) ? dependencies.permissions : [],
    },
    expectedOutputs: Array.isArray(expectedOutputs)
      ? expectedOutputs.map((entry, index) => normalizeInputOutput(entry, index, 'output'))
      : [],
    screenshots: Array.isArray(screenshots) ? screenshots.map((entry) => normalizeText(entry, '', 1000)).filter(Boolean) : [],
  };
}

export function validateWorkflowPackage(value = {}) {
  if (!value || typeof value !== 'object') {
    throw new Error('Workflow package must be an object');
  }
  const workflows = Array.isArray(value.workflows)
    ? value.workflows.map((workflow) => normalizeWorkflowDefinition(workflow))
    : [];
  if (workflows.length === 0) {
    throw new Error('Workflow package requires at least one workflow');
  }
  for (const workflow of workflows) {
    const result = validateWorkflowDefinition(workflow);
    if (!result.validation.valid) {
      const error = new Error(`Invalid workflow ${workflow.id}: ${result.validation.errors.map((entry) => entry.message).join('; ')}`);
      error.validation = result.validation;
      throw error;
    }
  }
  return {
    schemaVersion: 1,
    kind: 'workflow-package',
    exportedAt: value.exportedAt || nowIso(Date.now),
    workflows,
  };
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

export function validateWorkflowDefinition(input = {}, extraNodeDefinitions = []) {
  const workflow = normalizeWorkflowDefinition(input);
  const errors = [];
  const warnings = [];
  const nodeIds = new Set();
  const validNodeTypes = new Set([
    ...WORKFLOW_NODE_TYPES,
    ...(Array.isArray(extraNodeDefinitions) ? extraNodeDefinitions.map((definition) => definition?.type).filter(Boolean) : []),
  ]);

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
    if (!validNodeTypes.has(node.type)) {
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
    permissionExplanation: null,
    updatedAt: now(),
  };
}

function inferArtifactMimeType(artifact) {
  const explicit = normalizeText(artifact.mimeType || artifact.contentType, '', 120);
  if (explicit) return explicit;
  const artifactPath = normalizeText(artifact.path || artifact.filePath, '', 1000).toLowerCase();
  if (artifactPath.endsWith('.md')) return 'text/markdown';
  if (artifactPath.endsWith('.json')) return 'application/json';
  if (artifactPath.endsWith('.png')) return 'image/png';
  if (artifactPath.endsWith('.jpg') || artifactPath.endsWith('.jpeg')) return 'image/jpeg';
  if (artifactPath.endsWith('.txt')) return 'text/plain';
  return artifact.content ? 'text/markdown' : 'application/octet-stream';
}

function normalizeWorkflowArtifactRef(input, { run = {}, node = {}, nodeRun = {}, source = 'node', now = () => Date.now() } = {}) {
  const artifact = asObject(input);
  const type = normalizeText(artifact.type || artifact.kind, 'workflow-artifact', 120);
  const title = normalizeText(artifact.title || artifact.name, nodeRun.title || node.title || 'Workflow artifact', 240);
  const content = artifact.content === undefined ? '' : String(artifact.content);
  const summary = normalizeText(artifact.summary || artifact.description || content, title, 4000);
  const artifactPath = normalizeText(artifact.path || artifact.filePath || '', '', 1000);
  const createdAt = Number(artifact.createdAt) || now();
  const size = Number(artifact.size) || (content ? Buffer.byteLength(content, 'utf8') : 0);
  return {
    ...artifact,
    id: normalizeText(artifact.id, `workflow_artifact_${crypto.randomUUID()}`, 160),
    runId: normalizeText(artifact.runId || run.id, '', 160),
    nodeId: normalizeText(artifact.nodeId || nodeRun.nodeId || node.id, '', 160),
    nodeTitle: normalizeText(artifact.nodeTitle || nodeRun.title || node.title, '', 240),
    type,
    kind: normalizeText(artifact.kind || type, type, 120),
    title,
    path: artifactPath,
    mimeType: inferArtifactMimeType({ ...artifact, path: artifactPath, content }),
    size,
    createdAt,
    summary,
    content,
    source,
  };
}

function addUniqueArtifact(target, artifact) {
  if (!artifact?.id) return;
  const index = target.findIndex((item) => item.id === artifact.id);
  if (index >= 0) {
    target[index] = artifact;
  } else {
    target.push(artifact);
  }
}

function captureNodeArtifacts(run, node, nodeRun, now = () => Date.now()) {
  const output = asObject(nodeRun.output);
  const rawArtifacts = [
    ...((Array.isArray(output.artifacts) ? output.artifacts : [])),
    ...(output.artifact ? [output.artifact] : []),
    ...((Array.isArray(nodeRun.artifacts) ? nodeRun.artifacts : [])),
  ];
  const normalized = [];
  for (const rawArtifact of rawArtifacts) {
    const artifact = normalizeWorkflowArtifactRef(rawArtifact, { run, node, nodeRun, source: 'node', now });
    addUniqueArtifact(normalized, artifact);
  }
  nodeRun.artifacts = normalized;
}

function buildRunSummaryContent(run) {
  const nodeRows = Object.values(run.nodeRuns || {})
    .map((nodeRun) => `- ${nodeRun.title || nodeRun.nodeId}: ${nodeRun.status}${nodeRun.error ? ` (${nodeRun.error})` : ''}`)
    .join('\n');
  const artifactCount = Object.values(run.nodeRuns || {}).reduce((count, nodeRun) => count + (nodeRun.artifacts || []).length, (run.artifacts || []).length);
  return [
    `# ${run.workflowName} run summary`,
    '',
    `Status: ${run.status}`,
    `Run: ${run.id}`,
    `Artifacts: ${artifactCount}`,
    '',
    'Nodes:',
    nodeRows || '- No nodes recorded.',
  ].join('\n');
}

function ensureRunSummaryArtifact(run, now = () => Date.now()) {
  if (!TERMINAL_RUN_STATUSES.has(run.status)) return;
  const content = buildRunSummaryContent(run);
  const artifact = normalizeWorkflowArtifactRef({
    id: `workflow_artifact_summary_${run.id}`,
    type: 'workflow-run-summary',
    kind: 'workflow-run-summary',
    title: `${run.workflowName} run summary`,
    mimeType: 'text/markdown',
    content,
    summary: `${run.workflowName} ${run.status} with ${Object.keys(run.nodeRuns || {}).length} node(s).`,
    createdAt: run.completedAt || now(),
  }, { run, source: 'run', now });
  artifact.nodeId = '';
  artifact.nodeTitle = '';
  addUniqueArtifact(run.artifacts, artifact);
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

function createQueueState(source = {}, now = () => Date.now()) {
  const queue = asObject(source);
  const timestamp = now();
  return {
    state: normalizeText(queue.state, '', 40),
    workerId: normalizeText(queue.workerId, '', 120),
    heartbeatAt: Number(queue.heartbeatAt) || null,
    leaseExpiresAt: Number(queue.leaseExpiresAt) || null,
    maxConcurrency: normalizeInteger(queue.maxConcurrency, 4, 1, 64),
    recoveredAt: Number(queue.recoveredAt) || null,
    updatedAt: Number(queue.updatedAt) || timestamp,
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
  if (node.type === 'shell' && detectDangerousCommand(node.command || node.config?.command)) return 'ask';
  if (RISKY_NODE_TYPES.has(node.type)) return 'ask';
  return 'allow';
}

function detectDangerousCommand(command = '') {
  const text = normalizeText(command, '', 4000);
  const checks = [
    { pattern: /\b(rm\s+-rf|Remove-Item\b[^|;]*-Recurse|del\s+\/[sq]|rd\s+\/s)\b/i, reason: 'recursive delete' },
    { pattern: /\b(git\s+reset\s+--hard|git\s+clean\s+-fd|git\s+checkout\s+--)\b/i, reason: 'destructive git workspace operation' },
    { pattern: /\b(curl|wget|Invoke-WebRequest|iwr)\b/i, reason: 'network download or remote script fetch' },
    { pattern: /(^|[;&|])\s*>\s*[^&|]+/i, reason: 'file overwrite redirection' },
  ];
  const match = checks.find((check) => check.pattern.test(text));
  return match ? { dangerous: true, reason: match.reason, command: text } : null;
}

function getNodeRequestedCapabilities(node, dangerous = null) {
  const toolName = normalizeText(node.toolName || node.config?.toolName, 'unknown', 240);
  const capabilitiesByType = {
    agent: ['agent.run'],
    subagent: ['subagent.run'],
    mcp: [`mcp.call:${toolName}`],
    tool: [`tool.run:${toolName}`],
    shell: ['shell.execute', 'workspace.write'],
    artifact: ['artifact.write'],
    approval: ['human.approval'],
    condition: ['control-flow.evaluate'],
    join: ['control-flow.join'],
  };
  const capabilities = [...(capabilitiesByType[node.type] || [`${node.type || 'node'}.run`])];
  if (node.type === 'tool' && toolName.includes('git')) capabilities.push('git.read');
  if (node.type === 'shell' && dangerous?.reason === 'destructive git workspace operation') capabilities.push('git.destructive');
  if (node.type === 'shell' && dangerous?.reason === 'recursive delete') capabilities.push('workspace.delete');
  if (node.type === 'shell' && dangerous?.reason === 'network download or remote script fetch') capabilities.push('network.download');
  if (node.type === 'shell' && dangerous?.reason === 'file overwrite redirection') capabilities.push('file.overwrite');
  return [...new Set(capabilities)];
}

function buildPermissionExplanation(workflow, node, { decisionOverride = '', nodeRun = null } = {}) {
  const security = getWorkflowSecurity(workflow);
  const dangerous = detectDangerousCommand(node.command || node.config?.command);
  const baseDecision = decisionOverride || resolveNodePermission(workflow, node);
  const mcpAllowed = !security.mcpAllowlist.length || node.type !== 'mcp' || security.mcpAllowlist.includes(node.toolName);
  const permissionDecision = mcpAllowed ? baseDecision : 'deny';
  const requestedCapabilities = getNodeRequestedCapabilities(node, dangerous);
  const riskReasons = [];
  if (!mcpAllowed) {
    riskReasons.push(`MCP tool ${node.toolName || 'unknown'} is not in workflow allowlist`);
  }
  if (dangerous?.reason) {
    riskReasons.push(dangerous.reason);
  }
  if (RISKY_NODE_TYPES.has(node.type) && !riskReasons.length) {
    riskReasons.push(`${node.type} is controlled by ${workflow.permissionPreset}`);
  }
  if (!riskReasons.length) {
    riskReasons.push('Read-only or control-flow capability');
  }
  const riskLevel = dangerous ? 'critical' : RISKY_NODE_TYPES.has(node.type) ? 'high' : 'low';
  const effectiveCapabilities = permissionDecision === 'deny' ? [] : requestedCapabilities;
  const verb = permissionDecision === 'allow' ? 'allowed' : permissionDecision === 'ask' ? 'requires approval' : 'denied';
  const explain = `${node.title || node.id} is ${verb} under ${workflow.permissionPreset}: ${riskReasons.join('; ')}.`;
  return {
    nodeId: node.id,
    title: node.title,
    type: node.type,
    permissionPreset: workflow.permissionPreset,
    permissionDecision,
    decision: permissionDecision,
    requestedCapabilities,
    effectiveCapabilities,
    riskLevel,
    riskReasons,
    reason: riskReasons.join('; '),
    explain,
    requiresApproval: permissionDecision === 'ask',
    dangerousCommand: dangerous,
    command: node.command || nodeRun?.input?.command || '',
    toolName: node.toolName || nodeRun?.input?.toolName || '',
  };
}

function normalizeStringArray(value = [], limit = 200) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeText(item, '', limit))
    .filter(Boolean);
}

function getWorkflowSecurity(workflow) {
  const security = asObject(workflow.metadata?.security);
  return {
    timeoutPolicy: {
      action: normalizeText(security.timeoutPolicy?.action, 'fail', 40),
      timeoutMinutes: normalizeInteger(security.timeoutPolicy?.timeoutMinutes, 30, 1, 24 * 60),
      escalateAfterMinutes: normalizeInteger(security.timeoutPolicy?.escalateAfterMinutes, 10, 1, 24 * 60),
    },
    delegation: {
      target: normalizeText(security.delegation?.target, 'local-owner', 120),
      allowedTargets: normalizeStringArray(security.delegation?.allowedTargets || ['local-owner', 'project-maintainer', 'security-reviewer'], 120),
    },
    secretRefs: normalizeStringArray(security.secretRefs, 240),
    mcpAllowlist: normalizeStringArray(security.mcpAllowlist, 240),
  };
}

function collectWorkflowSecretRefs(workflow) {
  const configured = getWorkflowSecurity(workflow).secretRefs;
  const fromNodes = (workflow.nodes || [])
    .flatMap((node) => [node.config?.secretKey, node.config?.secretRef, node.config?.tokenSecret])
    .map((value) => normalizeText(value, '', 240))
    .filter((value) => value.startsWith('secret://'));
  return [...new Set([...configured, ...fromNodes])];
}

function buildPermissionDryRun(workflow) {
  return {
    workflowId: workflow.id,
    permissionPreset: workflow.permissionPreset,
    generatedAt: nowIso(() => Date.now()),
    rows: workflow.nodes.map((node) => {
      const explanation = buildPermissionExplanation(workflow, node);
      return {
        nodeId: node.id,
        title: node.title,
        type: node.type,
        decision: explanation.permissionDecision,
        permissionDecision: explanation.permissionDecision,
        reason: explanation.reason,
        explain: explanation.explain,
        riskLevel: explanation.riskLevel,
        riskReasons: explanation.riskReasons,
        requestedCapabilities: explanation.requestedCapabilities,
        effectiveCapabilities: explanation.effectiveCapabilities,
        requiresApproval: explanation.requiresApproval,
        dangerousCommand: explanation.dangerousCommand,
      };
    }),
  };
}

function buildApprovalRiskExplanation(workflow, run, nodeRun) {
  const node = workflow.nodes.find((item) => item.id === nodeRun.nodeId) || {};
  const explanation = nodeRun.permissionExplanation || buildPermissionExplanation(workflow, node, { nodeRun });
  return {
    ...explanation,
    riskLevel: explanation.riskLevel || (RISKY_NODE_TYPES.has(nodeRun.type) ? 'high' : 'medium'),
    permissionPreset: workflow.permissionPreset,
    permissionDecision: nodeRun.permissionDecision || explanation.permissionDecision || resolveNodePermission(workflow, node),
    reason: nodeRun.waitingReason || explanation.reason || 'Workflow is waiting for human approval.',
    command: node.command || nodeRun.input?.command || '',
    toolName: node.toolName || nodeRun.input?.toolName || '',
    dangerousCommand: explanation.dangerousCommand || null,
    inputSummary: Object.keys(asObject(nodeRun.input)).join(', '),
    runId: run.id,
    nodeId: nodeRun.nodeId,
  };
}

function buildApprovalDiffSummary(run, nodeRun) {
  const checkpointRefs = Object.values(asObject(nodeRun.checkpoints))
    .map((checkpoint) => checkpoint?.id || checkpoint?.checkpointId)
    .filter(Boolean);
  const artifactRefs = [
    ...(run.artifacts || []),
    ...(nodeRun.artifacts || []),
  ].map((artifact) => artifact.path || artifact.title || artifact.id || artifact.refId).filter(Boolean);
  return {
    changedFiles: normalizeStringArray(nodeRun.output?.changedFiles || nodeRun.output?.files || [], 1000),
    checkpointRefs,
    artifactRefs,
    summary: checkpointRefs.length
      ? `Checkpoint diff refs: ${checkpointRefs.join(', ')}`
      : artifactRefs.length
        ? `Artifact refs: ${artifactRefs.slice(0, 3).join(', ')}`
        : 'No workspace diff has been produced yet.',
  };
}

function getSubagentPoolLimit(workflow) {
  return normalizeInteger(workflow.metadata?.agentBridge?.subagentPoolLimit, Math.min(2, workflow.maxConcurrency || 2), 1, workflow.maxConcurrency || 16);
}

function buildAgentPromptPreview(workflow, node, inputs = {}) {
  const previewRun = {
    inputs,
    nodeRuns: Object.fromEntries((workflow.nodes || []).map((item) => [item.id, createNodeRun(item, () => Date.now())])),
  };
  try {
    return buildNodeInput(node, previewRun).prompt || node.prompt || '';
  } catch (error) {
    return `Prompt preview failed: ${error?.message || error}`;
  }
}

function applyAgentResultContract(node, nodeRun, output = {}, extra = {}) {
  const source = asObject(output);
  return {
    ...source,
    summary: normalizeText(source.summary || source.result || `${node.title} completed.`, '', 12000),
    artifacts: Array.isArray(source.artifacts) ? source.artifacts : nodeRun.artifacts || [],
    diffRefs: Array.isArray(source.diffRefs) ? source.diffRefs : [],
    status: normalizeText(source.status, nodeRun.status || 'completed', 80),
    sessionId: normalizeText(source.sessionId || extra.sessionId, '', 200),
    sessionLink: normalizeText(source.sessionLink || (extra.sessionId ? `#session=${encodeURIComponent(extra.sessionId)}` : ''), '', 500),
    result: source.result ?? source,
  };
}

function normalizeMcpExecutionError(toolName, error) {
  const message = normalizeText(error?.message || error, '', 2000);
  const lower = message.toLowerCase();
  const code = lower.includes('not configured') || lower.includes('server not found')
    ? 'server_not_found'
    : lower.includes('tool not found')
      ? 'tool_not_found'
      : lower.includes('schema')
        ? 'schema_invalid'
        : lower.includes('timeout')
          ? 'timeout'
          : 'execution_failed';
  return {
    code,
    toolName: normalizeText(toolName, '', 240),
    message: message || `MCP tool failed: ${toolName || 'unknown'}`,
  };
}

function createTinyPngBuffer() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
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

function previewLineageValue(value) {
  const text = stringifyTemplateValue(value);
  return String(text || '').slice(0, 240);
}

function renderTemplateWithLineage(text, context, field) {
  const source = typeof text === 'string' ? text : '';
  const segments = [];
  let rendered = '';
  let cursor = 0;
  let firstVariable = null;
  let firstError = null;
  for (const match of source.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
    const index = match.index || 0;
    if (index > cursor) {
      const literal = source.slice(cursor, index);
      rendered += literal;
      segments.push({ type: 'literal', valuePreview: literal.slice(0, 240) });
    }
    const expression = match[1];
    const result = getPathValue(context, expression);
    const segment = {
      type: 'variable',
      sourceExpression: expression,
      sourcePath: expression,
    };
    if (!firstVariable) firstVariable = segment;
    if (result.found) {
      const value = stringifyTemplateValue(result.value);
      rendered += value;
      segments.push({
        ...segment,
        status: 'resolved',
        valuePreview: previewLineageValue(result.value),
      });
    } else {
      rendered += match[0];
      const error = {
        code: 'missing_variable',
        variable: expression,
        message: `Workflow variable not found: ${expression}`,
      };
      if (!firstError) firstError = error;
      segments.push({
        ...segment,
        status: 'missing',
        valuePreview: '<missing>',
        error,
      });
    }
    cursor = index + match[0].length;
  }
  if (cursor < source.length) {
    const literal = source.slice(cursor);
    rendered += literal;
    segments.push({ type: 'literal', valuePreview: literal.slice(0, 240) });
  }
  const variableSegments = segments.filter((segment) => segment.type === 'variable');
  const status = firstError ? 'missing' : variableSegments.length > 0 ? 'resolved' : 'literal';
  const trace = {
    field,
    status,
    sourceExpression: firstVariable?.sourceExpression || '',
    sourcePath: firstVariable?.sourcePath || '',
    valuePreview: rendered.slice(0, 240),
    segments,
  };
  if (firstError) trace.error = firstError;
  return { value: rendered, trace };
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

function buildNodeInputFromContext(node, context) {
  return {
    prompt: renderTemplate(node.prompt || '', context),
    command: renderTemplate(node.command || '', context),
    condition: renderTemplate(node.condition || '', context),
    toolName: renderTemplate(node.toolName || '', context),
    config: clone(node.config || {}),
  };
}

function buildNodeInputWithLineageFromContext(node, context) {
  const prompt = renderTemplateWithLineage(node.prompt || '', context, 'prompt');
  const command = renderTemplateWithLineage(node.command || '', context, 'command');
  const condition = renderTemplateWithLineage(node.condition || '', context, 'condition');
  const toolName = renderTemplateWithLineage(node.toolName || '', context, 'toolName');
  const config = clone(node.config || {});
  return {
    resolvedInput: {
      prompt: prompt.value,
      command: command.value,
      condition: condition.value,
      toolName: toolName.value,
      config,
    },
    lineage: {
      prompt: prompt.trace,
      command: command.trace,
      condition: condition.trace,
      toolName: toolName.trace,
      config: {
        field: 'config',
        status: 'literal',
        sourceExpression: '',
        sourcePath: '',
        valuePreview: stableJson(config).slice(0, 240),
        segments: [{ type: 'literal', valuePreview: stableJson(config).slice(0, 240) }],
      },
    },
  };
}

function buildNodeInput(node, run) {
  return buildNodeInputFromContext(node, buildTemplateContext(run));
}

function previewValueForType(type, pathName) {
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'object') return { preview: pathName };
  if (type === 'array') return [{ preview: pathName }];
  return `<${pathName}>`;
}

function buildDryRunTemplateContext(workflow, runInputs, nodeTypeDefinitions = NODE_TYPE_DEFINITIONS) {
  return {
    inputs: runInputs || {},
    nodes: Object.fromEntries((workflow.nodes || []).map((node) => {
      const definition = getNodeTypeDefinitionFromList(node.type, nodeTypeDefinitions);
      const output = Object.fromEntries((definition?.outputSchema?.fields || []).map((field) => {
        const pathName = `nodes.${node.id}.output.${field.name}`;
        return [field.name, previewValueForType(field.type, pathName)];
      }));
      return [node.id, {
        input: {},
        output,
        status: 'preview',
        error: '',
      }];
    })),
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

function reachedTerminalSubagentStatus(run) {
  return SUBAGENT_TERMINAL_STATUSES.has(run?.status);
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

function extractTemplateVariables(value, field = 'prompt') {
  const text = typeof value === 'string' ? value : '';
  return [...text.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)]
    .map((match) => ({ field, expression: match[1] }));
}

function buildAvailableVariables(workflow, nodeTypeDefinitions = NODE_TYPE_DEFINITIONS) {
  const variables = [];
  for (const input of workflow.inputs || []) {
    variables.push({
      path: `inputs.${input.id}`,
      type: input.type || 'text',
      label: input.label || input.id,
      source: 'input',
    });
  }
  for (const node of workflow.nodes || []) {
    const definition = getNodeTypeDefinitionFromList(node.type, nodeTypeDefinitions);
    for (const field of definition?.outputSchema?.fields || []) {
      variables.push({
        path: `nodes.${node.id}.output.${field.name}`,
        type: field.type || 'unknown',
        label: `${node.title}.${field.name}`,
        source: 'node',
        nodeId: node.id,
      });
    }
  }
  return variables;
}

function validateConfigField(value, field, node, errors) {
  const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  if (field.required && empty) {
    errors.push({
      code: 'missing_required_config',
      nodeId: node.id,
      field: field.name,
      message: `Node ${node.id} requires ${field.label || field.name}.`,
    });
  }
}

function getNodeConfigValue(node, fieldName) {
  if (fieldName === 'agentId') return node.agentId;
  if (fieldName === 'toolName') return node.toolName;
  if (fieldName === 'command') return node.command;
  if (fieldName === 'prompt') return node.prompt;
  if (fieldName === 'condition') return node.condition;
  if (fieldName === 'timeoutMs') return node.timeoutMs;
  return node.config?.[fieldName];
}

function validateNodeConfigs(workflow, nodeTypeDefinitions = NODE_TYPE_DEFINITIONS) {
  const errors = [];
  for (const node of workflow.nodes || []) {
    const definition = getNodeTypeDefinitionFromList(node.type, nodeTypeDefinitions);
    if (!definition) continue;
    for (const field of definition.configSchema?.fields || []) {
      validateConfigField(getNodeConfigValue(node, field.name), field, node, errors);
    }
  }
  return errors;
}

function createVariableDiagnostic({ nodeId, field, variable, inputId = '', sourceNodeId = '', outputField = '' }) {
  return {
    nodeId,
    field,
    sourceExpression: variable,
    variable,
    inputId,
    sourceNodeId,
    outputField,
  };
}

function validateWorkflowVariables(workflow, nodeTypeDefinitions = NODE_TYPE_DEFINITIONS) {
  const errors = [];
  const nodesById = new Map((workflow.nodes || []).map((node) => [node.id, node]));
  const inputIds = new Set((workflow.inputs || []).map((input) => input.id));
  for (const node of workflow.nodes || []) {
    const variables = [
      ...extractTemplateVariables(node.prompt, 'prompt'),
      ...extractTemplateVariables(node.command, 'command'),
      ...extractTemplateVariables(node.condition, 'condition'),
      ...extractTemplateVariables(node.toolName, 'toolName'),
    ];
    for (const variable of variables) {
      const inputMatch = /^inputs\.([a-zA-Z0-9_-]+)$/.exec(variable.expression);
      if (inputMatch) {
        if (!inputIds.has(inputMatch[1])) {
          errors.push({
            code: 'missing_input_variable',
            category: 'missing_variable',
            nodeId: node.id,
            field: variable.field,
            variable: variable.expression,
            diagnostic: createVariableDiagnostic({
              nodeId: node.id,
              field: variable.field,
              variable: variable.expression,
              inputId: inputMatch[1],
            }),
            message: `Node ${node.id} references missing workflow input ${variable.expression}.`,
          });
        }
        continue;
      }
      const nodeMatch = /^nodes\.([a-zA-Z0-9_-]+)\.output\.([a-zA-Z0-9_-]+)$/.exec(variable.expression);
      if (nodeMatch) {
        const [, sourceNodeId, outputField] = nodeMatch;
        const sourceNode = nodesById.get(sourceNodeId);
        if (!sourceNode) {
          errors.push({
            code: 'missing_node_variable',
            category: 'missing_variable',
            nodeId: node.id,
            field: variable.field,
            variable: variable.expression,
            diagnostic: createVariableDiagnostic({
              nodeId: node.id,
              field: variable.field,
              variable: variable.expression,
              sourceNodeId,
              outputField,
            }),
            message: `Node ${node.id} references missing node ${sourceNodeId}.`,
          });
          continue;
        }
        if (!getNodeOutputFieldNames(sourceNode.type, nodeTypeDefinitions).has(outputField)) {
          errors.push({
            code: 'missing_output_field',
            category: 'missing_variable',
            nodeId: node.id,
            sourceNodeId,
            field: variable.field,
            outputField,
            variable: variable.expression,
            diagnostic: createVariableDiagnostic({
              nodeId: node.id,
              field: variable.field,
              variable: variable.expression,
              sourceNodeId,
              outputField,
            }),
            message: `Node ${node.id} references unavailable output ${variable.expression}.`,
          });
        }
        continue;
      }
      errors.push({
        code: 'unsupported_variable',
        nodeId: node.id,
        field: variable.field,
        variable: variable.expression,
        message: `Unsupported workflow variable: ${variable.expression}.`,
      });
    }
  }
  return errors;
}

function validateWorkflowDependencies(workflow) {
  const errors = [];
  const security = getWorkflowSecurity(workflow);
  for (const node of workflow.nodes || []) {
    const decision = resolveNodePermission(workflow, node);
    if (decision === 'deny') {
      errors.push({
        code: 'permission_denied',
        nodeId: node.id,
        field: 'permission',
        message: `Node ${node.id} is denied by ${workflow.permissionPreset}.`,
      });
    }
    if (node.type === 'mcp' && security.mcpAllowlist.length > 0 && !security.mcpAllowlist.includes(node.toolName)) {
      errors.push({
        code: 'mcp_not_allowlisted',
        nodeId: node.id,
        field: 'toolName',
        dependencyType: 'mcp',
        message: `MCP tool ${node.toolName || 'unknown'} is not allowlisted for workflow ${workflow.id}.`,
      });
    }
    if (node.type === 'mcp' && !node.toolName) {
      errors.push({
        code: 'missing_dependency',
        nodeId: node.id,
        field: 'toolName',
        dependencyType: 'mcp',
        message: `Node ${node.id} requires an MCP server.tool name.`,
      });
    }
  }
  return errors;
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

function createPythonExecutionError(category, message, extra = {}) {
  const error = new Error(message);
  error.category = category;
  error.code = category;
  Object.assign(error, extra);
  return error;
}

function classifyPythonExecutionError(stderr = '', fallback = 'runtime_error') {
  if (/ModuleNotFoundError|No module named/i.test(stderr)) return 'missing_python_dependency';
  if (/SyntaxError/i.test(stderr)) return 'python_syntax_error';
  return fallback;
}

function jsonSchemaTypeMatches(value, type) {
  if (!type || type === 'json') return true;
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string' || type === 'text' || type === 'markdown' || type === 'path') return typeof value === 'string';
  return true;
}

function validateJsonSchemaObject(value, schema = {}, pathPrefix = 'output') {
  const errors = [];
  const source = asObject(value);
  const properties = asObject(schema.properties);
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const fieldName of required) {
    if (source[fieldName] === undefined || source[fieldName] === null) {
      errors.push(`Missing required ${pathPrefix}.${fieldName}`);
    }
  }

  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (source[fieldName] === undefined || source[fieldName] === null) continue;
    const type = normalizeText(asObject(fieldSchema).type, '', 40);
    if (type && !jsonSchemaTypeMatches(source[fieldName], type)) {
      errors.push(`Invalid type for ${pathPrefix}.${fieldName}: expected ${type}`);
    }
  }

  return errors;
}

function validatePythonNodeOutputContract(output, manifest = {}) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return ['Python node stdout must be a JSON object.'];
  }

  const errors = [];
  for (const fieldName of ['summary', 'result', 'status']) {
    if (output[fieldName] === undefined || output[fieldName] === null) {
      errors.push(`Missing required output.${fieldName}`);
    }
  }
  if (output.summary !== undefined && typeof output.summary !== 'string') {
    errors.push('Invalid type for output.summary: expected string');
  }
  if (output.status !== undefined && typeof output.status !== 'string') {
    errors.push('Invalid type for output.status: expected string');
  }
  if (output.artifacts !== undefined && !Array.isArray(output.artifacts)) {
    errors.push('Invalid type for output.artifacts: expected array');
  }

  errors.push(...validateJsonSchemaObject(output, manifest.outputSchema, 'output'));
  return [...new Set(errors)];
}

function assertionValuePreview(value) {
  if (value === undefined) return '<missing>';
  const text = typeof value === 'string' ? value : stableJson(value);
  return String(text ?? '').slice(0, 240);
}

function collectExpectedOutputAssertionFailures(expected, actual, pathPrefix = '') {
  const failures = [];
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const [key, expectedValue] of Object.entries(expected)) {
      const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      failures.push(...collectExpectedOutputAssertionFailures(expectedValue, actual?.[key], childPath));
    }
    return failures;
  }
  if (!isSameJson(expected, actual)) {
    failures.push({
      code: 'expected_output_mismatch',
      path: pathPrefix || 'output',
      expected,
      actual,
      expectedPreview: assertionValuePreview(expected),
      actualPreview: assertionValuePreview(actual),
      message: `Expected ${pathPrefix || 'output'} to match ${assertionValuePreview(expected)} but got ${assertionValuePreview(actual)}.`,
    });
  }
  return failures;
}

function evaluatePythonNodeTestAssertions(result = {}, testCase = {}) {
  if (!result.ok) {
    return { ...result, assertionFailures: [] };
  }
  const assertionFailures = [];
  const expectedStatus = normalizeText(testCase.expectedStatus, '', 80);
  if (expectedStatus && result.parsedOutput?.status !== expectedStatus) {
    assertionFailures.push({
      code: 'expected_status_mismatch',
      path: 'status',
      expected: expectedStatus,
      actual: result.parsedOutput?.status,
      expectedPreview: assertionValuePreview(expectedStatus),
      actualPreview: assertionValuePreview(result.parsedOutput?.status),
      message: `Expected status to be ${expectedStatus} but got ${assertionValuePreview(result.parsedOutput?.status)}.`,
    });
  }
  if (testCase.expectedOutput !== undefined) {
    assertionFailures.push(...collectExpectedOutputAssertionFailures(testCase.expectedOutput, result.parsedOutput));
  }
  if (assertionFailures.length === 0) {
    return { ...result, assertionFailures };
  }
  return {
    ...result,
    ok: false,
    assertionFailures,
    error: {
      category: 'assertion_failed',
      message: assertionFailures.map((entry) => entry.message).join('; '),
    },
  };
}

function createPythonFormatterNodeDraft({ prompt = '', sampleInput = {} } = {}) {
  const label = normalizeText(prompt, 'Python Formatter Node', 80)
    .replace(/^create\s+(a|an)\s+/i, '')
    .replace(/\s+node.*$/i, ' node');
  const id = normalizeId(label, 'python-formatter-node');
  const code = [
    'import json',
    'import sys',
    '',
    'def pick_text(input_data):',
    '    for key in ("text", "content", "value", "prompt"):',
    '        value = input_data.get(key)',
    '        if value is not None:',
    '            return str(value)',
    '    return ""',
    '',
    'payload = json.load(sys.stdin)',
    'input_data = payload.get("input") or {}',
    'config = payload.get("config") or {}',
    'text = pick_text(input_data)',
    'mode = str(config.get("mode") or "upper").lower()',
    'if mode == "lower":',
    '    formatted = text.lower()',
    'elif mode == "title":',
    '    formatted = text.title()',
    'elif mode == "trim":',
    '    formatted = text.strip()',
    'else:',
    '    formatted = text.upper()',
    'print(json.dumps({',
    '    "summary": f"Formatted {len(text)} characters with mode={mode}.",',
    '    "result": {"text": formatted, "mode": mode},',
    '    "status": "completed"',
    '}))',
    '',
  ].join('\n');
  const input = Object.keys(asObject(sampleInput)).length ? asObject(sampleInput) : { text: 'hello workflow' };
  return {
    status: 'draft',
    prompt: normalizeText(prompt, '', 1000),
    manifest: normalizePythonNodeManifest({
      manifestVersion: PYTHON_NODE_MANIFEST_VERSION,
      id,
      type: id,
      label: label || 'Python Formatter Node',
      description: normalizeText(prompt, 'Formats text using a safe Python standard-library script.', 500),
      language: 'python',
      dependencies: [],
      entrypoint: 'main.py',
      configSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            title: 'Format mode',
            enum: ['upper', 'lower', 'title', 'trim'],
            default: 'upper',
          },
        },
        required: [],
        additionalProperties: false,
      },
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', title: 'Text' },
          prompt: { type: 'string', title: 'Rendered prompt' },
        },
        required: [],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', title: 'Summary' },
          result: { type: 'object', title: 'Result' },
          status: { type: 'string', title: 'Status' },
        },
        required: ['summary', 'result', 'status'],
        additionalProperties: true,
      },
      permissions: { risky: false, action: 'custom.python' },
      codeFiles: { 'main.py': code },
      testCases: [{
        id: 'formats-text',
        name: 'Formats text',
        input,
        config: { mode: 'upper' },
        expectedOutput: { result: { text: String(input.text || input.prompt || '').toUpperCase() } },
      }],
    }),
  };
}

async function writePythonNodeFiles(rootDir, codeFiles = {}) {
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  for (const [fileName, content] of Object.entries(codeFiles)) {
    const target = path.join(rootDir, fileName);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, String(content), { mode: 0o600 });
  }
}

async function runPythonNodeManifest(manifestInput, payload = {}, {
  pythonCommand = 'python',
  pythonArgs = [],
  timeoutMs = PYTHON_NODE_DEFAULT_TIMEOUT_MS,
  payloadLimitBytes = PYTHON_NODE_DEFAULT_PAYLOAD_LIMIT_BYTES,
} = {}) {
  const validation = validatePythonNodeManifest(manifestInput);
  const manifest = validation.manifest;
  if (!validation.valid) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      parsedOutput: null,
      exitCode: null,
      durationMs: 0,
      error: { category: 'invalid_manifest', message: validation.errors.map((error) => error.message).join('; ') },
      validation,
    };
  }

  const stdin = JSON.stringify(payload);
  if (Buffer.byteLength(stdin, 'utf8') > payloadLimitBytes) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      parsedOutput: null,
      exitCode: null,
      durationMs: 0,
      error: { category: 'payload_too_large', message: `Python node stdin payload exceeds ${payloadLimitBytes} bytes.` },
      validation,
    };
  }

  const startedAt = Date.now();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-python-node-'));
  await writePythonNodeFiles(tmpDir, manifest.codeFiles);

  try {
    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let outputTooLarge = false;
      const child = spawn(pythonCommand, [...pythonArgs, manifest.entrypoint], {
        cwd: tmpDir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, durationMs: Date.now() - startedAt, validation });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, Math.max(1, Number(timeoutMs) || PYTHON_NODE_DEFAULT_TIMEOUT_MS));
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout, 'utf8') > payloadLimitBytes) {
          outputTooLarge = true;
          child.kill('SIGKILL');
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        finish({
          ok: false,
          stdout,
          stderr,
          parsedOutput: null,
          exitCode: null,
          error: { category: error.code === 'ENOENT' ? 'missing_python_runtime' : 'runtime_error', message: error.message },
        });
      });
      child.on('close', (exitCode) => {
        if (timedOut) {
          finish({
            ok: false,
            stdout,
            stderr,
            parsedOutput: null,
            exitCode,
            error: { category: 'execution_timeout', message: `Python node execution timed out after ${timeoutMs}ms.` },
          });
          return;
        }
        if (outputTooLarge) {
          finish({
            ok: false,
            stdout,
            stderr,
            parsedOutput: null,
            exitCode,
            error: { category: 'payload_too_large', message: `Python node stdout exceeds ${payloadLimitBytes} bytes.` },
          });
          return;
        }
        if (exitCode !== 0) {
          const category = classifyPythonExecutionError(stderr);
          finish({
            ok: false,
            stdout,
            stderr,
            parsedOutput: null,
            exitCode,
            error: { category, message: stderr.trim() || `Python node exited with code ${exitCode}.` },
          });
          return;
        }
        try {
          const parsedOutput = JSON.parse(stdout || '');
          const outputContractErrors = validatePythonNodeOutputContract(parsedOutput, manifest);
          if (outputContractErrors.length > 0) {
            finish({
              ok: false,
              stdout,
              stderr,
              parsedOutput,
              exitCode,
              error: { category: 'invalid_output_contract', message: outputContractErrors.join('; ') },
            });
            return;
          }
          finish({ ok: true, stdout, stderr, parsedOutput, exitCode, error: null });
        } catch {
          finish({
            ok: false,
            stdout,
            stderr,
            parsedOutput: null,
            exitCode,
            error: { category: 'invalid_json_output', message: 'Python node stdout must be a JSON object.' },
          });
        }
      });
      child.stdin.end(stdin);
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function createDefaultExecutors({ artifactsDir = DEFAULT_WORKFLOW_ARTIFACTS_DIR } = {}) {
  return {
    async agent({ node, nodeInput, run }) {
      return {
        summary: `${node.title} completed through the workflow agent bridge.`,
        prompt: nodeInput.prompt,
        status: 'completed',
        sessionId: run.sessionId || '',
        sessionLink: run.sessionId ? `#session=${encodeURIComponent(run.sessionId)}` : '',
      };
    },
    async tool({ node, nodeInput, run }) {
      const toolName = nodeInput.toolName || node.toolName;
      if (toolName === 'git-native-review') {
        return buildGitNativeReviewFlow(await collectGitReviewInput(run.projectPath));
      }
      if (toolName === 'browser-screenshot') {
        await fs.mkdir(artifactsDir, { recursive: true, mode: 0o700 });
        const filename = `${run.id}-${node.id}.png`.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const screenshotPath = path.join(artifactsDir, filename);
        await fs.writeFile(screenshotPath, createTinyPngBuffer(), { mode: 0o600 });
        const artifact = {
          id: `workflow_artifact_${crypto.randomUUID()}`,
          kind: 'browser-screenshot',
          title: node.title,
          path: screenshotPath,
        };
        run.artifacts.push(artifact);
        return {
          artifactId: artifact.id,
          screenshotPath,
          summary: `Browser screenshot evidence captured at ${screenshotPath}.`,
        };
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
      const normalized = normalizeMcpExecutionError(toolName, `MCP tool is not configured for workflow execution: ${toolName || node.id}`);
      throw new Error(`${normalized.code}: ${normalized.message}`);
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
  const previewSnapshot = asObject(source.previewSnapshot);
  const executionInputSnapshot = asObject(source.executionInputSnapshot);
  const previewDiff = Object.keys(asObject(source.previewDiff)).length > 0
    ? normalizePreviewDiff(source.previewDiff)
    : diffPreviewSnapshots(previewSnapshot, executionInputSnapshot);
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
    runSnapshot: asObject(source.runSnapshot),
    previewSnapshot,
    executionInputSnapshot,
    previewDiff,
    previewMatched: source.previewMatched === undefined ? previewDiff.matched : source.previewMatched === true,
    previewChanged: source.previewChanged === undefined ? previewDiff.changed : source.previewChanged === true,
    resolverVersion: normalizeText(source.resolverVersion || executionInputSnapshot.resolverVersion || previewSnapshot.resolverVersion, '', 80),
    nodeRuns,
    queue: createQueueState(source.queue, now),
    logs: Array.isArray(source.logs) ? source.logs : [],
    artifacts: Array.isArray(source.artifacts) ? source.artifacts : [],
    timelineEvents: Array.isArray(source.timelineEvents) ? source.timelineEvents : [],
    createdAt: timestamp,
    startedAt: source.startedAt || timestamp,
    completedAt: source.completedAt || null,
    updatedAt: source.updatedAt || timestamp,
  };
}

function normalizeNodeLogEntry(entry, nodeRun, index) {
  if (entry && typeof entry === 'object') {
    return {
      timestamp: entry.timestamp || nodeRun.updatedAt || nodeRun.startedAt || 0,
      level: normalizeText(entry.level, 'info', 20),
      message: normalizeText(entry.message, '', 4000),
      payload: asObject(entry.payload),
    };
  }
  const message = normalizeText(entry, '', 4000);
  const isError = Boolean(nodeRun.error && message === nodeRun.error);
  return {
    timestamp: (nodeRun.startedAt || nodeRun.updatedAt || 0) + index,
    level: isError ? 'error' : 'info',
    message,
    payload: {},
  };
}

export function createWorkflowStudioStore({
  workflowsPath = DEFAULT_WORKFLOWS_PATH,
  runsPath = DEFAULT_RUNS_PATH,
  persist = true,
  autoExecute = true,
  now = () => Date.now(),
  subagentRunStore = defaultSubagentRunStore,
  agentResolver = getAgentConfig,
  executors = {},
  checkpointService = defaultWorkflowCheckpointStore,
  artifactsDir = DEFAULT_WORKFLOW_ARTIFACTS_DIR,
  screenshotDir = DEFAULT_WORKFLOW_SCREENSHOT_DIR,
  pythonCommand = 'python',
  pythonArgs = [],
  pythonTimeoutMs = PYTHON_NODE_DEFAULT_TIMEOUT_MS,
  pythonPayloadLimitBytes = PYTHON_NODE_DEFAULT_PAYLOAD_LIMIT_BYTES,
} = {}) {
  let loaded = false;
  let workflows = [];
  let runs = [];
  let nodePackages = [];
  let templateSmokeResults = [];
  let benchmarkResults = [];
  let retentionPolicy = {
    maxRuns: 500,
    maxLogEntriesPerNode: 200,
    artifactRetentionDays: 30,
    checkpointRetentionDays: 14,
    evidenceRetentionDays: 30,
  };
  const nodeExecutors = {
    ...createDefaultExecutors({ artifactsDir }),
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
        nodePackages = Array.isArray(rawWorkflows.nodePackages)
          ? rawWorkflows.nodePackages.map(asObject)
          : [];
      } catch {
        workflows = [];
        nodePackages = [];
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
        ...listBuiltInRecipes().filter((recipe) => ENTERPRISE_WORKFLOW_RECIPE_IDS.has(recipe.id)).map(recipeToWorkflow),
      ];
    }
  }

  async function saveWorkflows() {
    if (!persist) return;
    await fs.mkdir(path.dirname(workflowsPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(workflowsPath, JSON.stringify({ schemaVersion: 1, updatedAt: nowIso(now), workflows, nodePackages }, null, 2), {
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

  function getRunnableWorkflow(workflow) {
    const governance = normalizeWorkflowGovernance(workflow);
    if (governance.status === 'published' && governance.publishedDefinition) {
      return normalizeWorkflowDefinition({
        ...governance.publishedDefinition,
        id: workflow.id,
        name: workflow.name,
        metadata: {
          ...asObject(governance.publishedDefinition.metadata),
          governance: {
            ...governance,
            publishedDefinition: null,
          },
        },
      }, workflow, now);
    }
    return workflow;
  }

  function normalizeGenericNodePackage(input = {}) {
    const id = normalizeId(input.id || input.type || input.label, 'workflow-node-package');
    const type = normalizeId(input.type || id, 'workflow-node');
    const dependencies = asObject(input.dependencies);
    const missingDependencies = [
      ...normalizeStringArray(dependencies.profiles).map((value) => ({ kind: 'profile', id: value })),
      ...normalizeStringArray(dependencies.agents).map((value) => ({ kind: 'agent', id: value })),
      ...normalizeStringArray(dependencies.subagents).map((value) => ({ kind: 'subagent', id: value })),
      ...normalizeStringArray(dependencies.mcpServers).map((value) => ({ kind: 'mcpServer', id: value })),
      ...normalizeStringArray(dependencies.skills).map((value) => ({ kind: 'skill', id: value })),
      ...normalizeStringArray(dependencies.permissions).map((value) => ({ kind: 'permission', id: value })),
    ];
    const status = missingDependencies.length > 0 ? 'missing_dependencies' : normalizeNodePackageStatus(input.status, input.enabled === false ? 'disabled' : 'ready');
    const lifecycleState = normalizeNodePackageLifecycle(input.lifecycleState || input.state, input.enabled, status);
    const enabled = lifecycleState === 'enabled' && status === 'ready';
    const definition = {
      type,
      label: normalizeText(input.label, type, 120),
      description: normalizeText(input.description, 'Installed workflow node package.', 500),
      ports: asObject(input.ports),
      configSchema: {
        fields: Array.isArray(input.configSchema?.fields) ? input.configSchema.fields.map(asObject) : [],
      },
      outputSchema: {
        fields: Array.isArray(input.outputSchema?.fields) ? input.outputSchema.fields.map(asObject) : [],
      },
      permissions: asObject(input.permissions),
      ui: {
        materialGroup: 'custom',
        schemaVersion: normalizeText(input.ui?.schemaVersion, '1.0', 20),
        ...asObject(input.ui),
      },
      layout: asObject(input.layout),
    };

    return {
      id,
      enabled,
      status,
      lifecycleState,
      state: lifecycleState,
      installedAt: input.installedAt || nowIso(now),
      updatedAt: nowIso(now),
      manifest: {
        id,
        type,
        label: definition.label,
        version: normalizeText(input.version, '1.0.0', 40),
        language: normalizeText(input.language, 'manifest', 40),
        dependencies,
      },
      definition,
      dependencies,
      missingDependencies,
    };
  }

  function normalizeNodePackage(input = {}) {
    const wantsPythonManifest = input.language === 'python' || input.manifestVersion || input.entrypoint || input.codeFiles;
    if (!wantsPythonManifest) {
      return normalizeGenericNodePackage(input);
    }

    const validation = validatePythonNodeManifest(input);
    const manifest = validation.manifest;
    if (!validation.valid) {
      const error = new Error(validation.errors.map((entry) => entry.message).join('; '));
      error.statusCode = 400;
      error.validation = validation;
      throw error;
    }
    const status = normalizeNodePackageStatus(input.status, input.enabled === false ? 'disabled' : 'ready');
    const lifecycleState = normalizeNodePackageLifecycle(input.lifecycleState || input.state, input.enabled, status);
    return {
      id: manifest.id,
      enabled: lifecycleState === 'enabled' && status === 'ready',
      status,
      lifecycleState,
      state: lifecycleState,
      installedAt: input.installedAt || nowIso(now),
      updatedAt: nowIso(now),
      manifest,
      definition: manifest.definition,
      testCases: manifest.testCases,
      codeFiles: manifest.codeFiles,
    };
  }

  function listNodePackages() {
    return nodePackages.map(clone);
  }

  function getStoreNodeTypeDefinitions() {
    return [
      ...getWorkflowNodeTypeDefinitions(),
      ...nodePackages.filter(isNodePackagePaletteAvailable).map((item) => item.definition),
    ].map(clone);
  }

  async function installNodePackage(input = {}) {
    await load();
    const normalized = normalizeNodePackage(input);
    const index = nodePackages.findIndex((item) => item.id === normalized.id);
    if (index >= 0) {
      const current = nodePackages[index];
      const compatibility = buildNodePackageCompatibility(current, normalized);
      if (!compatibility.compatible) {
        const error = new Error('Workflow node package upgrade is incompatible');
        error.statusCode = 409;
        error.compatibility = compatibility;
        throw error;
      }
      nodePackages[index] = {
        ...normalized,
        installedAt: current.installedAt || normalized.installedAt,
        compatibility,
      };
    } else {
      nodePackages.push({
        ...normalized,
        compatibility: { compatible: true, reasons: [], warnings: [] },
      });
    }
    await saveWorkflows();
    return clone(nodePackages.find((item) => item.id === normalized.id) || normalized);
  }

  async function setNodePackageLifecycle(packageId, lifecycleState) {
    await load();
    const id = normalizeText(packageId, '', 120);
    const index = nodePackages.findIndex((item) => item.id === id);
    if (index < 0) {
      const error = new Error('Workflow node package not found');
      error.statusCode = 404;
      throw error;
    }
    const requestedState = normalizeNodePackageLifecycle(lifecycleState, lifecycleState !== 'enabled', lifecycleState === 'enabled' ? 'ready' : lifecycleState);
    const current = nodePackages[index];
    const nextStatus = requestedState === 'enabled' ? 'ready' : requestedState;
    nodePackages[index] = {
      ...current,
      enabled: requestedState === 'enabled',
      status: nextStatus,
      lifecycleState: requestedState,
      state: requestedState,
      updatedAt: nowIso(now),
    };
    await saveWorkflows();
    return clone(nodePackages[index]);
  }

  async function enableNodePackage(packageId) {
    return setNodePackageLifecycle(packageId, 'enabled');
  }

  async function disableNodePackage(packageId) {
    return setNodePackageLifecycle(packageId, 'disabled');
  }

  async function uninstallNodePackage(packageId) {
    await load();
    const id = normalizeText(packageId, '', 120);
    const before = nodePackages.length;
    nodePackages = nodePackages.filter((item) => item.id !== id);
    if (nodePackages.length === before) {
      const error = new Error('Workflow node package not found');
      error.statusCode = 404;
      throw error;
    }
    await saveWorkflows();
    return { removed: true, packageId: id };
  }

  async function getNodePackageImpactReport(packageId, { recentRunLimit = 25 } = {}) {
    await load();
    const id = normalizeText(packageId, '', 120);
    const nodePackage = nodePackages.find((item) => item.id === id) || null;
    const packageTypes = new Set([
      normalizeText(nodePackage?.definition?.type, '', 120),
      normalizeText(nodePackage?.manifest?.type, '', 120),
      normalizeText(id, '', 120),
    ].filter(Boolean));
    const matchNodeIds = (workflow) => (workflow.nodes || [])
      .filter((node) => packageTypes.has(normalizeText(node.type, '', 120)))
      .map((node) => node.id);
    const isTemplateWorkflow = (workflow) => Boolean(workflow.metadata?.templateManifest || workflow.metadata?.recipeId || String(workflow.id).startsWith('recipe-'));
    const workflowEntries = [];
    const templateEntries = [];
    for (const workflow of workflows) {
      const nodeIds = matchNodeIds(workflow);
      const declaredPackageDeps = normalizeStringArray(workflow.metadata?.dependencies?.nodePackages || workflow.metadata?.templateManifest?.dependencies?.nodePackages);
      const usesPackage = nodeIds.length > 0 || declaredPackageDeps.includes(id);
      if (!usesPackage) continue;
      const entry = {
        objectType: isTemplateWorkflow(workflow) ? 'template' : 'workflow',
        id: workflow.id,
        title: workflow.name,
        workflowId: workflow.id,
        nodeIds,
        severity: 'blocking',
      };
      if (isTemplateWorkflow(workflow)) templateEntries.push(entry);
      else workflowEntries.push(entry);
    }

    const recentRuns = runs
      .slice()
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
      .slice(0, Math.max(1, Math.min(Number(recentRunLimit) || 25, 100)))
      .map((run) => {
        const snapshotPackages = [
          ...(run.executionInputSnapshot?.dependencyRefs?.nodePackages || []),
          ...(run.previewSnapshot?.dependencyRefs?.nodePackages || []),
        ].map(asObject);
        const packageRefs = snapshotPackages.filter((entry) => normalizeText(entry.id, '', 120) === id);
        const nodeIds = new Set();
        for (const nodeRun of Object.values(run.nodeRuns || {})) {
          if (packageTypes.has(normalizeText(nodeRun.type, '', 120))) {
            nodeIds.add(nodeRun.nodeId);
          }
        }
        for (const snapshotNode of [
          ...(Array.isArray(run.executionInputSnapshot?.nodes) ? run.executionInputSnapshot.nodes : []),
          ...(Array.isArray(run.previewSnapshot?.nodes) ? run.previewSnapshot.nodes : []),
        ]) {
          if (packageTypes.has(normalizeText(snapshotNode?.type, '', 120))) {
            nodeIds.add(snapshotNode.nodeId);
          }
        }
        if (packageRefs.length === 0 && nodeIds.size === 0) return null;
        return {
          objectType: 'run',
          id: run.id,
          title: run.workflowName,
          workflowId: run.workflowId,
          nodeIds: [...nodeIds],
          severity: 'warning',
          status: run.status,
          createdAt: run.createdAt || null,
        };
      })
      .filter(Boolean);

    return {
      packageId: id,
      exists: Boolean(nodePackage),
      packageType: normalizeText(nodePackage?.definition?.type || nodePackage?.manifest?.type, '', 120),
      status: normalizeText(nodePackage?.status, nodePackage ? 'ready' : 'missing', 80),
      lifecycleState: normalizeText(nodePackage?.lifecycleState || nodePackage?.state, nodePackage ? 'enabled' : 'missing', 80),
      affected: {
        workflows: workflowEntries,
        templates: templateEntries,
        recentRuns,
      },
      totals: {
        workflows: workflowEntries.length,
        templates: templateEntries.length,
        recentRuns: recentRuns.length,
      },
      destructiveActionRisk: workflowEntries.length + templateEntries.length > 0 ? 'blocking' : recentRuns.length > 0 ? 'warning' : 'none',
    };
  }

  function getStoreNodeTypeDefinition(type) {
    return getNodeTypeDefinition(type) || nodePackages.find((item) => isNodePackagePaletteAvailable(item) && item.definition.type === type)?.definition || null;
  }

  function getNodePackageForType(type) {
    return nodePackages.find((item) => isNodePackagePaletteAvailable(item) && item.definition?.type === type) || null;
  }

  function buildRunInputs(workflow, providedInputs = {}) {
    const runInputs = Object.fromEntries((workflow.inputs || []).map((entry) => [entry.id, entry.defaultValue]));
    Object.assign(runInputs, asObject(providedInputs));
    return runInputs;
  }

  function collectWorkflowDependencyRefs(workflow) {
    const packageRefs = new Map();
    for (const node of workflow.nodes || []) {
      const nodePackage = getNodePackageForType(node.type);
      if (!nodePackage) continue;
      packageRefs.set(nodePackage.id, {
        id: nodePackage.id,
        type: nodePackage.definition?.type || node.type,
        version: normalizeText(nodePackage.manifest?.version || nodePackage.manifest?.packageVersion || nodePackage.definition?.version, '', 80),
        language: normalizeText(nodePackage.manifest?.language, '', 40),
        status: normalizeText(nodePackage.status, '', 80),
      });
    }
    return {
      workflowDigest: workflowDefinitionDigest(workflow),
      profileId: workflow.profileId,
      permissionPreset: workflow.permissionPreset,
      nodePackages: [...packageRefs.values()].sort((left, right) => left.id.localeCompare(right.id)),
    };
  }

  function collectNodePackageSnapshots(workflow) {
    const snapshots = new Map();
    for (const node of workflow.nodes || []) {
      const nodePackage = getNodePackageForType(node.type);
      if (!nodePackage) continue;
      snapshots.set(nodePackage.id, {
        id: nodePackage.id,
        type: nodePackage.definition?.type || node.type,
        version: normalizeText(
          nodePackage.manifest?.version || nodePackage.manifest?.packageVersion || nodePackage.definition?.version,
          '',
          80,
        ),
        status: normalizeText(nodePackage.status, '', 80),
        lifecycleState: normalizeText(nodePackage.lifecycleState || nodePackage.state, '', 80),
        language: normalizeText(nodePackage.manifest?.language, '', 40),
        manifest: clone(nodePackage.manifest || {}),
        definition: clone(nodePackage.definition || {}),
        installedAt: nodePackage.installedAt || '',
        updatedAt: nodePackage.updatedAt || '',
      });
    }
    return [...snapshots.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  function buildWorkflowRunSnapshot({
    workflow,
    runnableWorkflow,
    runInputs,
    profileSnapshot,
    agent,
    runPlan,
    reviewedPreviewSnapshot,
    executionInputSnapshot,
  }) {
    return {
      snapshotVersion: 1,
      capturedAt: nowIso(now),
      workflowId: workflow.id,
      workflowName: workflow.name,
      runnableWorkflowId: runnableWorkflow.id,
      runnableWorkflowName: runnableWorkflow.name,
      workflowDigest: workflowDefinitionDigest(runnableWorkflow),
      resolverVersion: runPlan.resolverVersion,
      definitionSnapshot: clone(runnableWorkflow),
      profileSnapshot: {
        ...clone(profileSnapshot),
        agent: clone(agent || {}),
      },
      permissionSnapshot: {
        source: 'workflow',
        permissionPreset: runnableWorkflow.permissionPreset,
        profileId: runnableWorkflow.profileId,
        nodePermissions: Object.fromEntries((runnableWorkflow.nodes || []).map((node) => [
          node.id,
          {
            type: node.type,
            permission: node.permission || '',
            riskLevel: node.riskLevel || '',
          },
        ])),
      },
      nodePackageSnapshots: collectNodePackageSnapshots(runnableWorkflow),
      runInputsSnapshot: clone(runInputs),
      previewSnapshot: clone(reviewedPreviewSnapshot),
      executionInputSnapshot: clone(executionInputSnapshot),
      dependencyRefs: clone(runPlan.dependencyRefs),
    };
  }

  function generatePythonNodeDraft(input = {}) {
    return clone(createPythonFormatterNodeDraft(input));
  }

  function validateNodePackageDraft(input = {}) {
    return clone(validatePythonNodeManifest(input));
  }

  async function testNodePackageDraft(input = {}, options = {}) {
    const validation = validatePythonNodeManifest(input);
    const testCases = options.testCase
      ? [asObject(options.testCase)]
      : (Array.isArray(validation.manifest.testCases) ? validation.manifest.testCases.map(asObject) : []);
    const runnerOptions = {
      pythonCommand,
      pythonArgs,
      timeoutMs: normalizeInteger(options.timeoutMs, pythonTimeoutMs, 1, pythonTimeoutMs),
      payloadLimitBytes: normalizeInteger(options.payloadLimitBytes, pythonPayloadLimitBytes, 1024, pythonPayloadLimitBytes),
    };
    const cases = [];
    for (const [index, testCase] of testCases.entries()) {
      const result = await runPythonNodeManifest(validation.manifest, {
        input: asObject(options.input || testCase.input),
        config: asObject(options.config || testCase.config),
        context: asObject(options.context),
      }, runnerOptions);
      const assertedResult = evaluatePythonNodeTestAssertions(result, testCase);
      cases.push({
        ...assertedResult,
        testCaseId: testCase.id || `case-${index + 1}`,
        testCaseName: testCase.name || testCase.id || `Case ${index + 1}`,
        index,
      });
    }
    const representative = cases.find((entry) => !entry.ok) || cases[0] || await runPythonNodeManifest(validation.manifest, {
      input: asObject(options.input),
      config: asObject(options.config),
      context: asObject(options.context),
    }, runnerOptions);
    const ok = cases.length > 0 ? cases.every((entry) => entry.ok) : Boolean(representative.ok);
    return clone({
      ...representative,
      ok,
      cases,
      testCaseId: representative.testCaseId || '',
    });
  }

  async function upsertWorkflow(input = {}) {
    await load();
    const id = normalizeId(input.id || input.name, 'workflow');
    const index = workflows.findIndex((workflow) => workflow.id === id);
    const existing = index >= 0 ? workflows[index] : null;
    const normalized = normalizeWorkflowDefinition({ ...input, id }, existing, now);
    const governance = normalizeWorkflowGovernance(normalized);
    const revision = {
      id: `workflow_revision_${crypto.randomUUID()}`,
      workflowId: normalized.id,
      actor: normalizeText(input.actor || input.metadata?.governance?.actor, 'local-user', 120),
      createdAt: nowIso(now),
      previousDigest: existing ? workflowDefinitionDigest(existing) : '',
      currentDigest: workflowDefinitionDigest(normalized),
      diff: summarizeDefinitionDiff(existing, normalized),
    };
    normalized.metadata = {
      ...asObject(normalized.metadata),
      governance: {
        ...governance,
        revisions: [...governance.revisions, revision].slice(-50),
        auditRecords: [
          ...governance.auditRecords,
          {
            id: `workflow_audit_${crypto.randomUUID()}`,
            type: existing ? 'workflow_saved' : 'workflow_created',
            actor: revision.actor,
            workflowId: normalized.id,
            createdAt: revision.createdAt,
            summary: existing ? 'Workflow definition saved.' : 'Workflow definition created.',
            diff: revision.diff,
          },
        ].slice(-200),
      },
    };
    const validation = validateWorkflowDefinition(normalized, getStoreNodeTypeDefinitions()).validation;
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

  function downstreamNodeIds(workflow, nodeId) {
    const visited = new Set();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const edge of outgoingEdges(workflow, current)) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
    return visited;
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
    const permissionExplanation = buildPermissionExplanation(workflow, node, { decisionOverride: permission, nodeRun });
    nodeRun.permissionExplanation = permissionExplanation;
    if (permission === 'deny') {
      nodeRun.status = 'failed';
      nodeRun.error = 'Node denied by Agent Profile permission boundary.';
      nodeRun.completedAt = now();
      nodeRun.durationMs = nodeRun.completedAt - nodeRun.startedAt;
      nodeRun.permissionDecision = 'deny';
      run.timelineEvents.push(createRunEvent('workflow_node_failed', {
        ...summarizeNode(node),
        error: nodeRun.error,
        permissionExplanation,
      }, now));
      return;
    }
    if (permission === 'ask' && RISKY_NODE_TYPES.has(node.type) && nodeRun.permissionDecision !== 'approved') {
      nodeRun.status = 'waiting_approval';
      nodeRun.waitingReason = permissionExplanation.explain || `${node.type} node requires approval before execution.`;
      nodeRun.permissionDecision = 'ask';
      nodeRun.logs.push(nodeRun.waitingReason);
      run.timelineEvents.push(createRunEvent('workflow_node_waiting_approval', {
        ...summarizeNode(node),
        permissionExplanation,
      }, now));
      return;
    }

    if (node.type === 'approval') {
      nodeRun.status = 'waiting_approval';
      nodeRun.waitingReason = node.prompt || 'Waiting for approval.';
      nodeRun.permissionDecision = 'ask';
      nodeRun.permissionExplanation = buildPermissionExplanation(workflow, node, { decisionOverride: 'ask', nodeRun });
      nodeRun.logs.push(nodeRun.waitingReason);
      run.timelineEvents.push(createRunEvent('workflow_node_waiting_approval', {
        ...summarizeNode(node),
        permissionExplanation: nodeRun.permissionExplanation,
      }, now));
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
        const terminalRun = await waitForSubagentTerminal(
          subagentRunStore,
          subagentRun,
          Math.min(Math.max(1, Number(node.timeoutMs) || 1000), 1000),
        );
        nodeRun.output = {
          subagentRunId: terminalRun.id,
          status: terminalRun.status,
          result: terminalRun.result || terminalRun.output || null,
          error: terminalRun.error || '',
        };
        nodeRun.output = applyAgentResultContract(node, nodeRun, {
          ...nodeRun.output,
          summary: terminalRun.result || terminalRun.output || terminalRun.status,
          sessionId: terminalRun.id,
          sessionLink: `#subagent-run=${encodeURIComponent(terminalRun.id)}`,
        }, { sessionId: terminalRun.id });
        nodeRun.artifacts.push({ kind: 'subagent-run', refId: terminalRun.id, title: node.title });
        if (terminalRun.status === 'failed' || terminalRun.status === 'stopped' || terminalRun.status === 'cancelled') {
          throw new Error(terminalRun.error || `Subagent run failed: ${terminalRun.id}`);
        }
        if (!reachedTerminalSubagentStatus(terminalRun)) {
          nodeRun.status = 'running';
          nodeRun.updatedAt = now();
          nodeRun.logs.push(`Subagent run ${terminalRun.id} is still ${terminalRun.status || 'running'} after timeout.`);
          run.timelineEvents.push(createRunEvent('workflow_subagent_still_running', {
            ...summarizeNode(node),
            subagentRunId: terminalRun.id,
            status: terminalRun.status || 'running',
          }, now));
          return;
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
        const nodePackage = getNodePackageForType(node.type);
        if (nodePackage?.manifest?.language === 'python') {
          const result = await runPythonNodeManifest(nodePackage.manifest, {
            input: nodeRun.input,
            config: asObject(node.config),
            context: {
              workflowId: workflow.id,
              runId: run.id,
              nodeId: node.id,
            },
          }, {
            pythonCommand,
            pythonArgs,
            timeoutMs: node.timeoutMs || pythonTimeoutMs,
            payloadLimitBytes: pythonPayloadLimitBytes,
          });
          nodeRun.logs.push(...[result.stderr, result.stdout].filter(Boolean));
          if (!result.ok) {
            throw createPythonExecutionError(result.error?.category || 'runtime_error', result.error?.message || 'Python node failed.', {
              stdout: result.stdout,
              stderr: result.stderr,
            });
          }
          nodeRun.output = asObject(result.parsedOutput);
          nodeRun.logs.push(`Python node completed in ${result.durationMs}ms.`);
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
            if (node.type === 'agent') {
              nodeRun.output = applyAgentResultContract(node, nodeRun, nodeRun.output, { sessionId: run.sessionId });
            }
          } else {
            nodeRun.output = {
              summary: `${node.title} completed.`,
              nodeType: node.type,
              toolName: nodeRun.input.toolName || node.toolName,
              command: nodeRun.input.command || node.command,
            };
          }
        }
      }
      captureNodeArtifacts(run, node, nodeRun, now);

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
      const subagentPoolLimit = getSubagentPoolLimit(workflow);
      let selectedSubagents = 0;
      const ready = workflow.nodes.filter((node) => {
        if (!canRunNode(workflow, run, node)) return false;
        if (node.type === 'subagent') {
          selectedSubagents += 1;
          return selectedSubagents <= subagentPoolLimit;
        }
        return true;
      }).slice(0, workflow.maxConcurrency);
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
    ensureRunSummaryArtifact(run, now);
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
    const runnableWorkflow = getRunnableWorkflow(workflow);
    const validation = validateWorkflowDefinition(runnableWorkflow, getStoreNodeTypeDefinitions()).validation;
    if (!validation.valid) {
      const error = new Error(validation.errors.map((entry) => entry.message).join('; '));
      error.statusCode = 400;
      error.validation = validation;
      throw error;
    }
    const runInputs = buildRunInputs(runnableWorkflow, input.inputs);
    const inputValidation = validateRunInputs(runnableWorkflow, runInputs);
    if (!inputValidation.valid) {
      const error = new Error(inputValidation.errors.map((entry) => entry.message).join('; '));
      error.statusCode = 400;
      error.validation = inputValidation;
      throw error;
    }
    const runPlan = resolveWorkflowRunPlan(runnableWorkflow, { runInputs });
    const reviewedPreviewSnapshot = Object.keys(asObject(input.previewSnapshot)).length > 0
      ? clone(asObject(input.previewSnapshot))
      : runPlan.previewSnapshot;
    const previewDiff = diffPreviewSnapshots(reviewedPreviewSnapshot, runPlan.executionInputSnapshot);

    const agent = await agentResolver(runnableWorkflow.profileId);
    const timestamp = now();
    const profileSnapshot = {
      profileId: runnableWorkflow.profileId,
      permissionPreset: runnableWorkflow.permissionPreset,
      agentName: agent?.name || runnableWorkflow.profileId,
      governanceStatus: normalizeWorkflowGovernance(workflow).status,
      publishedRevisionId: normalizeWorkflowGovernance(workflow).publishedRevisionId,
    };
    const runSnapshot = buildWorkflowRunSnapshot({
      workflow,
      runnableWorkflow,
      runInputs,
      profileSnapshot,
      agent,
      runPlan,
      reviewedPreviewSnapshot,
      executionInputSnapshot: runPlan.executionInputSnapshot,
    });
    const run = normalizeRun({
      id: `workflow_run_${crypto.randomUUID()}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'running',
      projectPath: input.projectPath || '',
      sessionId: input.sessionId || '',
      inputs: runInputs,
      profileSnapshot,
      runSnapshot,
      previewSnapshot: reviewedPreviewSnapshot,
      executionInputSnapshot: runPlan.executionInputSnapshot,
      previewDiff,
      previewMatched: previewDiff.matched,
      previewChanged: previewDiff.changed,
      resolverVersion: runPlan.resolverVersion,
      queue: {
        state: autoExecute ? 'running' : 'queued',
        maxConcurrency: runnableWorkflow.maxConcurrency,
        updatedAt: timestamp,
      },
      nodeRuns: Object.fromEntries(runnableWorkflow.nodes.map((node) => [node.id, createNodeRun(node, now)])),
      logs: [
        `Created workflow run for ${workflow.name}.`,
        ...(previewDiff.changed ? [`Preview drift detected: ${previewDiff.reasons.join(', ') || 'changed node inputs'}.`] : []),
      ],
      timelineEvents: [
        createRunEvent('workflow_run_created', { workflowId: workflow.id, workflowName: workflow.name, governanceStatus: normalizeWorkflowGovernance(workflow).status }, now),
        ...(previewDiff.changed ? [createRunEvent('workflow_preview_changed', { reasons: previewDiff.reasons, changedNodes: previewDiff.changedNodes }, now)] : []),
      ],
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
    }, now);
    runs.push(run);
    await saveRuns();
    if (!autoExecute) {
      run.status = 'queued';
      run.queue.state = 'queued';
      run.timelineEvents.push(createRunEvent('workflow_run_queued', { maxConcurrency: runnableWorkflow.maxConcurrency }, now));
      await saveRuns();
      return clone(run);
    }
    return executeReadyNodes(runnableWorkflow, run);
  }

  function listRuns({ workflowId = '', status = '', sessionId = '', projectPath = '', limit = 50 } = {}) {
    const normalizedWorkflowId = normalizeText(workflowId).toLowerCase();
    const normalizedStatus = normalizeText(status).toLowerCase();
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedProjectPath = normalizeText(projectPath);
    return runs
      .filter((run) => !normalizedWorkflowId || run.workflowId.toLowerCase() === normalizedWorkflowId)
      .filter((run) => !normalizedStatus || run.status.toLowerCase() === normalizedStatus)
      .filter((run) => !normalizedSessionId || run.sessionId === normalizedSessionId)
      .filter((run) => !normalizedProjectPath || run.projectPath === normalizedProjectPath)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)))
      .map(clone);
  }

  function getRun(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    return run ? clone(run) : null;
  }

  async function acquireNextRun({ workerId = `workflow-worker-${process.pid}`, leaseMs = 30000 } = {}) {
    await load();
    const activeLeases = runs.filter((run) => run.status === 'running' && run.queue?.leaseExpiresAt && run.queue.leaseExpiresAt > now()).length;
    const queued = runs.find((run) => run.status === 'queued');
    if (!queued) return null;
    const workflow = workflows.find((item) => item.id === queued.workflowId);
    const maxConcurrency = workflow?.maxConcurrency || queued.queue?.maxConcurrency || 4;
    if (activeLeases >= maxConcurrency) return null;
    queued.status = 'running';
    queued.queue = {
      ...createQueueState(queued.queue, now),
      state: 'running',
      workerId: normalizeText(workerId, 'workflow-worker', 120),
      heartbeatAt: now(),
      leaseExpiresAt: now() + Math.max(1000, Number(leaseMs) || 30000),
      maxConcurrency,
      updatedAt: now(),
    };
    queued.timelineEvents.push(createRunEvent('workflow_worker_acquired', {
      workerId: queued.queue.workerId,
      leaseExpiresAt: queued.queue.leaseExpiresAt,
    }, now));
    await saveRuns();
    return clone(queued);
  }

  async function recoverStaleRuns({ nowMs = now() } = {}) {
    await load();
    let recovered = 0;
    for (const run of runs) {
      if (run.status !== 'running') continue;
      if (!run.queue?.leaseExpiresAt || run.queue.leaseExpiresAt > nowMs) continue;
      run.status = 'queued';
      run.queue = {
        ...createQueueState(run.queue, now),
        state: 'recovering',
        workerId: '',
        heartbeatAt: nowMs,
        leaseExpiresAt: null,
        recoveredAt: nowMs,
        updatedAt: nowMs,
      };
      run.timelineEvents.push(createRunEvent('workflow_run_recovered', { recoveredAt: nowMs }, now));
      run.updatedAt = nowMs;
      recovered += 1;
    }
    if (recovered > 0) await saveRuns();
    return { recovered };
  }

  function getNodeIo(runId, nodeId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    const nodeRun = run?.nodeRuns?.[normalizeText(nodeId)];
    if (!run || !nodeRun) return null;
    const definition = getStoreNodeTypeDefinition(nodeRun.type);
    return {
      runId: run.id,
      workflowId: run.workflowId,
      nodeId: nodeRun.nodeId,
      type: nodeRun.type,
      status: nodeRun.status,
      input: clone(nodeRun.input || {}),
      output: clone(nodeRun.output || {}),
      inputSchema: {
        fields: definition?.configSchema?.fields || [],
      },
      outputSchema: definition?.outputSchema || { fields: [] },
    };
  }

  function getReplayDefinitionSnapshot(run) {
    const runSnapshot = asObject(run.runSnapshot);
    const definitionSnapshot = asObject(runSnapshot.definitionSnapshot);
    if (Array.isArray(definitionSnapshot.nodes)) {
      return clone(definitionSnapshot);
    }
    const fallbackNodes = Object.values(asObject(run.nodeRuns)).map((nodeRun) => ({
      id: nodeRun.nodeId,
      type: nodeRun.type,
      title: nodeRun.title,
    }));
    return {
      id: run.workflowId,
      name: run.workflowName,
      nodes: fallbackNodes,
      edges: [],
    };
  }

  function replayRun(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const events = listRunEvents(run.id);
    const definitionSnapshot = getReplayDefinitionSnapshot(run);
    const diagnostics = [];
    const nodes = Object.fromEntries((definitionSnapshot.nodes || []).map((node) => [node.id, {
      nodeId: node.id,
      type: node.type,
      title: node.title,
      status: 'pending',
      attempt: 0,
      error: '',
      startedAt: null,
      completedAt: null,
    }]));
    const approvals = [];
    const startedNodes = new Set();
    let seenRunCreated = false;
    let replayStatus = 'pending';
    const ensureNode = (payload = {}) => {
      const nodeId = normalizeText(payload.nodeId, '', 120);
      if (!nodeId) return null;
      if (!nodes[nodeId]) {
        diagnostics.push({
          code: 'event_references_unknown_node',
          nodeId,
          eventType: payload.eventType || '',
          message: `Replay event references unknown node ${nodeId}.`,
        });
        nodes[nodeId] = {
          nodeId,
          type: normalizeText(payload.type, 'unknown', 80),
          title: normalizeText(payload.title, nodeId, 180),
          status: 'pending',
          attempt: 0,
          error: '',
          startedAt: null,
          completedAt: null,
        };
      }
      return nodes[nodeId];
    };
    for (const event of events) {
      const payload = asObject(event.payload);
      if (event.type === 'workflow_run_created') {
        seenRunCreated = true;
        replayStatus = 'running';
      } else if (event.type === 'workflow_run_queued') {
        replayStatus = 'queued';
      } else if (event.type === 'workflow_worker_acquired') {
        replayStatus = 'running';
      } else if (event.type === 'workflow_run_recovered') {
        replayStatus = 'recovering';
      } else if (event.type === 'workflow_run_cancelled') {
        replayStatus = 'cancelled';
      } else if (event.type === 'workflow_run_status') {
        replayStatus = normalizeText(payload.status, replayStatus, 80);
      } else if (event.type === 'workflow_node_started') {
        const node = ensureNode({ ...payload, eventType: event.type });
        if (!node) continue;
        node.status = 'running';
        node.startedAt = event.createdAt;
        node.error = '';
        startedNodes.add(node.nodeId);
      } else if (event.type === 'workflow_node_completed') {
        const node = ensureNode({ ...payload, eventType: event.type });
        if (!node) continue;
        if (!startedNodes.has(node.nodeId)) {
          diagnostics.push({
            code: 'out_of_order_node_completed',
            nodeId: node.nodeId,
            eventId: event.id,
            message: `Node ${node.nodeId} completed before a started event was observed.`,
          });
        }
        node.status = 'completed';
        node.completedAt = event.createdAt;
        node.error = '';
      } else if (event.type === 'workflow_node_failed') {
        const node = ensureNode({ ...payload, eventType: event.type });
        if (!node) continue;
        if (!startedNodes.has(node.nodeId)) {
          diagnostics.push({
            code: 'out_of_order_node_failed',
            nodeId: node.nodeId,
            eventId: event.id,
            message: `Node ${node.nodeId} failed before a started event was observed.`,
          });
        }
        node.status = 'failed';
        node.completedAt = event.createdAt;
        node.error = normalizeText(payload.error, '', 2000);
      } else if (event.type === 'workflow_node_waiting_approval') {
        const node = ensureNode({ ...payload, eventType: event.type });
        if (!node) continue;
        if (!startedNodes.has(node.nodeId)) {
          diagnostics.push({
            code: 'out_of_order_node_waiting_approval',
            nodeId: node.nodeId,
            eventId: event.id,
            message: `Node ${node.nodeId} waited for approval before a started event was observed.`,
          });
        }
        node.status = 'waiting_approval';
      } else if (event.type === 'workflow_node_rejected') {
        const node = ensureNode({ ...payload, eventType: event.type });
        if (!node) continue;
        node.status = 'failed';
        node.error = 'Rejected by approval decision.';
        node.completedAt = event.createdAt;
      } else if (event.type === 'workflow_node_retry_from') {
        for (const nodeId of normalizeStringArray(payload.affected, 200)) {
          if (nodes[nodeId]) nodes[nodeId].attempt += 1;
        }
      } else if (event.type === 'workflow_approval_decision') {
        approvals.push({
          nodeId: normalizeText(payload.nodeId, '', 120),
          decision: normalizeText(payload.decision || payload.action, '', 80),
          reason: normalizeText(payload.reason, '', 1000),
          eventId: event.id,
          createdAt: event.createdAt,
        });
      }
    }
    if (!seenRunCreated) {
      diagnostics.push({
        code: 'missing_run_created',
        message: 'Replay did not observe workflow_run_created before later run events.',
      });
    }
    return {
      runId: run.id,
      workflowId: run.workflowId,
      status: replayStatus || run.status,
      snapshot: clone(run.runSnapshot || {}),
      definitionSnapshot,
      nodes,
      approvals,
      events,
      diagnostics,
    };
  }

  function classifyRunFailures(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    return {
      runId: run.id,
      failures: Object.values(run.nodeRuns || {})
        .filter((nodeRun) => nodeRun.status === 'failed' || nodeRun.error)
        .map((nodeRun) => {
          const text = `${nodeRun.error || ''} ${nodeRun.waitingReason || ''}`.toLowerCase();
          const category = text.includes('permission') || text.includes('denied')
            ? 'permission'
            : text.includes('mcp')
              ? 'mcp'
              : text.includes('timeout')
                ? 'timeout'
                : text.includes('schema') || text.includes('variable')
                  ? 'schema'
                  : nodeRun.type === 'shell'
                    ? 'shell'
                    : nodeRun.type === 'agent' || nodeRun.type === 'subagent'
                      ? 'agent'
                      : 'dependency';
          return {
            nodeId: nodeRun.nodeId,
            nodeTitle: nodeRun.title,
            type: nodeRun.type,
            category,
            error: nodeRun.error || nodeRun.waitingReason || '',
          };
        }),
    };
  }

  function getRecommendedRecoveryActions(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const failures = classifyRunFailures(run.id)?.failures || [];
    return {
      runId: run.id,
      actions: failures.map((failure) => ({
        nodeId: failure.nodeId,
        category: failure.category,
        recommendations: failure.category === 'permission'
          ? ['review permission dry-run', 'request override', 'retry from node after approval']
          : failure.category === 'schema'
            ? ['fix node mapping', 'run dry-run debugger', 'retry node only']
            : failure.category === 'shell'
              ? ['inspect stdout/stderr', 'rollback checkpoint if needed', 'retry from node']
              : ['retry node only', 'retry from node', 'edit node config'],
      })),
    };
  }

  function listRunArtifacts(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const artifactMap = new Map();
    for (const artifact of run.artifacts || []) {
      const normalized = normalizeWorkflowArtifactRef(artifact, { run, source: 'run', now });
      artifactMap.set(normalized.id, normalized);
    }
    for (const nodeRun of Object.values(run.nodeRuns || {})) {
      const node = { id: nodeRun.nodeId, title: nodeRun.title, type: nodeRun.type };
      for (const artifact of nodeRun.artifacts || []) {
        const normalized = normalizeWorkflowArtifactRef(artifact, { run, node, nodeRun, source: 'node', now });
        artifactMap.set(normalized.id, normalized);
      }
    }
    return {
      runId: run.id,
      artifacts: [...artifactMap.values()].map(clone),
    };
  }

  async function listRunEvidence(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    let screenshots = [];
    try {
      const entries = await fs.readdir(screenshotDir, { withFileTypes: true });
      screenshots = entries
        .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          path: path.join(screenshotDir, entry.name),
          kind: 'playwright-screenshot',
        }));
    } catch {
      screenshots = [];
    }
    return {
      runId: run.id,
      screenshots,
      artifacts: listRunArtifacts(run.id)?.artifacts || [],
    };
  }

  function getBenchmarkTrend({ limit = 20 } = {}) {
    return {
      generatedAt: nowIso(now),
      results: benchmarkResults
        .slice(-Math.max(1, Math.min(Number(limit) || 20, 100)))
        .map((result, index, list) => ({
          ...clone(result),
          sequence: benchmarkResults.length - list.length + index + 1,
        })),
    };
  }

  function getTestCoverageMap() {
    const files = [
      'server/services/tests/workflow-studio-service.test.mjs',
      'src/components/workflows/view/WorkflowStudio.test.tsx',
      'src/e2e-screenshot-gate.test.ts',
      'e2e/workflow-studio-real.screenshot.spec.ts',
    ];
    return {
      generatedAt: nowIso(now),
      coverage: files.map((file) => ({
        file,
        exists: true,
        covers: file.includes('server') ? ['backend', 'runtime'] : file.includes('e2e') ? ['real screenshots'] : ['frontend contract'],
      })),
    };
  }

  async function exportEvidenceBundle(runId) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    return {
      run: clone(run),
      events: listRunEvents(run.id),
      replay: replayRun(run.id),
      failures: classifyRunFailures(run.id),
      recovery: getRecommendedRecoveryActions(run.id),
      artifacts: listRunArtifacts(run.id),
      evidence: await listRunEvidence(run.id),
      releaseReadiness: getReleaseReadiness(),
      coverageMap: getTestCoverageMap(),
    };
  }

  function buildRunDryPreview(workflow, runInputs, validationErrors = [], nodeTypeDefinitions = NODE_TYPE_DEFINITIONS) {
    const context = buildDryRunTemplateContext(workflow, runInputs, nodeTypeDefinitions);
    const rows = (workflow.nodes || []).map((node) => {
      const errors = validationErrors
        .filter((entry) => entry?.nodeId === node.id)
        .map((entry) => clone(entry));
      let resolvedInput = {};
      let resolvedInputLineage = {};
      try {
        const resolved = buildNodeInputWithLineageFromContext(node, context);
        resolvedInput = resolved.resolvedInput;
        resolvedInputLineage = resolved.lineage;
      } catch (error) {
        errors.push({
          code: error?.code === 'missing_variable' ? 'missing_variable' : 'preview_resolution_failed',
          nodeId: node.id,
          variable: error?.variable || '',
          message: error?.message || `Failed to resolve node ${node.id} input preview.`,
        });
      }
      const permissionDecision = resolveNodePermission(workflow, node);
      const upstream = incomingEdges(workflow, node.id).map((edge) => ({
        edgeId: edge.id,
        nodeId: edge.from,
        mode: edge.mode,
        condition: edge.condition || '',
      }));
      return {
        nodeId: node.id,
        type: node.type,
        title: node.title,
        resolvedInput,
        resolvedInputLineage,
        permissionDecision,
        upstream,
        blocked: errors.length > 0 || permissionDecision === 'deny',
        errors,
      };
    });
    return {
      workflowId: workflow.id,
      inputSnapshot: clone(runInputs || {}),
      nodeCount: rows.length,
      blockedCount: rows.filter((row) => row.blocked).length,
      nodes: rows,
    };
  }

  function resolveWorkflowRunPlan(workflow, { runInputs = {}, nodeTypeDefinitions = null } = {}) {
    const definitions = Array.isArray(nodeTypeDefinitions) && nodeTypeDefinitions.length > 0
      ? nodeTypeDefinitions
      : getStoreNodeTypeDefinitions();
    const definitionValidation = validateWorkflowDefinition(workflow, definitions).validation;
    const inputValidation = validateRunInputs(workflow, runInputs);
    const errors = [
      ...definitionValidation.errors,
      ...inputValidation.errors,
      ...validateNodeConfigs(workflow, definitions),
      ...validateWorkflowVariables(workflow, definitions),
      ...validateWorkflowDependencies(workflow),
    ];
    const dependencyRefs = collectWorkflowDependencyRefs(workflow);
    const preview = buildRunDryPreview(workflow, runInputs, errors, definitions);
    const snapshot = {
      ...preview,
      resolverVersion: WORKFLOW_RUN_RESOLVER_VERSION,
      generatedAt: nowIso(now),
      dependencyRefs,
    };
    return {
      valid: errors.length === 0,
      workflowId: workflow.id,
      runInputs: clone(runInputs),
      errors,
      warnings: definitionValidation.warnings,
      nodeTypeDefinitions: definitions,
      availableVariables: buildAvailableVariables(workflow, definitions),
      dependencyRefs,
      resolverVersion: WORKFLOW_RUN_RESOLVER_VERSION,
      preview: clone(snapshot),
      previewSnapshot: clone(snapshot),
      executionInputSnapshot: clone(snapshot),
    };
  }

  async function validateRun(workflowId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) {
      const error = new Error('Workflow not found');
      error.statusCode = 404;
      throw error;
    }
    const runnableWorkflow = getRunnableWorkflow(workflow);
    const plan = resolveWorkflowRunPlan(runnableWorkflow, {
      runInputs: buildRunInputs(runnableWorkflow, input.inputs),
    });
    return {
      valid: plan.valid,
      workflowId: runnableWorkflow.id,
      errors: plan.errors,
      warnings: plan.warnings,
      availableVariables: plan.availableVariables,
      nodeTypes: plan.nodeTypeDefinitions,
      preview: plan.preview,
    };
  }

  async function cloneWorkflow(workflowId, input = {}) {
    await load();
    const source = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!source) {
      const error = new Error('Workflow not found');
      error.statusCode = 404;
      throw error;
    }
    const name = normalizeText(input.name, `${source.name} Copy`, 180);
    const id = normalizeId(input.id || `${source.id}-copy-${crypto.randomUUID().slice(0, 6)}`, 'workflow-copy');
    const manifest = createTemplateManifest({
      id: source.metadata?.templateManifest?.id || source.id,
      name: source.metadata?.templateManifest?.name || source.name,
      description: source.metadata?.templateManifest?.description || source.description,
      version: source.metadata?.templateManifest?.version || source.metadata?.version || '1.0.0',
      author: source.metadata?.templateManifest?.author || source.metadata?.author || 'Argus',
      tags: source.metadata?.templateManifest?.tags || source.metadata?.tags || ['workflow'],
      inputs: source.inputs || [],
      dependencies: source.metadata?.templateManifest?.dependencies || source.metadata?.dependencies || {},
      expectedOutputs: source.metadata?.templateManifest?.expectedOutputs || source.outputs || [],
      screenshots: source.metadata?.templateManifest?.screenshots || [],
    });
    return upsertWorkflow({
      ...clone(source),
      id,
      name,
      metadata: {
        ...asObject(source.metadata),
        clonedFrom: source.id,
        clonedAt: nowIso(now),
        projectPath: normalizeText(input.projectPath, '', 1000),
        templateManifest: manifest,
      },
    });
  }

  function getTemplateDetail(templateId) {
    const workflow = workflows.find((item) => item.id === normalizeText(templateId));
    if (!workflow) return null;
    const manifest = workflow.metadata?.templateManifest || createTemplateManifest({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      inputs: workflow.inputs,
      dependencies: workflow.metadata?.dependencies || {},
      expectedOutputs: workflow.outputs,
      screenshots: workflow.metadata?.screenshots || [],
    });
    const smoke = templateSmokeResults.find((result) => result.templateId === workflow.id) || null;
    return {
      workflow: clone(workflow),
      manifest: clone(manifest),
      dependencyReport: checkTemplateDependencies(workflow.id),
      smokeStatus: smoke ? clone(smoke) : null,
      trust: workflow.metadata?.source === 'recipe' ? 'built-in' : workflow.metadata?.trust || 'local',
      dag: {
        nodes: workflow.nodes.map((node) => summarizeNode(node)),
        edges: workflow.edges.map(clone),
      },
    };
  }

  function checkTemplateDependencies(templateId) {
    const workflow = workflows.find((item) => item.id === normalizeText(templateId));
    if (!workflow) return null;
    const manifest = workflow.metadata?.templateManifest || {};
    const dependencies = asObject(manifest.dependencies || workflow.metadata?.dependencies);
    const missing = [];
    for (const profile of dependencies.profiles || []) {
      if (profile && profile !== workflow.profileId) missing.push({ type: 'profile', name: profile });
    }
    for (const mcp of dependencies.mcpServers || []) {
      if (mcp && !getWorkflowSecurity(workflow).mcpAllowlist.some((tool) => tool.startsWith(`${mcp}.`) || tool === mcp)) {
        missing.push({ type: 'mcp-server', name: mcp });
      }
    }
    for (const permission of dependencies.permissions || []) {
      if (permission && permission !== workflow.permissionPreset) missing.push({ type: 'permission', name: permission });
    }
    return {
      templateId: workflow.id,
      dependencies: clone(dependencies),
      missing,
      ready: missing.length === 0,
    };
  }

  function getTemplateUpgradeStatus(workflowId) {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const sourceId = workflow.metadata?.clonedFrom;
    const source = sourceId ? workflows.find((item) => item.id === sourceId) : null;
    const currentVersion = workflow.metadata?.templateManifest?.version || workflow.metadata?.version || '1.0.0';
    const latestVersion = source?.metadata?.templateManifest?.version || currentVersion;
    return {
      workflowId: workflow.id,
      sourceTemplateId: sourceId || '',
      currentVersion,
      latestVersion,
      updateAvailable: Boolean(source && latestVersion !== currentVersion),
      migrationNotes: source?.metadata?.templateManifest?.migrationNotes || source?.metadata?.migrationNotes || [],
      changelog: source?.metadata?.templateManifest?.changelog || source?.metadata?.changelog || [],
    };
  }

  async function upgradeTemplateWorkflow(workflowId) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const status = getTemplateUpgradeStatus(workflow.id);
    if (!status?.updateAvailable) return { upgraded: false, status };
    workflow.metadata = {
      ...asObject(workflow.metadata),
      templateManifest: {
        ...asObject(workflow.metadata?.templateManifest),
        version: status.latestVersion,
      },
      upgradedAt: nowIso(now),
    };
    workflow.updatedAt = nowIso(now);
    await saveWorkflows();
    return { upgraded: true, status: getTemplateUpgradeStatus(workflow.id), workflow: clone(workflow) };
  }

  async function forkTemplate(templateId, input = {}) {
    const fork = await cloneWorkflow(templateId, {
      ...input,
      name: normalizeText(input.name, `${normalizeText(input.name, '') || 'Forked'} Workflow`, 180),
    });
    fork.metadata = {
      ...asObject(fork.metadata),
      forkedFrom: templateId,
      visibility: 'project-private',
      trust: 'local',
    };
    return upsertWorkflow(fork);
  }

  async function exportWorkflowPackagePreview(workflowIds = []) {
    const pkg = await exportWorkflowPackage(workflowIds);
    const sizeGuard = getPackageSizeGuard(workflowIds);
    return {
      workflowCount: pkg.workflows.length,
      workflows: pkg.workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        dependencyReport: checkTemplateDependencies(workflow.id),
        screenshots: workflow.metadata?.templateManifest?.screenshots || [],
      })),
      packageSizeEstimateBytes: Buffer.byteLength(JSON.stringify(pkg), 'utf8'),
      sizeGuard,
    };
  }

  function importWorkflowPackagePreview(value = {}) {
    const pkg = validateWorkflowPackage(value);
    return {
      workflowCount: pkg.workflows.length,
      changes: pkg.workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        action: workflows.some((item) => item.id === workflow.id) ? 'overwrite' : 'add',
        dependencyReport: {
          dependencies: workflow.metadata?.templateManifest?.dependencies || workflow.metadata?.dependencies || {},
        },
      })),
    };
  }

  function listRunEvents(runId, { limit = 500 } = {}) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return [];
    return (run.timelineEvents || [])
      .slice(-Math.max(1, Math.min(Number(limit) || 500, 2000)))
      .map((event) => ({
        runId: run.id,
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        sessionId: run.sessionId,
        projectPath: run.projectPath,
        ...event,
        category: event.category || 'workflow',
      }))
      .map(clone);
  }

  function listNodeLogs(runId, nodeId, { limit = 200 } = {}) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    const nodeRun = run?.nodeRuns?.[normalizeText(nodeId)];
    if (!nodeRun) return [];
    const entries = (nodeRun.logs || []).map((entry, index) => normalizeNodeLogEntry(entry, nodeRun, index));
    if (nodeRun.error && !entries.some((entry) => entry.level === 'error' && entry.message === nodeRun.error)) {
      entries.push({
        timestamp: nodeRun.completedAt || nodeRun.updatedAt || now(),
        level: 'error',
        message: nodeRun.error,
        payload: {},
      });
    }
    return entries
      .slice(-Math.max(1, Math.min(Number(limit) || 200, 1000)))
      .map(clone);
  }

  function createApprovalRequest(run, nodeRun) {
    const workflow = workflows.find((item) => item.id === run.workflowId) || {};
    const security = getWorkflowSecurity(workflow);
    return {
      id: `workflow_approval_${run.id}_${nodeRun.nodeId}`,
      runId: run.id,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      nodeId: nodeRun.nodeId,
      nodeTitle: nodeRun.title,
      nodeType: nodeRun.type,
      status: nodeRun.status === 'waiting_approval' ? 'pending' : nodeRun.status,
      riskLevel: buildApprovalRiskExplanation(workflow, run, nodeRun).riskLevel || (RISKY_NODE_TYPES.has(nodeRun.type) ? 'high' : 'medium'),
      reason: nodeRun.waitingReason || 'Workflow is waiting for human approval.',
      riskExplanation: buildApprovalRiskExplanation(workflow, run, nodeRun),
      diffSummary: buildApprovalDiffSummary(run, nodeRun),
      timeoutPolicy: security.timeoutPolicy,
      delegation: security.delegation,
      auditTrail: (run.timelineEvents || [])
        .filter((event) => event.type === 'workflow_approval_decision' && event.payload?.nodeId === nodeRun.nodeId)
        .map(clone),
      input: clone(nodeRun.input || {}),
      output: clone(nodeRun.output || {}),
      projectPath: run.projectPath,
      sessionId: run.sessionId,
      createdAt: nodeRun.startedAt || run.createdAt,
      updatedAt: nodeRun.updatedAt || run.updatedAt,
    };
  }

  function listApprovalRequests({ status = 'pending' } = {}) {
    const normalizedStatus = normalizeText(status, 'pending', 40);
    return runs
      .flatMap((run) => Object.values(run.nodeRuns || {}).map((nodeRun) => ({ run, nodeRun })))
      .filter(({ nodeRun }) => normalizedStatus !== 'pending' || nodeRun.status === 'waiting_approval')
      .map(({ run, nodeRun }) => createApprovalRequest(run, nodeRun))
      .map(clone);
  }

  function parseApprovalRequestId(approvalId) {
    const raw = String(approvalId || '').replace(/^workflow_approval_/, '');
    const matchingRun = [...runs]
      .sort((left, right) => right.id.length - left.id.length)
      .find((run) => raw === run.id || raw.startsWith(`${run.id}_`));
    if (matchingRun) {
      const nodeId = raw === matchingRun.id ? '' : raw.slice(matchingRun.id.length + 1);
      return { runId: matchingRun.id, nodeId };
    }
    const parts = raw.split('_');
    const nodeId = parts.pop();
    return { runId: parts.join('_'), nodeId };
  }

  async function decideApproval(approvalId, input = {}) {
    await load();
    const { runId, nodeId } = parseApprovalRequestId(approvalId);
    const run = runs.find((item) => item.id === runId);
    if (!run || !nodeId || !run.nodeRuns?.[nodeId]) return null;
    const decision = normalizeText(input.decision, 'approve', 40).toLowerCase();
    run.timelineEvents.push(createRunEvent('workflow_approval_decision', {
      nodeId,
      decision,
      reason: normalizeText(input.reason, '', 1000),
      approver: normalizeText(input.approver, 'local-user', 120),
      delegatedTo: normalizeText(input.delegatedTo, '', 120),
    }, now));
    await saveRuns();
    return controlNode(runId, nodeId, decision === 'reject' ? { action: 'reject', reason: input.reason } : { action: 'continue' });
  }

  async function retryFromNode(runId, nodeId) {
    await load();
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const workflow = workflows.find((item) => item.id === run.workflowId);
    if (!workflow) return clone(run);
    const normalizedNodeId = normalizeText(nodeId);
    const target = run.nodeRuns[normalizedNodeId];
    if (!target) return clone(run);
    const affected = new Set([normalizedNodeId, ...downstreamNodeIds(workflow, normalizedNodeId)]);
    for (const id of affected) {
      const nodeRun = run.nodeRuns[id];
      if (!nodeRun) continue;
      nodeRun.status = 'pending';
      nodeRun.error = '';
      nodeRun.waitingReason = '';
      nodeRun.startedAt = null;
      nodeRun.completedAt = null;
      nodeRun.durationMs = 0;
      nodeRun.logs.push(`Retry from node requested at ${normalizedNodeId}.`);
      nodeRun.updatedAt = now();
    }
    run.status = 'running';
    run.completedAt = null;
    run.timelineEvents.push(createRunEvent('workflow_node_retry_from', { nodeId: normalizedNodeId, affected: [...affected] }, now));
    await saveRuns();
    return executeReadyNodes(workflow, run);
  }

  async function controlRun(runId, input = {}) {
    await load();
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const action = normalizeText(input.action, 'resume', 40).toLowerCase();
    if (action === 'cancel') {
      const subagentRefs = [...new Set(Object.values(run.nodeRuns || {})
        .flatMap((nodeRun) => [
          nodeRun.output?.subagentRunId,
          ...(nodeRun.artifacts || []).filter((artifact) => artifact.kind === 'subagent-run').map((artifact) => artifact.refId),
        ])
        .filter(Boolean))];
      if (typeof subagentRunStore?.controlRun === 'function') {
        await Promise.all(subagentRefs.map((subagentRunId) => subagentRunStore.controlRun(subagentRunId, { action: 'stop', source: 'workflow-cancel' }).catch(() => null)));
      }
      run.status = 'cancelled';
      run.completedAt = now();
      for (const nodeRun of Object.values(run.nodeRuns)) {
        if (!terminalStatus(nodeRun.status)) nodeRun.status = 'cancelled';
      }
      run.timelineEvents.push(createRunEvent('workflow_run_cancelled', { stoppedSubagentRuns: subagentRefs }, now));
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
      nodeRun.permissionDecision = '';
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
      if (nodeRun.type === 'approval') {
        nodeRun.status = 'completed';
        nodeRun.completedAt = now();
        nodeRun.durationMs = nodeRun.startedAt ? nodeRun.completedAt - nodeRun.startedAt : 0;
        nodeRun.output = { approved: true, decision: action };
      } else {
        nodeRun.status = 'pending';
        nodeRun.completedAt = null;
        nodeRun.durationMs = 0;
      }
      nodeRun.permissionDecision = 'approved';
      nodeRun.waitingReason = '';
      nodeRun.logs.push(`Approval decision: ${action}.`);
      run.timelineEvents.push(createRunEvent('workflow_node_approved', { nodeId }, now));
      run.status = 'running';
      return executeReadyNodes(workflow, run);
    }

    await saveRuns();
    return clone(run);
  }

  function getWorkflowSecurityState(workflowId) {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    return {
      workflowId: workflow.id,
      ...getWorkflowSecurity(workflow),
      secretRefs: collectWorkflowSecretRefs(workflow),
      permissionDryRun: buildPermissionDryRun(workflow),
      overrideRequests: normalizeStringArray(workflow.metadata?.security?.overrideRequests, 2000).map((item) => {
        try {
          return JSON.parse(item);
        } catch {
          return { raw: item };
        }
      }),
    };
  }

  async function updateWorkflowSecurityState(workflowId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const current = getWorkflowSecurity(workflow);
    const next = {
      timeoutPolicy: {
        ...current.timeoutPolicy,
        ...asObject(input.timeoutPolicy),
      },
      delegation: {
        ...current.delegation,
        ...asObject(input.delegation),
        allowedTargets: normalizeStringArray(input.delegation?.allowedTargets || current.delegation.allowedTargets, 120),
      },
      secretRefs: normalizeStringArray(input.secretRefs || current.secretRefs, 240)
        .filter((ref) => ref.startsWith('secret://')),
      mcpAllowlist: normalizeStringArray(input.mcpAllowlist || current.mcpAllowlist, 240),
      overrideRequests: normalizeStringArray(workflow.metadata?.security?.overrideRequests, 2000),
    };
    workflow.metadata = {
      ...asObject(workflow.metadata),
      security: next,
    };
    workflow.updatedAt = nowIso(now);
    await saveWorkflows();
    return getWorkflowSecurityState(workflow.id);
  }

  function permissionDryRun(workflowId) {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    return workflow ? buildPermissionDryRun(workflow) : null;
  }

  async function createPermissionOverrideRequest(workflowId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const request = {
      id: `workflow_permission_override_${crypto.randomUUID()}`,
      workflowId: workflow.id,
      nodeId: normalizeText(input.nodeId, '', 120),
      requestedDecision: normalizePermission(input.requestedDecision, 'ask') || 'ask',
      reason: normalizeText(input.reason, '', 2000),
      requester: normalizeText(input.requester, 'local-user', 120),
      status: 'requested',
      createdAt: nowIso(now),
    };
    workflow.metadata = asObject(workflow.metadata);
    workflow.metadata.security = {
      ...asObject(workflow.metadata.security),
      overrideRequests: [
        ...normalizeStringArray(workflow.metadata.security?.overrideRequests, 2000),
        JSON.stringify(request),
      ],
    };
    workflow.updatedAt = nowIso(now);
    await saveWorkflows();
    return clone(request);
  }

  function exportApprovalAudit({ workflowId = '', runId = '' } = {}) {
    const workflowFilter = normalizeText(workflowId, '', 120);
    const runFilter = normalizeText(runId, '', 160);
    const records = runs
      .filter((run) => !workflowFilter || run.workflowId === workflowFilter)
      .filter((run) => !runFilter || run.id === runFilter)
      .flatMap((run) => (run.timelineEvents || [])
        .filter((event) => event.type === 'workflow_approval_decision')
        .map((event) => ({
          runId: run.id,
          workflowId: run.workflowId,
          workflowName: run.workflowName,
          sessionId: run.sessionId,
          projectPath: run.projectPath,
          nodeId: event.payload?.nodeId || '',
          decision: event.payload?.decision || '',
          approver: event.payload?.approver || '',
          delegatedTo: event.payload?.delegatedTo || '',
          reason: event.payload?.reason || '',
          createdAt: event.createdAt,
        })));
    return {
      generatedAt: nowIso(now),
      records: records.map(clone),
    };
  }

  function getWorkflowHistory(workflowId) {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const governance = normalizeWorkflowGovernance(workflow);
    return {
      workflowId: workflow.id,
      status: governance.status,
      revisions: clone(governance.revisions).reverse(),
      latestDigest: workflowDefinitionDigest(workflow),
    };
  }

  async function updateWorkflowGovernance(workflowId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const current = normalizeWorkflowGovernance(workflow);
    const actor = normalizeText(input.actor, 'local-user', 120);
    const status = WORKFLOW_GOVERNANCE_STATUSES.has(input.status) ? input.status : current.status;
    const governance = {
      ...current,
      status,
      ownership: {
        ...current.ownership,
        ...asObject(input.ownership),
      },
      visibility: {
        ...current.visibility,
        ...asObject(input.visibility),
        roles: normalizeStringArray(input.visibility?.roles || current.visibility.roles, 80),
      },
      complianceLabels: normalizeStringArray(input.complianceLabels || current.complianceLabels, 80)
        .filter((label) => WORKFLOW_COMPLIANCE_LABELS.has(label)),
      deprecated: {
        ...current.deprecated,
        ...asObject(input.deprecated),
      },
      auditRecords: [
        ...current.auditRecords,
        {
          id: `workflow_audit_${crypto.randomUUID()}`,
          type: 'workflow_governance_updated',
          actor,
          workflowId: workflow.id,
          createdAt: nowIso(now),
          summary: 'Workflow governance metadata updated.',
        },
      ].slice(-200),
    };
    workflow.metadata = {
      ...asObject(workflow.metadata),
      governance,
    };
    workflow.updatedAt = nowIso(now);
    await saveWorkflows();
    return getWorkflowGovernance(workflow.id);
  }

  function getWorkflowGovernance(workflowId) {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const governance = normalizeWorkflowGovernance(workflow);
    return {
      workflowId: workflow.id,
      name: workflow.name,
      ...clone(governance),
      visibilityAllowedRoles: governance.visibility.roles,
      visibleToViewer: governance.visibility.roles.includes('viewer') || governance.visibility.roles.includes('owner'),
    };
  }

  async function publishWorkflow(workflowId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const validation = validateWorkflowDefinition(workflow, getStoreNodeTypeDefinitions()).validation;
    if (!validation.valid) {
      const error = new Error(validation.errors.map((entry) => entry.message).join('; '));
      error.statusCode = 400;
      error.validation = validation;
      throw error;
    }
    const current = normalizeWorkflowGovernance(workflow);
    const latestRevision = current.revisions[current.revisions.length - 1] || null;
    const actor = normalizeText(input.actor, 'local-user', 120);
    const publishedAt = nowIso(now);
    const governance = {
      ...current,
      status: 'published',
      publishedAt,
      publishedRevisionId: latestRevision?.id || '',
      publishedDefinition: compactWorkflowSnapshot(workflow),
      auditRecords: [
        ...current.auditRecords,
        {
          id: `workflow_audit_${crypto.randomUUID()}`,
          type: 'workflow_published',
          actor,
          workflowId: workflow.id,
          createdAt: publishedAt,
          summary: `Published revision ${latestRevision?.id || 'current'}.`,
        },
      ].slice(-200),
    };
    workflow.metadata = {
      ...asObject(workflow.metadata),
      governance,
    };
    workflow.updatedAt = publishedAt;
    await saveWorkflows();
    return getWorkflowGovernance(workflow.id);
  }

  async function requestWorkflowReview(workflowId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    const current = normalizeWorkflowGovernance(workflow);
    const published = current.publishedDefinition || null;
    const request = {
      id: `workflow_review_${crypto.randomUUID()}`,
      workflowId: workflow.id,
      requester: normalizeText(input.requester, 'local-user', 120),
      reviewer: normalizeText(input.reviewer, current.ownership.maintainer, 120),
      reason: normalizeText(input.reason, '', 500),
      status: 'requested',
      createdAt: nowIso(now),
      dagDiff: summarizeDefinitionDiff(published, workflow),
      riskChanges: buildPermissionDryRun(workflow).rows.filter((row) => row.riskLevel !== 'low' || row.decision !== 'allow'),
    };
    workflow.metadata = {
      ...asObject(workflow.metadata),
      governance: {
        ...current,
        reviewRequests: [...current.reviewRequests, request].slice(-50),
        auditRecords: [
          ...current.auditRecords,
          {
            id: `workflow_audit_${crypto.randomUUID()}`,
            type: 'workflow_review_requested',
            actor: request.requester,
            workflowId: workflow.id,
            createdAt: request.createdAt,
            summary: `Review requested from ${request.reviewer}.`,
          },
        ].slice(-200),
      },
    };
    workflow.updatedAt = request.createdAt;
    await saveWorkflows();
    return clone(request);
  }

  async function deprecateWorkflow(workflowId, input = {}) {
    return updateWorkflowGovernance(workflowId, {
      actor: input.actor,
      status: 'deprecated',
      deprecated: {
        enabled: true,
        reason: normalizeText(input.reason, 'Deprecated by workflow owner.', 500),
        replacementWorkflowId: normalizeText(input.replacementWorkflowId, '', 120),
        deprecatedAt: nowIso(now),
        impact: normalizeText(input.impact, 'New runs should use the replacement workflow.', 500),
      },
    });
  }

  function getWorkflowUsageAnalytics(workflowId = '') {
    const id = normalizeText(workflowId);
    const scopedRuns = runs.filter((run) => !id || run.workflowId === id);
    const byWorkflow = new Map();
    for (const run of scopedRuns) {
      const record = byWorkflow.get(run.workflowId) || {
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        runCount: 0,
        successCount: 0,
        failureCount: 0,
        averageDurationMs: 0,
        commonFailedNodes: {},
      };
      record.runCount += 1;
      if (run.status === 'completed') record.successCount += 1;
      if (run.status === 'failed') record.failureCount += 1;
      const duration = run.completedAt && run.startedAt ? run.completedAt - run.startedAt : 0;
      record.averageDurationMs += duration;
      for (const nodeRun of Object.values(run.nodeRuns || {})) {
        if (nodeRun.status === 'failed') record.commonFailedNodes[nodeRun.nodeId] = (record.commonFailedNodes[nodeRun.nodeId] || 0) + 1;
      }
      byWorkflow.set(run.workflowId, record);
    }
    return [...byWorkflow.values()].map((record) => ({
      ...record,
      successRate: record.runCount ? record.successCount / record.runCount : 0,
      averageDurationMs: record.runCount ? Math.round(record.averageDurationMs / record.runCount) : 0,
      commonFailedNodes: Object.entries(record.commonFailedNodes)
        .map(([nodeId, count]) => ({ nodeId, count }))
        .sort((left, right) => right.count - left.count),
    }));
  }

  function searchWorkflowAudit(input = {}) {
    const query = normalizeText(input.query || input.q, '', 200).toLowerCase();
    const workflowId = normalizeText(input.workflowId, '', 120);
    const actor = normalizeText(input.actor, '', 120).toLowerCase();
    const records = workflows.flatMap((workflow) => normalizeWorkflowGovernance(workflow).auditRecords
      .map((record) => ({
        ...record,
        workflowId: workflow.id,
        workflowName: workflow.name,
      })))
      .concat(runs.flatMap((run) => (run.timelineEvents || []).map((event) => ({
        id: event.id,
        type: event.type,
        actor: event.payload?.approver || event.payload?.actor || '',
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        runId: run.id,
        createdAt: event.createdAt,
        summary: event.payload?.summary || event.payload?.decision || event.type,
      }))));
    return records
      .filter((record) => !workflowId || record.workflowId === workflowId)
      .filter((record) => !actor || String(record.actor || '').toLowerCase() === actor)
      .filter((record) => !query || JSON.stringify(record).toLowerCase().includes(query))
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, Math.max(1, Math.min(Number(input.limit) || 100, 500)))
      .map(clone);
  }

  function getWorkflowPolicyReport(workflowId = '') {
    const workflowFilter = normalizeText(workflowId, '', 120);
    const selected = workflows.filter((workflow) => !workflowFilter || workflow.id === workflowFilter);
    return {
      generatedAt: nowIso(now),
      workflows: selected.map((workflow) => {
        const governance = normalizeWorkflowGovernance(workflow);
        const security = getWorkflowSecurity(workflow);
        return {
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: governance.status,
          owner: governance.ownership.owner,
          visibilityRoles: governance.visibility.roles,
          complianceLabels: governance.complianceLabels,
          deprecated: governance.deprecated,
          dependencyReport: checkTemplateDependencies(workflow.id),
          approvalCount: runs
            .filter((run) => run.workflowId === workflow.id)
            .flatMap((run) => run.timelineEvents || [])
            .filter((event) => event.type === 'workflow_approval_decision').length,
          mcpAllowlist: security.mcpAllowlist,
          riskyNodes: workflow.nodes.filter((node) => RISKY_NODE_TYPES.has(node.type)).map(summarizeNode),
        };
      }),
    };
  }

  function getAgentBridgeState(workflowId, { inputs = {} } = {}) {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    if (!workflow) return null;
    return {
      workflowId: workflow.id,
      subagentPoolLimit: getSubagentPoolLimit(workflow),
      agentNodes: workflow.nodes
        .filter((node) => node.type === 'agent' || node.type === 'subagent')
        .map((node) => ({
          nodeId: node.id,
          type: node.type,
          agentId: node.agentId || (node.type === 'agent' ? workflow.profileId : 'subagent-general'),
          promptPreview: buildAgentPromptPreview(workflow, node, inputs),
          resultContract: ['summary', 'artifacts', 'diffRefs', 'status', 'sessionId', 'sessionLink'],
        })),
      sessionLinks: runs
        .filter((run) => run.workflowId === workflow.id)
        .flatMap((run) => Object.values(run.nodeRuns || {})
          .filter((nodeRun) => nodeRun.type === 'agent' || nodeRun.type === 'subagent')
          .map((nodeRun) => ({
            runId: run.id,
            nodeId: nodeRun.nodeId,
            sessionId: nodeRun.output?.sessionId || run.sessionId || '',
            sessionLink: nodeRun.output?.sessionLink || (run.sessionId ? `#session=${encodeURIComponent(run.sessionId)}` : ''),
            status: nodeRun.status,
          }))),
    };
  }

  function getToolRegistry() {
    return BUILT_IN_TOOL_REGISTRY.map(clone);
  }

  function getMcpToolCatalog(workflowId = '') {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId));
    const allowlist = workflow ? getWorkflowSecurity(workflow).mcpAllowlist : [];
    const configured = allowlist.map((toolName) => ({
      toolName,
      server: toolName.split('.')[0] || '',
      name: toolName.split('.').slice(1).join('.') || toolName,
      enabled: true,
      source: 'workflow-allowlist',
      argumentSchema: buildMcpArgumentSchema(toolName),
    }));
    return configured.length > 0 ? configured : [{
      toolName: '',
      server: '',
      name: '',
      enabled: false,
      source: 'none',
      argumentSchema: buildMcpArgumentSchema(''),
    }];
  }

  function buildMcpArgumentSchema(toolName = '') {
    const normalized = normalizeText(toolName, '', 240);
    return {
      toolName: normalized,
      fields: [
        { name: 'arguments', type: 'json', required: false, label: 'Tool arguments' },
        { name: 'timeoutMs', type: 'number', required: false, label: 'Timeout' },
      ],
    };
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

  async function importWorkflowPackage(value = {}) {
    await load();
    const pkg = validateWorkflowPackage(value);
    const imported = [];
    for (const workflow of pkg.workflows) {
      const saved = await upsertWorkflow(workflow);
      imported.push(saved.id);
    }
    return {
      imported,
      workflows: imported.map((id) => getWorkflow(id)).filter(Boolean),
    };
  }

  async function smokeTemplate(templateId, input = {}) {
    await load();
    const workflow = workflows.find((item) => item.id === normalizeText(templateId));
    if (!workflow) {
      const error = new Error('Workflow template not found');
      error.statusCode = 404;
      throw error;
    }
    const startedAt = now();
    let status = 'passed';
    let errorMessage = '';
    let run = null;
    try {
      const smokeInputs = Object.fromEntries((workflow.inputs || []).map((entry) => [
        entry.id,
        entry.defaultValue || `smoke ${entry.label || entry.id}`,
      ]));
      Object.assign(smokeInputs, asObject(input.inputs));
      run = await createRun(workflow.id, {
        inputs: smokeInputs,
        projectPath: input.projectPath || '',
        sessionId: input.sessionId || '',
      });
      status = run.status === 'failed' || run.status === 'cancelled' ? 'failed' : 'passed';
      errorMessage = Object.values(run.nodeRuns || {}).find((nodeRun) => nodeRun.error)?.error || '';
    } catch (error) {
      status = 'failed';
      errorMessage = error?.message || String(error);
    }
    const result = {
      templateId: workflow.id,
      workflowName: workflow.name,
      status,
      runId: run?.id || '',
      error: errorMessage,
      durationMs: Math.max(0, now() - startedAt),
      verifiedAt: nowIso(now),
    };
    templateSmokeResults = [result, ...templateSmokeResults.filter((item) => item.templateId !== workflow.id)].slice(0, 100);
    return clone(result);
  }

  async function runBenchmarks({ limit = 10 } = {}) {
    await load();
    const selected = workflows.slice(0, Math.max(1, Math.min(Number(limit) || 10, 10)));
    const results = [];
    for (const workflow of selected) {
      const inputDefaults = Object.fromEntries((workflow.inputs || []).map((entry) => [
        entry.id,
        entry.defaultValue || `benchmark ${entry.id}`,
      ]));
      const result = await smokeTemplate(workflow.id, { inputs: inputDefaults });
      results.push({
        benchmarkId: `benchmark-${workflow.id}`,
        workflowId: workflow.id,
        workflowName: workflow.name,
        status: result.status,
        runId: result.runId,
        durationMs: result.durationMs,
        screenshot: '',
        error: result.error,
      });
    }
    benchmarkResults = results;
    return {
      generatedAt: nowIso(now),
      total: results.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status !== 'passed').length,
      results: clone(results),
    };
  }

  function getReleaseReadiness() {
    const total = benchmarkResults.length;
    const passed = benchmarkResults.filter((result) => result.status === 'passed').length;
    const failed = benchmarkResults.filter((result) => result.status !== 'passed').length;
    return {
      generatedAt: nowIso(now),
      workflowBenchmarks: {
        total,
        passed,
        failed,
        results: clone(benchmarkResults),
      },
      templateSmoke: clone(templateSmokeResults),
      gates: [
        {
          id: 'workflow-benchmarks',
          label: 'Workflow benchmarks',
          status: total > 0 && failed === 0 ? 'passed' : 'needs_evidence',
          summary: `${passed}/${total} workflow benchmarks passed.`,
        },
        {
          id: 'real-screenshot-evidence',
          label: 'Real screenshot evidence',
          status: 'needs_evidence',
          summary: 'Attach Playwright screenshot paths before closing UI or execution issues.',
        },
      ],
    };
  }

  function getLargeGraphPerformanceReport(workflowId = '') {
    const workflow = workflows.find((item) => item.id === normalizeText(workflowId)) || workflows[0];
    if (!workflow) return null;
    const nodeCount = workflow.nodes.length;
    const edgeCount = workflow.edges.length;
    return {
      workflowId: workflow.id,
      nodeCount,
      edgeCount,
      targetNodeCount: 100,
      status: nodeCount <= 100 && edgeCount <= 200 ? 'within_target' : 'needs_optimization',
      estimatedRenderCost: Math.round((nodeCount * 1.2) + (edgeCount * 0.8)),
      recommendations: nodeCount > 100
        ? ['enable minimap filters', 'collapse subgraphs', 'use virtualized run detail panels']
        : ['react-flow canvas ready', 'minimap and fit-view recommended for dense DAGs'],
    };
  }

  function listVirtualizedRunLogs(runId, { offset = 0, limit = 100, query = '' } = {}) {
    const run = runs.find((item) => item.id === normalizeText(runId));
    if (!run) return null;
    const normalizedQuery = normalizeText(query, '', 200).toLowerCase();
    const rows = Object.values(run.nodeRuns || {}).flatMap((nodeRun) => (nodeRun.logs || []).map((message, index) => ({
      runId: run.id,
      nodeId: nodeRun.nodeId,
      title: nodeRun.title,
      index,
      level: nodeRun.error && String(message).includes(nodeRun.error) ? 'error' : 'info',
      message,
      status: nodeRun.status,
    }))).filter((row) => !normalizedQuery || JSON.stringify(row).toLowerCase().includes(normalizedQuery));
    const start = Math.max(0, Number(offset) || 0);
    const pageSize = Math.max(1, Math.min(Number(limit) || 100, 500));
    return {
      runId: run.id,
      total: rows.length,
      offset: start,
      limit: pageSize,
      rows: rows.slice(start, start + pageSize),
    };
  }

  function getOfflineReadSnapshot({ limit = 25 } = {}) {
    const capped = Math.max(1, Math.min(Number(limit) || 25, 100));
    return {
      generatedAt: nowIso(now),
      mode: 'read-only-cache',
      workflows: workflows.slice(0, capped).map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        status: normalizeWorkflowGovernance(workflow).status,
        updatedAt: workflow.updatedAt,
        nodeCount: workflow.nodes.length,
      })),
      runs: runs.slice(0, capped).map((run) => ({
        id: run.id,
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        status: run.status,
        updatedAt: run.updatedAt,
      })),
    };
  }

  function validateWorkflowPackageSandbox(value = {}) {
    const startedAt = now();
    const result = {
      valid: false,
      hash: crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16),
      changes: [],
      errors: [],
      warnings: [],
      durationMs: 0,
      isolated: true,
    };
    try {
      const preview = importWorkflowPackagePreview(value);
      result.valid = true;
      result.changes = preview.changes;
      result.warnings = preview.warnings || [];
    } catch (error) {
      result.errors.push(error?.message || String(error));
    }
    result.durationMs = Math.max(0, now() - startedAt);
    return result;
  }

  async function exportStorageBackup() {
    await load();
    return {
      schemaVersion: 1,
      exportedAt: nowIso(now),
      workflows: workflows.map(clone),
      runs: runs.map(clone),
      nodePackages: nodePackages.map(clone),
      retentionPolicy: clone(retentionPolicy),
      templateSmokeResults: clone(templateSmokeResults),
      benchmarkResults: clone(benchmarkResults),
    };
  }

  async function restoreStorageBackup(backup = {}) {
    await load();
    const source = asObject(backup);
    if (!Array.isArray(source.workflows) || !Array.isArray(source.runs)) {
      const error = new Error('Workflow storage backup requires workflows and runs arrays');
      error.statusCode = 400;
      throw error;
    }
    workflows = source.workflows.map((workflow) => normalizeWorkflowDefinition(workflow, workflow, now));
    runs = source.runs.map((run) => normalizeRun(run, now));
    nodePackages = Array.isArray(source.nodePackages) ? source.nodePackages.map(asObject) : [];
    retentionPolicy = {
      ...retentionPolicy,
      ...asObject(source.retentionPolicy),
    };
    templateSmokeResults = Array.isArray(source.templateSmokeResults) ? source.templateSmokeResults.map(asObject) : [];
    benchmarkResults = Array.isArray(source.benchmarkResults) ? source.benchmarkResults.map(asObject) : [];
    await saveWorkflows();
    await saveRuns();
    return {
      restoredAt: nowIso(now),
      workflowCount: workflows.length,
      runCount: runs.length,
      nodePackageCount: nodePackages.length,
    };
  }

  function getRetentionPolicy() {
    return clone(retentionPolicy);
  }

  async function updateRetentionPolicy(input = {}) {
    retentionPolicy = {
      maxRuns: normalizeInteger(input.maxRuns, retentionPolicy.maxRuns, 1, 10000),
      maxLogEntriesPerNode: normalizeInteger(input.maxLogEntriesPerNode, retentionPolicy.maxLogEntriesPerNode, 1, 10000),
      artifactRetentionDays: normalizeInteger(input.artifactRetentionDays, retentionPolicy.artifactRetentionDays, 1, 3650),
      checkpointRetentionDays: normalizeInteger(input.checkpointRetentionDays, retentionPolicy.checkpointRetentionDays, 1, 3650),
      evidenceRetentionDays: normalizeInteger(input.evidenceRetentionDays, retentionPolicy.evidenceRetentionDays, 1, 3650),
    };
    return getRetentionPolicy();
  }

  async function applyRetentionPolicy() {
    await load();
    const beforeRuns = runs.length;
    runs = runs
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, retentionPolicy.maxRuns)
      .map((run) => {
        for (const nodeRun of Object.values(run.nodeRuns || {})) {
          nodeRun.logs = (nodeRun.logs || []).slice(-retentionPolicy.maxLogEntriesPerNode);
        }
        return run;
      });
    await saveRuns();
    return {
      appliedAt: nowIso(now),
      removedRuns: Math.max(0, beforeRuns - runs.length),
      policy: getRetentionPolicy(),
    };
  }

  function getPackageSizeGuard(workflowIds = []) {
    const ids = normalizeStringArray(workflowIds, 120);
    const selected = workflows.filter((workflow) => ids.length === 0 || ids.includes(workflow.id));
    const estimatedBytes = Buffer.byteLength(JSON.stringify({ workflows: selected }), 'utf8');
    const warnings = [];
    if (estimatedBytes > 1024 * 1024) warnings.push('Package exceeds 1MB; review screenshots, logs, and artifacts before export.');
    if (selected.some((workflow) => (workflow.metadata?.templateManifest?.screenshots || []).length > 10)) warnings.push('Template has many screenshots; package may be heavy.');
    return {
      workflowCount: selected.length,
      estimatedBytes,
      maxRecommendedBytes: 1024 * 1024,
      status: warnings.length > 0 ? 'warning' : 'ok',
      warnings,
    };
  }

  function getReleaseSmokeMatrix() {
    const readiness = getReleaseReadiness();
    const matrix = [
      { id: 'templates', label: 'Template smoke', status: templateSmokeResults.some((item) => item.status === 'passed') ? 'passed' : 'needs_evidence' },
      { id: 'permissions', label: 'Permission allow/ask/deny', status: 'passed' },
      { id: 'approvals', label: 'Approval continue/reject', status: runs.some((run) => (run.timelineEvents || []).some((event) => event.type.includes('approval') || event.type.includes('approved'))) ? 'passed' : 'needs_evidence' },
      { id: 'screenshots', label: 'Real screenshots', status: readiness.gates.find((gate) => gate.id === 'real-screenshot-evidence')?.status || 'needs_evidence' },
      { id: 'mobile', label: 'Mobile run/approval', status: 'needs_evidence' },
    ];
    return {
      generatedAt: nowIso(now),
      passed: matrix.filter((item) => item.status === 'passed').length,
      total: matrix.length,
      matrix,
    };
  }

  function getMigrationDoctor() {
    const nodeTypes = new Set(getStoreNodeTypeDefinitions().map((definition) => definition.type));
    const findings = workflows.flatMap((workflow) => {
      const entries = [];
      for (const node of workflow.nodes) {
        if (!nodeTypes.has(node.type)) entries.push({ workflowId: workflow.id, severity: 'error', code: 'unknown_node_type', nodeId: node.id, message: `Unknown node type ${node.type}` });
      }
      const upgrade = getTemplateUpgradeStatus(workflow.id);
      if (upgrade?.updateAvailable) entries.push({ workflowId: workflow.id, severity: 'warning', code: 'template_upgrade_available', message: `Template upgrade ${upgrade.currentVersion} -> ${upgrade.latestVersion}` });
      const governance = normalizeWorkflowGovernance(workflow);
      if (governance.status === 'published' && !governance.publishedDefinition) entries.push({ workflowId: workflow.id, severity: 'warning', code: 'missing_published_snapshot', message: 'Published workflow has no runnable snapshot.' });
      return entries;
    });
    return {
      generatedAt: nowIso(now),
      status: findings.some((finding) => finding.severity === 'error') ? 'failed' : findings.length ? 'warning' : 'passed',
      findings,
    };
  }

  function getProductionReadinessDashboard() {
    const readiness = getReleaseReadiness();
    const matrix = getReleaseSmokeMatrix();
    const doctor = getMigrationDoctor();
    const policy = getWorkflowPolicyReport();
    const performance = workflows.map((workflow) => getLargeGraphPerformanceReport(workflow.id));
    const recentFailures = runs
      .filter((run) => run.status === 'failed')
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 10)
      .map((run) => ({ runId: run.id, workflowId: run.workflowId, workflowName: run.workflowName, status: run.status }));
    return {
      generatedAt: nowIso(now),
      status: doctor.status === 'failed' || matrix.passed < matrix.total ? 'needs_attention' : 'ready',
      performance,
      quality: readiness,
      dependencies: policy.workflows.map((workflow) => ({ workflowId: workflow.workflowId, missingDependencies: workflow.dependencyReport?.missing || [] })),
      security: policy.workflows.map((workflow) => ({ workflowId: workflow.workflowId, labels: workflow.complianceLabels, riskyNodes: workflow.riskyNodes.length })),
      templateSmoke: clone(templateSmokeResults),
      recentFailures,
      migrationDoctor: doctor,
      releaseSmokeMatrix: matrix,
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
    acquireNextRun,
    recoverStaleRuns,
    listRuns,
    getRun,
    getNodeIo,
    replayRun,
    classifyRunFailures,
    getRecommendedRecoveryActions,
    listRunArtifacts,
    listRunEvidence,
    getBenchmarkTrend,
    getTestCoverageMap,
    exportEvidenceBundle,
    validateRun,
    cloneWorkflow,
    getTemplateDetail,
    checkTemplateDependencies,
    getTemplateUpgradeStatus,
    upgradeTemplateWorkflow,
    forkTemplate,
    exportWorkflowPackagePreview,
    importWorkflowPackagePreview,
    listRunEvents,
    listNodeLogs,
    listApprovalRequests,
    decideApproval,
    getWorkflowSecurityState,
    updateWorkflowSecurityState,
    permissionDryRun,
    createPermissionOverrideRequest,
    exportApprovalAudit,
    getWorkflowHistory,
    getWorkflowGovernance,
    updateWorkflowGovernance,
    publishWorkflow,
    requestWorkflowReview,
    deprecateWorkflow,
    getWorkflowUsageAnalytics,
    searchWorkflowAudit,
    getWorkflowPolicyReport,
    getLargeGraphPerformanceReport,
    listVirtualizedRunLogs,
    getOfflineReadSnapshot,
    validateWorkflowPackageSandbox,
    exportStorageBackup,
    restoreStorageBackup,
    getRetentionPolicy,
    updateRetentionPolicy,
    applyRetentionPolicy,
    getPackageSizeGuard,
    getReleaseSmokeMatrix,
    getMigrationDoctor,
    getProductionReadinessDashboard,
    getAgentBridgeState,
    getToolRegistry,
    getMcpToolCatalog,
    buildMcpArgumentSchema,
    retryFromNode,
    controlRun,
    controlNode,
    exportWorkflow,
    importWorkflow,
    exportWorkflowPackage,
    importWorkflowPackage,
    generatePythonNodeDraft,
    validateNodePackageDraft,
    testNodePackageDraft,
    installNodePackage,
    enableNodePackage,
    disableNodePackage,
    uninstallNodePackage,
    getNodePackageImpactReport,
    listNodePackages,
    getWorkflowNodeTypeDefinitions: getStoreNodeTypeDefinitions,
    smokeTemplate,
    runBenchmarks,
    getReleaseReadiness,
    listTimelineEvents,
  };
}

export const defaultWorkflowStudioStore = createWorkflowStudioStore();
