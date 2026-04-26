# AIINWORK

AIINWORK is a local-first MTL-Code desktop workspace.

## Structure

- `claude-code/` - MTL-Code backend CLI and agent runtime.
- `claudecodeui/` - MTL-Code UI frontend and local server.
- `workspace/` - local packaging/output workspace. This is ignored by Git.

## Git Notes

The source folders were originally separate Git repositories. When uploading this
root folder as one repository, remove or move the nested `.git` folders first so
Git stores the actual source files instead of submodule pointers.
