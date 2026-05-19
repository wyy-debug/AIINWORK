# Workflow Studio REQ-112 to REQ-121 Verification

Scope: run console refresh, logs, retry, cancellation, resume, pinning, and archive controls.

## Requirements

- `REQ-112 Workflow Run Live Polling Strategy`: Runs shows the active refresh strategy.
- `REQ-113 Workflow Run Streaming Logs`: Runs exposes a streaming log area.
- `REQ-114 Workflow Run Log Search`: Logs can be filtered by node, status, or message text.
- `REQ-115 Workflow Run Compare Attempts`: Run details summarize node attempts for comparison.
- `REQ-116 Workflow Retry Node Only`: Failed nodes expose a retry-only action.
- `REQ-117 Workflow Retry From Node Preview`: Retry-from shows affected downstream nodes before action.
- `REQ-118 Workflow Cancel Confirmation`: Cancellation explains artifact/checkpoint impact first.
- `REQ-119 Workflow Resume Banner`: Waiting/recovering runs are surfaced in a resume banner.
- `REQ-120 Workflow Run Pinning`: Run history supports pin/unpin.
- `REQ-121 Workflow Run Archive`: Run history exposes archive controls.

## Evidence

Expected Playwright screenshots:

- `REQ-112-workflow-run-live-polling-strategy.png`
- `REQ-113-workflow-run-streaming-logs.png`
- `REQ-114-workflow-run-log-search.png`
- `REQ-115-workflow-run-compare-attempts.png`
- `REQ-116-workflow-retry-node-only.png`
- `REQ-117-workflow-retry-from-node-preview.png`
- `REQ-118-workflow-cancel-confirmation.png`
- `REQ-119-workflow-resume-banner.png`
- `REQ-120-workflow-run-pinning.png`
- `REQ-121-workflow-run-archive.png`

## Verification Commands

- `npm run test:unit -- WorkflowStudio.test.tsx e2e-screenshot-gate.test.ts`
- `npm run typecheck`
- `npm run test:e2e:workflow-real`
- `npm run test:unit`
- `npm run build`
- `npm run check:mojibake`
