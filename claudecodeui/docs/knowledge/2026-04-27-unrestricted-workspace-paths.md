# 2026-04-27 Unrestricted Workspace Paths

## Why

Project creation previously constrained every selected workspace path to `WORKSPACES_ROOT`, which defaults to the current user home directory. On Windows this meant the folder picker could browse `C:\Users\<user>` but failed as soon as the user selected another drive or a path outside the home folder.

The product behavior is now: users may create or add projects from any normal filesystem location, while obvious system-critical directories remain blocked.

## Backend Rules

- `server/routes/projects.js` owns workspace path validation through `validateWorkspacePath()`.
- `WORKSPACES_ROOT` is now only the default browsing start path. It is not an allow-list root.
- `validateWorkspacePath()` still resolves absolute paths and follows existing symlinks before returning `resolvedPath`.
- The validator blocks forbidden system locations through `FORBIDDEN_PATHS`, including Windows locations such as `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`, `C:\System Volume Information`, and `C:\$Recycle.Bin`.
- Symlinks are allowed only when their real target is not a forbidden system location.
- The old error text `Workspace path must be within the allowed workspace root` should not reappear.

## Folder Browser Rules

- `/api/browse-filesystem` in `server/index.js` still uses `validateWorkspacePath()` before reading a real directory.
- The special path `__WINDOWS_DRIVES__` is a virtual browser location, not a real workspace path.
- When the frontend requests `__WINDOWS_DRIVES__`, the backend lists accessible Windows drive roots such as `C:\`, `D:\`, or `E:\`.
- The frontend constant for this virtual location is `WINDOWS_DRIVES_PATH` in `src/components/project-creation-wizard/utils/pathUtils.ts`.
- `getParentPath()` maps a Windows drive root such as `C:\` back to `WINDOWS_DRIVES_PATH`, letting users jump from one drive to another without typing a path.
- `FolderBrowserModal.tsx` shows `displayPath` when present. The virtual location displays as `This PC`.
- `Use this folder` and create-folder actions are disabled at the virtual `This PC` layer because it is not a valid workspace target.

## User Flow

1. The folder picker opens at `~`, which expands to `WORKSPACES_ROOT`.
2. The user can navigate upward to a drive root such as `C:\`.
3. From the drive root, the `..` row opens `This PC`.
4. `This PC` lists accessible drive roots.
5. The user selects a normal folder on any drive.
6. Workspace creation or existing workspace registration calls `validateWorkspacePath()`.
7. The backend accepts the path unless it is a forbidden system location or resolves through a symlink to one.

## Verification

- `node --check server/routes/projects.js`
- `node --check server/index.js`
- `git diff --check`
- Smoke test the folder picker on Windows:
  - open the project creation wizard
  - browse from `C:\` to `This PC`
  - choose a folder on another drive, for example `E:\AIINWORK`
  - create or add the workspace
  - confirm no `allowed workspace root` error is shown

## Packaging Note

The desktop packaging flow uses:

- `npm run package:electron-win`
- output directory: `../workspace/vendor/electron-dist`

The packaging script builds the paired `../claude-code` runtime when `../claude-code/dist/cli-node.js` is missing, then builds the UI client/server and invokes `electron-builder`.
