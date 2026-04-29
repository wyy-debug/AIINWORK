# OpenMythos Runtime Controls

Date: 2026-04-29

## What Changed

- MTL-Code UI exposes an OpenMythos-inspired Runtime settings page under the Agents settings area.
- Runtime settings are stored in `~/.mtl-code/settings.json` and mirrored into the Claude Code launch environment.
- Claude Code reads the runtime environment to build a hidden task card, choose adaptive effort, and add optional routing hints.
- Agent runtime diagnostics now report the resolved OpenMythos runtime configuration for each session.

## Settings Shape

The saved settings block uses this shape:

```json
{
  "openMythosRuntime": {
    "enabled": true,
    "adaptiveEffort": true,
    "taskCard": true,
    "routingHints": true,
    "minEffort": "low",
    "maxEffort": "xhigh"
  }
}
```

The backend mirrors those values into `settings.env` when the MTL-Code model settings route saves:

```json
{
  "MTL_CODE_OPENMYTHOS_RUNTIME": "1",
  "MTL_CODE_OPENMYTHOS_ADAPTIVE_EFFORT": "1",
  "MTL_CODE_OPENMYTHOS_TASK_CARD": "1",
  "MTL_CODE_OPENMYTHOS_ROUTING_HINTS": "1",
  "MTL_CODE_OPENMYTHOS_MIN_EFFORT": "low",
  "MTL_CODE_OPENMYTHOS_MAX_EFFORT": "xhigh"
}
```

Supported effort values are `low`, `medium`, `high`, and `xhigh`.

## Runtime Behavior

- `enabled` controls whether OpenMythos runtime guidance is attached at all.
- `adaptiveEffort` lets Claude Code infer effort from task risk and complexity when the user has not already set effort explicitly.
- `taskCard` controls whether a hidden frozen task card is attached to the request.
- `routingHints` controls whether the hidden card includes skill/subagent route suggestions.
- `minEffort` and `maxEffort` clamp the adaptive effort result.
- User-selected `/effort`, session effort, and existing explicit effort environment values still take precedence over adaptive effort.

## Diagnostics

`agent_runtime_debug` now includes the resolved OpenMythos runtime block. The frontend diagnostics panel shows:

- whether the runtime is enabled
- adaptive effort status
- task card status
- routing hints status
- minimum and maximum effort bounds

## Verification

Claude Code checks:

```powershell
cd E:\AIINWORK\claude-code
bun test src/utils/__tests__/openmythosRuntime.test.ts
bun run typecheck
```

MTL-Code UI checks:

```powershell
cd E:\AIINWORK\claudecodeui
npm run typecheck
npm run build
npm run package:preview-win
```

Manual UI check:

1. Open Settings > MTLCode > Runtime.
2. Confirm the Runtime page uses localized labels.
3. Toggle each runtime module and save.
4. Start a new MTL-Code session and confirm diagnostics show the same OpenMythos runtime settings.
