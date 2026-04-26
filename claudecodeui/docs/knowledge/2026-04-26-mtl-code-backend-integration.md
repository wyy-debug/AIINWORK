# MTL-Code Backend Integration

Date: 2026-04-26

## Decision

`claudecodeui` is now treated as MTL-Code UI. The UI starts the local MTL-Code backend through the Claude Agent SDK compatibility path.

The provider key remains `claude` for now because it is part of the existing WebSocket message contract, normalized message storage, SDK preset names, and many provider maps. User-facing copy, package metadata, CLI names, app data paths, and default backend execution now use MTL-Code naming.

## Runtime Contract

- Primary backend executable: `mtl-code`
- Override env: `MTL_CODE_CLI_PATH`
- Legacy fallback env: `CLAUDE_CLI_PATH`
- Primary backend config directory: `~/.mtl-code`
- Legacy history/config fallback: `~/.claude`
- UI app data directory: `~/.mtl-code-ui`
- UI package/bin: `mtl-code-ui`

## Frontend-To-Backend Path

1. Frontend sends the existing `claude-command` WebSocket message.
2. `server/index.js` keeps routing that message to `queryClaudeSDK`.
3. `server/claude-sdk.js` sets `pathToClaudeCodeExecutable` to `MTL_CODE_CLI_PATH || CLAUDE_CLI_PATH || "mtl-code"`.
4. The SDK spawns MTL-Code while keeping Claude SDK presets such as `claude_code` for compatibility.
5. Project/session discovery checks `~/.mtl-code/projects` first and then `~/.claude/projects`.

## Packaging Impact

Desktop packaging should bundle or locate both:

- `mtl-code-ui`: Electron shell plus built frontend/backend.
- `mtl-code`: the CLI/backend executable used by the SDK.

The installer can either add the bundled `mtl-code` to the child process PATH or set `MTL_CODE_CLI_PATH` before launching the backend.

