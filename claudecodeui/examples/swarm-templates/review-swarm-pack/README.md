# Review Swarm Pack

This first-party sample exercises the `swarm-template` package shape:

- queen topology
- four roles backed by agent templates
- SQLite-backed local bus with retry/TTL
- default `coordinator-subagents` runtime for real Claude Code subagent dispatch
- setup, launch, and result dialogs with presets
- optional MCP/model dependencies
- run-scoped memory with manual example promotion

The manifest is intentionally data-only. It does not distribute executable UI or remote runtime code.

When launched from the Swarm dashboard, this sample defaults to the real coordinator runtime. Use `runtimeMode: "local-control-plane"` only for offline UI and bus tests.
