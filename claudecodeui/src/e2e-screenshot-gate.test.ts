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
      'REQ-082-workflow-home-overview.png',
      'REQ-083-workflow-empty-state-guide.png',
      'REQ-084-workflow-first-run-wizard.png',
      'REQ-085-workflow-command-palette.png',
      'REQ-086-workflow-recent-objects.png',
      'REQ-087-workflow-favorites.png',
      'REQ-088-workflow-breadcrumb-and-deep-link.png',
      'REQ-089-workflow-status-taxonomy.png',
      'REQ-090-workflow-help-overlay.png',
      'REQ-091-workflow-keyboard-shortcuts-panel.png',
      'REQ-092-workflow-multi-select-nodes.png',
      'REQ-093-workflow-copy-paste-nodes.png',
      'REQ-094-workflow-duplicate-subgraph.png',
      'REQ-095-workflow-undo-redo.png',
      'REQ-096-workflow-auto-layout-modes.png',
      'REQ-097-workflow-layout-lock.png',
      'REQ-098-workflow-edge-route-styles.png',
      'REQ-099-workflow-edge-branch-labels.png',
      'REQ-100-workflow-graph-minimap-filters.png',
      'REQ-101-workflow-graph-validation-badges.png',
      'REQ-102-workflow-node-schema-versioning.png',
      'REQ-103-workflow-node-config-presets.png',
      'REQ-104-workflow-required-field-guard.png',
      'REQ-105-workflow-secret-field-type.png',
      'REQ-106-workflow-json-config-editor.png',
      'REQ-107-workflow-typed-variable-picker.png',
      'REQ-108-workflow-mapping-preview.png',
      'REQ-109-workflow-transform-functions.png',
      'REQ-110-workflow-output-contract-test.png',
      'REQ-111-workflow-data-lineage-view.png',
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
