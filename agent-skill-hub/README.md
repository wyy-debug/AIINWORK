# Agent/Skill Hub

Standalone Agent template and Skill repository service for MTL-Code compatible clients.

## Start

```powershell
npm install
$env:HUB_ADMIN_TOKEN="change-me"
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
$env:HUB_ADMIN_TOKEN="change-me"
.\dist\agent-skill-hub.exe
```

The Hub listens on `0.0.0.0` by default, so machines on the LAN can reach it if Windows Firewall allows the port. Example LAN startup:

```powershell
$env:PORT="4877"
$env:HOST="0.0.0.0"
$env:HUB_DATA_DIR="D:\mtl-agent-skill-hub-data"
$env:HUB_ADMIN_TOKEN="change-me"
.\dist\agent-skill-hub.exe
```

Example Windows Firewall rule:

```powershell
New-NetFirewallRule -DisplayName "Agent Skill Hub 4877" -Direction Inbound -Protocol TCP -LocalPort 4877 -Action Allow
```

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
