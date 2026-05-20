# UI Bug Sweep Verification

Date: 2026-05-20

## Scope

- BUG-UI-001 Workflow Studio Desktop Layout Overflow
- BUG-UI-002 Workflow Studio Mobile Read/Run Layout
- BUG-UI-003 Workflow Studio Inspector Density
- BUG-UI-004 Workflow Runs Console Usability
- BUG-UI-005 Chat Runtime Drawer Panel Layout
- BUG-UI-006 Argus Brain Diagnostics Readability
- BUG-UI-007 Sidebar Project Action Hit Targets
- BUG-UI-008 Agent Profile / Composer Popover Placement
- BUG-UI-009 Settings Debug Visibility Controls
- BUG-UI-010 Real UI Screenshot Gate Upgrade

## Screenshot Evidence

- `output/playwright/screenshots/BUG-UI-001-workflow-desktop-editor.png`
- `output/playwright/screenshots/BUG-UI-002-workflow-mobile-read-run.png`
- `output/playwright/screenshots/BUG-UI-003-workflow-inspector-density.png`
- `output/playwright/screenshots/BUG-UI-004-workflow-runs-console.png`
- `output/playwright/screenshots/BUG-UI-005-runtime-drawer-desktop.png`
- `output/playwright/screenshots/BUG-UI-006-argus-brain-diagnostics.png`
- `output/playwright/screenshots/BUG-UI-007-sidebar-hit-targets.png`
- `output/playwright/screenshots/BUG-UI-008-agent-profile-mobile-popover.png`
- `output/playwright/screenshots/BUG-UI-009-settings-debug-visibility.png`
- `output/playwright/screenshots/BUG-UI-010-real-screenshot-gate.png`

## Commands

- `npx playwright test --config=playwright.config.ts e2e/ui-bug-sweep.screenshot.spec.ts` - passed, 9 tests.
- `npm run test:unit -- WorkflowStudio.test.tsx AgentRuntimeDiagnosticsPanel.test.tsx SidebarProjectItem.test.tsx DebugSettingsTab.test.ts ChatInterface.runtime-panels.test.ts` - passed, 5 files, 6 tests.
- `npm run test:e2e:screenshots` - passed, 17 passed, 1 skipped.
- `npm run typecheck` - passed.
- `npm run build` - passed.
- `npm run check:mojibake` - passed, no mojibake patterns found.

## Fix Summary

- Workflow Studio hides the dense desktop React Flow editor on mobile and provides a read/run mobile panel.
- Workflow Studio screenshot gates now cover desktop editor overflow, inspector density, runs console approval/log usability, and mobile invariants.
- Sidebar project edit/new-session actions now have 36px hit targets and stable project-name input test ids.
- Settings Debug visibility controls now have stable selectors and verified persistence to local runtime debug settings.
- Sidebar and Settings fallback text mojibake was removed.
- Pill buttons now forward button attributes, allowing stable test ids on mobile settings tabs.
