import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { expect, type Page, type Route, test } from '@playwright/test';

const screenshotDir = resolve(process.cwd(), 'output/playwright/screenshots');

const project = {
  name: 'AIINWORK',
  displayName: 'AIINWORK',
  fullPath: 'E:\\AIINWORK',
  path: 'E:\\AIINWORK',
  sessions: [{
    id: 'session-ui-bug',
    title: 'UI bug sweep',
    summary: 'UI bug sweep',
    created_at: '2026-05-20T01:00:00.000Z',
    updated_at: '2026-05-20T01:10:00.000Z',
  }],
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
  id: 'workflow-run-ui',
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

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function capture(page: Page, name: string) {
  const target = resolve(screenshotDir, name);
  await mkdir(dirname(target), { recursive: true });
  await page.screenshot({ path: target, fullPage: true });
  const file = await stat(target);
  expect(file.size).toBeGreaterThan(0);
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(Math.max(metrics.docScrollWidth, metrics.bodyScrollWidth)).toBeLessThanOrEqual(metrics.innerWidth + 2);
}

async function expectLocatorInViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 2);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 2);
}

async function installApi(page: Page, activeTab: 'chat' | 'workflows' = 'chat') {
  await page.addInitScript((tab) => {
    localStorage.setItem('activeTab', tab);
    localStorage.setItem('argus-debug-settings', JSON.stringify({
      showPromptInjectionPanel: true,
      showRuntimeTimelinePanel: true,
      showCheckpointPanel: true,
      showArgusBrainDiagnosticsPanel: true,
    }));
  }, activeTab);

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/projects') return json(route, [project]);
    if (path.startsWith('/api/conversations')) return json(route, { project: { ...project, name: 'Conversations', sessions: [] } });
    if (path === '/api/settings/notification-preferences') return json(route, { success: true, preferences: {} });
    if (path === '/api/workflows') return json(route, { success: true, workflows: [workflow] });
    if (path === `/api/workflows/${workflow.id}`) return json(route, { success: true, workflow });
    if (path === `/api/workflows/${workflow.id}/runs`) return json(route, { success: true, run: waitingRun }, 201);
    if (path === '/api/workflow-runs') return json(route, { success: true, runs: [waitingRun] });
    if (path === '/api/workflows/node-types') return json(route, { success: true, nodeTypes: [] });
    if (path === '/api/workflow-approvals') return json(route, {
      success: true,
      approvals: [{
        id: 'approval-ui',
        runId: waitingRun.id,
        nodeId: 'approval',
        nodeTitle: 'Human Approval',
        riskLevel: 'medium',
        reason: 'Shell/write step waits for local approval.',
        riskExplanation: { riskLevel: 'medium', reason: 'Workflow may modify files after approval.' },
        diffSummary: { summary: 'No file diff yet; approval unlocks the build step.' },
      }],
    });
    if (path.startsWith('/api/workflows/') || path.startsWith('/api/workflow-runs/') || path.startsWith('/api/workflow-benchmarks')) return json(route, { success: true });
    if (path === '/api/agents') return json(route, {
      success: true,
      agents: [
        { id: 'plan', name: 'Plan', status: 'enabled', mode: 'primary', permissionPreset: 'suggest' },
        { id: 'build', name: 'Build', status: 'enabled', mode: 'primary', permissionPreset: 'auto-edit' },
        { id: 'explore', name: 'Explore', status: 'enabled', mode: 'subagent', permissionPreset: 'suggest' },
      ],
    });
    if (path === '/api/sessions/session-ui-bug/messages') return json(route, {
      messages: [
        { id: 'user-1', sessionId: 'session-ui-bug', provider: 'claude', role: 'user', kind: 'text', content: 'Run UI bug sweep.', timestamp: '2026-05-20T01:00:00.000Z' },
        { id: 'assistant-1', sessionId: 'session-ui-bug', provider: 'claude', role: 'assistant', kind: 'text', content: 'Runtime panels are visible for review.', timestamp: '2026-05-20T01:01:00.000Z' },
      ],
      total: 2,
      hasMore: false,
    });
    if (path === '/api/sessions/session-ui-bug/timeline') return json(route, {
      success: true,
      timeline: {
        summary: { total: 3, tools: 1, failures: 0, permissionBlocks: 0, checkpoints: 1, subagents: 0 },
        events: [
          { id: 'evt-1', timestamp: '2026-05-20T01:00:00.000Z', title: 'User request', summary: 'Run UI bug sweep.', status: 'success' },
          { id: 'evt-2', timestamp: '2026-05-20T01:01:00.000Z', title: 'Argus Brain extracted atoms', summary: 'UI bug priorities captured.', status: 'success' },
          { id: 'evt-3', timestamp: '2026-05-20T01:02:00.000Z', title: 'Tool completed: Playwright', summary: 'Screenshots generated.', status: 'success' },
        ],
      },
    });
    if (path === '/api/session-timeline/session-ui-bug') return json(route, { timeline: { events: [] } });
    if (path === '/api/brain/session/session-ui-bug') return json(route, {
      brain: {
        enabled: true,
        status: 'ready',
        compactedEventCount: 4,
        tokenReductionEstimate: 900,
        latestCompaction: {
          currentGoal: 'Fix UI bug sweep.',
          summary: 'Workflow and runtime panel readability are the current priorities.',
          nextAction: 'Capture desktop and mobile screenshots.',
          activeDecisions: ['Desktop and mobile screenshots required'],
          openRisks: ['Dense panels can hide controls'],
        },
        refs: [{ id: 'ref-1', label: 'ui bug sweep', refType: 'memory', refId: 'memory-1' }],
      },
    });
    if (path === '/api/brain/session/session-ui-bug/inspector') return json(route, {
      inspector: {
        status: 'ready',
        layers: {
          atoms: [{ id: 'atom-1', atomType: 'risk', title: 'Runtime drawer crowding', status: 'active', pinned: true }],
          rawRefs: [{ id: 'raw-1', label: 'ui_bug_sweep', contentPreview: 'Fix overflow, popovers, and hit targets.' }],
          scenarios: [{ id: 'scenario-1', title: 'Mobile workflow approval' }],
          projectProfile: { summary: 'UI bug sweep requires real screenshots.' },
        },
        recallHits: [{ id: 'hit-1', title: 'Fix UI readability', summary: 'Runtime and Workflow panels must stay readable.' }],
      },
    });
    if (path === '/api/checkpoints') return json(route, {
      success: true,
      checkpoints: [{ id: 'cp-1', phase: 'after', hasChanges: true, rollbackAvailable: true, createdAt: '2026-05-20T01:02:00.000Z' }],
    });
    if (path === '/api/git/status') return json(route, { files: [] });
    if (path === '/api/commands/list') return json(route, { builtIn: [], custom: [] });
    return json(route, { success: true });
  });
}

test('BUG-UI-001 desktop Workflow Studio editor has no horizontal page overflow and clickable controls @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, 'workflows');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId('workflow-react-flow-canvas')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('workflow-dry-run-debugger').click();
  await expect(page.getByTestId('workflow-dry-run-debugger').first()).toBeVisible();
  await capture(page, 'BUG-UI-001-workflow-desktop-editor.png');
});

test('BUG-UI-002 mobile Workflow Studio favors read/run over dense desktop editor @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApi(page, 'workflows');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId('workflow-dag-canvas')).toBeHidden();
  await expect(page.getByTestId('workflow-mobile-run')).toBeVisible();
  await capture(page, 'BUG-UI-002-workflow-mobile-read-run.png');
});

test('BUG-UI-003 Workflow Studio inspector stays readable with dense node configuration @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, 'workflows');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Editor' }).click();
  await page.getByTestId('workflow-node').first().click();
  await expect(page.getByTestId('workflow-node-inspector')).toBeVisible();
  await expect(page.getByTestId('workflow-inspector-tabs')).toBeVisible();
  await page.getByRole('button', { name: 'Permissions' }).click();
  await expect(page.getByTestId('workflow-permission-source')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await capture(page, 'BUG-UI-003-workflow-inspector-density.png');
});

test('BUG-UI-004 Workflow Runs console keeps approval and diagnosis actions usable @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, 'workflows');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-run-console')).toBeVisible();
  await expect(page.getByTestId('workflow-approval-inbox-panel')).toBeVisible();
  await expect(page.getByTestId('workflow-run-streaming-logs')).toBeVisible();
  await page.getByPlaceholder('node, status, error').fill('approval');
  await expectNoHorizontalOverflow(page);
  await capture(page, 'BUG-UI-004-workflow-runs-console.png');
});

test('BUG-UI-005/006 desktop Chat runtime drawer remains readable and composer clickable @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, 'chat');
  await page.goto('/session/session-ui-bug', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Runtime Diagnostics').first()).toBeVisible();
  await expect(page.getByText('Argus Brain').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByPlaceholder(/Type \/ for commands/).click();
  await capture(page, 'BUG-UI-005-runtime-drawer-desktop.png');
  await capture(page, 'BUG-UI-006-argus-brain-diagnostics.png');
});

test('BUG-UI-007 sidebar project actions have clickable hit targets @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installApi(page, 'chat');
  await page.goto('/session/session-ui-bug', { waitUntil: 'domcontentloaded' });
  const editButton = page.getByTestId('sidebar-project-edit-button').first();
  const newSessionButton = page.getByTestId('sidebar-project-new-session-button').first();
  await expect(editButton).toBeVisible();
  await expect(newSessionButton).toBeVisible();
  const editBox = await editButton.boundingBox();
  const newBox = await newSessionButton.boundingBox();
  expect(editBox!.width).toBeGreaterThanOrEqual(36);
  expect(editBox!.height).toBeGreaterThanOrEqual(36);
  expect(newBox!.width).toBeGreaterThanOrEqual(36);
  expect(newBox!.height).toBeGreaterThanOrEqual(36);
  await editButton.click();
  await expect(page.locator('[data-testid="sidebar-project-name-input"]:visible')).toBeVisible();
  await capture(page, 'BUG-UI-007-sidebar-hit-targets.png');
});

test('BUG-UI-008 agent profile popover stays inside viewport on mobile @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApi(page, 'chat');
  await page.goto('/session/session-ui-bug', { waitUntil: 'domcontentloaded' });
  await page.getByTitle('Switch Agent Profile').click();
  await expect(page.getByRole('listbox', { name: 'Agent Profile' })).toBeVisible();
  await expectLocatorInViewport(page, '[role="listbox"][aria-label="Agent Profile"]');
  await capture(page, 'BUG-UI-008-agent-profile-mobile-popover.png');
});

test('BUG-UI-009 Settings Debug switches persist and match runtime panel visibility @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installApi(page, 'chat');
  await page.goto('/session/session-ui-bug', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-settings-button').first().click();
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  await expect(page.getByTestId('settings-debug-visibility-controls')).toBeVisible();
  const timelineSwitch = page.getByRole('switch', { name: 'Runtime Timeline' });
  await expect(timelineSwitch).toHaveAttribute('aria-checked', 'true');
  await timelineSwitch.click();
  await expect(timelineSwitch).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('argus-debug-settings') || '{}').showRuntimeTimelinePanel)).toBe(false);
  await expectNoHorizontalOverflow(page);
  await capture(page, 'BUG-UI-009-settings-debug-visibility.png');
});

test('BUG-UI-010 real screenshot gate checks desktop and mobile viewport invariants @screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, 'workflows');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Library' }).click();
  await expect(page.getByTestId('workflow-library-gallery')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('workflow-view-tabs').getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByTestId('workflow-run-console')).toBeVisible();
  await capture(page, 'BUG-UI-010-real-screenshot-gate.png');
});
