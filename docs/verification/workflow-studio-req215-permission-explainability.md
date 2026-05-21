# Workflow Permission Explainability Evidence

REQ-215 closes when workflow permission decisions are structured, visible, and auditable.

Run commands:

```powershell
npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs src/components/workflows/view/WorkflowStudio.test.tsx
npm run test:e2e:screenshots -- --grep "REQ-215"
npm run typecheck
npm run check:mojibake
```

Screenshot evidence:

- `claudecodeui/output/playwright/screenshots/REQ-215B-approval-capability-context.png`
- `claudecodeui/output/playwright/screenshots/REQ-215D-allow-ask-deny-evidence.png`

Close criteria:

- Permission dry-run rows include requested capabilities, effective capabilities, risk reasons, and a human explanation.
- `enterprise-safe` denies dangerous shell commands such as destructive git workspace operations.
- Approval cards show the requested capability and risk reasons before the user approves or rejects.
- Run events persist permission explanations for denied and waiting-approval nodes.
