# Workflow Studio REQ-081 UI Productization Evidence

## Scope

REQ-081 upgrades Workflow Studio UI without adding backend runtime capability.

Implemented:

- Workflow Command Center with workflow/profile/permission/latest run state.
- Run setup drawer instead of always-visible run inputs.
- React Flow canvas using `@xyflow/react`, `ReactFlow`, `Background`, `Controls`, `MiniMap`, and `Handle`.
- Grouped node palette and Inspector tabs.
- Template gallery with filters and preview panel.
- Runs three-column console with run list, live graph, Approval Inbox, run history, and failure diagnosis panel.

## Verification

Commands run:

```powershell
npm run test:unit
npm run typecheck
npm run build
npm run check:mojibake
$env:DESKTOP_MODE='true'; $env:WORKFLOW_REAL_SMOKE='1'; npm run test:e2e:workflow-real
npm run package:debug-win
npm run smoke:packaged-debug
```

## Screenshot Evidence

- `claudecodeui/output/playwright/screenshots/REQ-081-editor-react-flow-canvas.png`
- `claudecodeui/output/playwright/screenshots/REQ-081-library-template-gallery.png`
- `claudecodeui/output/playwright/screenshots/REQ-081-inspector-node-config.png`
- `claudecodeui/output/playwright/screenshots/REQ-081-run-console-approval.png`
- `claudecodeui/output/playwright/screenshots/REQ-081-mobile-run-approval.png`

## Closure

REQ-081 and child issues can be closed only after package smoke passes with these screenshots present.

Package smoke passed against:

- `workspace/vendor/debug/Argus-Debug-1.31.1/Argus-Debug.exe`
