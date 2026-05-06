# Codex MultiAgentV2 Subagent Migration

Date: 2026-05-05

Argus subagents are aligned to the current OpenAI Codex MultiAgentV2 observable protocol: `spawn_agent`, `list_agents`, `wait_agent`, `send_message`, `followup_task`, and `close_agent`.

The active contract is the MultiAgentV2 behavior plus the local control-plane implementation. The local TypeScript control layer maps Codex concepts onto canonical agent paths, a path-first Thread graph, and an independently drained Mailbox sequence.

## Current Rules

- Subagent tools remain feature-gated.
- Enabled sessions publish only the Codex tool names.
- `spawn_agent` accepts `message`, `task_name`, `agent_type`, `fork_turns`, `model`, and `reasoning_effort`.
- `task_name` is a relative lowercase name using letters, digits, and underscores. Public references use canonical paths such as `/root/review_runtime`, or bare relative names from the current agent path.
- `send_message` is queue-only and has no model-visible result payload.
- `followup_task` sends concrete follow-up work and starts or resumes a known non-root target when needed.
- `list_agents` returns `agents: [{ agent_name, agent_status, last_task_message }]` and includes `/root`.
- `wait_agent` uses the registry Mailbox sequence and locally returns `{ message, timed_out, sequence, updates }`.
- Nicknames, internal task ids, and hidden agent ids are not public target handles.

## Codex Alignment Matrix

| Capability | Codex source area | Local target | Status |
| --- | --- | --- | --- |
| `spawn_agent` | `multi_agents_v2/spawn.rs` | Create a child task with canonical `/root/...` path, task message, optional role/model/effort controls, and fork policy validation | Aligned |
| `list_agents` | `multi_agents_v2/list_agents.rs` | Read the Thread graph and return `{ agent_name, agent_status, last_task_message }`, including `/root` | Aligned |
| `wait_agent` | `multi_agents_v2/wait.rs` | Drain Mailbox sequence updates; local output includes `sequence` and typed `updates` in addition to compact timeout status | Locally extended |
| `send_message` | `multi_agents_v2/send_message.rs` | Queue information only; never trigger or resume an agent turn | Aligned |
| `followup_task` | `multi_agents_v2/followup_task.rs` | Assign concrete follow-up work to a known non-root agent and trigger/resume as needed | Aligned |
| `close_agent` | `agent/control.rs` | Close the target agent and descendants and report previous status | Aligned |
| Thread graph | `agent/registry.rs` | Persist `agentPath` and `parentAgentPath`; list, close, and target resolution use canonical paths instead of legacy thread ids | Aligned |
| Mailbox | `agent/mailbox.rs` | Use typed events and sequence counters for final notifications and agent messages | Aligned |
| Control layer | `agent/control.rs` | Route list, target resolution, queue-only message delivery, follow-up trigger, and subtree close through `SubagentControl` | Aligned |

## Backend Boundary

Tool publishing is owned by `claude-code/src/tools.ts`:

- Disabled sessions publish no subagent tools.
- Enabled sessions publish `spawn_agent`, `list_agents`, `wait_agent`, `close_agent`, `send_message`, and `followup_task`.
- Internal recovery helpers can remain private if they are not exported, documented, or visible as tools.

Subagent state lives in `claude-code/src/tasks/subagentRegistry.ts`, with orchestration in `claude-code/src/tasks/subagentControl.ts`. The important public-facing fields are canonical `agentPath`, `parentAgentPath`, graph status, runtime status, last task message, and mailbox sequence.

## UI Boundary

The UI should render `spawn_agent` and current control tools as subagent activity. It should not infer active protocol behavior from old transcript text, internal task ids, or hidden recovery helpers.
