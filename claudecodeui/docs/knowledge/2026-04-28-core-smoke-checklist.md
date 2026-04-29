# MTL-Code Core Smoke Checklist

Date: 2026-04-28

Run this checklist before shipping a Windows package after Agent, Skill, MCP, Worktree, permission, or session-list changes.

## Automated Baseline

1. Start a dev or packaged preview target.
2. Ensure Playwright is available for this checkout, for example `npm install --no-save playwright`.
3. Run `npm run smoke:ui`.
4. Use `SMOKE_BASE_URL=http://host:port npm run smoke:ui` when the target is not `http://127.0.0.1:5173`.
5. The script covers shell load, project/conversation switch, composer input, and model switcher focus recovery.

## Code UI

1. Launch the packaged app.
2. Confirm the desktop/start/taskbar icon is the blue MTL-Code icon.
3. Confirm the sidebar can switch between `项目` and `对话` without flashing into the wrong space.
4. Create or open a project outside `C:\Users\yckui`; it should not be blocked unless it is a system-critical path.
5. In a project session, confirm Agent controls are hidden and Skill controls are visible.
6. Type `@` in a project session and confirm the project file picker opens and inserts the selected file mention.
7. Delete a session and confirm it disappears immediately; refresh should not bring it back.
8. Rename, pin, archive, and restore a session; pinned sessions should sort first and archived sessions should remain recoverable.

## Agent / Skill

1. Open an independent conversation and choose to use an Agent.
2. Complete any required slots and start the conversation.
3. Bind an installed Skill from the composer, then send a message.
4. Open diagnostics and confirm Agent, Skill, MCP, model, context window, and permission snapshots are visible.
5. Bind a missing Skill name and confirm it is marked unavailable but does not block sending.

## MCP / Hub

1. Add a remote Hub catalog URL and sync it.
2. Search Hub Skills from the composer Skill menu and install one directly.
3. Pull `soc-redmine` or `ainwork-code-search` MCP from Repository.
4. Run MCP diagnostics; missing required values should be reported without showing secrets.
5. Configure required fields such as `REDMINE_API_KEY` or `root`, save, then rerun diagnostics.

## Worktree

1. Open a clean Git project and dispatch a managed worktree.
2. Confirm the worktree appears as a separate project and opens a session.
3. Confirm the worktree header shows parent project, base ref/commit, detached state, create branch, and delete.
4. Create a branch from the worktree header.
5. Try deleting a dirty worktree and confirm deletion is blocked.
6. Try dispatching from a non-Git project and confirm the UI or API gives a clear error.
7. Open the parent project's Worktree task list and confirm continue-open, open-session, create-branch, and delete actions are visible.

## Permissions

1. Enable bypass permissions in settings.
2. Send a command that would normally request tool permission.
3. If a permission request still appears, open diagnostics and confirm the effective mode, skip flag, allowed tools, disallowed tools, and conflicts.
