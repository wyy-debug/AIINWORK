# Subagent Event-Driven Dispatch

Updated: 2026-05-05

## Status

Subagent dispatch remains hard-disabled in release builds. The current work is a debug/test-only runtime foundation that replaces text-based delegation checks with typed runtime events and one-shot dispatch tickets.

## Goal

The desired flow is:

```text
Local Tool Events
  -> AgentDispatchPlan proposal
  -> DispatchManager.evaluate
  -> dispatch_ticket
  -> AgentSpawn(dispatch_ticket)
  -> SubagentManager
  -> AgentWait / AgentResult
```

This is intentionally different from the previous flow where the model attempted `AgentSpawn` first and the tool entry point tried to reject bad delegation by reading visible natural language or matching text rules.

## Invariants

- `DispatchManager` is the only place that may issue a dispatch ticket.
- `AgentDispatchPlan` is read-only. It submits a structured proposal and returns zero or more one-shot tickets.
- `AgentSpawn` is ticket-only. Missing, expired, already used, cross-session, cross-turn, or objective-mismatched tickets are rejected.
- Natural language plans are not security gates.
- Text regex policies are not dispatch policy.
- OpenMythos may generate proposal hints, but it cannot start workers or bypass `DispatchManager`.
- Teammate/name spawn paths cannot bypass ticket validation.
- Release builds keep Subagent tools hidden and disabled until the event chain is fully validated.

## Local Tool Events

Dispatch decisions are based on typed events attached to the current session and user turn.

Supported event types:

- `tool_completed`
- `file_read`
- `file_exists`
- `mcp_tool_completed`
- `mcp_config`
- `permission_result`
- `model_binding`
- `skill_binding`
- `task_notification`

Relevant fields include:

- `toolName`
- `filePath`
- `mcpServer`
- `mcpTool`
- `model`
- `modelProfileId`
- `skillName`
- `status`: `ok`, `error`, `missing`, or `blocked`

The runtime records:

- tool success/failure from `toolExecution`
- permission allow/deny from `QueryEngine`
- active model and MCP connection state from `QueryEngine`
- Skill invocation from `SkillTool`

## Dispatch Proposal Requirements

A proposal step can declare `requiredEvents`. A subagent step becomes runnable only when:

- the step is typed as `subagent`
- all dependency steps are complete
- dependency completion is proven by matching local events
- the step allows parallel execution when the proposal execution mode requires it
- the session and user-turn ticket budgets are still available
- no same-objective subagent is already running

Simple local tasks should stay local:

- reading `SKILL.md`
- checking whether a file exists
- invoking a single known MCP tool
- reading a bookmark list

Those actions should first produce local events. Only later analysis or parallel review steps should request tickets.

## AgentSpawn Contract

`AgentSpawn` consumes a dispatch ticket with this scope:

- `sessionId`
- `userTurnId`
- `stepId`
- `objective`
- TTL
- single-use state

If any scope field does not match, the spawn is rejected. This prevents model-driven redispatch, stale ticket reuse, and cross-session leakage.

## Current Tests

Validated in this slice:

- no ticket before required local events exist
- ticket after MCP `list_bookmarks` local event
- explicit `mcp_config`, `skill_binding`, `model_binding`, and `permission_result` dependencies
- no ticket when permission is blocked
- ticket single-use, session-scoped, turn-scoped, objective-scoped, and TTL-scoped
- runtime binding event generation for model, MCP, and skill state
- `AgentDispatchPlan` schema mapping for model/skill/MCP requirements
- old OpenMythos visible-plan and worker bypass markers are absent
- release tool publishing still hides Subagent tools while hard-disabled

Commands run:

```text
bun test src/tasks/__tests__/subagentDispatch.test.ts src/tasks/__tests__/subagentRegistry.test.ts packages/builtin-tools/src/tools/AgentControlTool/__tests__/AgentControlTools.test.ts packages/builtin-tools/src/tools/AgentTool/__tests__/agentSpawnDispatchTicket.test.ts packages/builtin-tools/src/tools/AgentTool/__tests__/subagentRuntimeGuard.test.ts src/utils/__tests__/openmythosRuntime.test.ts src/utils/__tests__/openmythosWorkerRuntime.test.ts src/__tests__/tools.test.ts
bun run typecheck
bunx biome lint changed files
npm run typecheck
npm run check:mojibake
```

## Remaining Work

- Add UI debug visibility for proposal, local events, and issued tickets.
- Add interface tests for model/Skill/MCP binding events coming from UI session configuration.
- Add an end-to-end debug scenario for `.utrace` analysis:
  - parent detects file and MCP state locally
  - parent calls `list_bookmarks`
  - `DispatchManager` issues a ticket only for a later analysis step
  - `AgentSpawn` consumes the ticket
- Keep release disabled until the above debug path is stable.
