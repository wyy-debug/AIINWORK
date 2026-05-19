# Workflow Studio REQ-162 to REQ-171 Verification

Implemented in code, not as static UI labels:

- `REQ-162 Workflow Change History`: workflow saves append persisted revision records with actor, digest, node/edge diff, and audit records.
- `REQ-163 Workflow Draft Publish Flow`: publish stores a compact published definition snapshot; workflow runs prefer the published snapshot.
- `REQ-164 Workflow Review Request`: review requests include DAG diff and risk changes before publish.
- `REQ-165 Workflow Ownership Metadata`: owner, team, maintainer, and support contact are persisted in workflow governance metadata.
- `REQ-166 Workflow Deprecation Flow`: deprecation records reason, replacement workflow, timestamp, and impact.
- `REQ-167 Workflow Usage Analytics`: run counts, success rate, average duration, and common failed nodes are derived from real runs.
- `REQ-168 Workflow Role-based Visibility`: workflow governance stores visible roles and default role.
- `REQ-169 Workflow Compliance Labels`: supported compliance labels are normalized and persisted.
- `REQ-170 Workflow Audit Log Search`: audit search combines governance audit records and run timeline events.
- `REQ-171 Workflow Policy Report`: policy report summarizes status, owner, labels, dependencies, approvals, MCP allowlist, and risky nodes.

New/real API surface:

- `GET /api/workflows/:id/history`
- `GET /api/workflows/:id/governance`
- `PUT /api/workflows/:id/governance`
- `POST /api/workflows/:id/publish`
- `POST /api/workflows/:id/review-requests`
- `POST /api/workflows/:id/deprecate`
- `GET /api/workflows/analytics/usage`
- `GET /api/workflows/audit/search`
- `GET /api/workflows/policy-report`

Verification commands:

- `npm run test:unit -- workflow-studio-service.test.mjs WorkflowStudio.test.tsx`
- `npm run typecheck`
- `DESKTOP_MODE=true WORKFLOW_REAL_SMOKE=1 npm run test:e2e:workflow-real`
- `npm run test:unit`
- `npm run build`
- `npm run check:mojibake`
