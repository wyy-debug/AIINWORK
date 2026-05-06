# OpenMythos Runtime Control

Date: 2026-04-29
Updated: 2026-05-05

OpenMythos is the Argus strategy layer. It can provide task-card generation, adaptive effort guidance, phase hints, expert-route suggestions, and context diagnostics. It does not start subagents, create dispatch tickets, or bypass feature gates.

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
