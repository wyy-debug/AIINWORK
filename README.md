# AIINWORK

AIINWORK is a local-first MTL-Code desktop workspace.

## Structure

- `claude-code/` - MTL-Code backend CLI and agent runtime.
- `claudecodeui/` - MTL-Code UI frontend and local server.
- `agent-skill-hub/` - standalone Agent template and Skill repository hub.
- `ainwork-code-search-mcp/` - local code search and GitNexus semantic impact MCP.
- `soc-redmine-mcp/` - local SOC Redmine issue and revision diff MCP.
- `soc-redmine-review-kit/` - SOC Redmine review Agent template and Skills.
- `mtl-code-capability-builder-skill/` - Skill for creating and validating MTL-Code Agent, MCP, and Skill packages.
- `workspace/` - local packaging/output workspace. This is ignored by Git.

## Git Notes

The source folders were originally separate Git repositories. When uploading this
root folder as one repository, remove or move the nested `.git` folders first so
Git stores the actual source files instead of submodule pointers.
