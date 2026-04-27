# Per-Conversation Agent Slots

Date: 2026-04-27

This note documents the current single-conversation Agent binding path. Agent configuration and conversation usage are intentionally separate:

- Agent Builder owns reusable Agent definitions.
- The chat composer owns which Agent is active in one conversation.
- The session binding table owns the persisted per-conversation Agent choice and slot configuration.

## Current Behavior

Enabled Agents are loaded only in standalone conversation space. Project sessions always use the default MTL-Code configuration and do not show Agent selection or Agent setup controls.

For a new standalone conversation, the empty conversation screen asks whether this conversation should use an Agent. Choosing the default path keeps the session unbound. Choosing the Agent path lets the user select an enabled Agent. If that Agent has application slots, the frontend opens a setup dialog and requires every slot to be mapped to an application before the Agent is enabled for that conversation.

The selected slot values are normalized as:

```json
{
  "appBindings": [
    {
      "slot": "高级工具",
      "app": "MCP: project-tools",
      "status": "optional"
    }
  ]
}
```

For existing sessions, the binding is loaded through:

- `GET /api/sessions/:sessionId/agent?provider=claude`

For updates, the frontend sends:

- `PUT /api/sessions/:sessionId/agent`

with `agentId`, `provider`, and `configuration`.

For deletion, the frontend sends:

- `DELETE /api/sessions/:sessionId/agent?provider=claude`

The backend stores this configuration in `session_agent_bindings.config_json`. Existing installations are migrated by adding the column when the app starts.

## Runtime Flow

When a message is submitted, the composer sends the resolved Agent in the existing WebSocket command payload:

- `options.agentId`
- `options.agentAppBindings`
- `options.allowSessionAgentBinding`

`server/index.js` resolves the runtime Agent by combining:

1. the explicit Agent ID in the command payload,
2. the persisted session binding when the command has a concrete session ID and `allowSessionAgentBinding === true`,
3. the explicit slot configuration from `options.agentAppBindings`,
4. the persisted `config_json` slot configuration when no fresh slot config is sent and session Agent binding is allowed.

`server/services/agent-config-service.js` applies the session slot configuration to the Agent runtime profile before building the prompt. This makes slot selections backend-real: they are injected into the Agent prompt and are not only a GUI display value.

## Project And Conversation State

Project sessions and standalone conversations are separate UI modes.

- Selecting a project session clears the selected standalone conversation.
- Switching to conversation mode clears project-session selection.
- Opening a quick-start Agent creates a standalone blank conversation with that Agent pending or selected.
- `ChatInterface` is keyed by mode, project, and session ID so stale local chat state is not reused across modes.

This prevents project chat history, conversation history, and Agent bindings from leaking into each other.

## Invariants

- Project conversations must not automatically apply session Agent bindings.
- New standalone conversations start without an Agent until the user chooses the Agent path in the new-conversation prompt.
- A leading `@agent` mention still applies only to the current message.
- Per-conversation slot setup never edits the reusable Agent template.
- The Agent Builder app browser only shows implemented integrations. Currently that is `自定义 MCP`; placeholder third-party apps are not listed.
- MCP app bindings still depend on Provider MCP configuration for actual tool availability.
- Channel runtimes such as DingTalk are deferred; the current channel card is configuration context only.
