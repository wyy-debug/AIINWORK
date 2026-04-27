# Agent Template And Skill Repository

Date: 2026-04-27

## Goal

MTL-Code UI now has a repository surface for sharing prompt-based agent templates and Skills:

- Agent templates are prompt/system-instruction markdown files that install into MTL-Code custom agents.
- Skills are `SKILL.md` files that install into MTL-Code skill directories.
- Repository items can be uploaded into the local writable repository, pulled into user/project scope, and liked.
- External remote repositories are supported through an HTTP(S) `catalog.json` URL.

## Backend Ownership

Route: `server/routes/agent-repository.js`

Mounted at:

- `GET /api/agent-repository/catalog`
- `GET /api/agent-repository/sources`
- `POST /api/agent-repository/sources`
- `PUT /api/agent-repository/sources/:repoId`
- `DELETE /api/agent-repository/sources/:repoId`
- `GET /api/agent-repository/local/catalog`
- `GET /api/agent-repository/local/content?path=...`
- `POST /api/agent-repository/local/init`
- `POST /api/agent-repository/upload`
- `POST /api/agent-repository/items/:repoId/:itemId/like`
- `POST /api/agent-repository/install`

Local writable repository storage:

- `~/.mtl-code-ui/agent-repository/local/catalog.json`
- `~/.mtl-code-ui/agent-repository/local/agents/<name>/<name>.md`
- `~/.mtl-code-ui/agent-repository/local/skills/<name>/SKILL.md`
- `~/.mtl-code-ui/agent-repository/sources.json`
- `~/.mtl-code-ui/agent-repository/likes.json`

## Catalog Contract

The normalized catalog shape is:

```json
{
  "schemaVersion": 1,
  "name": "Team Agent Repository",
  "description": "Shared prompt templates and skills.",
  "updatedAt": "2026-04-27T00:00:00.000Z",
  "items": [
    {
      "id": "frontend-reviewer",
      "kind": "agent-template",
      "name": "frontend-reviewer",
      "title": "Frontend Reviewer",
      "description": "Review React UI changes.",
      "author": "Team",
      "tags": ["react", "review"],
      "icon": "bot",
      "supportedApps": [
        { "id": "slack", "label": "Slack" },
        { "id": "notion", "label": "Notion" }
      ],
      "appSlots": [
        {
          "id": "chat",
          "label": "Chat",
          "placeholder": "Add application",
          "options": [{ "id": "slack", "label": "Slack" }]
        }
      ],
      "capabilities": ["Summarize work", "Draft review notes"],
      "version": "1.0.0",
      "likes": 0,
      "downloads": 0,
      "contentUrl": "./agents/frontend-reviewer/frontend-reviewer.md"
    },
    {
      "id": "rag-writer",
      "kind": "skill",
      "name": "rag-writer",
      "title": "RAG Writer",
      "description": "Write repository knowledge notes.",
      "contentUrl": "./skills/rag-writer/SKILL.md"
    }
  ]
}
```

Compatibility aliases:

- `kind: "agent"`, `"template"`, or `"agent-template"` normalize to `agent-template`.
- `items`, `agents`, `templates`, and `skills` arrays are accepted.
- `content` can be inline, but `contentUrl` is preferred for remote catalogs.
- `likeUrl` is optional. If present for a remote item, the UI backend POSTs `{ itemId, kind, liked }` to it. If missing, likes are stored as a local overlay.
- Agent templates can define ChatGPT-style setup metadata:
  - `icon`: short display marker
  - `supportedApps`: array of app labels or `{ id, label, icon, category }`
  - `appSlots`: setup rows such as calendar/chat/email/knowledge/project tracker, each with `options`
  - `capabilities`: short bullet list shown in the template detail pane
- If a template has `supportedApps` but no `appSlots`, the UI derives default slots for calendar, chat, email, knowledge base, and project tracker.

## Install Contract

User-scope installs:

- Agent templates: `~/.mtl-code/agents/<name>.md`
- Skills: `~/.mtl-code/skills/<name>/SKILL.md`

Project-scope installs:

- Agent templates: `<project>/.claude/agents/<name>.md`
- Skills: `<project>/.claude/skills/<name>/SKILL.md`

This matches the MTL-Code backend discovery rules:

- User config home is `MTL_CODE_CONFIG_DIR`, then `CLAUDE_CONFIG_DIR`, then `~/.mtl-code`.
- Project scope uses `.claude/agents` and `.claude/skills`.

## Frontend Ownership

Repository UI lives in:

- `src/components/settings/view/tabs/agents-settings/sections/content/RepositoryContent.tsx`

The Agent settings tabs now include:

- Model
- Permissions
- MCP
- Repository

The repository view supports:

- syncing enabled repositories
- adding HTTP(S) catalog URLs
- enabling/disabling/removing remote sources
- standalone Agent/Skill Hub catalog URL guidance
- ChatGPT-style agent template gallery with detail pane, supported app chips, capabilities, and setup dialog
- filtering agent templates vs skills
- liking/unliking items
- installing to user or project scope
- uploading agent prompt templates and skill markdown into the local writable repository

Shared upload/review/publish flows now belong to the standalone `agent-skill-hub` project. The desktop UI should not mount a public repository server; it consumes Hub catalogs as remote sources.

When installing an Agent template, the UI can send:

```json
{
  "configuration": {
    "appBindings": {
      "calendar": "Google Calendar",
      "chat": "Slack"
    }
  }
}
```

The backend appends a `Configured applications` section to the installed Agent markdown. This records the selected applications as prompt context. It does not pretend to create OAuth or MCP connections; actual tools still depend on configured MCP servers/connectors.

When the guided setup installs an Agent template, the frontend also creates or updates a runtime Agent config through `/api/agents`. The runtime config uses the installed markdown content as `systemPrompt`, applies the selected app bindings, enables the Agent, and preserves template metadata such as capabilities and repository ID.

Skill installs remain file installs only. They do not create runtime Agent configs by themselves.

## Safety Rules

- External repositories are read via HTTP(S) catalog URL only.
- Remote response text is capped at 2 MB.
- Local repository content paths are normalized and must stay inside `~/.mtl-code-ui/agent-repository/local`.
- Installed filenames are slugified before writing.
- Existing installed files are not overwritten unless the UI sends `overwrite: true`.
