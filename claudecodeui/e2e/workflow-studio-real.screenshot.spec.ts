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
  await expect(page.getByTestId('workflow-dag-canvas')).toBeVisible();
  await screenshot(page, 'REQ-057-real-workflow-editor.png');

  await page.getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-runs').getByText('waiting_approval').first()).toBeVisible();
  await screenshot(page, 'REQ-057-real-workflow-approval.png');

  const continueResponse = await request.post(`/api/workflow-runs/${runId}/nodes/approval/control`, {
    data: { action: 'continue' },
  });
  expect(continueResponse.ok()).toBe(true);

  await page.getByTestId('workflow-studio').getByRole('button', { name: 'Refresh' }).click();
  await page.getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-runs').getByText('completed').first()).toBeVisible();
  await screenshot(page, 'REQ-057-real-workflow-completed-history.png');

  await request.delete(`/api/workflows/${workflowId}`);
});
