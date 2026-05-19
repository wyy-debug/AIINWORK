# 2026-05-03 Argus Workbench Integration

## Product Rule

Argus first-use UI is chat-first. Standalone empty tool pages should not be primary navigation. The visible workflow is:

- Chat: default workspace and session surface.
- Files: project file browsing and editing.
- Shell: direct terminal surface.
- Changes: local Git review, shown when the project has local changes or when explicitly opened.
- Run: project commands and worktree dispatch.
- Preview: local-only browser preview for localhost and project file URLs.
- Results: saved review notes, action logs, preview screenshots, and visual comments.

Automations stay implemented in backend/API storage but are hidden from default navigation and command menu until productized again. Plugin entry and legacy provider surfaces remain hidden.

## Frontend Ownership

- `src/components/main-content` owns the visible tab strip and routes workflow panels to existing panel implementations.
- `src/components/review` is branded as Changes and sends review summaries to Chat/Results.
- `src/components/actions` is branded as Run, auto-detects package scripts, streams logs, and opens Preview when a localhost URL appears.
- `src/components/browser` is branded as Preview and supports screenshot plus point/area visual comments.
- `src/components/artifacts` is branded as Results while keeping the `/api/artifacts` contract.
- `src/components/settings` exposes Model / Hub, Runtime, and Appearance. Model / Hub keeps model, permissions, MCP, and repository/Hub configuration. Runtime owns Argus Brain, Subagents, and local execution permissions.

## Runtime Contracts

- `argus-open-panel` is the preferred UI event for opening workflow panels.
- `argus-open-preview` opens Preview with a local URL from Run output.
- `argus-attach-context` is emitted when Results or Preview context is attached to Chat.
- `argus-refresh-workflow-counts` refreshes Changes and Results badges after Git or artifact-producing actions.
- Settings > Runtime exposes a separate Subagents switch. It only controls Codex-style tools for new sessions; historical OpenMythos settings are not a current dispatch surface.
- The local permission policy owns terminal selection, allowed paths, WSL selection, and dangerous command confirmation.

## Backend Contracts

- `/api/project-actions/config` returns configured actions plus detected `package.json` scripts.
- `/api/project-actions/run` still accepts a command override and applies Runtime Permissions.
- `/api/artifacts` remains the storage API for user-facing Results.
- Agent mode is now controlled by Agent Profiles and the Subagents workspace instead of hidden runtime toggles.
- Automations routes remain available for compatibility but are not linked from visible navigation.

## Argus Core Contract

- Historical OpenMythos notes are migration context only; current expert routing should use explicit Argus Brain, MCP/Profile, Skill, or Subagent surfaces.
- Subagent execution is exposed as OpenCode-style primary/subagent agents with explicit manual invocation and task permission checks.
- `TaskStop` is idempotent for terminal tasks. Calling it on a completed, failed, or killed task returns a no-op success instead of a tool error.
- User-facing chat must not render internal agent-control failure narration such as self-control/debug monologues or "replace the whole file manually" fallback text. The provider history adapter and `useChatMessages` filter known leaked internal narration, and runtime guidance tells the coordinator to continue locally with concise actionable status instead.
