# REQ-216 Workflow Runtime Artifact Contract

## Scope

Workflow runs now normalize node artifacts into a stable `WorkflowArtifactRef` contract and create a terminal run summary artifact when a run reaches a final state. The Runs UI exposes those refs in the Artifact Gallery with copy/evidence actions.

## Evidence

- Backend unit coverage: `server/services/tests/workflow-studio-service.test.mjs`
- Frontend source contract: `src/components/workflows/view/WorkflowStudio.test.tsx`
- Screenshot gate: `output/playwright/screenshots/REQ-216B-artifact-gallery-contract.png`

## Validation Commands

```bash
npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs src/components/workflows/view/WorkflowStudio.test.tsx
npm run test:e2e:screenshots -- --grep "REQ-216"
npm run typecheck
npm run check:mojibake
npm run build
```

## Acceptance Notes

- Node executor artifacts are copied into `nodeRun.artifacts` with `runId`, `nodeId`, `type`, `title`, `path`, `mimeType`, `size`, `summary`, and `createdAt`.
- Terminal runs include a `workflow-run-summary` artifact.
- Artifact Gallery rows expose `Copy path` and `Attach evidence` actions.
- Empty observability artifact payloads no longer hide selected run artifacts.
