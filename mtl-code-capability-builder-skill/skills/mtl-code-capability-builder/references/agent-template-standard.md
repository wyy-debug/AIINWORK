# Agent Template Standard

## File Shape

Create Agent templates as markdown files with YAML frontmatter:

```markdown
---
name: example-agent
description: "Reusable workflow description."
tools: Read, Grep, Bash
---

You are the Example Agent.
```

Use `name` as a lowercase hyphen slug. Keep `description` user-facing and specific.

## Prompt Contract

Every Agent template must specify:

- required user inputs
- required MCP bindings, if any
- required Skills, if any
- ordered workflow
- fallback behavior
- output contract
- blocked/error behavior
- secret-handling rules

When an Agent depends on MCP servers, include explicit wording that the Agent must use bound MCP tools directly and must not scan local config files to recover tokens.

## Hub Metadata

Publish Agent templates with:

- `kind: "agent-template"`
- `name`, `title`, `description`, `author`
- `tags`
- `icon`
- `capabilities`
- `dependencies.skills`
- `dependencies.mcpServers`
- `supportedApps` and `appSlots` when the setup UI should bind real MCP servers
- `content`: the Agent markdown body

Example dependency shape:

```json
{
  "dependencies": {
    "skills": [{ "name": "redmine-issue-intake" }],
    "mcpServers": [{ "name": "soc-redmine" }]
  }
}
```

## Runtime Binding Rules

- App slot values for MCP should be saved as `MCP: <serverName>`.
- Generic placeholders such as `Custom MCP` are setup prompts, not callable runtime bindings.
- If a required MCP tool is not visible at runtime, the Agent should stop or use the documented fallback. It should not manually start the installed MCP package to bypass missing bindings.

## Review Checklist

- No secrets in prompt or metadata.
- Required inputs are minimal.
- MCP and Skill dependencies are declared in Hub metadata.
- Output contract matches user expectations.
- Failure paths tell the user exactly what to configure next.
