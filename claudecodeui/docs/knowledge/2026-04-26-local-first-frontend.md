# 2026-04-26 Local-First Frontend Change Note

## Scope

This note records the first-use simplification for the local desktop direction.

## Frontend Removed From First-Use Surface

- App auth wrapper, protected routes, login/setup screens, onboarding screens, and browser-side bearer token injection.
- Provider auth modal/status wiring from settings.
- API credential settings tab and Git settings tab.
- Main Git tab, Git panel, Git-specific app tab type, and project tab persistence for `git`.
- Project creation GitHub clone/token UI and clone progress handling.
- Sidebar/About GitHub entry points, GitHub release polling, Git pull upgrade instruction, GitHub star badge.
- Plugin Git URL install box and plugin pull/update controls.

## Runtime Assumption

- Frontend HTTP requests use same-origin `/api/*`.
- Frontend WebSockets use same-origin `/ws` and `/shell`.
- Backend auth/Git/plugin install routes may still exist, but they are no longer exposed by the frontend first-use path.

## Packaging Implication

For a true no-auth desktop installer, add a backend desktop mode that binds to `127.0.0.1`, uses an ephemeral port, and bypasses app JWT/API-key middleware only in that local desktop process.
