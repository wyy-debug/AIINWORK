# 2026-05-04 Repository Update Summary

## Current Baseline

Argus UI is a local-first Electron workspace for Chat, Changes, Run, Preview, Results, Files, Shell, and Settings. The visible product remains Argus-only; the internal `claude` provider key is compatibility plumbing and must not leak into first-use UI.

## Main Runtime Surfaces

- Chat is the primary workflow surface.
- Changes owns local Git review and delivery preparation.
- Run owns project commands and action logs.
- Preview owns local development pages and visual comments.
- Results owns artifacts created by Chat, Changes, Run, and Preview.
- Automations and plugin entry points remain hidden from the primary navigation unless a later product pass restores them.

## Backend Areas

- `server/routes/project-actions.js` stores and runs project commands.
- `server/routes/artifacts.js` stores result metadata and content.
- `server/routes/git.js` powers the visible Changes panel.
- `server/routes/worktrees.js` keeps local/worktree state for future task isolation.
- `server/services/runtime-permission-service.js` guards Shell, Actions, Worktree setup, automation command execution, and backend runtime commands.
- `server/services/context-budget-service.js` provides the single ContextBudget contract for live and historical token display.

## OpenMythos And Subagents

OpenMythos is advisory only. It can create runtime hints, effort guidance, phase suggestions, and expert-route suggestions. It no longer creates worker plans, dispatch tickets, or auto-dispatch environment variables.

Subagent execution follows the Codex collaborative tool protocol:

- `spawn_agent`
- `send_input`
- `wait_agent`
- `list_agents`
- `close_agent`
- `resume_agent`

The old WorkerRuntime path has been removed. Historical transcripts may still render old records as read-only compatibility cards, but new sessions should only expose Codex-style tool names.

## Context Budget

Context display uses ContextBudget:

- current context window usage is `input + cache_read + cache_creation`
- cumulative token usage includes input, output, cache read, and cache creation
- DeepSeek and MIMO 1M profiles must display a 1M context window instead of falling back to 200K

## File Write Stability

File writes are guarded by post-write verification in `claude-code/src/utils/file.ts` and by UI-side mutation records in `server/services/file-mutation-service.js`.

The product goal is to reduce broken shell-string writes, stale-save overwrites, quote truncation, and silent file mutation failures.
