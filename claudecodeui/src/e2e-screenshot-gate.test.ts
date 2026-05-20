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
      'REQ-081-editor-flowgram-canvas.png',
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
      'REQ-112-workflow-run-live-polling-strategy.png',
      'REQ-113-workflow-run-streaming-logs.png',
      'REQ-114-workflow-run-log-search.png',
      'REQ-115-workflow-run-compare-attempts.png',
      'REQ-116-workflow-retry-node-only.png',
      'REQ-117-workflow-retry-from-node-preview.png',
      'REQ-118-workflow-cancel-confirmation.png',
      'REQ-119-workflow-resume-banner.png',
      'REQ-120-workflow-run-pinning.png',
      'REQ-121-workflow-run-archive.png',
      'REQ-122-workflow-approval-risk-explanation.png',
      'REQ-123-workflow-approval-diff-summary.png',
      'REQ-124-workflow-approval-timeout-policy.png',
      'REQ-125-workflow-approval-delegation.png',
      'REQ-126-workflow-approval-audit-export.png',
      'REQ-127-workflow-permission-dry-run.png',
      'REQ-128-workflow-permission-override-request.png',
      'REQ-129-workflow-secret-vault-integration.png',
      'REQ-130-workflow-mcp-allowlist-ui.png',
      'REQ-131-workflow-dangerous-command-policy.png',
      'REQ-132-workflow-agent-session-link.png',
      'REQ-133-workflow-agent-prompt-preview.png',
      'REQ-134-workflow-agent-result-contract.png',
      'REQ-135-workflow-subagent-pool-limit.png',
      'REQ-136-workflow-subagent-cancellation-bridge.png',
      'REQ-137-workflow-mcp-tool-catalog-sync.png',
      'REQ-138-workflow-mcp-argument-builder.png',
      'REQ-139-workflow-mcp-error-normalization.png',
      'REQ-140-workflow-tool-node-registry.png',
      'REQ-141-workflow-browser-screenshot-node.png',
      'REQ-142-workflow-template-detail-page.png',
      'REQ-143-workflow-template-dependency-check.png',
      'REQ-144-workflow-template-smoke-badge.png',
      'REQ-145-workflow-template-version-upgrade.png',
      'REQ-146-workflow-template-migration-notes.png',
      'REQ-147-workflow-template-fork.png',
      'REQ-148-workflow-package-export-wizard.png',
      'REQ-149-workflow-package-import-preview.png',
      'REQ-150-workflow-marketplace-trust-badge.png',
      'REQ-151-workflow-enterprise-template-pack.png',
      'REQ-152-workflow-event-timeline-correlation.png',
      'REQ-153-workflow-replay-visualizer.png',
      'REQ-154-workflow-failure-classifier.png',
      'REQ-155-workflow-recommended-recovery-action.png',
      'REQ-156-workflow-artifact-gallery.png',
      'REQ-157-workflow-screenshot-evidence-viewer.png',
      'REQ-158-workflow-benchmark-trend.png',
      'REQ-159-workflow-release-readiness-detail.png',
      'REQ-160-workflow-test-coverage-map.png',
      'REQ-161-workflow-evidence-export.png',
      'REQ-162-workflow-change-history.png',
      'REQ-163-workflow-draft-publish-flow.png',
      'REQ-164-workflow-review-request.png',
      'REQ-165-workflow-ownership-metadata.png',
      'REQ-166-workflow-deprecation-flow.png',
      'REQ-167-workflow-usage-analytics.png',
      'REQ-168-workflow-role-based-visibility.png',
      'REQ-169-workflow-compliance-labels.png',
      'REQ-170-workflow-audit-log-search.png',
      'REQ-171-workflow-policy-report.png',
      'REQ-172-workflow-large-graph-performance.png',
      'REQ-173-workflow-virtualized-run-logs.png',
      'REQ-174-workflow-offline-read-mode.png',
      'REQ-175-workflow-import-validation-sandbox.png',
      'REQ-176-workflow-storage-backup-restore.png',
      'REQ-177-workflow-data-retention-policy.png',
      'REQ-178-workflow-package-size-guard.png',
      'REQ-179-workflow-release-smoke-matrix.png',
      'REQ-180-workflow-migration-doctor.png',
      'REQ-181-workflow-production-readiness-dashboard.png',
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
