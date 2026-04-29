# AIINWORK Code Search MCP

Local stdio MCP server for searching a code folder passed by the caller.

## Tools

- `list_code_roots`: Show allowed search roots.
- `find_files`: Find files by name/path.
- `search_code`: Search code with ripgrep.
- `read_file`: Read a bounded file slice with line numbers.
- `repo_overview`: Summarize file counts by extension.
- `gitnexus_analyze`: Optional GitNexus index command for deeper graph search.
- `gitnexus_status`: Optional GitNexus status command.
- `gitnexus_tools`: List tools exposed by the installed GitNexus MCP server.
- `semantic_context`: Proxy GitNexus `context` for callers, callees, references, and process participation.
- `semantic_impact`: Proxy GitNexus `impact` for full semantic call-graph blast radius.
- `semantic_detect_changes`: Proxy GitNexus `detect_changes` for git-diff impact.
- `gitnexus_call_tool`: Advanced raw GitNexus MCP tool call.
- `doctor`: Check Node/npm/npx/ripgrep/GitNexus readiness and return actionable hints.

## Run

```powershell
cd E:\AIINWORK\ainwork-code-search-mcp
npm install
npm start
```

The MCP does not default to a code root. Pass `root` in each search/index tool call:

```json
{
  "root": "E:\\AIINWORK\\claudecodeui",
  "query": "providerMcpService"
}
```

Optionally restrict searchable roots with `AINWORK_CODE_ROOTS`. On Windows, separate multiple roots with semicolons:

```powershell
$env:AINWORK_CODE_ROOTS="E:\AIINWORK\claudecodeui;E:\AIINWORK\claude-code"
npm start
```

If `AINWORK_CODE_ROOTS` is unset, the caller may pass any explicit absolute root.

If this MCP is installed from Agent/Skill/MCP Hub, MTL-Code can write a default root into the MCP env:

```powershell
$env:AINWORK_DEFAULT_CODE_ROOT="E:\AIINWORK\claudecodeui"
npm start
```

When `AINWORK_DEFAULT_CODE_ROOT` is configured, tool calls may omit `root`; passing `root` still overrides the default for that call.

Optional GitNexus runtime settings:

- `GITNEXUS_PACKAGE`: npm package used by runtime `npm exec`; defaults to pinned `gitnexus@1.6.3`. Old `gitnexus@latest` values are normalized to this pinned default.
- `GITNEXUS_IGNORE_SCRIPTS`: defaults to `true`. This avoids npm optional dependency rebuild failures seen on some Windows Node/npm combinations. Set to `false` only if your GitNexus install requires package scripts.
- `GITNEXUS_COMMAND`: local GitNexus executable to use instead of `npm exec`, for offline or preinstalled setups.
- `GITNEXUS_MCP_TIMEOUT_MS`: timeout for GitNexus MCP calls; defaults to `60000`.

## Project MCP Config

The repository root `.mcp.json` points MTL-Code/Claude-compatible project MCP discovery at:

```text
E:\AIINWORK\ainwork-code-search-mcp\src\server.js
```

This root repo intentionally ignores `.mcp.json` as local runtime state. A tracked copy lives at:

```text
examples/claude-project.mcp.json
```

For Codex project scope, add this to `E:\AIINWORK\.codex\config.toml` if needed:

```toml
[mcp_servers.ainwork-code-search]
command = "node"
args = ["E:\\AIINWORK\\ainwork-code-search-mcp\\src\\server.js"]
```

Tracked provider examples:

- `examples/claude-project.mcp.json`
- `examples/codex.config.toml`
- `examples/gemini.settings.json`

## Hub package

`hub.mcp.json` describes the cloud catalog metadata and setup fields for Agent/Skill/MCP Hub. It exposes:

- `root` mapped to `AINWORK_DEFAULT_CODE_ROOT`.
- optional `AINWORK_CODE_ROOTS` allowlist.
- optional `GITNEXUS_COMMAND`.

Publish to a running Hub:

```powershell
cd E:\AIINWORK\ainwork-code-search-mcp
$env:HUB_URL="http://192.168.181.27:4877"
$env:HUB_ADMIN_TOKEN="your-admin-token"
npm run publish:hub
```

After MTL-Code pulls it from the Hub, the Repository tab will show the required `root` configuration before writing the MCP server into the MTL-Code/Claude Code MCP config.

## GitNexus

GitNexus is not vendored into this folder. The optional tools do not require a preinstalled global binary. By default they run a pinned package through npm:

```powershell
npm exec --yes --ignore-scripts --package gitnexus@1.6.3 -- gitnexus analyze
npm exec --yes --ignore-scripts --package gitnexus@1.6.3 -- gitnexus status
```

If npm/network access is not available on a target machine, preinstall GitNexus there and set `GITNEXUS_COMMAND` to the local executable or script path. Text search tools (`find_files`, `search_code`, `read_file`, `repo_overview`) continue to work even when GitNexus is unavailable.

For full semantic call-graph impact, first index the repo:

```json
{
  "root": "E:\\AIINWORK\\claude-code",
  "force": false
}
```

Call tool: `gitnexus_analyze`

Then inspect a symbol:

```json
{
  "root": "E:\\AIINWORK\\claude-code",
  "symbol": "providerMcpService"
}
```

Call tool: `semantic_context`

Then ask for blast radius:

```json
{
  "root": "E:\\AIINWORK\\claude-code",
  "symbol": "providerMcpService"
}
```

Call tool: `semantic_impact`

If the installed GitNexus version expects different argument names, call `gitnexus_tools` to inspect its live schema, or use `gitnexus_call_tool`:

```json
{
  "root": "E:\\AIINWORK\\claude-code",
  "toolName": "impact",
  "arguments": {
    "symbol": "providerMcpService"
  }
}
```

This keeps the local text search MCP usable immediately while leaving GitNexus as an external local dependency for semantic graph intelligence.

## Agent codeRoot handling

When an Agent request includes a `codeRoot`, pass that value as the per-call `root` argument to every `ainwork-code-search` tool call. The configured `AINWORK_DEFAULT_CODE_ROOT` is only a fallback for calls that omit `root`, not a replacement for the task's explicit `codeRoot`.

## Diagnostics

Before semantic impact analysis, run:

```json
{
  "root": "E:\\AIINWORK\\claude-code"
}
```

Call tool: `doctor`

`doctor` checks Node, npm, npx, ripgrep, and whether GitNexus can start from the selected root. If GitNexus fails, it returns hints such as:

- npm network access is blocked.
- `npm` is missing from PATH.
- GitNexus package resolution failed.
- Use `GITNEXUS_COMMAND` for a preinstalled GitNexus binary.
