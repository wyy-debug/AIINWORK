# Workflow Studio REQ-082 to REQ-091 Evidence

## Scope

REQ-082 to REQ-091 complete the first Workflow Studio onboarding and wayfinding batch:

- Home overview with active work, failed work, approvals, favorites, recent workflows, and status taxonomy.
- Empty state guide for projects with no workflows.
- First run wizard surface.
- Command palette.
- Recent objects and favorites.
- Breadcrumb and workflow deep link action.
- Help overlay and keyboard shortcuts panel.

## Verification

Commands run:

```powershell
npm run test:unit -- src/components/workflows/view/WorkflowStudio.test.tsx src/e2e-screenshot-gate.test.ts
npm run typecheck
$env:DESKTOP_MODE='true'; $env:WORKFLOW_REAL_SMOKE='1'; npm run test:e2e:workflow-real
npm run test:e2e -- e2e/workflow-studio.screenshot.spec.ts
```

## Screenshot Evidence

- `claudecodeui/output/playwright/screenshots/REQ-082-workflow-home-overview.png`
- `claudecodeui/output/playwright/screenshots/REQ-083-workflow-empty-state-guide.png`
- `claudecodeui/output/playwright/screenshots/REQ-084-workflow-first-run-wizard.png`
- `claudecodeui/output/playwright/screenshots/REQ-085-workflow-command-palette.png`
- `claudecodeui/output/playwright/screenshots/REQ-086-workflow-recent-objects.png`
- `claudecodeui/output/playwright/screenshots/REQ-087-workflow-favorites.png`
- `claudecodeui/output/playwright/screenshots/REQ-088-workflow-breadcrumb-and-deep-link.png`
- `claudecodeui/output/playwright/screenshots/REQ-089-workflow-status-taxonomy.png`
- `claudecodeui/output/playwright/screenshots/REQ-090-workflow-help-overlay.png`
- `claudecodeui/output/playwright/screenshots/REQ-091-workflow-keyboard-shortcuts-panel.png`

## Closure

REQ-082 to REQ-091 can be closed when the full unit, typecheck, build, mojibake, and relevant screenshot gates pass.
