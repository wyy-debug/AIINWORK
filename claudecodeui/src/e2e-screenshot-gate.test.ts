import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('E2E screenshot evidence gate', () => {
  it('exposes Playwright E2E scripts and configuration', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    expect(packageJson.scripts['test:e2e']).toBe('playwright test --config=playwright.config.ts');
    expect(packageJson.scripts['test:e2e:ui']).toBe('playwright test --ui --config=playwright.config.ts');
    expect(packageJson.scripts['test:e2e:screenshots']).toBe('playwright test --config=playwright.config.ts --grep @screenshot');
    expect(packageJson.devDependencies['@playwright/test']).toBeTruthy();
    expect(existsSync(resolve(root, 'playwright.config.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'e2e/runtime-panels.screenshot.spec.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'e2e/agent-capabilities.screenshot.spec.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'e2e/workflow-studio.screenshot.spec.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'e2e/workflow-studio-real.screenshot.spec.ts'))).toBe(true);
    expect(existsSync(resolve(root, '../docs/verification/screenshot-evidence-gate.md'))).toBe(true);
    expect(existsSync(resolve(root, '../docs/verification/req-001-008-screenshot-backfill.md'))).toBe(true);
    expect(existsSync(resolve(root, '../docs/verification/workflow-real-screenshot-gate.md'))).toBe(true);

    const spec = readFileSync(resolve(root, 'e2e/agent-capabilities.screenshot.spec.ts'), 'utf8');
    [
      'REQ-043-settings-debug-panel.png',
      'REQ-043-runtime-drawer-panels.png',
      'REQ-043-marketplace-agent-profile-entry.png',
      'REQ-001-agent-profiles.png',
      'REQ-002-checkpoints.png',
      'REQ-003-recipes-workflows.png',
      'REQ-004-permission-presets.png',
      'REQ-005-project-profile-init.png',
      'REQ-006-mcp-skill-marketplace.png',
      'REQ-007-runtime-timeline.png',
      'REQ-008-git-native-review-flow.png',
      'REQ-049-workflow-editor.png',
      'REQ-049-workflow-runner-approval.png',
      'REQ-049-workflow-history-completed.png',
      'REQ-057-real-workflow-editor.png',
      'REQ-057-real-workflow-approval.png',
      'REQ-057-real-workflow-completed-history.png',
      'REQ-081-editor-react-flow-canvas.png',
      'REQ-081-library-template-gallery.png',
      'REQ-081-inspector-node-config.png',
      'REQ-081-run-console-approval.png',
      'REQ-081-mobile-run-approval.png',
    ].forEach((screenshotName) => {
      const workflowSpec = readFileSync(resolve(root, 'e2e/workflow-studio.screenshot.spec.ts'), 'utf8');
      const realWorkflowSpec = readFileSync(resolve(root, 'e2e/workflow-studio-real.screenshot.spec.ts'), 'utf8');
      expect(`${spec}\n${workflowSpec}\n${realWorkflowSpec}`).toContain(screenshotName);
    });

    const realWorkflowSpec = readFileSync(resolve(root, 'e2e/workflow-studio-real.screenshot.spec.ts'), 'utf8');
    expect(realWorkflowSpec).not.toContain("page.route('**/api/**'");
    expect(realWorkflowSpec).not.toContain('installMockApi');
  });
});
