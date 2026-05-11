# Swarm / Message Bus Platform

Argus swarm templates add a higher-level orchestration layer above Claude Code subagents. Single agent templates remain supported; a `swarm-template` coordinates multiple role agents through topology, policies, dialogs, a local message bus, and run-scoped memory.

## Package Shape

- `kind: "swarm-template"`
- `topology.type`: `queen`, `mesh`, `pipeline`, `committee`, or `map_reduce`
- `roles[]`: role id, label, `agentTemplateId`, count, runtime, dependencies, dialogs, and topic subscriptions
- `bus`: provider, ack policy, retry limit, and TTL
- `memory`: run-scoped memory with manual promotion to examples
- `policies`: max agents, max depth, token budget, timeout, and message size

Manifests are data-only. Remote JS, HTML renderers, iframes, and executable URLs are rejected.

## Runtime

The control plane stores swarm runs, agents, messages, events, artifacts, and memory in SQLite. `swarm_events` is the append-only event log; run snapshots are reconstructed from the current run, agents, messages, events, and memory.

`POST /api/swarms/runs` defaults to `runtimeMode: "coordinator-subagents"`. The backend starts a hidden coordinator Claude session, asks it to call `spawn_agent` for each role using deterministic task names, and maps returned `taskId`/`threadId` values back onto `swarm_agents`. `runtimeMode: "local-control-plane"` remains available for offline UI and bus tests.

Runtime lifecycle is explicit. Runs carry `runtimeStatus` values (`starting`, `spawning`, `running`, `degraded`, `completed`, `failed`, `cancelled`), while agents carry `runtimeStatus` in metadata and snapshots. Partial spawn success is allowed: mapped agents stay `running`, failed agents are marked `failed`, and the run becomes `degraded` instead of losing the usable agents.

`cancel` fans out a stop control request to every mapped role agent before marking the run cancelled. `reconcile-run` restores UI state from persisted run/agent/message/event rows after refresh or backend restart; mapped agents are preserved, while active coordinator-subagent rows without a known `taskId` are marked `degraded`.

The v1 bus is local and SQLite-backed, with provider boundaries for future Redis/NATS-style brokers. It supports direct, topic, broadcast-style topics, idempotency keys, delivery ACKs, retry, TTL expiration, dead letters, and replay.

Message publication is asynchronous. `POST /api/swarms/runs/:runId/messages` returns the `published` message immediately. A background delivery worker scans `published` and `retry_scheduled` messages, routes direct/topic/broadcast deliveries, records `published -> delivered -> acknowledged`, and writes `swarm_message_delivery_failed` plus `retry_scheduled` or `dead_lettered` on failure. Retry backoff is intentionally simple for v1: 2 seconds for the first retry and 10 seconds after that.

## APIs

- `POST /api/swarms/templates/validate`
- `POST /api/swarms/runs`
- `GET /api/swarms/runs/:runId`
- `GET /api/swarms/runs/:runId/events`
- `POST /api/swarms/runs/:runId/messages`
- `POST /api/swarms/runs/:runId/control`

Run control actions are `pause`, `resume`, `cancel`, `retry-message`, `replay-dead-letter`, and `reconcile-run`. Agent control actions are `wait-agent`, `send-agent`, `followup-agent`, and `stop-agent`; wait/send/followup target the mapped Claude subagent task through direct control first and resume the coordinator session when guidance fallback is needed, while stop uses the direct task-control channel. Control results are persisted in the same run event log and surfaced on each agent row as `lastControl`.

## Example

See `examples/swarm-templates/review-swarm-pack`.
