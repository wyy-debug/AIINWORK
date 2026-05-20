# Performance / Review Bug Verification

Date: 2026-05-20

## Scope

- GitHub #306 / Kanban #304: `PERF-REVIEW-001 ReviewPanel caps large diff rendering`
- GitHub #307 / Kanban #305: `PERF-REVIEW-002 Review flow guards untracked file previews`

## Root Causes

- ReviewPanel converted every diff line into React elements. Large diffs could create thousands of DOM rows and make the Review tab slow.
- Git review flow generated synthetic diffs for untracked files by reading the entire file as UTF-8. Large or binary untracked files could slow review generation or create noisy artifacts.

## Fix Summary

- Added `MAX_RENDERED_DIFF_ROWS` and bounded ReviewPanel rendered diff rows to 1,500 with a visible truncation notice.
- Kept rendered-row line numbers stable so line comments still target visible rows.
- Moved untracked-file preview generation into the review flow service with a 64 KiB size guard.
- Added binary detection and safe summary output for likely binary untracked files.
- Preserved bounded text previews for normal untracked files.

## Commands

- `npm run test:unit -- ReviewPanel.test.tsx server/services/tests/git-native-review-flow-service.test.mjs` - passed, 2 files, 7 tests.
- `npm run typecheck` - passed.
- `npm run build` - passed.
- `npm run check:mojibake` - passed, no mojibake patterns found.
