# Workflow Studio REQ-122..131 Real Verification

Scope:
- `REQ-122 Workflow Approval Risk Explanation`
- `REQ-123 Workflow Approval Diff Summary`
- `REQ-124 Workflow Approval Timeout Policy`
- `REQ-125 Workflow Approval Delegation`
- `REQ-126 Workflow Approval Audit Export`
- `REQ-127 Workflow Permission Dry Run`
- `REQ-128 Workflow Permission Override Request`
- `REQ-129 Workflow Secret Vault Integration`
- `REQ-130 Workflow MCP Allowlist UI`
- `REQ-131 Workflow Dangerous Command Policy`

Real implementation evidence:
- Backend now exposes workflow security state through `GET /api/workflows/:id/security` and `PUT /api/workflows/:id/security`.
- Backend now exposes `GET /api/workflows/:id/permission-dry-run`.
- Backend now records permission override requests through `POST /api/workflows/:id/permission-overrides`.
- Backend now exports approval audit records through `GET /api/workflows/:id/approval-audit/export` and `GET /api/workflow-approvals/audit/export`.
- Approval inbox records now include risk explanation, diff/checkpoint summary, timeout policy, delegation data, and audit trail.
- Dangerous shell commands are detected in the workflow permission resolver and force `ask` even when the workflow preset would otherwise allow execution.
- Workflow security metadata persists secret references and MCP allowlists without storing plaintext secret values.

Verification commands:
- `npm run test:unit -- workflow-studio-service.test.mjs WorkflowStudio.test.tsx`
- `npm run typecheck`
- `DESKTOP_MODE=true WORKFLOW_REAL_SMOKE=1 npm run test:e2e:workflow-real`

Screenshot evidence:
- `REQ-122-workflow-approval-risk-explanation.png`
- `REQ-123-workflow-approval-diff-summary.png`
- `REQ-124-workflow-approval-timeout-policy.png`
- `REQ-125-workflow-approval-delegation.png`
- `REQ-126-workflow-approval-audit-export.png`
- `REQ-127-workflow-permission-dry-run.png`
- `REQ-128-workflow-permission-override-request.png`
- `REQ-129-workflow-secret-vault-integration.png`
- `REQ-130-workflow-mcp-allowlist-ui.png`
- `REQ-131-workflow-dangerous-command-policy.png`
