import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { expect, type Page, type Route, test } from '@playwright/test';

const screenshotDir = resolve(process.cwd(), 'output/playwright/screenshots');

test.use({ viewport: { width: 1920, height: 1080 } });

const project = {
  name: 'AIINWORK',
  displayName: 'AIINWORK',
  fullPath: 'E:\\AIINWORK',
  path: 'E:\\AIINWORK',
  sessions: [],
};

const workflow = {
  id: 'agent-review-delivery',
  name: 'Agent Review Delivery',
  description: 'Explore, approve, build, and collect an artifact.',
  profileId: 'build',
  permissionPreset: 'auto-edit',
  inputs: [{ id: 'change_request', label: 'Change request', type: 'textarea', required: true }],
  outputs: [{ id: 'summary', label: 'Summary', type: 'markdown' }],
  maxConcurrency: 4,
  nodes: [
    { id: 'explore', type: 'subagent', title: 'Explore Subagent', agentId: 'subagent-explore', prompt: 'Explore impact.', permission: '', position: { x: 80, y: 140 } },
    { id: 'approval', type: 'approval', title: 'Human Approval', prompt: 'Confirm before edits.', permission: '', position: { x: 360, y: 140 } },
    { id: 'artifact', type: 'artifact', title: 'Delivery Artifact', prompt: 'Collect summary.', permission: '', position: { x: 640, y: 140 } },
  ],
  edges: [
    { id: 'explore-approval', from: 'explore', to: 'approval', mode: 'success' },
    { id: 'approval-artifact', from: 'approval', to: 'artifact', mode: 'success' },
  ],
};

const waitingRun = {
  id: 'workflow-run-1',
  workflowId: workflow.id,
  workflowName: workflow.name,
  status: 'waiting_approval',
  createdAt: Date.now(),
  nodeRuns: {
    explore: { nodeId: 'explore', type: 'subagent', title: 'Explore Subagent', status: 'completed', attempt: 1, logs: ['Completed subagent node.'] },
    approval: { nodeId: 'approval', type: 'approval', title: 'Human Approval', status: 'waiting_approval', attempt: 1, waitingReason: 'Waiting for approval.', logs: ['Waiting for approval.'] },
    artifact: { nodeId: 'artifact', type: 'artifact', title: 'Delivery Artifact', status: 'pending', attempt: 0, logs: [] },
  },
  artifacts: [],
  timelineEvents: [],
};

const previewMatchedRun = {
  ...waitingRun,
  id: 'workflow-run-preview-matched',
  previewMatched: true,
  previewChanged: false,
  previewDiff: {
    matched: true,
    changed: false,
    reasons: [],
    changedNodes: [],
  },
};

const previewChangedRun = {
  ...waitingRun,
  id: 'workflow-run-preview-changed',
  previewMatched: false,
  previewChanged: true,
  previewDiff: {
    matched: false,
    changed: true,
    reasons: ['input_changed', 'node_input_changed'],
    changedNodes: [
      { nodeId: 'explore', fields: ['resolvedInput'], reasons: ['node_input_changed'] },
      { nodeId: 'approval', fields: ['permissionDecision'], reasons: ['permission_changed'] },
    ],
  },
};

const completedRun = {
  ...waitingRun,
  status: 'completed',
  nodeRuns: {
    ...waitingRun.nodeRuns,
    approval: { ...waitingRun.nodeRuns.approval, status: 'completed', waitingReason: '', logs: ['Approval decision: continue.'] },
    artifact: { ...waitingRun.nodeRuns.artifact, status: 'completed', attempt: 1, logs: ['Completed artifact node.'] },
  },
  artifacts: [{ id: 'artifact-1', kind: 'workflow-summary', title: 'Delivery Artifact' }],
};

const builtinNodeTypes = [
  { type: 'agent', label: 'Agent', description: 'Run a primary agent.', ui: { materialGroup: 'agents' }, configSchema: { fields: [] } },
  { type: 'subagent', label: 'Subagent', description: 'Run a subagent.', ui: { materialGroup: 'agents' }, configSchema: { fields: [] } },
  { type: 'mcp', label: 'MCP', description: 'Call MCP.', ui: { materialGroup: 'integrations' }, configSchema: { fields: [] } },
  { type: 'tool', label: 'Tool', description: 'Run a tool.', ui: { materialGroup: 'integrations' }, configSchema: { fields: [] } },
  { type: 'shell', label: 'Shell', description: 'Run shell.', ui: { materialGroup: 'execution' }, configSchema: { fields: [] } },
  { type: 'approval', label: 'Approval', description: 'Wait for approval.', ui: { materialGroup: 'execution' }, configSchema: { fields: [] } },
  { type: 'condition', label: 'Condition', description: 'Branch.', ui: { materialGroup: 'control' }, configSchema: { fields: [] } },
  { type: 'join', label: 'Join', description: 'Join branches.', ui: { materialGroup: 'control' }, configSchema: { fields: [] } },
  { type: 'artifact', label: 'Artifact', description: 'Create artifact.', ui: { materialGroup: 'outputs' }, configSchema: { fields: [] } },
];

const customPythonManifest = {
  manifestVersion: '1',
  id: 'python-format-node',
  type: 'python-format-node',
  label: 'Python Format Node',
  description: 'Formats text with a safe Python standard-library script.',
  language: 'python',
  dependencies: [],
  entrypoint: 'main.py',
  permissions: { risky: false, action: 'custom.python' },
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', title: 'Format mode', enum: ['upper', 'lower', 'title'], default: 'upper' },
    },
    required: [],
  },
  inputSchema: { type: 'object', properties: { text: { type: 'string', title: 'Text' } } },
  outputSchema: { type: 'object', properties: { result: { type: 'object', title: 'Result' }, status: { type: 'string', title: 'Status' } } },
  codeFiles: {
    'main.py': [
      'import json',
      'import sys',
      'payload = json.load(sys.stdin)',
      'text = str((payload.get("input") or {}).get("text") or "")',
      'mode = str((payload.get("config") or {}).get("mode") or "upper")',
      'result = text.upper() if mode == "upper" else text.lower()',
      'print(json.dumps({"summary": "formatted", "result": {"text": result}, "status": "completed"}))',
    ].join('\n'),
  },
  testCases: [{ id: 'formats-text', name: 'Formats text', input: { text: 'hello workflow' }, config: { mode: 'upper' } }],
};

const customPythonNodeType = {
  type: 'python-format-node',
  label: 'Python Format Node',
  description: 'Formats text with a safe Python standard-library script.',
  ui: { materialGroup: 'custom', schemaVersion: '1.0' },
  configSchema: {
    fields: [{ name: 'mode', label: 'Format mode', type: 'select', options: ['upper', 'lower', 'title'], defaultValue: 'upper' }],
  },
  outputSchema: { fields: [{ name: 'result', type: 'object', label: 'Result' }, { name: 'status', type: 'string', label: 'Status' }] },
};

const incompatibleCustomPythonManifest = {
  ...customPythonManifest,
  version: '2.0.0',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'number', title: 'Format mode' },
    },
    required: [],
  },
  outputSchema: { type: 'object', properties: { result: { type: 'object', title: 'Result' } } },
};

const installedPythonNodePackage = {
  id: customPythonManifest.id,
  enabled: true,
  status: 'ready',
  lifecycleState: 'enabled',
  state: 'enabled',
  manifest: customPythonManifest,
  definition: customPythonNodeType,
  dependencies: {},
  missingDependencies: [],
};

const customRun = {
  id: 'workflow-run-custom',
  workflowId: workflow.id,
  workflowName: workflow.name,
  status: 'completed',
  createdAt: Date.now(),
  nodeRuns: {
    explore: { nodeId: 'explore', type: 'subagent', title: 'Explore Subagent', status: 'completed', attempt: 1, logs: ['Completed subagent node.'] },
    'python-format-node-1': {
      nodeId: 'python-format-node-1',
      type: 'python-format-node',
      title: 'Python Format Node 1',
      status: 'completed',
      attempt: 1,
      logs: ['stdout: {"summary":"formatted","result":{"text":"HELLO WORKFLOW"},"status":"completed"}'],
      output: { summary: 'formatted', result: { text: 'HELLO WORKFLOW' }, status: 'completed' },
    },
  },
  artifacts: [{ id: 'python-output', kind: 'workflow-python-output', title: 'Python node output' }],
  timelineEvents: [],
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMockApi(page: Page, options: { emptyWorkflows?: boolean; previewConsistency?: 'matched' | 'changed'; withInstalledNodePackage?: boolean; incompatibleUpgrade?: boolean } = {}) {
  let runState = options.previewConsistency === 'matched'
    ? previewMatchedRun
    : options.previewConsistency === 'changed'
      ? previewChangedRun
      : waitingRun;
  let nodeTypes = options.withInstalledNodePackage ? [...builtinNodeTypes, customPythonNodeType] : [...builtinNodeTypes];
  let installedPackages: unknown[] = options.withInstalledNodePackage ? [installedPythonNodePackage] : [];

  await page.addInitScript(() => {
    localStorage.setItem('activeTab', 'workflows');
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/projects') return json(route, [project]);
    if (path.startsWith('/api/conversations')) return json(route, { project: { ...project, name: 'Conversations', sessions: [] } });
    if (path === '/api/workflows') return json(route, { success: true, workflows: options.emptyWorkflows ? [] : [workflow] });
    if (path === '/api/workflows/node-types') return json(route, { success: true, nodeTypes });
    if (path === `/api/workflows/${workflow.id}`) return json(route, { success: true, workflow });
    if (path === '/api/workflows/validate') return json(route, { success: true, workflow, validation: { valid: true, errors: [], warnings: [] } });
    if (path === `/api/workflows/${workflow.id}/runs`) return json(route, { success: true, run: runState }, 201);
    if (path === '/api/workflow-runs') return json(route, { success: true, runs: [runState] });
    if (path === `/api/workflow-runs/${waitingRun.id}/nodes/approval/control`) {
      runState = completedRun;
      return json(route, { success: true, run: runState });
    }
    if (path === '/api/agents') return json(route, {
      success: true,
      agents: [
        { id: 'build', name: 'Build', status: 'enabled', mode: 'primary' },
        { id: 'subagent-explore', name: 'Explore', status: 'enabled', mode: 'subagent' },
      ],
    });
    if (path === '/api/workflow-node-packages') return json(route, { success: true, packages: installedPackages });
    if (path === `/api/workflow-node-packages/${customPythonManifest.id}/impact`) {
      return json(route, {
        success: true,
        report: {
          packageId: customPythonManifest.id,
          exists: true,
          destructiveActionRisk: 'blocking',
          totals: { workflows: 1, templates: 1, recentRuns: 1 },
          affected: {
            workflows: [{ objectType: 'workflow', id: workflow.id, title: workflow.name, nodeIds: ['python-format-node-1'], severity: 'blocking' }],
            templates: [{ objectType: 'template', id: 'template-format', title: 'Format Template', nodeIds: ['python-format-node-1'], severity: 'blocking' }],
            recentRuns: [{ objectType: 'run', id: customRun.id, title: customRun.workflowName, workflowId: customRun.workflowId, nodeIds: ['python-format-node-1'], severity: 'warning' }],
          },
        },
      });
    }
    if (path === `/api/workflow-node-packages/${customPythonManifest.id}/disable`) {
      installedPackages = [{ ...installedPythonNodePackage, enabled: false, status: 'disabled', lifecycleState: 'disabled', state: 'disabled' }];
      nodeTypes = [...builtinNodeTypes];
      return json(route, { success: true, package: installedPackages[0] });
    }
    if (path === `/api/workflow-node-packages/${customPythonManifest.id}/enable`) {
      installedPackages = [installedPythonNodePackage];
      nodeTypes = [...builtinNodeTypes, customPythonNodeType];
      return json(route, { success: true, package: installedPackages[0] });
    }
    if (path === `/api/workflow-node-packages/${customPythonManifest.id}` && route.request().method() === 'DELETE') {
      installedPackages = [];
      nodeTypes = [...builtinNodeTypes];
      return json(route, { success: true, removed: true, packageId: customPythonManifest.id });
    }
    if (path === '/api/workflow-node-packages/generate-draft') {
      return json(route, { success: true, draft: { status: 'draft', prompt: 'Create formatter node', manifest: options.incompatibleUpgrade ? incompatibleCustomPythonManifest : customPythonManifest } }, 201);
    }
    if (path === '/api/workflow-node-packages/validate-draft') {
      return json(route, {
        success: true,
        validation: {
          valid: true,
          errors: [],
          warnings: [{ code: 'stage_one_standard_library_only', message: 'Stage one rejects undeclared third-party imports before install.' }],
        },
      });
    }
    if (path === '/api/workflow-node-packages/test-draft') {
      return json(route, {
        success: true,
        result: {
          ok: true,
          exitCode: 0,
          durationMs: 42,
          stdout: '{"summary":"formatted","result":{"text":"HELLO WORKFLOW"},"status":"completed"}',
          stderr: 'test stderr captured',
          parsedOutput: { summary: 'formatted', result: { text: 'HELLO WORKFLOW' }, status: 'completed' },
        },
      });
    }
    if (path === '/api/workflow-node-packages/install') {
      if (options.incompatibleUpgrade) {
        return json(route, {
          success: false,
          error: 'Workflow node package upgrade is incompatible',
          compatibility: {
            compatible: false,
            reasons: [
              { code: 'config_field_type_changed', field: 'mode', from: 'select', to: 'number', message: 'config field changed type: mode' },
              { code: 'output_field_removed', field: 'status', message: 'output field was removed: status' },
            ],
            warnings: [],
          },
        }, 409);
      }
      nodeTypes = [...builtinNodeTypes, customPythonNodeType];
      installedPackages = [{ id: customPythonManifest.id, enabled: true, status: 'ready', manifest: customPythonManifest, definition: customPythonNodeType }];
      runState = customRun;
      return json(route, { success: true, package: installedPackages[0] }, 201);
    }
    if (path === '/api/git/status') return json(route, { files: [] });
    if (path === '/api/artifacts') return json(route, { artifacts: [] });
    if (path === '/api/settings/notification-preferences') return json(route, { success: true, preferences: {} });
    if (path === '/api/commands/list') return json(route, { builtIn: [], custom: [] });
    return json(route, { success: true });
  });
}

async function screenshot(page: Page, name: string) {
  const path = resolve(screenshotDir, name);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  const file = await stat(path);
  expect(file.size).toBeGreaterThan(0);
}

test('REQ-049 captures Workflow Studio editor, runner, approval, and history @screenshot', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await expect(page.getByTestId('workflow-home-overview')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId('workflow-dag-canvas')).toBeVisible();
  await screenshot(page, 'REQ-049-workflow-editor.png');

  await page.getByTestId('workflow-run').click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByTestId('workflow-runs')).toBeVisible();
  await expect(page.getByTestId('workflow-runs').getByText('waiting_approval').first()).toBeVisible();
  await screenshot(page, 'REQ-049-workflow-runner-approval.png');

  await page.getByTestId('workflow-approve-node').click();
  await expect(page.getByTestId('workflow-runs').getByText('completed').first()).toBeVisible();
  await screenshot(page, 'REQ-049-workflow-history-completed.png');
});

test('REQ-210C captures preview matched Run Console state @screenshot', async ({ page }) => {
  await installMockApi(page, { previewConsistency: 'matched' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-preview-diff-panel')).toBeVisible();
  await expect(page.getByTestId('workflow-preview-consistency-chip')).toContainText('Matched');
  await expect(page.getByTestId('workflow-preview-diff-panel')).toContainText('reviewed dry-run snapshot matches');
  await screenshot(page, 'REQ-210C-preview-matched-run-console.png');
});

test('REQ-210C captures preview changed Run Console state @screenshot', async ({ page }) => {
  await installMockApi(page, { previewConsistency: 'changed' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-preview-diff-panel')).toBeVisible();
  await expect(page.getByTestId('workflow-preview-consistency-chip')).toContainText('Review diff');
  await expect(page.getByTestId('workflow-preview-diff-panel')).toContainText('input_changed');
  await expect(page.getByTestId('workflow-preview-diff-panel')).toContainText('explore');
  await screenshot(page, 'REQ-210C-preview-changed-run-console.png');
});

test('REQ-211C captures custom node Package Manager impact and lifecycle state @screenshot', async ({ page }) => {
  await installMockApi(page, { withInstalledNodePackage: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await page.getByTestId('workflow-generate-custom-node').first().click();
  await expect(page.getByTestId('workflow-node-package-manager')).toBeVisible();
  await expect(page.getByTestId('workflow-node-package-state')).toContainText('enabled / ready');
  await page.getByRole('button', { name: 'Impact' }).click();
  await expect(page.getByTestId('workflow-node-package-impact-report')).toContainText('Workflows 1');
  await screenshot(page, 'REQ-211C-package-manager-impact.png');
  await page.getByTestId('workflow-node-package-disable').click();
  await expect(page.getByTestId('workflow-node-package-state')).toContainText('disabled / disabled');
  await screenshot(page, 'REQ-211C-package-manager-disabled.png');
});

test('REQ-211D captures package lifecycle and incompatible upgrade evidence @screenshot', async ({ page }) => {
  await installMockApi(page, { withInstalledNodePackage: true, incompatibleUpgrade: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await page.getByTestId('workflow-generate-custom-node').first().click();
  await expect(page.getByTestId('workflow-node-package-manager')).toBeVisible();
  await expect(page.getByTestId('workflow-node-package-state')).toContainText('enabled / ready');
  await page.getByRole('button', { name: 'Impact' }).click();
  await expect(page.getByTestId('workflow-node-package-impact-report')).toContainText('Workflows 1');
  await screenshot(page, 'REQ-211D-impact-report.png');
  await page.getByTestId('workflow-node-package-disable').click();
  await expect(page.getByTestId('workflow-node-package-state')).toContainText('disabled / disabled');
  await screenshot(page, 'REQ-211D-disabled-state.png');
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await expect(page.getByTestId('workflow-ai-node-draft-review')).toBeVisible();
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByTestId('workflow-python-node-test-result')).toContainText('Passed');
  await page.getByRole('button', { name: 'Install node' }).click();
  await expect(page.getByTestId('workflow-node-package-upgrade-warning')).toContainText('Incompatible package upgrade');
  await expect(page.getByTestId('workflow-node-package-upgrade-warning')).toContainText('status');
  await screenshot(page, 'REQ-211D-incompatible-upgrade.png');
});

test('REQ-183 captures WorkGraph adapter, FormMeta inspector, and line insertion @screenshot', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await expect(page.getByTestId('workflow-flowgram-adapter')).toContainText('mtl-flowgram-v1');
  await expect(page.getByTestId('workflow-migration-compatibility')).toContainText('Compatibility');
  await expect(page.getByTestId('workflow-migration-doctor-local')).toContainText('Migration doctor');
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId('workflow-flowgram-free-layout-editor')).toBeVisible();
  await expect(page.getByTestId('workflow-flowgram-operation-toolbar')).toBeVisible();
  await expect(page.getByTestId('workflow-flowgram-primary-actions')).toBeVisible();
  await expect(page.getByTestId('workflow-flowgram-operation-toolbar')).toContainText(/No node selected|Node selected/);
  await screenshot(page, 'BUG-UI-012-workflow-simple-default.png');
  await page.getByTestId('workflow-flowgram-more-toggle').click();
  await expect(page.getByTestId('workflow-flowgram-more-actions')).toBeVisible();
  await expect(page.getByTestId('workflow-flowgram-shortcut-hints')).toBeVisible();
  await page.getByTestId('workflow-flowgram-zoom-in').click();
  await expect(page.getByTestId('workflow-flowgram-operation-feedback')).toContainText('Zoomed in');
  await page.getByTestId('workflow-flowgram-zoom-out').click();
  await expect(page.getByTestId('workflow-flowgram-operation-feedback')).toContainText('Zoomed out');
  await page.getByTestId('workflow-flowgram-fit-view').click();
  await expect(page.getByTestId('workflow-flowgram-operation-feedback')).toContainText('Fit view');
  await screenshot(page, 'REQ-213-flowgram-operation-toolbar.png');
  await screenshot(page, 'BUG-UI-011-flowgram-visual-parity.png');
  await page.getByTestId(/workflow-flowgram-node-/).first().click();
  await expect(page.getByTestId('workflow-flowgram-operation-toolbar')).toContainText('Node selected');
  await expect(page.getByTestId('workflow-selection-helper')).toContainText('Node selected');
  await screenshot(page, 'REQ-214-flowgram-selection-panel.png');
  await screenshot(page, 'BUG-UI-012-workflow-simple-selected.png');
  await expect(page.getByTestId('workflow-flowgram-line-insert').first()).toBeVisible();
  await screenshot(page, 'REQ-183-workgraph-command-center.png');

  await page.getByTitle('Keyboard shortcuts').click();
  await expect(page.getByTestId('workflow-keyboard-shortcuts')).toContainText('Ctrl/Cmd Z');
  await screenshot(page, 'REQ-183-plugin-shortcuts-minimap.png');
  await page.keyboard.press('Escape');

  await page.getByTestId('workflow-flowgram-line-insert').first().click();
  await expect(page.getByTestId('workflow-flowgram-operation-feedback')).toBeVisible();
  await expect(page.getByTestId('workflow-form-meta-inspector')).toBeVisible();
  await expect(page.getByTestId('workflow-flow-reference-validation')).toContainText('Typed references');
  await expect(page.getByTestId('workflow-flowing-lines')).toBeVisible();
  await expect(page.getByTestId('workflow-flowgram-adapter')).toContainText('4 nodes');
  await screenshot(page, 'REQ-215-flowgram-line-insert-operation.png');
  await screenshot(page, 'REQ-216-flowgram-shortcut-feedback.png');
  await screenshot(page, 'REQ-183-line-add-formmeta-inspector.png');
});

test('REQ-083 captures Workflow Studio empty state guide @screenshot', async ({ page }) => {
  await installMockApi(page, { emptyWorkflows: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await expect(page.getByTestId('workflow-empty-state-guide')).toBeVisible();
  await screenshot(page, 'REQ-083-workflow-empty-state-guide.png');
});

test('BUG-UI-013 to BUG-UI-018 capture simplified Workflow Studio HCI @screenshot', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();

  await expect(page.getByTestId('workflow-simple-mode')).toBeVisible();
  await expect(page.getByTestId('workflow-editor').getByTestId('workflow-guided-builder')).toBeVisible();
  await expect(page.getByTestId('workflow-human-next-action')).toBeVisible();
  await expect(page.getByTestId('workflow-command-center')).not.toContainText('WorkGraph');
  await expect(page.getByTestId('workflow-command-center')).not.toContainText('Migration doctor');
  await expect(page.getByTestId('workflow-command-center')).not.toContainText('Benchmarks');
  await expect(page.getByTestId(/workflow-flowgram-node-/).first()).toBeVisible();
  await screenshot(page, 'BUG-UI-013-simple-editor-default.png');
  await screenshot(page, 'BUG-UI-014-command-center-declutter.png');
  await screenshot(page, 'BUG-UI-015-guided-builder.png');

  await page.getByTestId(/workflow-flowgram-node-/).first().click();
  await expect(page.getByTestId('workflow-inspector-essential-fields')).toBeVisible();
  await expect(page.getByTestId('workflow-inspector-advanced-sections')).toBeVisible();
  await screenshot(page, 'BUG-UI-016-inspector-essential-fields.png');

  await expect(page.getByTestId('workflow-flowgram-diagnostics-layer')).toBeHidden();
  await screenshot(page, 'BUG-UI-017-canvas-visual-polish.png');

  await page.getByTestId('workflow-run').click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByTestId('workflow-runs')).toBeVisible();
  await expect(page.getByTestId('workflow-run-story')).toContainText(/approval|waiting|continue/i);
  await expect(page.getByTestId('workflow-run-advanced-tabs')).toBeVisible();
  await screenshot(page, 'BUG-UI-018-run-story-approval.png');
});

test('BUG-UI-019 to BUG-UI-021 capture desktop-only Workflow Studio polish @screenshot', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();

  await expect(page.getByTestId('workflow-desktop-focus-layout')).toBeVisible();
  await expect(page.getByTestId('workflow-editor-setup-strip')).toBeVisible();
  await expect(page.getByTestId(/workflow-flowgram-node-/).first()).toBeVisible();
  await screenshot(page, 'BUG-UI-019-editor-focus-layout.png');

  await expect(page.getByTestId('workflow-canvas-operation-polish')).toBeVisible();
  await page.getByTestId(/workflow-flowgram-node-/).first().click();
  await expect(page.getByTestId('workflow-selection-helper')).toBeVisible();
  await screenshot(page, 'BUG-UI-020-canvas-operation-polish.png');

  await page.getByTestId('workflow-run').click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByTestId('workflow-runs-approval-focus')).toBeVisible();
  await screenshot(page, 'BUG-UI-021-runs-approval-focus.png');
});

test('BUG-UI-022 to BUG-UI-024 capture modern desktop Workflow Studio polish @screenshot', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();

  await expect(page.getByTestId('workflow-modern-desktop-shell')).toBeVisible();
  await expect(page.getByTestId('workflow-command-rail')).toBeVisible();
  await expect(page.getByTestId('workflow-editor-quick-path')).toBeVisible();
  await expect(page.getByTestId(/workflow-flowgram-node-/).first()).toBeVisible();
  await screenshot(page, 'BUG-UI-022-modern-desktop-shell.png');

  await page.getByTestId(/workflow-flowgram-node-/).first().click();
  await expect(page.getByTestId('workflow-properties-panel')).toBeVisible();
  await expect(page.getByTestId('workflow-inspector-node-summary')).toBeVisible();
  await expect(page.getByTestId('workflow-inspector-more-actions')).toBeVisible();
  await screenshot(page, 'BUG-UI-023-inspector-properties-panel.png');

  await expect(page.getByTestId('workflow-canvas-surface-modern')).toBeVisible();
  await expect(page.getByTestId('workflow-canvas-surface-titlebar')).toBeVisible();
  await expect(page.getByTestId('workflow-canvas-operation-polish')).toBeVisible();
  await expect(page.getByTestId('workflow-node-modern-block').first()).toBeVisible();
  await screenshot(page, 'BUG-UI-024-canvas-surface-node-polish.png');
});

test('BUG-UI-025 to BUG-UI-027 capture low-noise desktop Workflow Studio defaults @screenshot', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId(/workflow-flowgram-node-/).first()).toBeVisible();

  await expect(page.getByTestId('workflow-quiet-default-header')).toBeVisible();
  await expect(page.getByTestId('workflow-quiet-meta')).toBeVisible();
  await expect(page.getByTestId('workflow-command-center')).not.toContainText('Profile build');
  await screenshot(page, 'BUG-UI-025-quiet-default-header.png');

  await expect(page.getByTestId('workflow-canvas-first-rail')).toBeVisible();
  await expect(page.getByTestId('workflow-editor-metadata-details')).toBeVisible();
  await expect(page.getByTestId('workflow-editor-setup-strip')).not.toContainText('Permission');
  await screenshot(page, 'BUG-UI-026-canvas-first-simple-mode.png');

  await page.getByTestId(/workflow-flowgram-node-/).first().click();
  await expect(page.getByTestId('workflow-inspector-low-noise-defaults')).toBeVisible();
  await expect(page.getByTestId('workflow-inspector-advanced-sections')).toBeVisible();
  await expect(page.getByTestId('workflow-inspector-more-actions')).toBeVisible();
  await screenshot(page, 'BUG-UI-027-low-noise-inspector.png');
});

test('REQ-207 captures AI generated Python custom node review, install, and run output @screenshot', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId('workflow-generate-custom-node')).toBeVisible();

  await page.getByTestId('workflow-generate-custom-node').click();
  await expect(page.getByTestId('workflow-ai-node-draft-review')).toBeVisible();
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await expect(page.getByTestId('workflow-custom-schema-node-form')).toBeVisible();
  await screenshot(page, 'REQ-207-ai-node-draft.png');

  await page.getByRole('button', { name: 'Validate manifest' }).click();
  await expect(page.getByTestId('workflow-python-node-dependency-warning')).toContainText('Stage one rejects');
  await screenshot(page, 'REQ-207-python-node-dependency-warning.png');

  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByTestId('workflow-python-node-test-result')).toContainText('stdout');
  await expect(page.getByTestId('workflow-python-node-test-result')).toContainText('test stderr captured');
  await screenshot(page, 'REQ-207-python-node-test-stdout-stderr.png');

  await page.getByRole('button', { name: 'Install node' }).click();
  await expect(page.getByTestId('workflow-custom-node-installed')).toContainText('Python Format Node installed');
  await screenshot(page, 'REQ-207-custom-node-installed.png');

  await page.getByLabel('Close custom node review').click();
  await page.getByTestId('workflow-advanced-toggle').click();
  await expect(page.getByText('Custom')).toBeVisible();
  await page.getByTestId('workflow-add-node').filter({ hasText: 'Python Format Node' }).click();
  await expect(page.getByTestId('workflow-flowgram-node-python-format-node-1')).toBeVisible();
  await expect(page.getByTestId('workflow-selection-helper')).toContainText('Python Format Node 1');

  await page.getByTestId('workflow-run').click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByTestId('workflow-runs')).toBeVisible();
  await expect(page.getByTestId('workflow-runs')).toContainText('HELLO WORKFLOW');
  await screenshot(page, 'REQ-207-custom-node-run-output.png');
});
