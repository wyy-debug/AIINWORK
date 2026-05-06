# Coordinator Mode

Coordinator Mode is now defined as Codex-style collaborative agent control. Argus no longer documents the earlier experimental dispatch designs as the active model.

## Current Tool Surface

New sessions expose only the Codex-style collaborative tools when subagents are enabled:

- `spawn_agent`
- `send_message`
- `wait_agent`
- `list_agents`
- `close_agent`
- `resume_agent`

The removed experimental aliases and plan-gate designs are not callable in new sessions. Old transcripts may still be rendered for compatibility, but they are not execution inputs.

## Feature Gate

Subagents are disabled by default in release builds. Debug and test channels can enable the tools for protocol, state, UI, and history-recovery validation.

Nested subagents remain disabled by default. If a future debug build enables nesting, it must still obey the configured depth limit, session concurrency limit, and duplicate-objective guard.

## OpenMythos Boundary

OpenMythos is advisory only. It may suggest task decomposition and runtime diagnostics, but it must not create background agents or inject worker execution plans directly.

## State Recovery

History recovery is based on the thread graph:

```text
parent_thread_id -> child_thread_id
edge_status: open | closed
```

The UI should prefer graph state and runtime watcher updates over transcript text when displaying running, completed, failed, closed, and interrupted agents.
