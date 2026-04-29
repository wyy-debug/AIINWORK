# Hub Publishing Standard

## Hub URLs

Public catalog:

```text
http://<host>:4877/agent-repository/catalog.json
```

Admin API:

```text
http://<host>:4877/api/agent-repository-server/items
```

Admin requests use:

```text
Authorization: Bearer <HUB_ADMIN_TOKEN>
```

Do not hardcode real Hub tokens in committed files.

## Publish Payloads

Agent:

```json
{
  "kind": "agent-template",
  "name": "example-agent",
  "title": "Example Agent",
  "description": "Reusable workflow.",
  "author": "Team",
  "tags": ["example"],
  "capabilities": ["Do work"],
  "dependencies": {
    "skills": [{ "name": "example-skill" }],
    "mcpServers": [{ "name": "example-mcp" }]
  },
  "content": "..."
}
```

Skill package:

```json
{
  "kind": "skill",
  "name": "example-skill",
  "title": "Example Skill",
  "description": "Reusable procedure.",
  "packageFiles": [
    { "path": "SKILL.md", "encoding": "utf8", "content": "..." }
  ]
}
```

MCP server package:

```json
{
  "kind": "mcp-server",
  "name": "example-mcp",
  "title": "Example MCP",
  "packageFiles": [
    { "path": "package.json", "encoding": "utf8", "content": "..." },
    { "path": "src/server.js", "encoding": "utf8", "content": "..." }
  ],
  "mcp": {
    "serverName": "example-mcp",
    "transport": "stdio",
    "command": "node",
    "args": ["${installDir}/src/server.js"]
  }
}
```

## Package Files

Each package file entry has:

- `path`: package-relative path using `/`
- `content`: UTF-8 text or base64
- `encoding`: `utf8` or `base64`
- `size`: optional byte size

Do not publish:

- `node_modules`
- `.env`
- `.mcp.json`
- local runtime config
- tokens, logs, or generated reports

## Local Install Targets

User scope:

- Agents: `~/.mtl-code/agents/<name>.md`
- Skills: `~/.mtl-code/skills/<name>/`
- MCP servers: `~/.mtl-code/mcp-servers/<name>/`

Project scope:

- Agents: `<project>/.claude/agents/<name>.md`
- Skills: `<project>/.claude/skills/<name>/`
- MCP servers: `<project>/.mtl-code/mcp-servers/<name>/`

Runtime MCP configuration is separate from installed MCP package files. MTL-Code writes Claude-compatible MCP runtime config to `~/.mtl-code.json`.

## Publish Checklist

- Run local validation first.
- Publish MCP server packages before Agent templates that depend on them.
- Publish Skills before Agent templates that depend on them.
- Verify catalog contains all expected items after publishing.
- Ask users to Pull/Update locally; installed old versions do not automatically change.
