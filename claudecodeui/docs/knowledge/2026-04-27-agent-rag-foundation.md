# Agent RAG Foundation

Date: 2026-04-27

This note documents the first implemented Agent knowledge/RAG path. It is intentionally a lightweight retrieval layer, not the final vector database design.

## Current Behavior

Agent Builder upload actions now call:

- `POST /api/agents/:agentId/knowledge/upload`
- `GET /api/agents/:agentId/knowledge`
- `DELETE /api/agents/:agentId/knowledge/:sourceId`
- `POST /api/agents/:agentId/knowledge/:sourceId/reindex`

The endpoint accepts multipart form data:

- `files`: one or more uploaded files
- `mode`: `file` or `folder`
- `relativePaths`: JSON array preserving browser folder relative paths

Uploaded files are stored outside workspaces under:

```text
~/.mtl-code-ui/agents/knowledge/<agentId>/<sourceId>/
```

Each source has:

- `files/`: copied uploaded files
- `index.json`: extracted text chunks, local hash-vector embeddings, and file metadata

The Agent config in `~/.mtl-code-ui/agents/agents.json` is patched with `knowledgeSources` entries containing:

- `id`
- `type`
- `name`
- `status`
- `storageKey`
- `fileCount`
- `chunkCount`
- `embeddingModel`
- `addedAt`

Deleting a knowledge source removes both the Agent config entry and its stored index/files directory. Reindexing keeps the source ID stable and rebuilds `index.json` from the already uploaded files.

## Retrieval

`server/services/agent-rag-service.js` provides the current retrieval implementation. The active model is `local-hash-v1`: a deterministic local token-hashing vector, not an external embedding provider.

It supports text-like files such as markdown, txt, json, csv, yaml, xml, html, css, source code, sql, shell scripts, and logs. Binary formats such as PDF and Office documents are stored but not parsed yet.

At Agent runtime:

1. Chat sends `options.agentId`.
2. When the Agent was configured for this conversation, chat also sends `options.agentAppBindings`.
3. `server/index.js` calls `resolveAgentRuntime(agentId, { query: data.command, sessionConfiguration })`.
4. `server/services/agent-config-service.js` applies the per-conversation slot configuration, then builds the Agent system prompt.
5. `buildAgentKnowledgePrompt(agent, query)` reads indexed chunks, scores them against the user query with keyword overlap plus cosine similarity over local hash vectors, and injects the top excerpts into the Agent prompt.
6. Injected excerpts use labels such as `[K1]` so the Agent can cite the source label in its response.

For the MTL-Code provider this prompt is passed via `--append-system-prompt`. For other providers the Agent prompt is still injected in-band as before.

## MCP/App Bindings

Agent Builder application bindings are stored on the Agent config as reusable prompt-visible context. A conversation can override the active slot choices through `session_agent_bindings.config_json`. Custom MCP entries use the app name format `MCP: <serverName>`.

The actual MCP server definition is not stored in the Agent JSON. It is written through the Provider MCP API:

- user scope: `POST /api/providers/claude/mcp/servers`
- project scope: same endpoint with `workspacePath`

This keeps MCP execution aligned with the backend Provider runtime. The Agent binding records which MCP is intended for the Agent, while the Provider config is what makes the server available to MTL-Code sessions.

## Limitations

- Retrieval now has local vector scoring, but it is still not a production vector database and does not call a semantic embedding model.
- No PDF/DOCX parsing yet.
- There is no background indexing queue; upload performs extraction immediately.
- There is no per-message citation UI yet, only prompt-level source labels.

## Next Step

The next upgrade should replace the local hash-vector scorer with a pluggable embedding/vector-store provider while keeping the upload route, manifest shape, and `knowledgeSources` Agent config stable.
