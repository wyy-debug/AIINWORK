# 2026-04-26 Argus Agent Anthropic-Compatible Model Config

## Scope

This note records the Agent settings simplification and Argus backend model configuration path.

## Decisions

- Settings no longer exposes an About page.
- Settings > Agents shows one visible agent: `Argus`.
- The internal provider key remains `claude` for compatibility with current WebSocket messages, MCP provider routes, session history, and normalized message storage.
- Anthropic-compatible model settings are configured inside the Argus agent instead of adding another visible provider.

## Runtime Contract

Frontend:

- `ModelConfigContent.tsx` loads `GET /api/settings/mtl-code-model`.
- It saves `PUT /api/settings/mtl-code-model`.
- API keys are never echoed back to the browser; the response only reports `apiKeyConfigured`.

Backend:

- `server/routes/settings.js` reads and writes `~/.mtl-code/settings.json`.
- Legacy `~/.claude/settings.json` may be read as a fallback, but writes always go to the Argus path.
- Shared JSON config reads tolerate a leading UTF-8 BOM so manually edited `settings.json` files do not break model config loading.
- Anthropic-compatible mode writes:
  - `modelType: "anthropic"`
  - `model`
  - `env.ANTHROPIC_AUTH_TOKEN`
  - `env.ANTHROPIC_BASE_URL`
  - `env.ANTHROPIC_MODEL`
  - `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`
  - `env.ANTHROPIC_DEFAULT_SONNET_MODEL`
  - `env.ANTHROPIC_DEFAULT_OPUS_MODEL`
  - `env.MTL_CODE_MAX_CONTEXT_TOKENS`
  - `env.CONTEXT_WINDOW`
  - clears legacy `env.OPENAI_*` runtime keys so chat cannot accidentally route through OpenAI Chat Completions.

Argus backend:

- The CLI already supports `modelType: "anthropic"` and the `ANTHROPIC_*` environment keys through its settings/env pipeline.
- New sessions spawned by the UI backend pick up the saved settings when the Argus process starts.
- The default Argus context window is 200,000 tokens. DeepSeek does not receive a provider-specific context-window default; users can explicitly set `1000000` when using a 1M-token DeepSeek endpoint.
- The Agent settings UI context-window input must be saved through `/api/settings/mtl-code-model`; a GUI-only value is not enough.
- `server/routes/settings.js` persists the value to `MTL_CODE_MAX_CONTEXT_TOKENS` for the Argus backend and to `CONTEXT_WINDOW` for UI token-budget compatibility.
- `server/claude-sdk.js` merges saved `settings.env` into the spawned Argus child process and mirrors `MTL_CODE_MAX_CONTEXT_TOKENS` to `CONTEXT_WINDOW`.
- `../claude-code/src/utils/context.ts` honors `MTL_CODE_MAX_CONTEXT_TOKENS` for local context decisions such as auto-compact, not only for Ant-internal users.
- Token-budget UI should prefer `modelUsage[model].contextWindow` from the Argus result event when available.
- `src/services/api/client.ts` in the Argus backend explicitly passes `ANTHROPIC_BASE_URL` to the Anthropic SDK client, so configured gateways use the Anthropic Messages API request format.
- Chat execution must call the paired Argus runtime directly, not the Anthropic Agent SDK.
- `server/claude-sdk.js` keeps its historical export name for compatibility, but launches Argus with `--print --input-format stream-json --output-format stream-json --verbose`.
- `@anthropic-ai/claude-agent-sdk` is not a UI dependency; keep it out of `package.json`, `package-lock.json`, and packaged `resources/app/node_modules`.
- Packaged builds try only existing absolute-path runtime candidates: `resources/mtl-code/mtl-code.exe`, bundled `dist/cli-bun.js`, bundled `dist/cli-node.js`, and local dev candidates. Do not add bare `mtl-code` to the chat runtime fallback list; on Windows it can force `cmd.exe` and fail with `spawn C:\WINDOWS\system32\cmd.exe ENOENT`.
- The packaged launcher passes `MTL_CODE_RESOURCES_DIR` to the backend so runtime discovery can resolve `resources/mtl-code` without relying only on `SERVER_DIR`.
- The packaged `mtl-code.cmd` remains for manual fallback and prefers `%BUN_EXE%` or `%USERPROFILE%\.bun\bin\bun.exe` with `dist/cli-bun.js`, then falls back to the bundled Node runtime and `dist/cli-node.js`.
- Local development falls back to Bun plus `../claude-code/dist/cli-bun.js` before trying Node-based entrypoints, because Node 18 cannot run the current Argus build output reliably.
- Chat execution validates and repairs the project cwd before spawning Argus. On Windows, a malformed decoded path such as `C//Users/.../new/web/app` can be repaired to the existing hyphenated directory `C:\Users\...\new-web-app`; otherwise the UI returns a clear missing-project-directory error instead of a misleading backend binary `ENOENT`.
- Permission prompts use Argus's `stdio` control protocol and are bridged back to the existing frontend permission UI.

## Auth Status

`ClaudeProviderAuth` reports the Argus agent as authenticated when Anthropic-compatible runtime credentials are present.

## Verification

- `npm run typecheck`
- `npm run lint`
- Smoke-test the settings API before a packaging pass:
  - `GET /api/settings/mtl-code-model`
  - `PUT /api/settings/mtl-code-model`

## Follow-up: Chat First Screen

- The chat empty state must not expose provider/model switching.
- `ProviderSelectionEmptyState.tsx` renders a static `Argus / Argus` card.
- `useChatProviderState.ts` forces `selected-provider` to `claude` and `claude-model` to the `mtlcode` sentinel, replacing stale local values such as `opus`.
- `shared/modelConstants.js` exposes one Argus model: `{ value: "mtlcode", label: "Argus" }`.
- `server/claude-sdk.js` skips forwarding the `mtlcode` sentinel as a concrete CLI model, so the backend resolves the real runtime model from Argus settings/env.

## Follow-up: First-Use Optional Surfaces

- Settings first-use tabs are limited to Agents and Appearance.
- TaskMaster settings/install prompts are disabled by a no-op `TasksSettingsProvider`; TaskMaster routes remain legacy/optional backend surface.
- The sidebar community/Discord entry is hidden in expanded and collapsed sidebars.
- Persisted `tasks` active tabs are no longer considered valid and fall back to chat.
