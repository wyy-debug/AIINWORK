# Agent/Skill Hub

Standalone Agent template and Skill repository service for MTL-Code compatible clients.

## Start

```powershell
npm install
Copy-Item .\hub.config.example.json .\hub.config.json
notepad .\hub.config.json
npm start
```

Default URLs:

- Admin UI: `http://localhost:4877`
- Public catalog: `http://localhost:4877/agent-repository/catalog.json`
- Public submit: `POST http://localhost:4877/agent-repository/submit`
- Admin API: `http://localhost:4877/api/admin/*`

Add the public catalog URL in MTL-Code UI under Settings > Agents > Repository.

## Portable Windows EXE

Build a no-install Windows executable:

```powershell
npm run package:win
```

Output:

```text
dist\agent-skill-hub.exe
```

Run it directly:

```powershell
.\dist\agent-skill-hub.exe
```

The Hub listens on `0.0.0.0` by default, so machines on the LAN can reach it if Windows Firewall allows the port. Example LAN startup:

```json
{
  "host": "0.0.0.0",
  "port": 4877,
  "dataDir": "D:\\mtl-agent-skill-hub-data",
  "adminToken": "replace-with-a-long-random-token"
}
```

Example Windows Firewall rule:

```powershell
New-NetFirewallRule -DisplayName "Agent Skill Hub 4877" -Direction Inbound -Protocol TCP -LocalPort 4877 -Action Allow
```

### Fixed Remote Startup Script

For a remote Windows Hub, use `hub.config.json` and the checked-in startup
script so every launch uses the same host, port, data directory, and token.

1. Copy the private JSON config template:

```powershell
Copy-Item .\hub.config.example.json .\hub.config.json
notepad .\hub.config.json
```

2. Set stable values in `hub.config.json`:

```json
{
  "host": "0.0.0.0",
  "port": 4877,
  "dataDir": "D:\\mtl-agent-skill-hub-data",
  "adminToken": "replace-with-a-long-random-token",
  "submitToken": "",
  "name": "Agent/Skill Hub",
  "description": "Shared Agent templates and Skills.",
  "publicBasePath": "/agent-repository",
  "adminBasePath": "/api/admin"
}
```

3. Start the portable exe:

```powershell
.\scripts\start-hub.ps1
```

Or double-click / call:

```cmd
scripts\start-hub.cmd
```

To create the Windows Firewall rule during startup, run PowerShell as
Administrator once:

```powershell
.\scripts\start-hub.ps1 -OpenFirewall
```

`hub.config.json` is ignored by git. Keep it on the remote machine and reuse the
same `dataDir`; changing that directory makes the Hub look empty because catalog
metadata and uploaded Skill package files live there.

The Hub process itself reads JSON config at startup. Lookup order:

1. `HUB_CONFIG` / `AGENT_SKILL_HUB_CONFIG`
2. `hub.config.json` in the current working directory
3. `hub.config.json` next to `agent-skill-hub.exe`
4. built-in defaults

Environment variables such as `PORT`, `HUB_DATA_DIR`, and `HUB_ADMIN_TOKEN`
still work and override JSON values for one-off maintenance runs.

Catalog URL examples:

- Local machine: `http://localhost:4877/agent-repository/catalog.json`
- LAN client: `http://<server-ip>:4877/agent-repository/catalog.json`

Admin requests outside localhost require `HUB_ADMIN_TOKEN`:

```powershell
Invoke-RestMethod http://localhost:4877/api/admin/status -Headers @{ Authorization = "Bearer change-me" }
```

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `HUB_PORT` | `4877` | HTTP port. |
| `HOST` / `HUB_HOST` | `0.0.0.0` | HTTP bind address. |
| `HUB_DATA_DIR` | `~/.mtl-agent-skill-hub` | Store and markdown content root. |
| `HUB_NAME` | `Agent/Skill Hub` | Public catalog name. |
| `HUB_DESCRIPTION` | `Shared Agent templates and Skills.` | Public catalog description. |
| `HUB_ADMIN_TOKEN` | empty | Required for admin APIs outside localhost. |
| `HUB_SUBMIT_TOKEN` | empty | Optional token for public submissions. |
| `HUB_PUBLIC_BASE_PATH` | `/agent-repository` | Public catalog base path. |
| `HUB_ADMIN_BASE_PATH` | `/api/admin` | Admin API base path. |
| `HUB_MAX_PACKAGE_FILES` | `200` | Maximum files in one Skill package. |
| `HUB_MAX_PACKAGE_BYTES` | `20971520` | Maximum aggregate Skill package bytes. |

If `HUB_ADMIN_TOKEN` is not configured, admin APIs are only allowed from loopback requests. Configure it before exposing the Hub on a network.

## Public API

- `GET /agent-repository/catalog.json`
- `GET /agent-repository/content/:itemId.md`
- `GET /agent-repository/content/:itemId/:packageFile`
- `POST /agent-repository/items/:itemId/like`
- `POST /agent-repository/submit`

Submission body:

```json
{
  "kind": "agent-template",
  "name": "task-manager",
  "title": "Task Manager",
  "description": "Keep work organized.",
  "author": "Team",
  "tags": ["planning"],
  "supportedApps": ["Notion", "Slack"],
  "capabilities": ["Summarize tasks"],
  "content": "You are a task management agent..."
}
```

Skill packages can be submitted or published with `packageFiles` instead of a single markdown body:

```json
{
  "kind": "skill",
  "name": "unity-memory-profiler-code-analysis",
  "title": "Unity Memory Profiler Code Analysis",
  "packageFiles": [
    { "path": "SKILL.md", "encoding": "utf8", "content": "---\nname: unity-memory-profiler-code-analysis\n---\n..." },
    { "path": "scripts/analyze.js", "encoding": "utf8", "content": "export function analyze() {}\n" }
  ]
}
```

The admin UI can also select a Skill folder. The folder must contain `SKILL.md` at its root; subfolders such as `agents/`, `references/`, and `scripts/` are preserved in the public catalog.

MCP server packages use `kind: "mcp-server"` and can expose setup fields that MTL-Code shows after Pull:

```json
{
  "kind": "mcp-server",
  "name": "ainwork-code-search",
  "title": "AIINWORK Code Search MCP",
  "packageFiles": [
    { "path": "package.json", "encoding": "utf8", "content": "{...}" },
    { "path": "src/server.js", "encoding": "utf8", "content": "..." }
  ],
  "mcp": {
    "serverName": "ainwork-code-search",
    "transport": "stdio",
    "command": "node",
    "args": ["${installDir}/src/server.js"],
    "postInstall": { "type": "npm-install" },
    "setupFields": [
      {
        "key": "AINWORK_DEFAULT_CODE_ROOT",
        "label": "root",
        "type": "path",
        "target": "env",
        "required": true
      }
    ]
  }
}
```

`setupFields` are not secrets unless you mark them as `password`; the values are written into the local MCP config for the user who pulls the package. Tool schemas and live tool lists are still discovered by the MTL-Code/Claude Code runtime after the MCP server starts.

## Admin API

- `GET /api/admin/status`
- `GET /api/admin/catalog`
- `GET /api/admin/submissions?status=all`
- `GET /api/admin/submissions/:submissionId`
- `POST /api/admin/submissions/:submissionId/publish`
- `POST /api/admin/submissions/:submissionId/reject`
- `GET /api/admin/items`
- `POST /api/admin/items`
- `GET /api/admin/items/:itemId`
- `PATCH /api/admin/items/:itemId`
- `DELETE /api/admin/items/:itemId`

Admin requests can send `Authorization: Bearer <HUB_ADMIN_TOKEN>`.
