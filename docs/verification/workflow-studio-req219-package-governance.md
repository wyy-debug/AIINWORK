# REQ-219 Workflow Package Publish and Import Governance

## Scope

- Workflow packages now require `manifestVersion: "1"` and include package id, version, dependencies, dependency lock, trust level, screenshots, and smoke metadata.
- Export preview surfaces package governance metadata and an import preview.
- Import preview reports add/overwrite changes, conflicts, missing dependencies, trust warnings, screenshots, and smoke state without mutating workflow state.
- Imported workflows preserve the original package manifest snapshot on workflow metadata.

## Evidence

- Backend and UI contracts: `npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs src/components/workflows/view/WorkflowStudio.test.tsx`
- Screenshot gate: `npm run test:e2e:screenshots -- --grep "REQ-219"`
- Screenshots:
  - `claudecodeui/output/playwright/screenshots/REQ-219C-package-export-governance.png`
  - `claudecodeui/output/playwright/screenshots/REQ-219D-trust-smoke-governance.png`

## Acceptance Notes

- Missing or invalid package manifest versions fail validation.
- Invalid dependency lock entries fail validation.
- Community/unsigned packages expose trust warnings.
- Failed smoke state includes a visible failure reason.
