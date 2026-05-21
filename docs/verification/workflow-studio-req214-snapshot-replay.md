# Workflow Snapshot Replay Evidence

`REQ-214D` closes the Workflow Run Snapshot and Replay Hardening parent only when historical snapshot and replay evidence are reproducible.

Run commands:

```powershell
npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs
npm run test:unit -- src/components/workflows src/e2e-screenshot-gate.test.ts
npm run test:e2e:screenshots -- --grep "REQ-214C|REQ-214D"
npm run typecheck
npm run check:mojibake
npm run build
```

Required screenshots:

- `claudecodeui/output/playwright/screenshots/REQ-214C-historical-run-snapshot.png`
- `claudecodeui/output/playwright/screenshots/REQ-214D-snapshot-replay-evidence.png`

Close criteria:

- Historical run screenshot shows the `Historical snapshot` badge.
- Historical run screenshot shows `Changed since run` when the current workflow differs from the run-time snapshot.
- Snapshot details show workflow name, profile/preset, input keys, package snapshot count or IDs, and resolver/capture metadata.
- Replay evidence screenshot shows replay event count, `snapshot loaded`, and selected run status.
- Backend replay tests prove completed/failed/waiting runs rebuild from event logs and report missing/out-of-order diagnostics.
- GitHub issue and kanban close comments must include the command list and screenshot paths above.
