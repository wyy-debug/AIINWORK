# Standalone Agent/Skill Hub

Date: 2026-04-27

## Goal

The remote repository server has been extracted from MTL-Code UI into a standalone project:

```text
E:\AIINWORK\agent-skill-hub
```

MTL-Code UI remains a repository client that consumes HTTP(S) `catalog.json` files. Agent/Skill Hub owns the shared backend pieces:

- public catalog publishing
- public content download
- global like counts
- public or token-gated submissions
- authenticated review, publish, reject, update, and delete APIs

## Runtime Ownership

Hub files:

- `agent-skill-hub/src/server.js`
- `agent-skill-hub/public/*`

Hub mounts:

- Public server: `/agent-repository`
- Admin API: `/api/admin`
- Migration alias: `/api/agent-repository-server`

MTL-Code UI no longer imports or mounts `server/routes/agent-repository-server.js`.

## Storage

Default storage root:

- `~/.mtl-agent-skill-hub`

Override:

- `HUB_DATA_DIR`

Files:

- `store.json`: repository metadata, published items, submissions, and like counters
- `content/published/<item-id>.md`: published Agent/Skill markdown
- `content/submissions/<submission-id>.md`: pending submission markdown

Optional display metadata:

- `HUB_NAME`
- `HUB_DESCRIPTION`

Admin protection:

- `HUB_ADMIN_TOKEN`

Optional submit protection:

- `HUB_SUBMIT_TOKEN`

When the submit token is configured, public submissions must include one of:

- `Authorization: Bearer <token>`
- `x-repository-submit-token: <token>`
- `x-repository-token: <token>`
- JSON body field `submitToken`

## Public API

Published catalog:

- `GET /agent-repository/catalog.json`

Content download:

- `GET /agent-repository/content/:itemId.md`

Global like toggle:

- `POST /agent-repository/items/:itemId/like`
- Body: `{ "liked": true }`
- Optional stable client identity: `x-mtl-repository-client` or body `clientId`

Submit a new Agent template or Skill for review:

- `POST /agent-repository/submit`
- Body:

```json
{
  "kind": "agent-template",
  "name": "frontend-reviewer",
  "title": "Frontend Reviewer",
  "description": "Review React UI changes.",
  "author": "Team",
  "tags": ["react", "review"],
  "icon": "bot",
  "supportedApps": ["Slack", "Notion"],
  "appSlots": [
    {
      "id": "chat",
      "label": "Chat",
      "placeholder": "Add application",
      "options": ["Slack"]
    }
  ],
  "capabilities": ["Summarize work", "Draft review notes"],
  "content": "You are a careful React reviewer..."
}
```

`kind` accepts `agent`, `template`, `agent-template`, or `skill`.

The public catalog emits item IDs as raw slugs, for example `frontend-reviewer`. The repository client normalizes them to public item IDs such as `agent-template-frontend-reviewer` and uses the catalog-provided `likeUrl`.

Agent template metadata supports the ChatGPT-style creation flow:

- `icon`: short display marker
- `supportedApps`: strings or `{ id, label, icon, category }`
- `appSlots`: application setup rows with `id`, `label`, `placeholder`, `required`, and `options`
- `capabilities`: short bullet strings shown in the template detail pane

These fields are stored through public submissions, direct admin publishing, and admin updates. They are emitted in the public catalog for clients to render the template gallery and setup dialog.

## Admin API

All admin endpoints use the Hub admin token. When `HUB_ADMIN_TOKEN` is not configured, admin APIs are only allowed from loopback requests.

Repository status:

- `GET /api/admin/status`

Catalog preview:

- `GET /api/admin/catalog`

List submissions:

- `GET /api/admin/submissions`
- `GET /api/admin/submissions?status=all`
- `GET /api/admin/submissions?status=rejected`

Read a submission with content:

- `GET /api/admin/submissions/:submissionId`

Publish a submission:

- `POST /api/admin/submissions/:submissionId/publish`
- Optional body fields: `name`, `title`, `description`, `author`, `tags`, `version`, `content`, `overwrite`

Reject a submission:

- `POST /api/admin/submissions/:submissionId/reject`
- Body: `{ "reason": "Needs more detail." }`

Directly publish an item without pending review:

- `POST /api/admin/items`

List/read/update/delete published items:

- `GET /api/admin/items`
- `GET /api/admin/items/:itemId`
- `PATCH /api/admin/items/:itemId`
- `DELETE /api/admin/items/:itemId`

## Client Setup

To consume a deployed server from another MTL-Code UI:

1. Open Settings > Agents > Repository.
2. Add the catalog URL:

```text
https://your-host.example.com/agent-repository/catalog.json
```

3. Sync repositories.
4. Pull Agent templates or Skills from the shared repository.

## Admin UI

The standalone Hub serves a compact admin UI at:

```text
http://localhost:4877
```

It shows:

- server status and public catalog URL
- published, pending, and rejected counts
- whether public submissions require a token
- recent pending submissions with publish/reject actions
- recent published items with delete actions

This UI calls the Hub's authenticated `/api/admin/*` endpoints. It is intentionally an operational review surface, not a channel runtime.

## Safety Rules

- Public catalog/content/likes are unauthenticated by design.
- Admin APIs stay behind the existing JWT/desktop auth middleware.
- Submission content is capped at 2 MB.
- Stored filenames are derived from slugified item IDs.
- Content paths are resolved under the repository storage root.
- Likes are counted per stable client fingerprint when available, otherwise by request/IP/user-agent fingerprint.
