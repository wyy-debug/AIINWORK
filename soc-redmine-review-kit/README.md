# SOC Redmine Review Kit

Agent and Skill package for SOC Redmine risk review and test case generation.

## Contents

- `agents/soc-redmine-review-agent.md`
- `skills/redmine-issue-intake`
- `skills/soc-risk-review`
- `skills/soc-testcase-table-generator`
- `scripts/publish-to-hub.mjs`

Install or publish these together with:

- `soc-redmine-mcp`
- `ainwork-code-search-mcp`

## Required Runtime Inputs

- `issueId`
- `codeRoot`

The report is printed directly in chat. This kit does not require `outputPath` and does not write report files.

## Required MCP Servers

- `soc-redmine`
- `ainwork-code-search`

Example MCP config:

```text
examples/mcp-config.json
```

Example agent request:

```text
examples/review-request.md
```

The Redmine API key in examples is a placeholder. Store the real value only in the local MCP env.

## MTL-Code Agent Dependencies

When published to Agent/Skill Hub, the Agent template declares these dependencies:

- Skills: `redmine-issue-intake`, `soc-risk-review`, `soc-testcase-table-generator`
- MCP servers: `soc-redmine`, `ainwork-code-search`

MTL-Code installs Skill dependencies automatically. MCP dependencies that require local values, such as `REDMINE_API_KEY` or `AINWORK_DEFAULT_CODE_ROOT`, must be configured in MTL-Code's MCP config flow. Do not put real API keys in this Agent template, Skill files, Hub catalog data, or review reports.

MTL-Code stores Claude-compatible MCP runtime configuration in the user-level file:

```text
~/.mtl-code.json
```

The installed MCP package directory under `~/.mtl-code/mcp-servers/<name>` only contains server files. Running `node src/server.js` manually will not inherit `REDMINE_API_KEY` unless you set that environment variable yourself for that shell. In normal use, MTL-Code reads `~/.mtl-code.json` and starts `soc-redmine` with the configured env values.

For `ainwork-code-search`, configure `root` during MCP install if you want a default fallback. It is written to `AINWORK_DEFAULT_CODE_ROOT`. When the user request includes `codeRoot`, the Agent must pass that value as the per-call `root` argument to `doctor`, `gitnexus_analyze`, `semantic_context`, `semantic_impact`, `search_code`, `read_file`, and `find_files`.

GitNexus is optional for semantic impact. `ainwork-code-search-mcp` now defaults to a pinned npm package (`gitnexus@1.6.3`) and starts it with `npm exec --ignore-scripts` so distributed installs do not depend on a preinstalled global GitNexus binary. If npm/network access is unavailable, configure `GITNEXUS_COMMAND` to a preinstalled GitNexus executable.

## Publish To Hub

```powershell
cd E:\AIINWORK\soc-redmine-review-kit
$env:HUB_URL="http://localhost:4877"
$env:HUB_ADMIN_TOKEN="your-admin-token"
npm run publish:hub
```

The publish script creates one Agent template item and three Skill package items.

## Validate

This kit uses a Node-only skill validator so users do not need Python or PyYAML:

```powershell
npm run check
```
