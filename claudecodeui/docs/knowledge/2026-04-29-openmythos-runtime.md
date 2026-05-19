# Historical OpenMythos Runtime Note

Date: 2026-04-29
Updated: 2026-05-19

Status: Removed from the active runtime. This page is historical migration context only. Current task working memory is documented in [2026-05-18-argus-brain-runtime.md](2026-05-18-argus-brain-runtime.md).

OpenMythos was an Argus strategy-layer experiment. It could provide task-card generation, adaptive effort guidance, phase hints, expert-route suggestions, and context diagnostics. It does not exist as a current user-facing runtime control, does not start subagents, does not create dispatch tickets, and does not bypass feature gates.

Use current replacements instead:

- Argus Brain for local task working memory.
- MCP/Profile tools for code-structure context and external project knowledge.
- Argus Brain for durable local task state.
- Explicit Subagents controls for subagent execution.

Subagent execution uses Codex-style collaborative tools: `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `list_agents`, and `close_agent`. The model may use these tools only when the user explicitly asks for subagents, delegation, or parallel agent work.

## Configuration Shape

```json
{
  "openMythosRuntime": {
    "enabled": false,
    "adaptiveEffort": true,
    "taskCard": true,
    "routingHints": true,
    "loopControl": "enforced",
    "stableReinjection": true,
    "phaseAdapter": true,
    "expertRouting": true,
    "contextCacheDiagnostics": true,
    "minEffort": "low",
    "maxEffort": "max"
  },
  "subagents": {
    "enabled": false,
    "maxConcurrentThreadsPerSession": 3,
    "maxDepth": 1
  }
}
```

OpenMythos settings and subagent execution settings are separate controls.
