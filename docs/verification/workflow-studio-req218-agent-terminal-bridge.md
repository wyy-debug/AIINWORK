# REQ-218 Agent and Subagent Terminal Result Bridge

## Scope

- Agent workflow nodes normalize terminal outputs into `summary`, `status`, `sessionId`, `sessionLink`, `diffRefs`, and `artifacts`.
- Subagent workflow nodes wait for terminal status, bridge streamed logs, normalize artifacts, and keep the subagent run reference.
- Runs UI exposes terminal result evidence, open session links, subagent stream logs, and upstream handoff input.

## Evidence

- Backend contract: `npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs`
- UI source contract: `npm run test:unit -- src/components/workflows/view/WorkflowStudio.test.tsx`
- Screenshot gate: `npm run test:e2e:screenshots -- --grep "REQ-218"`
- Screenshot: `claudecodeui/output/playwright/screenshots/REQ-218D-agent-handoff-run.png`

## Acceptance Notes

- `Explore Subagent -> Reviewer Subagent -> Build Agent` can be represented as one completed workflow run.
- Subagent logs are visible in the workflow node logs and in the Runs evidence panel.
- The Build Agent receives reviewer output through the resolved node input.
- Agent session links are generated from returned `sessionId` when a direct `sessionLink` is not supplied.
