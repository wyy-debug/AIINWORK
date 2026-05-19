# Screenshot Evidence Gate

UI-facing GitHub issues cannot be closed with unit tests alone. A closing comment must include:

- Verification command: `npm run test:e2e:screenshots`
- Screenshot artifact paths under `claudecodeui/output/playwright/screenshots`
- At least one visible success, empty, or error state for the changed UI
- Trace or failure screenshot location when the run fails

AI may help discover selectors or draft a Playwright spec, but the closure gate is a deterministic Playwright test that can be rerun locally.

For settings or visibility features, capture before/after or a screenshot that shows the controlling switch and the affected panel. For backend-only issues, screenshot evidence is optional, but API output or unit test evidence must be linked in the closing comment.

REQ-049 Workflow Studio closure requires these deterministic screenshots:

- `REQ-049-workflow-editor.png`
- `REQ-049-workflow-runner-approval.png`
- `REQ-049-workflow-history-completed.png`
