# MTL-Code P0-P6 Requirements Status

Last updated: 2026-05-05

Status values:
- Not started
- In development
- Implementation complete
- Test complete
- Bug pending
- Needs new requirement
- Deferred

Development rule:
- Requirements are updated before work starts and after each requirement changes state.
- Every behavior change starts with a failing test.
- Test evidence is recorded on the requirement that it validates.
- Reference directories such as `DeepSeek-TUI/`, `crashsight-*`, and local test kits are not release artifacts unless a later requirement explicitly adds them.

## P0 Release Closure

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P0-01 | Commit only product changes and exclude local reference directories. | Stage tracked product files and explicit new tests/scripts only. Do not stage `DeepSeek-TUI/`, `crashsight-*`, `soc-hunter-test-kit/`. | `git status --short`; manual staged file review before commit. | Not started | Pending commit step. |
| P0-02 | Debug portable package exists and is identifiable. | `Argus-Debug.exe`, `build-manifest.json`, `README-Debug.txt`, `start-debug.ps1`, `channel=debug`, `debug=true`. | `npm run package:debug-win`; read manifest; check required files. | Test complete | Debug package generated at `workspace/vendor/debug/Argus-Debug-1.30.4`. |
| P0-03 | Release installer exists and is identifiable. | `Argus-1.30.4-x64.exe`, release manifest, `channel=release`, `debug=false`. | `npm run package:release-win`; read manifest; check installer path. | Test complete | Release installer generated at `workspace/vendor/electron-dist/Argus-1.30.4-x64.exe`. |
| P0-04 | Basic UI smoke passes on packaged app. | Launch debug portable or installed release, verify main shell, project/conversation switching, message send, subagent noise hidden. | `npm run smoke:ui` against running app or documented manual smoke. | Test complete | `npm run smoke:packaged-debug` passed against `Argus-Debug-1.30.4`. |
| P0-05 | Release gate remains green. | Unit tests, typecheck, mojibake scan, Claude Code subagent tests. | `npm run test:unit`; `npm run typecheck`; `npm run check:mojibake`; `bun run typecheck`; subagent bun tests. | Test complete | Current slice passed `npm run test:unit`, `npm run typecheck`, `npm run check:mojibake`, `git diff --check`, subagent bun tests, and `bun run typecheck`. |

## P1 Subagent UI Experience

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P1-01 | Composer status bar shows only running subagents. | Activity summary uses terminal detection and excludes completed/blocked/cancelled from active items. | Unit test for `summarizeSubagentActivity`. | Test complete | `subagentActivity.test.ts` covers running-only active list. |
| P1-02 | Status bar displays useful running details. | Running count, max count, objective, last tool, elapsed time, remaining steps. | Unit test summary fields; UI smoke visual check. | Test complete | `subagentActivity.test.ts` verifies status-bar details hydrate from manager records, including current/max/remaining steps, elapsed time, last tool, and latest output; unit/typecheck/mojibake passed. |
| P1-03 | Status bar expands into a background Agent detail panel. | Expandable list with objective, status, steps, last tool, summary, stop reason. | Component/unit test for detail model; UI smoke for expansion. | Implementation complete | `subagentDetailRows.test.ts` covers active/history detail rows; Composer now consumes the detail row model. UI smoke pending. |
| P1-04 | Users can stop one background Agent. | Per-agent cancel action calls canonical cancel path. | UI event test or API-level cancel test. | Test complete | `subagentStopRequest.test.ts` covers canonical single-agent stop request; ChatInterface uses the tested builder. |
| P1-05 | Users can stop all background Agents. | Bulk cancel action over running task IDs. | Unit test for selected running task IDs; manual smoke. | Implementation complete | `subagentStopRequest.test.ts` covers stop-all over active task IDs; manual smoke pending. |
| P1-06 | Users can view/copy evidence and re-dispatch from history. | History list, copy action, reuse objective action. | Unit test for history model; UI smoke for copy/reuse. | Implementation complete | `subagentDetailRows.test.ts` covers history evidence text and reuse affordance; UI smoke pending. |
| P1-07 | BLOCKED states show action-oriented Chinese guidance. | Map stop reasons to concise next steps. | Unit test mapping stop reason to guidance. | Test complete | `subagentGuidance.test.ts` covers auth, MCP config, cancelled, and generic blockers; `npm run typecheck` passed. |

## P2 Subagent Runtime Rules

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P2-01 | Single user turn spawn cap is 3. | Runtime manager/user-turn accounting. | Runtime unit test. | Test complete | `subagentSpawnPolicy.test.ts` covers per-turn max 3; bun subagent suite passed. |
| P2-02 | Single user turn concurrency cap is 2. | Queue or reject beyond two running in the same turn. | Runtime unit test. | Test complete | `subagentSpawnPolicy.test.ts` covers active max 2 and release behavior; bun subagent suite passed. |
| P2-03 | Session running cap is 3. | Count running records by session. | Runtime unit test. | Test complete | `validateSessionSubagentCapacity` is covered with app-state and registry counts; bun subagent suite passed. |
| P2-04 | Running objective dedupe rejects duplicate active tasks. | Objective normalization and session-aware lookup. | Runtime unit test. | Test complete | `subagentRegistry.test.ts` covers dedupe lookup. |
| P2-05 | Subagents cannot spawn nested subagents by default. | Runtime context flag and Agent/Task validation. | Runtime unit test. | Test complete | `validateSubagentSpawnLifecycle` rejects nested spawn unless explicitly allowed; bun subagent suite passed. |
| P2-06 | `AgentSendInput` rejects progress polling. | Reject open-ended English/Chinese wait/result/progress messages. | Control tool unit test. | Test complete | `AgentControlTools.test.ts` covers Chinese polling. |
| P2-07 | Results must be retrieved through `AgentWait` or `AgentResult`. | Prompt/tool guidance and SendInput validation. | Control tool unit tests for wait/result paths. | Test complete | `AgentControlTools.test.ts` covers structured `AgentResult` fields and `AgentWait` completed/pending task ids; focused subagent bun suite and `bun run typecheck` passed. |
| P2-08 | Terminal result protocol is structured. | Parse `STATUS`, `SUMMARY`, `EVIDENCE`, `NEXT_ACTION`, `CHANGES`, `BLOCKERS`. | Runtime protocol unit test. | Test complete | `subagentRegistry.test.ts` covers parser fields. |
| P2-09 | Budget exhaustion, cancellation, and restart produce terminal manager state. | `BLOCKED`, `cancelled`, `interrupted` records that do not consume concurrency. | Runtime unit tests. | Test complete | `subagentRegistry.test.ts` covers budget exhaustion as terminal `blocked` with released concurrency; cancel/resume control tests cover cancellation terminal state; subagent bun suite and `bun run typecheck` passed. |
| P2-10 | Completion notification prevents same-turn duplicate redispatch. | Completion gate in spawn path. | Runtime unit test. | Test complete | `validateSubagentSpawnLifecycle` rejects spawn during task-notification turns; AgentTool uses the tested policy. |

## P3 Message Display And Merge

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P3-01 | Hide subagent control noise from chat. | Filter `agentId`, `internal ID`, `output_file`, async launch text, wait chatter. | `useChatMessages` unit tests. | Test complete | Async launch text test exists. |
| P3-02 | Subagent manager snapshot has priority over legacy records. | `subagentSnapshot` wins over `subagentRecord`. | `useChatMessages` unit test. | Test complete | Snapshot priority test exists. |
| P3-03 | Task notification has highest terminal priority. | Notification state overrides running snapshot. | `useChatMessages` unit test. | Test complete | Task notification test exists. |
| P3-04 | Tool history is grouped by stable IDs. | Group by `taskId`, `parentToolUseId`, `toolId`, not text adjacency. | Unit test with interleaved tools. | Test complete | `useChatMessages.test.ts` covers interleaved child tools by `taskId` fallback and explicit `parentToolUseId`; `npm run test:unit`, `npm run typecheck`, and `npm run check:mojibake` passed. |
| P3-05 | Subagent internal tool history defaults collapsed. | Card summary first, expandable details. | UI/component smoke. | Test complete | `SubagentContainer.test.ts` verifies completed subagent cards render compact tool/read counts while lazy-collapsed details do not expose file names or commands; unit/typecheck/mojibake passed. |
| P3-06 | Historical session loading prefers manager state. | `subagentSnapshot/events/persisted record` first, `agent-*.jsonl` fallback only. | Store/adaptor unit test. | Test complete | `scripts/projects-history-subagent.test.mjs` verifies manager snapshot blocks legacy `agent-*.jsonl` sidecar restoration; unit/typecheck/mojibake passed. |

## P4 Test System

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P4-01 | UI has a repeatable unit test runner. | Vitest config and `npm run test:unit`. | `npm run test:unit`. | Test complete | Vitest added and green. |
| P4-02 | Runtime control tools have unit coverage. | Tests for list/wait/result/cancel/send/resume. | Bun tests. | Test complete | `AgentControlTools.test.ts` covers list, SendInput polling rejection, Wait, Result, Cancel, and Resume validation; focused subagent bun suite and `bun run typecheck` passed. |
| P4-03 | Anti-runaway guards have unit coverage. | Repeat tool/file/URL/empty/auth failure tests. | Bun tests. | Test complete | `subagentRuntimeGuard.test.ts` covers repeat tool/file, same URL, empty results, and repeated auth/permission failures; focused subagent bun suite and `bun run typecheck` passed. |
| P4-04 | Package manifests have unit coverage. | Debug, release, preview manifest tests. | `package-manifest.test.mjs`. | Test complete | Manifest tests green. |
| P4-05 | Packaged UI smoke can run automatically. | Start packaged app, set `SMOKE_BASE_URL`, run smoke. | `npm run smoke:packaged-debug`. | Test complete | `packaged-smoke.mjs` launches the debug portable app and `npm run smoke:packaged-debug` passed. |

## P5 Agent / Skill / MCP Diagnostics

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P5-01 | Agent install shows dependency overview. | Required skills, MCP servers, setup fields, installed/configured/callable states. | Unit/API test for dependency summary. | Not started | Needs dependency summary model. |
| P5-02 | Required skills auto-install with Agent install. | Install flow invokes skill install and records result. | API/install test with fake catalog. | In development | Partial behavior exists; test missing. |
| P5-03 | MCP diagnose reports install/config/runtime state. | Package/dependency/config/env/root/launch/tools status. | API diagnose test. | Test complete | Added diagnose state test for package/dependency/setup fields/runtime tools; backend now returns all setup fields, not only required fields. |
| P5-04 | Secrets are never shown. | Show configured/missing only. | Unit test redacts password/token fields. | Test complete | Added route-level diagnose tests for env tokens and authorization headers; response JSON only exposes `[configured]`. |
| P5-05 | Skill diagnostics show actual runtime injection. | Effective skills, `SKILL.md` path, exists/callable, prompt length. | Runtime debug payload test. | Test complete | Added resolveSkillReferences regression test for installed/missing skills, callable status, path, prompt length, and unavailable reason. |
| P5-06 | Subagents inherit the current session model profile. | Profile runtime env must override stale/global `MTL_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL`. | Service-level model runtime regression test. | Test complete | `model-runtime-subagent.test.ts` verifies a MiMo session overrides stale `deepseek-v4-flash` subagent env with `mimo-v2.5`. |

## P6 Worktree / Conversation Dispatch

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P6-01 | Worktree dispatch is conversation-first. | Conversation menu actions: dispatch local/worktree, copy path/session/deep link. | UI/menu test. | Test complete | Worktree dispatch payload now uses `sourceSessionId` + `createNewSession`; added payload test to prevent reusing the source conversation as the worktree session. |
| P6-02 | Dispatch modal captures task and bindings. | Task prompt, base ref, Agent, Skill, MCP, model, enter immediately. | Component/unit test for payload. | In development | Existing modal partial; needs conversation payload. |
| P6-03 | Worktree creation uses managed detached HEAD. | `git worktree add --detach`, root `~/.mtl-code/worktrees`. | API test with git fixture. | In development | Backend exists; fixture test missing. |
| P6-04 | New worktree inherits session context. | Agent/Skill/MCP/model copied from parent conversation. | API/integration test. | Test complete | Added binding merge tests; worktree dispatch can inherit source conversation Agent/Skill/MCP/model and lets explicit choices override inheritance. |
| P6-05 | Worktree task list supports lifecycle operations. | Continue, enter chat, create branch, delete, archive. | API/UI tests. | In development | List exists partially; full UI not complete. |
| P6-06 | Dirty delete is blocked with clear next actions. | Dirty check and actionable message. | API test with dirty worktree fixture. | In development | Dirty guard exists; message/action tests missing. |

## P7 Chat Scroll Stability

| ID | Requirement | Needs | Tests | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P7-01 | Manual scroll-up is anchored during streaming updates. | Track a live viewport anchor and restore by `data-message-key` instead of height diff when the user is not near bottom. | Unit test for anchor restore when content below grows and when content above prepends. | Test complete | `chatScrollRestore.test.ts` covers anchor capture, streaming growth below viewport, and older-message prepends above viewport. |
| P7-02 | Load-all and older-message pagination restore the same viewport anchor across delayed layout changes. | Reuse multi-frame anchor restore state for load-all/history paging. | Unit test for anchor-first restore and top fallback. | Test complete | `chatScrollRestore.test.ts` covers anchor-first restoration and top preservation when an anchor is unavailable. Hook restore now uses the shared helper. |
| P7-03 | Auto-fill history loads at most one page per session without user scroll intent. | Session-scoped auto-fill page budget. | Unit test for auto-fill decision. | Test complete | `chatScrollRestore.test.ts` covers the one-page auto-fill cap and non-scrollable-history decision. |
| P7-04 | Scroll container remains a real internal scroll area. | `min-h-0`, stable scrollbar gutter, reachable sticky load control. | Component/class regression test or smoke check. | Test complete | `chatScrollRestore.test.ts` asserts the message pane keeps `min-h-0`, `overflow-y-scroll`, and stable scrollbar gutter. |

## Execution Plan

1. Finish P0 commit readiness and smoke harness.
2. Complete P1-03, P1-04, P1-07 as the next UI-focused slice.
3. Complete P2-01, P2-02, P2-05, P2-10 before increasing any subagent functionality.
4. Complete P3-04 and P3-06 to remove remaining text-based inference risks.
5. Complete P4-02, P4-03, P4-05 to make release validation repeatable.
6. Complete P5 diagnostics before adding new Agent/Skill/MCP features.
7. Complete P6 conversation-first worktree after subagent state is stable.
8. Complete P7 scroll stability before the next package, because chat history navigation is a release-critical path.

## 2026-05-05 P5/P6 Execution Notes

- Completed P5-03 MCP diagnose coverage: package install, dependency install, setup field state, and runtime tool declaration are now covered by route-level tests.
- Completed P5-04 secret redaction: diagnose responses mask env/header secrets as `[configured]` and tests assert raw tokens never appear in the full JSON response.
- Completed P5-05 Skill runtime diagnostics: installed and missing Skill references are covered, including `SKILL.md` path, callable state, prompt length, and unavailable reason.
- Completed P6-01/P6-04 conversation-first worktree slice: dispatch payload now uses `sourceSessionId` + `createNewSession`, and backend binding merge inherits Agent, Skill, MCP bindings, and model profile from the source conversation.
- Verification run: MCP diagnose tests, Skill diagnostics test, Worktree binding test, Worktree payload unit test, full UI unit tests, `npm run typecheck`, and `npm run check:mojibake` all passed.

## 2026-05-05 P7 Execution Notes

- Added TDD coverage for chat scroll stability: viewport anchor capture/restore, streaming growth below the viewport, older-message prepends, top fallback, one-page auto-fill cap, and the message-pane scroll container contract.
- Extracted shared scroll restoration helpers so `useChatSessionState` and tests use the same anchor-first behavior.
- Verification run: `npm run test:unit`, `npm run typecheck`, and `npm run check:mojibake` passed.

## 2026-05-05 P5 Model Runtime Fix Notes

- Fixed subagent model inheritance: selected model profiles now write `MTL_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` to the same model as the active conversation profile, preventing stale `deepseek-v4-flash` settings from breaking MiMo or other sessions.
- Verification run: `npx tsx --tsconfig server/tsconfig.json server/services/tests/model-runtime-subagent.test.ts` passed.

## 2026-05-05 Subagent Event-Driven Dispatch Notes

- Release Subagent remains hard-disabled and cannot be enabled from the product UI while the event-driven runtime is under validation.
- Added the typed event contract documented in `2026-05-05-subagent-event-driven-dispatch.md`.
- `DispatchManager` now evaluates `mcp_config`, `skill_binding`, `model_binding`, and `permission_result` in addition to tool/file/MCP tool events.
- `AgentDispatchPlan` maps model, skill, and MCP configuration requirements into dispatch evaluation.
- `AgentSpawn` now has a tested ticket-only helper: missing, expired, already used, cross-session, cross-turn, and objective-mismatched tickets are rejected.
- Runtime event sources now include QueryEngine model/MCP binding events and SkillTool skill invocation events.
- Old visible-plan/text-regex bypass markers were checked and were not present: `workerRuntimeAttempted`, `MTL_CODE_OPENMYTHOS_DISPATCH_CONFIRMED`, `subagentSpawnPolicy`, `validateVisibleSubagentDispatchPlan`, and related visible-plan validators.
- Verification run: focused DispatchManager, AgentControlTool, AgentSpawn ticket, registry, runtime guard, OpenMythos runtime/worker, and tool publishing tests passed; `bun run typecheck`, targeted Biome lint, UI `npm run typecheck`, UI `npm run check:mojibake`, and targeted `git diff --check` passed.
