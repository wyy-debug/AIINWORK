---
name: mtl-code-capability-builder
description: Create or review MTL-Code capabilities: Agent templates, MCP server packages, Skill packages, Hub catalog metadata, install/setup contracts, and validation/publish workflows. Use when the user asks to build, package, standardize, validate, or publish Agent/MCP/Skill assets for MTL-Code or Agent/Skill Hub.
---

# MTL-Code Capability Builder

Use this Skill when creating or reviewing MTL-Code Agent templates, MCP server packages, Skill packages, or Hub publication payloads.

## Operating Rules

- Read the local repository docs or existing examples before writing artifacts.
- Keep secrets out of Agent templates, Skills, Hub metadata, README files, logs, and reports.
- For MCP secrets or user-specific paths, use Hub `mcp.setupFields` with `target: env`; use `type: password` for secrets.
- Prefer full package installs for Skills and MCP servers; include all required files in `packageFiles`.
- Validate locally before publishing to Hub.
- Do not claim MCP tools are available just because the prompt names them; runtime bindings must actually mount the MCP server.

## Artifact Selection

- Create an **Agent template** when the user needs a reusable role/workflow prompt and optional Skill/MCP dependencies.
- Create a **Skill package** when the user needs reusable procedural knowledge, domain rules, scripts, references, or output contracts.
- Create an **MCP server package** when the capability requires deterministic local tools, API access, repo search, filesystem-safe execution, or runtime data access.
- Create a **combined kit** when an Agent needs Skills and MCP servers together. Publish the MCP servers separately, publish Skills as packages, then publish the Agent template with dependencies.

## Required Workflow

1. Clarify the capability type, user inputs, runtime dependencies, and expected output.
2. Inspect existing examples in the repo, especially previous `hub.mcp.json`, `publish-to-hub.mjs`, `SKILL.md`, and Agent template files.
3. Design the contract:
   - user-facing inputs
   - MCP setup fields
   - runtime tool calls
   - fallback behavior
   - output format
   - error messages
4. Generate files using the standards below:
   - Agent template: read `references/agent-template-standard.md`.
   - Skill package: read `references/skill-package-standard.md`.
   - MCP server package: read `references/mcp-server-standard.md`.
   - Hub publishing: read `references/hub-publishing-standard.md`.
5. Add validation scripts where useful, preferably Node-only so users do not need Python/PyYAML.
6. Run validation and report exactly what passed and what still needs manual setup.

## Quality Bar

- Names use lowercase hyphen slugs, such as `soc-redmine-review-agent`.
- Agent prompts specify exact required inputs and what to do when they are missing.
- Skills keep `SKILL.md` concise and move long rules into one-level `references/`.
- MCP servers return actionable errors with hints; do not throw opaque stack traces for user misconfiguration.
- Windows support matters: avoid assuming Bash-only commands, and handle `.cmd/.bat` spawn quirks when launching npm/npx.
- Hub metadata must be safe to publish: no tokens, no local-only absolute paths except placeholders/examples.

## Validation

If this Skill package is available on disk, run:

```powershell
node scripts/validate-capability.mjs <path-to-agent-or-skill-or-mcp>
```

Use the validator as a smoke check only; still inspect behavior and runtime wiring manually.
