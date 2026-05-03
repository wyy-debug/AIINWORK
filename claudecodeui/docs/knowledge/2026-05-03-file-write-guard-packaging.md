# 2026-05-03 File Write Guard And Packaging

## Summary

This note records the first write-safety layer for Argus and the Windows installer generated after it. The goal is to reduce intermittent file write failures and make future debugging traceable instead of guessing whether a save, upload, model tool write, or external process changed a file.

## Implemented

- UI text file reads now return a `baseHash`.
- UI text file saves send `content + baseHash`.
- Backend save rejects stale writes with `409 FILE_WRITE_CONFLICT` when the file changed after the editor loaded it.
- Backend save uses a same-directory temporary file, then `rename`, then reads the file back and verifies the expected hash.
- Same-process writes to the same file are serialized in `server/services/file-mutation-service.js`.
- File create, update, rename, delete, and upload operations append an audit event to `file-mutations.jsonl`.
- Argus CLI `FileWriteTool` and `FileEditTool` still use the existing `writeTextContent` path, but the shared low-level write now performs post-write content verification.
- Argus UI permission defaults now use `acceptEdits`, and both frontend and backend clear stale exact `Bash/Edit/Write` deny entries so Task/Agent worker dispatches are not blocked from using write tools.

## Owner Files

| Area | Files |
| --- | --- |
| UI file guard service | `server/services/file-mutation-service.js` |
| Project file routes | `server/index.js` |
| Frontend API wrapper | `src/utils/api.js` |
| Code editor save state | `src/components/code-editor/hooks/useCodeEditorDocument.ts` |
| Argus CLI low-level write verification | `../claude-code/src/utils/file.ts` |
| Runtime docs | `docs/knowledge/04-runtime-flows.md` |
| Module ownership docs | `docs/knowledge/03-module-map.md` |

## Runtime Contract

Editor save flow:

1. `GET /api/projects/:projectName/file?filePath=...`
2. Response includes `content`, `baseHash`, `hash`, `size`, `mtimeMs`, and `encoding`.
3. `PUT /api/projects/:projectName/file` with `filePath`, `content`, and `baseHash`.
4. If current disk hash differs from `baseHash`, return:

```json
{
  "code": "FILE_WRITE_CONFLICT",
  "error": "File changed on disk. Reload before saving.",
  "expectedHash": "...",
  "currentHash": "...",
  "path": "..."
}
```

5. On success, response includes the next `baseHash`.

## Packaging Result

The installer was rebuilt after the guard landed and after rebuilding the paired Argus CLI.

Commands used:

```powershell
C:\Users\Stan\.bun\bin\bun.exe run build
$env:ARGUS_RUNTIME_NODE='C:\Users\Stan\Desktop\MTLCode\workspace\vendor\runtime-node24\node.exe'
& 'C:\Users\Stan\Desktop\MTLCode\workspace\vendor\runtime-node24\node.exe' scripts\package-electron-win.mjs
```

Output:

```text
C:\Users\Stan\Desktop\MTLCode\workspace\vendor\electron-dist\Argus-1.30.3-x64.exe
```

Packaging checks completed:

- build Node: Node 24.14.0
- packaged runtime Node: Node 24.14.0
- Vite client build completed
- server TypeScript build completed
- Argus backend compiled into `electron-resources/mtl-code/mtl-code.exe`
- `better-sqlite3` packaged native smoke passed
- `node-pty` packaged native smoke passed
- Repackaged after the Task/Agent write-permission default fix; first attempt was blocked by a running `win-unpacked\Argus.exe`, then the locked dev processes were stopped and the installer rebuilt successfully.
- Repackaged again after runtime diagnostics session-cache fix; installer path remains `workspace/vendor/electron-dist/Argus-1.30.3-x64.exe`.
- Repackaged again after hiding internal `<task-notification>` messages from visible chat; the first attempt was blocked by running unpacked Argus processes, then those build-output processes were stopped and packaging succeeded.

Known warnings:

- Vite reports large chunks over 1000 kB.
- Electron Builder reports `asar` is disabled. This is intentional for the current local packaging shape because backend resources and native modules must remain externally available.

## Verification

Completed before packaging:

```powershell
npm run typecheck
npm run check:mojibake
npm run build
npx eslint server/services/file-mutation-service.js src/components/code-editor/hooks/useCodeEditorDocument.ts src/utils/api.js
C:\Users\Stan\.bun\bin\bun.exe run typecheck
C:\Users\Stan\.bun\bin\bun.exe test src/utils/__tests__/file.test.ts
C:\Users\Stan\.bun\bin\bun.exe x biome lint src/utils/file.ts
```

Global `npm run lint` is still blocked by a pre-existing boundary error in `server/projects.js`; do not treat that as introduced by the write guard.

## Next Plan

1. **Packaged smoke on a clean install**
   - Install `Argus-1.30.3-x64.exe`.
   - Launch from Start menu.
   - Verify backend health, project list, project add, chat send, file tree, Shell, and settings open.
   - Save a file through Files and confirm no conflict on normal save.
   - Open the same file, edit it externally, then save from Argus and confirm `FILE_WRITE_CONFLICT` is shown instead of overwriting.

2. **Write guard second layer**
   - Add UI recovery action for conflict: reload file, compare current editor content, or copy unsaved draft.
   - Surface `file-mutations.jsonl` through a diagnostics view.
   - Consider routing Argus CLI tool write events into the same audit log, not only post-write verification.

3. **Long-running thinking/status stability**
   - Fix cases where OpenMythos/coordinator status keeps showing thinking after the answer is finished.
   - Treat final assistant message, abort, tool completion, and process exit as hard terminal states for the composer status bar.
   - Keep runtime diagnostics cached per session so the panel survives temporary session id replacement and route refreshes.

4. **Navigation panel reliability**
   - Re-test Chat, Files, Shell, Changes, Run, and Preview switching in the packaged app.
   - Keep `/session/:id` route sync from forcing Chat when the user intentionally opens another panel.

5. **Release hardening**
   - Decide whether to keep `asar=false` or move to `asar + asarUnpack`.
   - Add installer signing later.
   - Add a one-command packaged smoke script that starts the unpacked app and checks `/health`, native modules, and bundled Argus spawn.
