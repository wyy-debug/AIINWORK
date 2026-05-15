# MTL.md

This file provides guidance to MTL-Code (MTL-Code) when working with code in this repository.

## Repository Layout

- The main project lives in `claude-code/`; run development commands from that directory unless a task explicitly targets the outer repository.
- This is a Bun + TypeScript ESM monorepo for the MTL-Code CLI. Workspaces are declared in `claude-code/package.json` under `packages/*`, `packages/@ant/*`, and `packages/@anthropic-ai/*`.
- There is no root README, Cursor rule, or Copilot instruction file at the time this guidance was written. `claude-code/CLAUDE.md` contains a more exhaustive project guide if deeper context is needed.

## Commands

```bash
cd claude-code

# Install dependencies
bun install

# Run the CLI in development mode
bun run dev

# Run dev mode with debugger support
bun run dev:inspect

# Pipe/non-interactive mode
printf "say hello" | bun run src/entrypoints/cli.tsx -p

# Build. Outputs dist/cli.js plus cli-bun.js and cli-node.js wrappers.
bun run build

# Alternative Vite build pipeline
bun run build:vite

# Typecheck, test, lint, and format
bun run typecheck
bun test
bun test src/utils/__tests__/hash.test.ts
bun test --coverage
bun run test:all
bun run lint
bun run lint:fix
bun run format

# Other useful checks/services
bun run health
bun run check:unused
bun run rcs
bun run docs:dev
```

## Architecture Overview

- `src/entrypoints/cli.tsx` is the lightweight process entrypoint. It handles fast paths such as version output, system prompt dump, MCP/daemon/bridge modes, and then loads `src/main.tsx` for the full CLI.
- `src/main.tsx` defines the Commander.js CLI surface, initializes permissions, MCP, auth/session state, and dispatches to interactive REPL or print/headless execution.
- `src/query.ts` is the main model turn loop: it prepares context, calls the model, streams responses, runs tools, handles compaction/retry behavior, and continues tool-result follow-up turns.
- `src/QueryEngine.ts` wraps `query()` for higher-level session orchestration, mutable conversation state, compaction context, file history snapshots, attribution, and SDK/headless flows.
- `src/screens/REPL.tsx` is the interactive terminal UI entry point. UI is React/Ink based; shared app state lives in `src/state/*`, with process-wide session singletons in `src/bootstrap/state.ts`.
- `src/services/api/claude.ts` builds the Anthropic Messages API request, including system prompt blocks, message normalization, tool schemas, beta headers, provider-specific parameters, streaming, retry, and non-streaming fallback.
- Model provider selection is centralized in `src/utils/model/providers.ts`; supported paths include first-party Anthropic plus Bedrock, Vertex, Foundry, OpenAI-compatible, Gemini, and Grok adapters.
- System prompt and injected context are split across `src/constants/prompts.ts`, `src/context.ts`, `src/utils/api.ts`, `src/utils/claudemd.ts`, `src/utils/attachments.ts`, and `src/utils/messages.ts`. Default rules go into the API `system` field; project/user memory and many dynamic hints are injected as meta user messages wrapped in `<system-reminder>`.
- Tools are defined by the `Tool` interface in `src/Tool.ts`, assembled in `src/tools.ts`, and mostly implemented under `packages/builtin-tools/src/tools/`. Important groups include file tools, shell/REPL tools, planning tools, agent/task tools, MCP/web tools, and scheduling tools.
- `packages/@ant/ink/` is the forked Ink framework used by terminal UI components. Do not confuse it with `src/ink.ts`, which is only the render wrapper.
- Remote Control / Bridge code is under `src/bridge/` and `packages/remote-control-server/`; ACP integration is under `src/services/acp/` and `packages/acp-link/`.

## Build and Feature Flags

- Runtime is Bun (`engines.bun >= 1.2.0`), module type is ESM, JSX uses `react-jsx`, and TypeScript strict mode is enabled.
- `build.ts` uses `Bun.build()` with code splitting from `src/entrypoints/cli.tsx`, injects macro defines from `scripts/defines.ts`, enables default build features, copies vendor assets, and emits both Bun and Node wrapper entrypoints.
- Feature gates use `import { feature } from 'bun:bundle'`. Keep the standard direct pattern `if (feature('FLAG')) {}` or ternary conditions; this project relies on Bun feature processing and dead-code elimination.
- Dev mode runs through `scripts/dev.ts` with Bun `-d` macro defines and broader feature availability than production builds.

## Conventions and Constraints

- TypeScript must remain clean: `bun run typecheck` is the authoritative check for type errors.
- Commit messages in this repository use Conventional Commits, for example `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`, or `refactor: ...`.
- Path aliases from `tsconfig.json` include `src/*`, `@mtl-code/builtin-tools/*`, `@mtl-code/mcp-client/*`, `@mtl-code/agent-tools/*`, and `@mtl-code/weixin/*`.
- The codebase includes decompiled React Compiler output such as `_c(...)` memoization in `.tsx` components; treat that as normal when editing UI files.
- Biome only targets `src/` through the package scripts. Use existing formatting style and avoid broad formatting changes outside the files you intentionally modify.
