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

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMockApi(page: Page, options: { emptyWorkflows?: boolean } = {}) {
  let runState = waitingRun;

  await page.addInitScript(() => {
    localStorage.setItem('activeTab', 'workflows');
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/projects') return json(route, [project]);
    if (path.startsWith('/api/conversations')) return json(route, { project: { ...project, name: 'Conversations', sessions: [] } });
    if (path === '/api/workflows') return json(route, { success: true, workflows: options.emptyWorkflows ? [] : [workflow] });
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
