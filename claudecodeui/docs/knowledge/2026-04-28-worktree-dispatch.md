# Codex-Style Worktree Dispatch

Date: 2026-04-28

MTL-Code UI supports local managed worktree dispatch for Git projects. The goal is to run a task in a separate checkout while keeping the parent project clean.

## Runtime Shape

- Root directory: `~/.mtl-code/worktrees` by default.
- Creation command: `git worktree add --detach <worktreePath> <baseRef>`.
- `baseRef` defaults to the parent repository's current branch/HEAD.
- The new worktree is registered as a normal project and receives `project.worktree` metadata.
- The worktree remains detached until the user explicitly clicks “创建分支”.

## Stored Metadata

`worktree_dispatches` stores:

- worktree ID, parent project name/path, worktree path, base ref and base commit
- mode/status, provider, session ID, branch name
- selected Agent ID, Skill names, MCP/app bindings, and task prompt

The actual chat context remains in the normal provider session history. Agent/Skill/MCP choices are restored through the existing session binding path.

## UI Behavior

- Parent project sidebar shows the worktree dispatch action for non-worktree projects.
- The dispatch modal loads enabled Agents, installed Skills, and parent git status.
- Non-Git projects cannot create worktrees.
- Dirty parent projects are allowed, but the UI explains that the worktree is based on `HEAD` and does not copy uncommitted changes.
- Worktree project headers show parent path, detached/branch status, base commit, create-branch, and managed delete actions.
- Managed delete checks `git status --porcelain`; dirty worktrees are blocked until the user creates a branch or handles the changes.

## Invariants

- v1 does not auto-create a branch, merge, push, or open a PR.
- v1 does not copy uncommitted parent changes.
- Project sessions still use default MTL-Code unless an Agent/Skill was explicitly selected during dispatch.
