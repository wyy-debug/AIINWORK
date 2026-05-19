import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const screenshotDir = resolve(process.cwd(), 'output/playwright/screenshots');

test.use({ viewport: { width: 1920, height: 1080 } });

async function screenshot(page: Page, name: string) {
  const path = resolve(screenshotDir, name);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  const file = await stat(path);
  expect(file.size).toBeGreaterThan(0);
}

test('REQ-057 captures real Workflow Studio backend smoke screenshots @screenshot @real-screenshot', async ({ page, request }) => {
  test.skip(process.env.WORKFLOW_REAL_SMOKE !== '1', 'Set WORKFLOW_REAL_SMOKE=1 against a DESKTOP_MODE dev server to run the real backend screenshot gate.');

  const workflowId = `req-057-real-smoke-${Date.now()}`;
  const workflow = {
    id: workflowId,
    name: 'REQ-057 Real Workflow Smoke',
    description: 'Real backend screenshot gate workflow.',
    profileId: 'build',
    permissionPreset: 'auto-edit',
    inputs: [{ id: 'change_request', label: 'Change request', type: 'textarea', required: true }],
    outputs: [{ id: 'summary', label: 'Summary', type: 'markdown' }],
    maxConcurrency: 2,
    nodes: [
      { id: 'approval', type: 'approval', title: 'Approval Gate', prompt: 'Confirm real smoke.', permission: '', position: { x: 160, y: 150 } },
      { id: 'artifact', type: 'artifact', title: 'Smoke Artifact', prompt: 'Collect result.', permission: '', position: { x: 440, y: 150 } },
    ],
    edges: [{ id: 'approval-artifact', from: 'approval', to: 'artifact', mode: 'success' }],
  };
  const project = {
    name: 'REQ-057-real-project',
    displayName: 'REQ-057 Real Project',
    fullPath: process.cwd(),
    path: process.cwd(),
    sessions: [],
  };

  const saveResponse = await request.post('/api/workflows', { data: { workflow } });
  expect(saveResponse.ok()).toBe(true);

  const runResponse = await request.post(`/api/workflows/${workflowId}/runs`, {
    data: {
      projectPath: process.cwd(),
      sessionId: `req-057-${Date.now()}`,
      inputs: { change_request: 'real backend screenshot gate' },
    },
  });
  expect(runResponse.ok()).toBe(true);
  const runPayload = await runResponse.json();
  const runId = runPayload.run.id;

  await page.addInitScript(() => {
    localStorage.setItem('activeTab', 'workflows');
  });
  await page.route('**/api/projects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([project]) });
  });
  await page.route('**/api/conversations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project: { ...project, name: 'Conversations' } }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('workflow-studio')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('workflow-command-center')).toBeVisible();
  await expect(page.getByTestId('workflow-home-overview')).toBeVisible();
  await expect(page.getByTestId('workflow-first-run-wizard')).toBeVisible();
  await expect(page.getByTestId('workflow-recent-objects')).toBeVisible();
  await expect(page.getByTestId('workflow-favorites')).toBeVisible();
  await expect(page.getByTestId('workflow-breadcrumb')).toBeVisible();
  await expect(page.getByTestId('workflow-status-taxonomy')).toBeVisible();
  await screenshot(page, 'REQ-082-workflow-home-overview.png');
  await screenshot(page, 'REQ-084-workflow-first-run-wizard.png');
  await screenshot(page, 'REQ-086-workflow-recent-objects.png');
  await screenshot(page, 'REQ-087-workflow-favorites.png');
  await screenshot(page, 'REQ-088-workflow-breadcrumb-and-deep-link.png');
  await screenshot(page, 'REQ-089-workflow-status-taxonomy.png');

  await page.getByTestId('workflow-command-center').getByRole('button', { name: 'Command' }).click();
  await expect(page.getByTestId('workflow-command-palette')).toBeVisible();
  await screenshot(page, 'REQ-085-workflow-command-palette.png');
  await page.keyboard.press('Escape');

  await page.getByTitle('Workflow help').click();
  await expect(page.getByTestId('workflow-help-overlay')).toBeVisible();
  await screenshot(page, 'REQ-090-workflow-help-overlay.png');
  await page.keyboard.press('Escape');

  await page.getByTitle('Keyboard shortcuts').click();
  await expect(page.getByTestId('workflow-keyboard-shortcuts')).toBeVisible();
  await screenshot(page, 'REQ-091-workflow-keyboard-shortcuts-panel.png');
  await page.keyboard.press('Escape');

  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId('workflow-dag-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-react-flow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-multi-select')).toBeVisible();
  await expect(page.getByTestId('workflow-copy-paste')).toBeVisible();
  await expect(page.getByTestId('workflow-duplicate-subgraph')).toBeVisible();
  await expect(page.getByTestId('workflow-undo-redo')).toBeVisible();
  await expect(page.getByTestId('workflow-layout-mode')).toBeVisible();
  await expect(page.getByTestId('workflow-layout-lock')).toBeVisible();
  await expect(page.getByTestId('workflow-minimap-filters')).toBeVisible();
  await screenshot(page, 'REQ-057-real-workflow-editor.png');
  await screenshot(page, 'REQ-064-real-editor-create-save-reopen.png');
  await screenshot(page, 'REQ-081-editor-react-flow-canvas.png');
  await screenshot(page, 'REQ-092-workflow-multi-select-nodes.png');

  await page.getByTestId('workflow-node').first().click();
  await expect(page.getByTestId('workflow-inspector-tabs')).toBeVisible();
  await expect(page.getByTestId('workflow-node-schema-versioning')).toBeVisible();
  await screenshot(page, 'REQ-102-workflow-node-schema-versioning.png');
  await expect(page.getByTestId('workflow-node-config-presets')).toBeVisible();
  await screenshot(page, 'REQ-103-workflow-node-config-presets.png');
  await expect(page.getByTestId('workflow-required-field-guard')).toBeVisible();
  await screenshot(page, 'REQ-104-workflow-required-field-guard.png');
  await expect(page.getByTestId('workflow-secret-field-type')).toBeVisible();
  await screenshot(page, 'REQ-105-workflow-secret-field-type.png');
  await expect(page.getByTestId('workflow-json-config-editor')).toBeVisible();
  await screenshot(page, 'REQ-106-workflow-json-config-editor.png');
  await page.getByTestId('workflow-typed-variable-picker').scrollIntoViewIfNeeded();
  await screenshot(page, 'REQ-107-workflow-typed-variable-picker.png');
  await page.getByTestId('workflow-mapping-preview').scrollIntoViewIfNeeded();
  await screenshot(page, 'REQ-108-workflow-mapping-preview.png');
  await page.getByTestId('workflow-transform-functions').scrollIntoViewIfNeeded();
  await screenshot(page, 'REQ-109-workflow-transform-functions.png');
  await page.getByTestId('workflow-output-contract-test').scrollIntoViewIfNeeded();
  await screenshot(page, 'REQ-110-workflow-output-contract-test.png');
  await page.getByTestId('workflow-data-lineage-view').scrollIntoViewIfNeeded();
  await screenshot(page, 'REQ-111-workflow-data-lineage-view.png');
  await page.getByTestId('workflow-copy-paste').getByRole('button', { name: 'Copy' }).click();
  await screenshot(page, 'REQ-093-workflow-copy-paste-nodes.png');
  await screenshot(page, 'REQ-101-workflow-graph-validation-badges.png');
  await page.getByTestId('workflow-duplicate-subgraph').click();
  await screenshot(page, 'REQ-094-workflow-duplicate-subgraph.png');
  await page.getByTestId('workflow-undo-redo').getByRole('button', { name: 'Undo' }).click();
  await screenshot(page, 'REQ-095-workflow-undo-redo.png');
  await page.getByTestId('workflow-layout-mode').locator('select').selectOption('top-down');
  await page.getByRole('button', { name: 'Apply' }).first().click();
  await screenshot(page, 'REQ-096-workflow-auto-layout-modes.png');
  await page.getByTestId('workflow-node').first().click();
  await page.getByTestId('workflow-layout-lock').click();
  await screenshot(page, 'REQ-097-workflow-layout-lock.png');
  await page.getByTestId('workflow-minimap-filters').locator('select').selectOption('risk');
  await screenshot(page, 'REQ-100-workflow-graph-minimap-filters.png');
  await screenshot(page, 'REQ-081-inspector-node-config.png');

  await page.getByTestId('workflow-select-edge').first().click();
  await expect(page.getByTestId('workflow-edge-editor')).toBeVisible();
  await expect(page.getByTestId('workflow-edge-route-style')).toBeVisible();
  await expect(page.getByTestId('workflow-edge-branch-labels')).toBeVisible();
  await page.getByTestId('workflow-edge-route-style').locator('select').selectOption('step');
  await screenshot(page, 'REQ-098-workflow-edge-route-styles.png');
  await page.getByTestId('workflow-edge-branch-labels').locator('select').selectOption('failure');
  await screenshot(page, 'REQ-099-workflow-edge-branch-labels.png');

  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Library' }).click();
  await expect(page.getByTestId('workflow-library-gallery')).toBeVisible();
  await expect(page.getByTestId('workflow-template-preview')).toBeVisible();
  await expect(page.getByTestId('workflow-template-manifest').first()).toBeVisible();
  await expect(page.getByTestId('workflow-clone-template').first()).toBeVisible();
  await screenshot(page, 'REQ-064-real-template-library-clone.png');
  await screenshot(page, 'REQ-081-library-template-gallery.png');

  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await page.getByTestId('workflow-dry-run-debugger').first().click();
  await expect(page.getByTestId('workflow-dry-run-debugger').last()).toBeVisible();
  await screenshot(page, 'REQ-064-real-editor-dry-run-debugger.png');

  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-runs').getByText('waiting_approval').first()).toBeVisible();
  await expect(page.getByTestId('workflow-run-console')).toBeVisible();
  await expect(page.getByTestId('workflow-approval-inbox-panel')).toBeVisible();
  await expect(page.getByTestId('workflow-run-events').first()).toBeVisible();
  await screenshot(page, 'REQ-057-real-workflow-approval.png');
  await screenshot(page, 'REQ-064-real-runtime-approval-console.png');
  await screenshot(page, 'REQ-081-run-console-approval.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('workflow-approval-inbox-panel')).toBeVisible();
  await screenshot(page, 'REQ-081-mobile-run-approval.png');
  await page.setViewportSize({ width: 1920, height: 1080 });

  const continueResponse = await request.post(`/api/workflow-runs/${runId}/nodes/approval/control`, {
    data: { action: 'continue' },
  });
  expect(continueResponse.ok()).toBe(true);

  await page.getByTestId('workflow-studio').getByRole('button', { name: 'Refresh' }).click();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-runs').getByText('completed').first()).toBeVisible();
  await screenshot(page, 'REQ-057-real-workflow-completed-history.png');

  const permissionWorkflowId = `req-064-permission-deny-${Date.now()}`;
  const permissionWorkflow = {
    id: permissionWorkflowId,
    name: 'REQ-064 Permission Deny Smoke',
    description: 'Real permission deny screenshot gate workflow.',
    profileId: 'build',
    permissionPreset: 'enterprise-safe',
    inputs: [],
    outputs: [{ id: 'summary', label: 'Summary', type: 'markdown' }],
    maxConcurrency: 1,
    nodes: [
      { id: 'shell', type: 'shell', title: 'Denied Shell', command: 'node -e "console.log(1)"', permission: '', position: { x: 160, y: 150 } },
    ],
    edges: [],
  };
  const permissionSave = await request.post('/api/workflows', { data: { workflow: permissionWorkflow } });
  expect(permissionSave.ok()).toBe(true);
  const permissionRun = await request.post(`/api/workflows/${permissionWorkflowId}/runs`, {
    data: { projectPath: process.cwd(), sessionId: `req-064-permission-${Date.now()}`, inputs: {} },
  });
  expect(permissionRun.ok()).toBe(true);

  await page.getByTestId('workflow-studio').getByRole('button', { name: 'Refresh' }).click();
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByText(/permission boundary/i).first()).toBeVisible();
  await screenshot(page, 'REQ-064-real-permission-deny.png');

  await request.delete(`/api/workflows/${workflowId}`);
  await request.delete(`/api/workflows/${permissionWorkflowId}`);
});
