# MTL-Code Stabilization Development Plan

Last updated: 2026-05-05

This plan is driven by `2026-05-05-requirements-status.md`.

## Working Rules

1. Update the requirement status before starting a requirement.
2. Write or update the failing test first.
3. Verify RED for that requirement.
4. Implement the behavior.
5. Verify GREEN for the focused test.
6. Update the requirement status:
   - `Implementation complete` when code is done but not fully validated.
   - `Test complete` when required tests and checks pass.
   - `Bug pending` when a test fails because the implementation is wrong.
   - `Needs new requirement` when work reveals new behavior not covered by the current requirement.
7. Run broad gates only after the focused requirement is green.

## Current Baseline

Already green:
- UI unit test runner exists.
- Subagent manager snapshot priority is covered.
- Task notification priority is covered.
- Async launch control text is filtered.
- Subagent active summary only counts running tasks.
- Debug package and release package scripts exist and have been run once.
- Packaged debug smoke automation has passed once.
- Background Agent detail rows, stop request builder, and blocker guidance have unit coverage.
- Subagent event-driven dispatch foundation is in place for debug/test: structured local events feed `AgentDispatchPlan`, `DispatchManager` issues one-shot tickets, and `AgentSpawn` consumes tickets only.

Still missing:
- UI smoke for the expanded background Agent management panel.
- Runtime hard-cap tests for per-turn spawn/concurrency and nested spawn.
- Stable ID grouping tests for subagent tool history.
- Agent/Skill/MCP dependency diagnostics coverage.
- Conversation-first worktree dispatch.
- Debug UI for proposal/event/ticket snapshots.

## Next Development Slices

### Slice A: P0 Smoke Harness

Requirements:
- P0-04

Need:
- A script that can start the debug portable package or accept an existing packaged app URL.
- A smoke command that checks shell load and hidden subagent control noise.
- Documentation of how to run smoke manually if the packaged app is already running.

Tests:
- Unit test for smoke config resolution if pure helper is introduced.
- `npm run smoke:ui` against running app.

Exit:
- P0-04 becomes `Test complete`.

### Slice B: P1 Background Agent Management Panel

Requirements:
- P1-03
- P1-04
- P1-06
- P1-07

Need:
- Pure model helper for display items and blocker guidance.
- Expandable composer panel using `SubagentActivitySummary.historyItems`.
- Stop single Agent action.
- Copy evidence action.
- Reuse objective action.
- Chinese action guidance for common blockers.

Tests:
- Guidance helper tests.
- Activity model tests for running/history separation.
- UI smoke or component-level test if feasible.

Exit:
- P1-03, P1-04, P1-06, P1-07 updated individually. P1-03/P1-05/P1-06 still need UI smoke before moving from `Implementation complete` to `Test complete`.

### Slice C: P2 Runtime Hard Constraints

Requirements:
- P2-01
- P2-02
- P2-03
- P2-05
- P2-10

Need:
- Explicit accounting by user turn.
- Same-turn spawn gate.
- Same-turn running/concurrency gate.
- Nested spawn validation.
- Completion notification redispatch gate.

Tests:
- Bun tests for each gate.
- Existing runtime tests remain green.

Exit:
- Runtime gates become `Test complete`. P2-01, P2-02, P2-03, P2-05, and P2-10 now have focused policy tests and AgentTool uses the tested policy module.

### Slice C2: Event-Driven Subagent Dispatch

Requirements:
- P2 dispatch control follow-up

Need:
- Keep release Subagent hard-disabled.
- Record model, Skill, MCP, permission, and tool events for the active session/user turn.
- Make `AgentDispatchPlan` the read-only proposal entry.
- Make `DispatchManager` the only ticket issuer.
- Make `AgentSpawn` ticket-only.
- Remove/avoid visible natural-language plan gates, text regex policy, OpenMythos auto-worker bypasses, and teammate/name bypasses.

Tests:
- DispatchManager tests for missing events, matching MCP/Skill/model/permission events, duplicate objective, and ticket scoping.
- AgentControlTool tests for requirement schema mapping.
- AgentSpawn ticket tests for missing/expired/used/cross-scope/objective mismatch.
- OpenMythos worker tests proving it cannot launch while hard-disabled.

Exit:
- Event-driven dispatch stays debug/test-only but has typed events, one-shot tickets, and verified no legacy visible-plan bypass markers.

### Slice D: P3 Message Grouping And History

Requirements:
- P3-04
- P3-05
- P3-06

Need:
- Grouping helper keyed by `taskId`, `parentToolUseId`, `toolId`.
- Tests with interleaved subagent tools.
- History load path documented and covered.

Tests:
- `useChatMessages` grouping tests.
- Store/adaptor tests if history transformation is isolated.

Exit:
- Remaining text-adjacent grouping risk removed.

### Slice E: P4 Release Automation

Requirements:
- P4-02
- P4-03
- P4-05

Need:
- More Agent control tests.
- Auth-failure guard test.
- Packaged smoke runner or documented packaged smoke command.

Tests:
- Bun control tool suite.
- Bun guard suite.
- Packaged UI smoke.

Exit:
- Release gates can be run repeatably before every package.

### Slice F: P5 Diagnostics

Requirements:
- P5-01 through P5-05

Need:
- Dependency summary model.
- Secret redaction helper.
- MCP diagnose test fixtures.
- Skill runtime injection debug assertions.

Tests:
- Unit tests for redaction and dependency summary.
- API tests for diagnose response shape.

Exit:
- Agent/Skill/MCP runtime visibility is reliable.

### Slice G: P6 Conversation Worktree Dispatch

Requirements:
- P6-01 through P6-06

Need:
- Conversation menu actions.
- Dispatch payload model.
- Binding inheritance.
- Dirty delete action guidance.

Tests:
- Payload unit tests.
- Git fixture API tests.
- UI smoke for menu visibility.

Exit:
- Worktree follows conversation-first flow.
