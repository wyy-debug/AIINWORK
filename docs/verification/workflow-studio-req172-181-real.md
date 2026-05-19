# Workflow Studio REQ-172 to REQ-181 Verification

Implemented in code, not as static UI labels:

- `REQ-172 Workflow Large Graph Performance`: workflow performance report returns node/edge counts, target status, render cost, and recommendations.
- `REQ-173 Workflow Virtualized Run Logs`: paginated run log API returns offset/limit/total rows.
- `REQ-174 Workflow Offline Read Mode`: offline read snapshot exposes cached workflow/run summaries for read-only display.
- `REQ-175 Workflow Import Validation Sandbox`: sandbox validates workflow packages and reports changes/errors without writing project data.
- `REQ-176 Workflow Storage Backup Restore`: backup/restore APIs cover workflows, runs, node packages, retention policy, smoke, and benchmark state.
- `REQ-177 Workflow Data Retention Policy`: retention policy can be updated and applied to trim old runs and node logs.
- `REQ-178 Workflow Package Size Guard`: package size guard estimates bytes and warns on oversized screenshots/logs/artifacts.
- `REQ-179 Workflow Release Smoke Matrix`: release matrix tracks template, permission, approval, screenshot, and mobile smoke gates.
- `REQ-180 Workflow Migration Doctor`: migration doctor scans schema, node type, template upgrade, and published snapshot compatibility.
- `REQ-181 Workflow Production Readiness Dashboard`: dashboard aggregates performance, quality, dependencies, security, template smoke, recent failures, migration, and smoke matrix.

New/real API surface:

- `GET /api/workflows/:id/performance`
- `GET /api/workflow-runs/:runId/logs/virtualized`
- `GET /api/workflows/offline-snapshot`
- `POST /api/workflows/package/import/sandbox`
- `POST /api/workflows/storage/backup`
- `POST /api/workflows/storage/restore`
- `GET /api/workflows/retention-policy`
- `PUT /api/workflows/retention-policy`
- `POST /api/workflows/retention-policy/apply`
- `GET /api/workflows/package-size-guard`
- `GET /api/workflows/release-smoke-matrix`
- `GET /api/workflows/migration-doctor`
- `GET /api/workflows/production-readiness`

Verification commands:

- `npm run test:unit -- workflow-studio-service.test.mjs WorkflowStudio.test.tsx`
- `npm run typecheck`
- `DESKTOP_MODE=true WORKFLOW_REAL_SMOKE=1 npm run test:e2e:workflow-real`
- `npm run test:unit`
- `npm run build`
- `npm run check:mojibake`
