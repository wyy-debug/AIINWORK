# ADR: Self-hosted Obsidian Bridge

## Decision

Argus uses a first-party `Argus Bridge for Obsidian` plugin instead of depending on the community Local REST API plugin.

## Context

The bridge needs controlled Markdown writes, Obsidian Properties, template rendering, project MOC maintenance, and readback limited to user-approved folders. A generic full-vault REST plugin would expose a broader API surface than Argus needs and would make token, schema, and fallback behavior harder to own.

## Consequences

- Argus owns the payload schema, token pairing, fallback behavior, and AI readback scope.
- Users can still combine the generated Markdown with Dataview, Bases, Templater, Git, and other Obsidian ecosystem plugins.
- The first release supports local Obsidian Desktop only.
- Future read/search APIs extend the same local bridge protocol instead of reviving a separate RAG upload path.
