# Workflow Studio REQ-152..161 Real Verification

Scope:
- `REQ-152 Workflow Event Timeline Correlation`
- `REQ-153 Workflow Replay Visualizer`
- `REQ-154 Workflow Failure Classifier`
- `REQ-155 Workflow Recommended Recovery Action`
- `REQ-156 Workflow Artifact Gallery`
- `REQ-157 Workflow Screenshot Evidence Viewer`
- `REQ-158 Workflow Benchmark Trend`
- `REQ-159 Workflow Release Readiness Detail`
- `REQ-160 Workflow Test Coverage Map`
- `REQ-161 Workflow Evidence Export`

Real implementation evidence:
- Backend exposes `GET /api/workflow-runs/:runId/failures`.
- Backend exposes `GET /api/workflow-runs/:runId/recovery-actions`.
- Backend exposes `GET /api/workflow-runs/:runId/artifacts`.
- Backend exposes `GET /api/workflow-runs/:runId/evidence`.
- Backend exposes `GET /api/workflow-runs/:runId/evidence/export`.
- Backend exposes `GET /api/workflow-benchmarks/trend`.
- Backend exposes `GET /api/workflow-benchmarks/coverage-map`.
- Evidence export bundles run data, events, replay, failure classification, recovery actions, artifacts, screenshots, release readiness, and coverage map.
- Frontend reads real run observability/evidence/benchmark/coverage state.

Verification commands:
- `npm run test:unit -- workflow-studio-service.test.mjs WorkflowStudio.test.tsx`
- `npm run typecheck`
- `DESKTOP_MODE=true WORKFLOW_REAL_SMOKE=1 npm run test:e2e:workflow-real`

Screenshot evidence:
- `REQ-152-workflow-event-timeline-correlation.png`
- `REQ-153-workflow-replay-visualizer.png`
- `REQ-154-workflow-failure-classifier.png`
- `REQ-155-workflow-recommended-recovery-action.png`
- `REQ-156-workflow-artifact-gallery.png`
- `REQ-157-workflow-screenshot-evidence-viewer.png`
- `REQ-158-workflow-benchmark-trend.png`
- `REQ-159-workflow-release-readiness-detail.png`
- `REQ-160-workflow-test-coverage-map.png`
- `REQ-161-workflow-evidence-export.png`
