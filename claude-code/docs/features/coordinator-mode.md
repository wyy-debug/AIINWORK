# Coordinator Mode

Coordinator Mode is defined as Codex MultiAgentV2 collaborative agent control. New sessions expose only these tools when subagents are enabled:

- `spawn_agent`
- `send_message`
- `followup_task`
- `wait_agent`
- `list_agents`
- `close_agent`

The removed experimental aliases and plan-gate designs are not callable in new sessions. Old transcripts may still be rendered for compatibility, but they are not execution inputs.

## Feature Gate

Subagents are disabled by default in release builds. Debug and test channels can enable the tools for protocol, state, UI, and history-recovery validation.

Nested subagents remain disabled by default. If a future debug build enables nesting, it must still obey the configured depth limit, session concurrency limit, and duplicate-objective guard.

## OpenMythos Boundary

OpenMythos is advisory only. It may suggest task decomposition and runtime diagnostics, but it must not create background agents or inject worker execution plans directly.

## State Recovery

History recovery is based on the thread graph and mailbox sequence:

```text
/root -> /root/review_runtime
agentPath + parentAgentPath
graphStatus: open | closed
```

The UI should prefer canonical path graph state and runtime watcher updates over transcript text when displaying running, completed, failed, closed, and interrupted agents. `threadId` and `parentThreadId` are historical/debug fields and are not target resolution inputs.
