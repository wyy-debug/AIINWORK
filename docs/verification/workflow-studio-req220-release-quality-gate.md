# REQ-220 Workflow Release Quality Gate Verification

## Scope

- Added a desktop-only Workflow Studio release quality gate script.
- Added evidence manifest validation for required workflow screenshots.
- Wired the gate into Windows release packaging before the Electron package step.
- Surfaced release quality state in the Workflow Studio readiness dashboard.

## Evidence

- Screenshot gate: `claudecodeui/output/playwright/screenshots/REQ-220C-readiness-dashboard.png`
- Gate command: `npm run workflow:quality-gate`
- Packaging gate: `npm run package:release-win` now runs `npm run workflow:quality-gate` before `package-electron-win`.

## Verification Commands

```bash
npm run test:unit -- scripts/workflow-release-quality-gate.test.mjs server/services/tests/workflow-studio-service.test.mjs src/components/workflows/view/WorkflowStudio.test.tsx
npm run test:e2e:screenshots -- --grep "REQ-220"
npm run typecheck
npm run check:mojibake
npm run build
```

## Acceptance Notes

- The gate covers dry-run preview, Python custom node, approval allow/ask/deny, artifact output, retry failed node controls, MCP fixture, and Agent/Subagent handoff.
- Mobile evidence is intentionally not required.
- Missing screenshots fail the gate with explicit `Missing screenshot evidence` reasons.
- The generated evidence manifest includes `manifestVersion: "1"`, commit SHA, scenario id, issue id, command, and screenshot path.
