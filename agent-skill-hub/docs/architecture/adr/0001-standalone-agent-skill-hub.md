# ADR 0001: Extract Remote Repository Into Standalone Agent/Skill Hub

Date: 2026-04-27

## Status

Accepted

## Context

The desktop UI originally embedded a remote repository server route. That made local testing easy, but it mixed two responsibilities:

- MTL-Code UI as a local client that consumes catalogs and installs Agents/Skills.
- Remote repository service as a shared publishing, review, and like-count backend.

## Decision

Move the remote repository service into a standalone Node/Express project named `agent-skill-hub`.

MTL-Code UI keeps only client-side repository consumption and local installation. The Hub owns public catalog publishing, public submissions, global likes, and admin review APIs.

## Consequences

Positive:

- The Hub can be deployed independently and shared by multiple MTL-Code clients.
- Desktop packaging no longer includes a public repository server.
- Repository data has a clear owner.

Trade-offs:

- Operators must start/deploy one more service.
- The first storage implementation is file-backed, so highly concurrent multi-admin workflows should later move to a database.
