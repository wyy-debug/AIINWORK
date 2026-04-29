# SOC Redmine Agent / MCP Setup Notes

Date: 2026-04-28

This note records the runtime wiring for `soc-redmine-mcp`, `ainwork-code-search-mcp`, and `soc-redmine-review-kit`.

## What caused the REDMINE_API_KEY confusion

`soc-redmine-mcp` reads `REDMINE_API_KEY` only from the environment of the MCP server process. The key is not stored inside the MCP package directory.

MTL-Code writes Claude-compatible MCP runtime configuration to:

```text
~/.mtl-code.json
```

The install directory:

```text
~/.mtl-code/mcp-servers/soc-redmine
```

contains only the MCP server files. Searching only under `~/.mtl-code/` will not find the user-level MCP runtime env. Running `node src/server.js` manually from Bash/PowerShell will also fail unless that shell explicitly sets `REDMINE_API_KEY`, because the shell process does not inherit values from `~/.mtl-code.json`.

There was also a Code UI runtime bug: Code UI starts MTL-Code with `--bare` by default for faster, cleaner scripted sessions. MTL-Code's own startup code skips auto-discovered MCP config in `--bare` mode, including user-level config and `.mcp.json`. That meant the installed MCP config could be correct, but the session still had no mounted MCP tools.

The fix is: when a session/Agent has MCP bindings, Code UI keeps `--bare` but also passes the user-level MCP config explicitly through `--mcp-config ~/.mtl-code.json`. MTL-Code honors explicit `--mcp-config` even in bare mode, so the configured `REDMINE_API_KEY` and `AINWORK_DEFAULT_CODE_ROOT` are available to the MCP server process without putting secrets in prompts or command-line JSON.

## Correct runtime flow

1. Install `soc-redmine` from Hub or configure it manually as an MCP server.
2. Fill `REDMINE_BASE_URL` and `REDMINE_API_KEY` in the MCP setup form.
3. MTL-Code writes the runtime server entry to `~/.mtl-code.json`.
4. When a conversation starts with a bound Agent/MCP, Code UI passes `~/.mtl-code.json` via `--mcp-config`, and the MTL-Code runtime launches the MCP server with the configured env.
5. The Agent prompt may mention `MCP: soc-redmine`, but the prompt never contains the API key.

## Agent dependency behavior

The `soc-redmine-review-agent` Hub template must declare:

- Skills: `redmine-issue-intake`, `soc-risk-review`, `soc-testcase-table-generator`
- MCP servers: `soc-redmine`, `ainwork-code-search`

Skill dependencies can be installed automatically. MCP dependencies that require local secrets or paths are not silently marked as usable. If `REDMINE_API_KEY` or `AINWORK_DEFAULT_CODE_ROOT` is missing during dependency installation, the dependency status is `needs-configuration`; the Agent can still install, but MTL-Code should not auto-bind that MCP until it is configured.

## ainwork-code-search root

`ainwork-code-search-mcp` declares `root` as a setup field. The installer writes it to `AINWORK_DEFAULT_CODE_ROOT`.

Tool calls may still pass a per-call `root` argument. For SOC Redmine Agent requests, the user-provided `codeRoot` must be passed as that per-call `root`. `AINWORK_DEFAULT_CODE_ROOT` is only a fallback for calls that omit `root`.

If no default root is configured and the tool call does not pass `root`, the MCP returns:

```text
root is required. Pass the directory you want this MCP to search, or configure AINWORK_DEFAULT_CODE_ROOT.
```

## GitNexus package behavior

`ainwork-code-search-mcp` does not vendor GitNexus and does not require users to have a global GitNexus binary. The default runtime path is:

```text
npm exec --yes --ignore-scripts --package gitnexus@1.6.3 -- gitnexus ...
```

Older configs that still contain `GITNEXUS_PACKAGE=gitnexus@latest` are normalized to the pinned default by the MCP server. `GITNEXUS_IGNORE_SCRIPTS=true` avoids npm optional dependency rebuild failures such as:

```text
Cannot destructure property 'package' of 'node.target'
```

If a user's machine cannot reach npm, or needs a locally managed GitNexus install, configure `GITNEXUS_COMMAND` in the MCP setup form. Text search tools remain usable even when GitNexus semantic indexing is unavailable.

## Operational rules

- Never put `REDMINE_API_KEY` in Agent templates, Skills, Hub catalog entries, docs, reports, or chat messages.
- Use the MTL-Code MCP setup UI to store secrets locally.
- For manual MCP testing, set env variables only in the current shell session and do not write them to repo files.
- In standalone conversations, make sure the selected Agent/session actually has `MCP: soc-redmine` and `MCP: ainwork-code-search` bindings; otherwise the prompt may describe the workflow but the runtime tools may not be mounted for that session.
