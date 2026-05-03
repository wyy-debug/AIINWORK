# Agent/Skill Hub Extraction

Date: 2026-04-27

## Decision

The remote repository service has been extracted from Argus into:

```text
E:\AIINWORK\agent-skill-hub
```

Argus is now only a repository client. It can add HTTP(S) catalog URLs, like/pull/install items, upload to its local writable repository, and create runtime Agents from templates.

The standalone Hub owns:

- public catalog serving
- public content downloads
- public submissions
- global likes
- admin review/publish/reject/delete
- shared Hub storage

## Argus Changes

Removed embedded routes from `server/index.js`:

- `/agent-repository`
- `/api/agent-repository-server`

Removed the embedded route file:

- `server/routes/agent-repository-server.js`

The Repository settings UI now points users to a standalone Hub catalog URL such as:

```text
http://localhost:4877/agent-repository/catalog.json
```

## Hub Project

The Hub is a separate Express service:

- `agent-skill-hub/src/server.js`
- `agent-skill-hub/public/*`
- `agent-skill-hub/docs/architecture/*`

Default URLs:

- Admin UI: `http://localhost:4877`
- Catalog: `http://localhost:4877/agent-repository/catalog.json`
- Admin API: `http://localhost:4877/api/admin/*`

Use `HUB_ADMIN_TOKEN` before exposing the service outside localhost.
