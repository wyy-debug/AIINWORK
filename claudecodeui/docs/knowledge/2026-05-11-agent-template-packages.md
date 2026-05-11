# Agent Template Packages

Agent-template packages distribute reusable subagent behavior plus data-driven dialogs. They do not distribute private chat history by default.

## Manifest

Required fields:

- `schemaVersion`
- `id`
- `version`
- `kind: "agent-template"`
- `runtime`
- `dependencies`
- `dialogs`

Dialog schemas support `setup`, `launch`, and `result`. Each dialog can define fields, up to 12 presets, and a `defaultPresetId`. Fields are limited to data-only types: `text`, `textarea`, `select`, `multiselect`, `boolean`, `number`, `path`, `mcpServer`, `skill`, and `modelProfile`.

Executable UI is intentionally blocked. Package validation rejects remote HTML, script, iframe, component, renderer, and unsafe paths. Package file paths are checked for Windows case-only collisions.

## Dependencies

Repository install resolves dependencies on the backend through:

`POST /api/agent-repository/dependencies/resolve`

The response groups `required`, `optional`, `blockingMissing`, and `selectedDependencies`. Required missing dependencies keep the installed agent in `draft` status until the dependency is available or configured. Optional selections are saved as `templateSelectedDependencies` and injected into runtime session bindings.

## Runtime Control

Subagent controls use `claude-subagent-control` from the UI. The server tries direct task control first. Current stable Argus backends support direct `stop_task`; `wait`, `send`, and `followup` fall back to guidance/resume prompts unless a newer backend advertises direct support.

Control actions are recorded as subagent events:

- `control_requested`
- `control_accepted`
- `control_failed`

These events are rendered in the same subagent event log as registry and tool events.

## Claude Code Compatibility

Claude Code Markdown/YAML subagents can be imported into an agent-template manifest using their `description`, `tools`, `model`, and prompt body. Export writes a minimal Claude Code-compatible Markdown file. Argus-only dialogs, presets, dependencies, examples, and selected dependency state stay in the package manifest.

See `examples/agent-templates/subagent-review-pack` for a complete sample.
