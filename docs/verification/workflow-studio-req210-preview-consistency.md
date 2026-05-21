# Workflow Preview Consistency Evidence

`REQ-210C` verifies that Workflow Studio can prove both preview/run matched and preview/run changed states before closing the `REQ-210` parent.

Run command:

```powershell
npm run test:e2e:screenshots -- --grep "REQ-210C"
```

Required screenshots:

- `claudecodeui/output/playwright/screenshots/REQ-210C-preview-matched-run-console.png`
- `claudecodeui/output/playwright/screenshots/REQ-210C-preview-changed-run-console.png`

Close criteria:

- The matched screenshot shows `workflow-preview-consistency-chip` as `Matched`.
- The changed screenshot shows `workflow-preview-consistency-chip` as `Review diff`.
- The changed screenshot includes at least one changed node and the preview drift reason.
- `REQ-210A` and `REQ-210B` unit/source tests remain green.
