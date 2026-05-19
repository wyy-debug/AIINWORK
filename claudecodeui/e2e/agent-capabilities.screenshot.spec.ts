import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { expect, type Page, type Route, test } from '@playwright/test';

const screenshotDir = resolve(process.cwd(), 'output/playwright/screenshots');

test.use({ viewport: { width: 1920, height: 1080 } });

const project = {
  name: 'AIINWORK',
  displayName: 'AIINWORK',
  fullPath: 'E:\\AIINWORK',
  path: 'E:\\AIINWORK',
  sessions: [{
    id: 'session-req',
    title: 'REQ screenshot verification',
    summary: 'REQ screenshot verification',
    created_at: '2026-05-19T05:00:00.000Z',
    updated_at: '2026-05-19T05:10:00.000Z',
  }],
};

const timelineEvents = [
  {
    id: 'evt-user',
    timestamp: '2026-05-19T05:00:00.000Z',
    type: 'user_request',
    category: 'request',
    status: 'success',
    title: 'User request',
    summary: 'Capture screenshot evidence for REQ-001 to REQ-008.',
  },
  {
    id: 'evt-brain',
    timestamp: '2026-05-19T05:01:00.000Z',
    type: 'brain',
    category: 'runtime',
    status: 'success',
    title: 'Argus Brain extracted atoms',
    summary: 'Project priorities and acceptance rules were materialized.',
  },
  {
    id: 'evt-tool',
    timestamp: '2026-05-19T05:02:00.000Z',
    type: 'tool_completed',
    category: 'tool',
    status: 'success',
    title: 'Tool completed: Playwright',
    summary: 'Screenshot artifact generated.',
  },
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installMockApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('activeTab', 'chat');
    localStorage.setItem('argus-debug-settings', JSON.stringify({
      showPromptInjectionPanel: true,
      showRuntimeTimelinePanel: true,
      showCheckpointPanel: true,
      showArgusBrainDiagnosticsPanel: true,
    }));
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/projects') return json(route, [project]);
    if (path.startsWith('/api/conversations')) return json(route, { project: { ...project, name: 'Conversations', sessions: [] } });
    if (path === '/api/settings/notification-preferences') return json(route, {
      success: true,
      preferences: { channels: { inApp: true, webPush: false }, events: { actionRequired: true, stop: true, error: true } },
    });
    if (path === '/api/sessions/session-req/messages') return json(route, {
      messages: [
        {
          id: 'msg-user',
          sessionId: 'session-req',
          timestamp: '2026-05-19T05:00:00.000Z',
          provider: 'claude',
          kind: 'text',
          role: 'user',
          content: 'Verify Agent Profiles, Checkpoints, Marketplace, Brain, and Review Flow.',
        },
        {
          id: 'msg-assistant',
          sessionId: 'session-req',
          timestamp: '2026-05-19T05:01:00.000Z',
          provider: 'claude',
          kind: 'text',
          role: 'assistant',
          content: 'Screenshot evidence is ready for the planning capabilities.',
        },
      ],
      total: 2,
      hasMore: false,
      tokenUsage: { contextBudget: { current: { used: 1200 }, window: { tokens: 200000 } } },
    });
    if (path === '/api/sessions/session-req/timeline') return json(route, {
      success: true,
      timeline: {
        summary: { total: timelineEvents.length, tools: 1, failures: 0, permissionBlocks: 0, checkpoints: 1, subagents: 0 },
        events: timelineEvents,
      },
    });
    if (path === '/api/session-timeline/session-req') return json(route, {
      timeline: { events: timelineEvents },
    });
    if (path === '/api/brain/session/session-req') return json(route, {
      brain: {
        enabled: true,
        status: 'ready',
        compactedEventCount: 3,
        tokenReductionEstimate: 840,
        latestCompaction: {
          currentGoal: 'Finish all GitHub issues with screenshot evidence.',
          summary: 'Brain recalls project planning rules and feature priorities.',
          nextAction: 'Close issues only after tests and screenshots pass.',
          sourceEventCount: 3,
          activeDecisions: ['No V1/V2/V3 labels', 'Screenshot evidence required'],
          openRisks: ['Keep screenshots deterministic'],
          mermaid: 'flowchart TD\n  brain["Argus Brain"] --> req["REQ evidence"]',
        },
        refs: [{ id: 'ref-1', refType: 'memory', label: 'project priorities', refId: 'memory-1' }],
      },
    });
    if (path === '/api/brain/session/session-req/inspector') return json(route, {
      inspector: {
        status: 'ready',
        actions: ['Pin', 'Archive', 'Export report'],
        controls: ['Show raw preview'],
        layers: {
          rawRefs: [{ id: 'raw-1', refType: 'memory', label: 'project_priorities', contentPreview: 'Agent Profiles and Marketplace first.' }],
          atoms: [{ id: 'atom-1', atomType: 'priority', title: 'Agent Profiles before Marketplace', status: 'active', pinned: true }],
          scenarios: [{ id: 'scenario-1', title: 'Close issue with screenshot evidence' }],
          projectProfile: { summary: 'MTL-Code uses Brain + MCP + Agent Profiles.' },
        },
        recallHits: [{
          id: 'hit-1',
          kind: 'atom',
          atomType: 'goal',
          title: 'Do not restore retired built-in capabilities',
          summary: 'Keep Obsidian, CodeGraph, and the small model runtime removed; use Brain plus MCP/Profile integrations instead.',
          reasons: [{ signal: 'project-memory', rank: 1 }],
        }],
      },
    });
    if (path === '/api/checkpoints') return json(route, {
      success: true,
      checkpoints: [{
        id: 'checkpoint-after-1',
        sessionId: 'session-req',
        provider: 'claude',
        phase: 'after',
        profileKind: 'build',
        permissionPreset: 'auto-edit',
        branch: 'main',
        headSha: '1f5c783abc',
        rollbackAvailable: true,
        hasChanges: true,
        diff: 'diff --git a/app.ts b/app.ts\n+ screenshot evidence',
        createdAt: '2026-05-19T05:03:00.000Z',
      }],
    });
    if (path === '/api/checkpoints/checkpoint-after-1/diff') return json(route, { success: true, diff: 'diff --git a/app.ts b/app.ts\n+ screenshot evidence' });
    if (path === '/api/agents/skills/installed') return json(route, { skills: [{ name: 'playwright', title: 'Playwright', description: 'Browser screenshot verification' }] });
    if (path === '/api/agent-repository/catalog') return json(route, {
      items: [{
        id: 'redmine-review',
        itemId: 'redmine-review',
        repoId: 'local-enterprise',
        kind: 'recipe',
        name: 'redmine-review',
        title: 'Redmine Review',
        description: 'Review Redmine tickets with project context.',
        tags: ['recipe', 'enterprise'],
        installState: 'installed',
        enabled: true,
      }],
    });
    if (path === '/api/capability-marketplace') return json(route, {
      success: true,
      catalog: {
        items: [
          {
            id: 'crashsight-analysis',
            kind: 'recipe',
            name: 'CrashSight analysis',
            title: 'CrashSight Analysis',
            description: 'Analyze crash reports with Skills, MCP, and permissions declared.',
            source: 'builtin',
            tags: ['recipe', 'crash'],
            installState: 'installed',
            enabled: true,
            dependencies: { skills: ['playwright'], mcpServers: ['crashsight'] },
          },
          {
            id: 'redmine-mcp',
            kind: 'mcp-server',
            name: 'Redmine MCP',
            title: 'Redmine MCP',
            description: 'Connect local enterprise Redmine.',
            source: 'enterprise',
            tags: ['mcp', 'redmine'],
            installState: 'available',
            enabled: false,
          },
        ],
      },
    });
    if (path === '/api/project-actions/config') return json(route, {
      actions: {
        setup: { command: 'npm install', enabled: true },
        run: { command: 'npm run dev', enabled: true },
        test: { command: 'npm run test:unit', enabled: true },
        build: { command: 'npm run build', enabled: true },
      },
      detectedScripts: [{ name: 'test:unit', command: 'npm run test:unit' }],
    });
    if (path === '/api/project-actions/runs/list') return json(route, { runs: [{ id: 'run-1', actionType: 'test', command: 'npm run test:unit', status: 'completed', output: '426 tests passed', startedAt: '2026-05-19T05:04:00.000Z' }] });
    if (path === '/api/project-profile/draft') return json(route, {
      targetPath: 'E:\\AIINWORK\\MTL.md',
      exists: true,
      content: '# MTL-Code\n\nProject profile with module map, commands, risks, and test entrypoints.',
      diff: '+ Project profile with module map, commands, risks, and test entrypoints.',
    });
    if (path === '/api/git/status') return json(route, {
      branch: 'main',
      hasCommits: true,
      files: [{ path: 'claudecodeui/src/App.tsx', kind: 'modified', status: 'modified', staged: false, unstaged: true }],
    });
    if (path === '/api/git/comments') return json(route, { comments: [] });
    if (path === '/api/git/diff') return json(route, { diff: 'diff --git a/claudecodeui/src/App.tsx b/claudecodeui/src/App.tsx\n+ screenshot verification' });
    if (path === '/api/git/review-flow') return json(route, {
      review: {
        hasChanges: true,
        summary: ['Runtime panels are visible and gated by Debug settings.'],
        risks: [{ title: 'UI evidence can go stale', files: ['claudecodeui/e2e/agent-capabilities.screenshot.spec.ts'], mitigation: 'Run Playwright screenshots before closing UI issues.' }],
        tests: ['npm run test:e2e:screenshots'],
        impact: ['Chat runtime drawer', 'Settings Debug tab'],
        commitMessage: 'test: add screenshot evidence gate',
        prBody: '## Summary\n- Adds screenshot evidence for UI requirements.',
        content: '# Git-native review package\n\nScreenshot evidence generated.',
      },
      artifact: { id: 'artifact-review', title: 'Git-native review package' },
    });
    if (path === '/api/recipes' || path === '/api/recipes/catalog') return json(route, { recipes: [] });

    return json(route, { success: true });
  });
}

async function capture(page: Page, name: string) {
  const path = resolve(screenshotDir, name);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  const file = await stat(path);
  expect(file.size).toBeGreaterThan(0);
}

async function openSession(page: Page) {
  await page.goto('/session/session-req', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByRole('heading', { name: 'REQ screenshot verification' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test('REQ-043 captures Settings Debug panel screenshot @screenshot', async ({ page }) => {
  await openSession(page);
  await page.waitForFunction(() => typeof window.openSettings === 'function');
  await page.evaluate(() => window.openSettings?.('debug'));
  await expect(page.getByText('Runtime panel visibility')).toBeVisible();
  await expect(page.getByText('Argus Brain Diagnostics')).toBeVisible();
  await capture(page, 'REQ-043-settings-debug-panel.png');
});

test('REQ-043 captures runtime drawer panels screenshot @screenshot', async ({ page }) => {
  await openSession(page);
  await expect(page.getByText('Runtime Timeline').first()).toBeVisible();
  await expect(page.getByText('Checkpoints').first()).toBeVisible();
  await expect(page.getByText('Argus Brain').first()).toBeVisible();
  await expect(page.getByText('Brain Workbench').first()).toBeVisible();
  await capture(page, 'REQ-043-runtime-drawer-panels.png');
});

test('REQ-045 captures Brain recall hit details screenshot @screenshot', async ({ page }) => {
  await openSession(page);
  await expect(page.getByText('Recall hit details').first()).toBeVisible();
  await expect(page.getByText('Do not restore retired built-in capabilities').first()).toBeVisible();
  await expect(page.getByText(/Obsidian, CodeGraph, and the small model runtime/).first()).toBeVisible();
  await page.getByText('Recall hit details').first().scrollIntoViewIfNeeded();
  await capture(page, 'REQ-045-brain-recall-hit-details.png');
});

test('REQ-043 captures Marketplace and Agent Profile entry screenshots @screenshot', async ({ page }) => {
  await openSession(page);
  await page.getByTitle('Switch Agent Profile').click();
  await expect(page.getByRole('listbox', { name: 'Agent Profile' })).toBeVisible();
  await capture(page, 'REQ-043-marketplace-agent-profile-entry.png');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => typeof window.openSettings === 'function');
  await page.evaluate(() => window.openSettings?.('agents'));
  await page.getByRole('tab', { name: 'Marketplace' }).click();
  await expect(page.getByText('Capability Marketplace')).toBeVisible();
  await expect(page.getByText('CrashSight Analysis')).toBeVisible();
  await capture(page, 'REQ-006-mcp-skill-marketplace.png');
});

test('REQ-044 backfills screenshots for REQ-001 to REQ-008 @screenshot', async ({ page }) => {
  await openSession(page);

  await page.getByTitle('Switch Agent Profile').click();
  await expect(page.getByRole('listbox', { name: 'Agent Profile' })).toBeVisible();
  await capture(page, 'REQ-001-agent-profiles.png');
  await page.keyboard.press('Escape');

  await expect(page.getByText('Checkpoints').first()).toBeVisible();
  await capture(page, 'REQ-002-checkpoints.png');

  await page.waitForFunction(() => typeof window.openSettings === 'function');
  await page.evaluate(() => window.openSettings?.('agents'));
  await page.getByRole('tab', { name: 'Marketplace' }).click();
  await expect(page.getByText('Capability Marketplace')).toBeVisible();
  await capture(page, 'REQ-003-recipes-workflows.png');
  await capture(page, 'REQ-006-mcp-skill-marketplace.png');

  await page.getByRole('tab', { name: 'Permissions' }).click();
  await expect(page.getByText(/Permission/i).first()).toBeVisible();
  await capture(page, 'REQ-004-permission-presets.png');

  await page.locator('.modal-backdrop button').first().click();
  await expect(page.locator('.modal-backdrop')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('argus-open-tab', { detail: { tab: 'actions' } })));
  await expect(page.getByRole('heading', { name: 'Project profile' })).toBeVisible();
  await capture(page, 'REQ-005-project-profile-init.png');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('argus-open-tab', { detail: { tab: 'chat' } })));
  await expect(page.getByText('Runtime Timeline').first()).toBeVisible();
  await capture(page, 'REQ-007-runtime-timeline.png');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('argus-open-tab', { detail: { tab: 'review' } })));
  await page.getByRole('button', { name: 'Review changes' }).click();
  await expect(page.getByText('Git-native review package')).toBeVisible();
  await capture(page, 'REQ-008-git-native-review-flow.png');

  await writeFile(
    resolve(screenshotDir, 'REQ-044-backfill-manifest.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      screenshots: [
        'REQ-001-agent-profiles.png',
        'REQ-002-checkpoints.png',
        'REQ-003-recipes-workflows.png',
        'REQ-004-permission-presets.png',
        'REQ-005-project-profile-init.png',
        'REQ-006-mcp-skill-marketplace.png',
        'REQ-007-runtime-timeline.png',
        'REQ-008-git-native-review-flow.png',
      ],
    }, null, 2),
  );
});
