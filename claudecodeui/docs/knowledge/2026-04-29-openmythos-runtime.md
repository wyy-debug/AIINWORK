# OpenMythos Runtime Controls

Date: 2026-04-29

## What Changed

- MTL-Code UI exposes an OpenMythos-inspired Runtime settings page under the Agents settings area.
- Runtime settings are stored in `~/.mtl-code/settings.json` and mirrored into the Claude Code launch environment.
- Claude Code reads the runtime environment to build a hidden task card, choose adaptive effort, and add optional routing hints.
- Agent runtime diagnostics now report the resolved OpenMythos runtime configuration, preview card, phase plan, expert routes, and context ledger for each session.
- `loopBudget` can now be mapped to `maxTurns` when `loopControl` is `enforced`.
- Stable reinjection carries the frozen task card into follow-up turns and subagent contexts.
- Phase adapter adds `orient -> plan -> implement -> verify -> finalize` guidance; early `orient` and `plan` phases block mutating tools.
- Expert routing is deterministic but conservative: it suggests security, verification, performance, architecture, frontend, git, or local routes; v1 does not silently dispatch write-capable experts.
- Context cache diagnostics are a ledger over compact boundaries, microcompact boundaries, RAG excerpts, and tool summaries. This is not MLA or KV-cache.

## Settings Shape

The saved settings block uses this shape:

```json
{
  "openMythosRuntime": {
    "enabled": true,
    "adaptiveEffort": true,
    "taskCard": true,
    "routingHints": true,
    "loopControl": "enforced",
    "stableReinjection": true,
    "phaseAdapter": true,
    "expertRouting": true,
    "contextCacheDiagnostics": true,
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
  "MTL_CODE_OPENMYTHOS_LOOP_CONTROL": "enforced",
  "MTL_CODE_OPENMYTHOS_STABLE_REINJECTION": "1",
  "MTL_CODE_OPENMYTHOS_PHASE_ADAPTER": "1",
  "MTL_CODE_OPENMYTHOS_EXPERT_ROUTING": "1",
  "MTL_CODE_OPENMYTHOS_CONTEXT_CACHE_DIAGNOSTICS": "1",
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
- `loopControl` is `enforced` or `advisory`. `enforced` maps `loopBudget` to the existing Claude Code `maxTurns` guard.
- `stableReinjection` re-adds the frozen goal, constraints, acceptance criteria, phase, expert routes, and context ledger as a critical system reminder after tool results and into subagents.
- `phaseAdapter` computes the current phase from turn count. `orient` and `plan` are read-only phases; `implement`, `verify`, and `finalize` may use mutating tools when appropriate.
- `expertRouting` records deterministic suggested experts. It is a route hint and usage-detection surface, not an automatic hidden writer.
- `contextCacheDiagnostics` exposes compact/RAG/tool-summary ledger details in diagnostics.
- `minEffort` and `maxEffort` clamp the adaptive effort result.
- User-selected `/effort`, session effort, and existing explicit effort environment values still take precedence over adaptive effort.

## Diagnostics

`agent_runtime_debug` now includes the resolved OpenMythos runtime block. The frontend diagnostics panel shows:

- whether the runtime is enabled
- adaptive effort status
- task card status
- routing hints status
- minimum and maximum effort bounds
- loop control mode
- stable reinjection, phase adapter, expert routing, and context cache diagnostic toggles
- runtime card: frozen goal, effort, risk score, loop budget, remaining budget, current phase, phase plan
- expert routes and context ledger counts

## Implementation Limits

- This is not ACT halting. v1 uses the existing `maxTurns` limit as the hard budget when `loopControl=enforced`.
- This is not MLA/KV cache. v1 exposes recoverable summaries and ledger counts around compact, microcompact, RAG, and tool summaries.
- Expert routes do not automatically spawn write-capable subagents. The model is strongly guided to use the right skill/subagent, and diagnostics make the route visible.
- Phase enforcement is intentionally coarse: early phases block tools whose existing `isReadOnly()` method returns false.

## Verification

Claude Code checks:

```powershell
cd E:\AIINWORK\claude-code
bun test src/utils/__tests__/openmythosRuntime.test.ts
bun run benchmark:openmythos
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
