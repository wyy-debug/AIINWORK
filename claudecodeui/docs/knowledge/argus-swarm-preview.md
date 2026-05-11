# Argus Swarm Preview

Argus Swarm packages are data-only `swarm-template` manifests. They may include topology, roles, routing, bus policy, memory settings, dialogs, presets, dependencies, compatibility metadata, and explicitly sanitized examples. They must not include remote JavaScript, HTML renderers, or real transcript history.

## Runtime

The default runtime is `coordinator-subagents`. A hidden coordinator session asks Claude Code to call `spawn_agent` for each role and stores the resulting `taskId` and `threadId` on `swarm_agents`. Runs may be reconciled after refresh or restart. Known mappings are preserved; uncertain active agents become `degraded`.

`local-control-plane` remains available for tests and offline development only.

## Message Bus

The preview broker is SQLite-backed. Messages are published first, then a background delivery worker scans `published` and `retry_scheduled` messages. Routing supports direct agent ids, topic subscribers declared in `routing.topics`, role-level `topics`, and broadcast.

Every publish, delivery, ack, failure, retry, dead-letter, and replay writes a row to `swarm_delivery_trace`.

## Repository Packages

Repository installs resolve dependencies and role bindings on the backend. Missing required dependencies or missing role agent-template bindings install as `draft`; ready packages install as `enabled`.

Export/import endpoints only move the swarm template package, dialogs, dependency declarations, role bindings, and examples. Real history and transcripts are intentionally excluded.

## Memory And Federation

Run memory is scoped to one swarm run: facts, decisions, artifacts, and role notes. Promotion to template examples must be explicit review.

Federation has a provider seam in this preview: `local` is usable; `remote-http-placeholder` reports a disabled placeholder until a reliable remote transport is implemented.

## Smoke

Run the real runtime smoke with:

```bash
npm run smoke:swarm-real
```

It requires a real Argus auth token through `ARGUS_SMOKE_AUTH_TOKEN` or `SMOKE_AUTH_TOKEN`, and a local Claude runtime capable of coordinator subagent dispatch. Missing auth or Claude capability is a smoke failure.
