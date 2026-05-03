# 2026-05-02 Codex-Style Roadmap V1

## Product Position

Argus remains the only visible product provider. Legacy provider code can stay as compatibility code, but first-use surfaces must not expose Codex, Claude Code, Cursor, Gemini, plugin tabs, GitHub auth, or provider model pickers.

Automations is the only restored sidebar capability from the previously hidden advanced surfaces. Plugins stay hidden.

## Implemented Anchors

| Capability | Frontend owners | Backend owners | Notes |
| --- | --- | --- | --- |
| Review | `src/components/review/view/ReviewPanel.tsx` | `server/routes/git.js`, `server/database/schema.js` | Staged/unstaged grouping, file stage/unstage/discard, hunk action endpoint, local review notes, PR feedback paste import, review-note artifacts. |
| Project Actions | `src/components/actions/view/ActionsPanel.tsx` | `server/routes/project-actions.js`, `server/services/runtime-permission-service.js`, `action_runs` table | Setup/Run/Test/Build commands are stored in project `.mtl-code/actions.json`; detected defaults and user fallback are supported. Runs now enforce runtime permissions, support dangerous-command confirmation, and persist action-log artifacts. |
| Worktree Mode | `src/components/actions/view/ActionsPanel.tsx`, existing worktree components | `server/routes/worktrees.js`, `worktree_dispatches` table | Actions panel exposes Local/Worktree mode and can create managed isolated tasks. Worktree rows now have DB columns reserved for handoff/action linkage. |
| Automations | `src/components/automations/view/AutomationsPanel.tsx`, sidebar header | `server/routes/automations.js`, `server/routes/triage.js` | Local SQLite definitions/runs, manual run, simple interval scheduler, Triage inbox. Target modes are `triage-only`, `local-argus`, and `worktree-argus`; Argus target modes create run/triage/artifact output. |
| Browser | `src/components/browser/view/BrowserPanel.tsx` | Electron IPC in `electron/main.mjs`, `electron/preload.cjs` | Local-only browser preview/screenshot/visual comments. Allowed targets: localhost, 127.0.0.1, ::1, and project-scoped file URLs. IPC includes open, navigate, back, forward, refresh, screenshot, and close. |
| Artifacts | `src/components/artifacts/view/ArtifactsPanel.tsx` | `server/routes/artifacts.js`, `artifacts` table | Durable result previews for review notes, screenshots, visual comments, action logs, automation runs, and future generated files. UI supports source filtering. |
| Command Menu | `src/components/command-menu/view/GlobalCommandMenu.tsx` | `server/routes/commands.js` | Cmd/Ctrl+K opens visible Argus tabs. Slash commands `/review`, `/actions`, `/browser`, `/automations`, `/artifacts`, and `/worktree` dispatch to the same surfaces; `/worktree` opens Actions in Worktree mode. |
| Runtime Permissions | `src/components/settings/view/tabs/RuntimeSettingsTab.tsx` | `server/routes/settings.js`, `server/services/runtime-permission-service.js` | Stores default terminal, WSL allowance, allowed paths, and dangerous-command confirmation policy. Shell, Actions, and Argus backend spawn use the shared runtime permission service. |
| Session Stability | `src/hooks/useProjectsState.ts`, `src/stores/useSessionStore.ts`, chat/main-content views | `/api/sessions/:id/messages` consumers | `/session/:id` route resolution now has explicit loading/missing states. Message history failures surface in the right chat pane instead of silently falling back to a stale empty state. |
| IDE Bridge | future extension client | `server/routes/ide-bridge.js` | Local token/state/context API reserved for VS Code or other IDE sync. |

## API Surface

- Git review: `/api/git/status`, `/api/git/diff`, `/api/git/stage`, `/api/git/unstage`, `/api/git/discard`, `/api/git/hunk-action`, `/api/git/comments`, `/api/git/feedback`
- Project actions: `/api/project-actions/config`, `/api/project-actions/run`, `/api/project-actions/:runId/stop`, `/api/project-actions/:runId/logs`, `/api/project-actions/runs/list`
- Automations: `/api/automations`, `/api/automations/:id/run`, `/api/automations/runs`, `/api/triage`
- Artifacts: `/api/artifacts`, `/api/artifacts/:id`
- Runtime settings: `/api/settings/runtime-permissions`
- IDE bridge: `/api/ide-bridge/token`, `/api/ide-bridge/state`, `/api/ide-bridge/context`
- Electron browser IPC: `browser:open`, `browser:navigate`, `browser:back`, `browser:forward`, `browser:refresh`, `browser:screenshot`, `browser:close`

## Durable State

New durable tables live in `server/database/schema.js`:

- `automation_definitions`
- `automation_runs`
- `triage_items`
- `artifacts`
- `review_comments`
- `action_runs`

`worktree_dispatches` also reserves `handoff_status`, `last_run_id`, and `action_profile_id` for Worktree productization.

`automation_definitions.target_mode` stores the selected automation target mode.

## Verification

Minimum verification for this roadmap slice:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. `npm run check:mojibake`
5. Package only after the roadmap slice builds cleanly.

## 2026-05-03 Full Closure Notes

This pass turns the V1 surfaces into connected Codex-style loops instead of isolated panels:

- Session routing is a single visible-state path: generated Worktree/Automation sessions dispatch `argus-open-session`, refresh projects, select the target project/session, switch to Chat, and navigate to `/session/:id`. Missing generated sessions now use the explicit route recovery state.
- Review gained repository-level actions: `/api/git/stage-all`, `/api/git/unstage-all`, `/api/git/discard-all`, and `/api/git/review-summary`. `ReviewPanel` supports inline diff notes, file open, summary copy, and "ask Argus" chat-context insertion.
- Actions run events are durable and live: `action_run_events` stores run output/status, and `GET /api/project-actions/:runId/events` streams existing and new events over SSE. Action completion still creates action-log artifacts.
- Automations now use a local queue runner with run states `queued/running/completed/failed/cancelled`. `automation_runs` stores `trigger_type`, `session_id`, `worktree_id`, and `metadata_json`; `automation_run_events` streams run progress. New APIs include cancel, retry, and run-events SSE.
- Worktrees can bind Argus sessions at creation time, run project setup through the shared runtime permission policy, and expose handoff/setup APIs: `POST /api/worktrees/:id/handoff` and `POST /api/worktrees/:id/run-setup`.
- Artifacts gained cross-source links through `artifact_links`, source/project/session filtering, and `POST /api/artifacts/:id/attach-to-session` for chat-context attachment.
- Browser IPC now has visible BrowserView lifecycle commands: `browser:attach`, `browser:resize`, and `browser:detach`. Open/navigate/back/forward/refresh/screenshot use the same BrowserView webContents when attached.
- Shell, Actions, Worktree setup, and Automation command execution all rely on `runtime-permission-service`. Shell WebSocket confirmation uses `runtime_permission_confirmation_required`; frontend confirmation retries with the returned token.
- Runtime settings now surface `powershell`, `cmd`, `git-bash`, and `wsl`, plus WSL distro and allowed path policy. The UI describes this as an Argus local permission policy, not an OS kernel sandbox.
- Command registry includes visible Argus-only commands: `/review`, `/status`, `/mcp`, `/plan-mode`, `/actions`, `/browser`, `/worktree`, `/artifacts`, and `/automations`. `/mcp` opens MCP settings; `/plan-mode` inserts chat text.
- IDE bridge now has token-gated context/open-file/event APIs, and the local VS Code extension skeleton lives at `ide-extension/argus-vscode`.

When continuing this area, keep provider UI Argus-only. Legacy keys such as `claude` remain compatibility plumbing and must not reappear in first-use UI.
