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
  await expect(page.getByTestId('workflow-approval-risk-explanation')).toBeVisible();
  await screenshot(page, 'REQ-122-workflow-approval-risk-explanation.png');
  await expect(page.getByTestId('workflow-approval-diff-summary')).toBeVisible();
  await screenshot(page, 'REQ-123-workflow-approval-diff-summary.png');
  await expect(page.getByTestId('workflow-approval-timeout-policy')).toBeVisible();
  await screenshot(page, 'REQ-124-workflow-approval-timeout-policy.png');
  await expect(page.getByTestId('workflow-approval-delegation')).toBeVisible();
  await screenshot(page, 'REQ-125-workflow-approval-delegation.png');
  await expect(page.getByTestId('workflow-approval-audit-export')).toBeVisible();
  await screenshot(page, 'REQ-126-workflow-approval-audit-export.png');
  await expect(page.getByTestId('workflow-permission-dry-run')).toBeVisible();
  await screenshot(page, 'REQ-127-workflow-permission-dry-run.png');
  await expect(page.getByTestId('workflow-permission-override-request')).toBeVisible();
  await screenshot(page, 'REQ-128-workflow-permission-override-request.png');
  await expect(page.getByTestId('workflow-secret-vault-integration')).toBeVisible();
  await screenshot(page, 'REQ-129-workflow-secret-vault-integration.png');
  await expect(page.getByTestId('workflow-mcp-allowlist-ui')).toBeVisible();
  await screenshot(page, 'REQ-130-workflow-mcp-allowlist-ui.png');
  await expect(page.getByTestId('workflow-dangerous-command-policy')).toBeVisible();
  await screenshot(page, 'REQ-131-workflow-dangerous-command-policy.png');
  const remainingBacklogScreenshots = [
    ['workflow-agent-session-link', 'REQ-132-workflow-agent-session-link.png'],
    ['workflow-agent-prompt-preview', 'REQ-133-workflow-agent-prompt-preview.png'],
    ['workflow-agent-result-contract', 'REQ-134-workflow-agent-result-contract.png'],
    ['workflow-subagent-pool-limit', 'REQ-135-workflow-subagent-pool-limit.png'],
    ['workflow-subagent-cancellation-bridge', 'REQ-136-workflow-subagent-cancellation-bridge.png'],
    ['workflow-mcp-tool-catalog-sync', 'REQ-137-workflow-mcp-tool-catalog-sync.png'],
    ['workflow-mcp-argument-builder', 'REQ-138-workflow-mcp-argument-builder.png'],
    ['workflow-mcp-error-normalization', 'REQ-139-workflow-mcp-error-normalization.png'],
    ['workflow-tool-node-registry', 'REQ-140-workflow-tool-node-registry.png'],
    ['workflow-browser-screenshot-node', 'REQ-141-workflow-browser-screenshot-node.png'],
    ['workflow-template-detail-page', 'REQ-142-workflow-template-detail-page.png'],
    ['workflow-template-dependency-check', 'REQ-143-workflow-template-dependency-check.png'],
    ['workflow-template-smoke-badge', 'REQ-144-workflow-template-smoke-badge.png'],
    ['workflow-template-version-upgrade', 'REQ-145-workflow-template-version-upgrade.png'],
    ['workflow-template-migration-notes', 'REQ-146-workflow-template-migration-notes.png'],
    ['workflow-template-fork', 'REQ-147-workflow-template-fork.png'],
    ['workflow-package-export-wizard', 'REQ-148-workflow-package-export-wizard.png'],
    ['workflow-package-import-preview', 'REQ-149-workflow-package-import-preview.png'],
    ['workflow-marketplace-trust-badge', 'REQ-150-workflow-marketplace-trust-badge.png'],
    ['workflow-enterprise-template-pack', 'REQ-151-workflow-enterprise-template-pack.png'],
    ['workflow-event-timeline-correlation', 'REQ-152-workflow-event-timeline-correlation.png'],
    ['workflow-replay-visualizer', 'REQ-153-workflow-replay-visualizer.png'],
    ['workflow-failure-classifier', 'REQ-154-workflow-failure-classifier.png'],
    ['workflow-recommended-recovery-action', 'REQ-155-workflow-recommended-recovery-action.png'],
    ['workflow-artifact-gallery', 'REQ-156-workflow-artifact-gallery.png'],
    ['workflow-screenshot-evidence-viewer', 'REQ-157-workflow-screenshot-evidence-viewer.png'],
    ['workflow-benchmark-trend', 'REQ-158-workflow-benchmark-trend.png'],
    ['workflow-release-readiness-detail', 'REQ-159-workflow-release-readiness-detail.png'],
    ['workflow-test-coverage-map', 'REQ-160-workflow-test-coverage-map.png'],
    ['workflow-evidence-export', 'REQ-161-workflow-evidence-export.png'],
    ['workflow-change-history', 'REQ-162-workflow-change-history.png'],
    ['workflow-draft-publish-flow', 'REQ-163-workflow-draft-publish-flow.png'],
    ['workflow-review-request', 'REQ-164-workflow-review-request.png'],
    ['workflow-ownership-metadata', 'REQ-165-workflow-ownership-metadata.png'],
    ['workflow-deprecation-flow', 'REQ-166-workflow-deprecation-flow.png'],
    ['workflow-usage-analytics', 'REQ-167-workflow-usage-analytics.png'],
    ['workflow-role-based-visibility', 'REQ-168-workflow-role-based-visibility.png'],
    ['workflow-compliance-labels', 'REQ-169-workflow-compliance-labels.png'],
    ['workflow-audit-log-search', 'REQ-170-workflow-audit-log-search.png'],
    ['workflow-policy-report', 'REQ-171-workflow-policy-report.png'],
    ['workflow-large-graph-performance', 'REQ-172-workflow-large-graph-performance.png'],
    ['workflow-virtualized-run-logs', 'REQ-173-workflow-virtualized-run-logs.png'],
    ['workflow-offline-read-mode', 'REQ-174-workflow-offline-read-mode.png'],
    ['workflow-import-validation-sandbox', 'REQ-175-workflow-import-validation-sandbox.png'],
    ['workflow-storage-backup-restore', 'REQ-176-workflow-storage-backup-restore.png'],
    ['workflow-data-retention-policy', 'REQ-177-workflow-data-retention-policy.png'],
    ['workflow-package-size-guard', 'REQ-178-workflow-package-size-guard.png'],
    ['workflow-release-smoke-matrix', 'REQ-179-workflow-release-smoke-matrix.png'],
    ['workflow-migration-doctor', 'REQ-180-workflow-migration-doctor.png'],
    ['workflow-production-readiness-dashboard', 'REQ-181-workflow-production-readiness-dashboard.png'],
  ] as const;
  for (const [testId, screenshotName] of remainingBacklogScreenshots) {
    await expect(page.getByTestId(testId)).toBeVisible();
    await page.getByTestId(testId).scrollIntoViewIfNeeded();
    await screenshot(page, screenshotName);
  }
  await expect(page.getByTestId('workflow-run-live-polling-strategy')).toBeVisible();
  await screenshot(page, 'REQ-112-workflow-run-live-polling-strategy.png');
  await expect(page.getByTestId('workflow-run-streaming-logs')).toBeVisible();
  await screenshot(page, 'REQ-113-workflow-run-streaming-logs.png');
  await expect(page.getByTestId('workflow-run-log-search')).toBeVisible();
  await screenshot(page, 'REQ-114-workflow-run-log-search.png');
  await expect(page.getByTestId('workflow-run-compare-attempts')).toBeVisible();
  await screenshot(page, 'REQ-115-workflow-run-compare-attempts.png');
  await expect(page.getByTestId('workflow-resume-banner')).toBeVisible();
  await screenshot(page, 'REQ-119-workflow-resume-banner.png');
  await expect(page.getByTestId('workflow-run-pinning').first()).toBeVisible();
  await page.getByTestId('workflow-run-pinning').first().click();
  await screenshot(page, 'REQ-120-workflow-run-pinning.png');
  await expect(page.getByTestId('workflow-run-archive').first()).toBeVisible();
  await screenshot(page, 'REQ-121-workflow-run-archive.png');
  await page.getByRole('button', { name: 'Cancel impact' }).first().click();
  await expect(page.getByTestId('workflow-cancel-confirmation')).toBeVisible();
  await screenshot(page, 'REQ-118-workflow-cancel-confirmation.png');
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
  await expect(page.getByTestId('workflow-retry-node-only').first()).toBeVisible();
  await screenshot(page, 'REQ-116-workflow-retry-node-only.png');
  await page.getByRole('button', { name: 'Preview retry from' }).first().click();
  await expect(page.getByTestId('workflow-retry-from-node-preview')).toBeVisible();
  await screenshot(page, 'REQ-117-workflow-retry-from-node-preview.png');
  await screenshot(page, 'REQ-064-real-permission-deny.png');

  await request.delete(`/api/workflows/${workflowId}`);
  await request.delete(`/api/workflows/${permissionWorkflowId}`);
});
