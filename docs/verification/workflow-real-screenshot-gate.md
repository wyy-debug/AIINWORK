# Workflow Real Screenshot Gate

`REQ-057` upgrades Workflow Studio closure from mock screenshots to a real backend smoke gate.

Run it against a local desktop-mode dev server:

```powershell
$env:DESKTOP_MODE="true"
$env:WORKFLOW_REAL_SMOKE="1"
npm run test:e2e:workflow-real
```

Required evidence before closing workflow execution issues:

- `claudecodeui/output/playwright/screenshots/REQ-057-real-workflow-editor.png`
- `claudecodeui/output/playwright/screenshots/REQ-057-real-workflow-approval.png`
- `claudecodeui/output/playwright/screenshots/REQ-057-real-workflow-completed-history.png`
- Playwright trace/video from `claudecodeui/output/playwright/test-results` when the run fails.

Rules:

- Do not mock `/api/workflows` or `/api/workflow-runs` in the real gate.
- The spec must create a temporary workflow through the real API, run it to approval, continue it, confirm completed history, then clean up.
- GitHub issue closure must attach or reference the screenshot paths.
