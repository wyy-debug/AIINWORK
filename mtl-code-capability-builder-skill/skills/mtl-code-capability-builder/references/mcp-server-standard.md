# MCP Server Package Standard

## Package Shape

Use a normal Node package unless there is a strong reason not to:

```text
mcp-name/
  package.json
  package-lock.json
  src/server.js
  README.md
  hub.mcp.json
  scripts/publish-to-hub.mjs
  examples/*.json
```

For Hub publication, `hub.mcp.json` is the catalog item.

## hub.mcp.json Shape

Use:

```json
{
  "kind": "mcp-server",
  "name": "example-mcp",
  "title": "Example MCP",
  "description": "What the MCP does.",
  "author": "Team",
  "version": "0.1.0",
  "tags": ["mcp"],
  "capabilities": ["Tool capability"],
  "mcp": {
    "serverName": "example-mcp",
    "transport": "stdio",
    "command": "node",
    "args": ["${installDir}/src/server.js"],
    "env": {},
    "postInstall": {
      "type": "npm-install",
      "args": ["install", "--omit=dev", "--ignore-scripts"]
    },
    "setupFields": [],
    "runtimeFields": [],
    "tools": []
  }
}
```

## Setup Fields

Use `setupFields` for values MTL-Code should ask for during Pull:

- `key`: env/header/arg name
- `label`: UI label
- `type`: `text`, `password`, `path`, `path-list`, `number`, `select`, or `boolean`
- `target`: `env`, `arg`, `args`, `cwd`, `url`, `header`, `tool-argument`, or `metadata`
- `required`: boolean
- `defaultValue`, `placeholder`, `description`

Mark secrets as `type: "password"` and `target: "env"`. Do not put real secrets in `env`, examples, README, scripts, Agent templates, or reports.

Use `runtimeFields` for per-call tool arguments such as `root` so Agents know to pass user-provided values instead of relying on defaults.

## Runtime Rules

- Use stdio MCP unless HTTP/SSE is specifically required.
- Return structured tool errors with `error`, `hints`, and diagnostic fields.
- For local git diffs, explain when a revision is missing from the provided repository root.
- For Windows, handle npm/npx through `cmd.exe` or robust spawn wrappers when launching `.cmd` files.
- If using external packages through `npm exec`, prefer pinned versions over `latest`.

## Validation Checklist

- `package.json` has `type: "module"` when using ESM.
- `npm run check` exists when possible.
- MCP server starts without secrets and returns a clear missing-config error.
- `hub.mcp.json` has setup fields for all required local values.
- Publication package excludes `node_modules`, logs, local config, and secrets.
