# Argus Five-Layer Knowledge Architecture

Updated: 2026-05-03

This directory is the development entry point for `claudecodeui`, now branded as Argus. Use it to answer five practical questions before changing code: what domain concept is involved, which system boundary owns it, which module should change, which runtime flow is affected, and how to verify the result.

## Layers

| Layer | File | Question |
| --- | --- | --- |
| K1 | [01-domain-knowledge.md](01-domain-knowledge.md) | What domain concepts and shared terms does the project use? |
| K2 | [02-system-architecture.md](02-system-architecture.md) | How do frontend, backend, providers, storage, and realtime channels cooperate? |
| K3 | [03-module-map.md](03-module-map.md) | Which files and modules own each capability? |
| K4 | [04-runtime-flows.md](04-runtime-flows.md) | How do common user flows run end to end? |
| K5 | [05-development-playbook.md](05-development-playbook.md) | How should changes be implemented and verified safely? |

## Current Notes

- [2026-05-04-repository-update-summary.md](2026-05-04-repository-update-summary.md): repository update from `2d96cbc` to `4785f3d`, Argus Workbench/API/runtime changes, ContextBudget/RAG removal notes, and verification checklist.
- [2026-05-03-file-write-guard-packaging.md](2026-05-03-file-write-guard-packaging.md): write guard, stale-save conflict handling, Argus CLI post-write verification, Windows installer output, packaging checks, and next hardening plan.
- [2026-05-03-context-budget-alignment.md](2026-05-03-context-budget-alignment.md): unified ContextBudget contract for current context window usage, cumulative token consumption, DeepSeek 1M display, diagnostics, and packaging verification.
- [2026-05-03-argus-workbench-integration.md](2026-05-03-argus-workbench-integration.md): chat-first Workbench flow, visible Changes/Run/Preview/Results panels, runtime settings ownership, and coordinator/subagent defaults.
- [2026-04-28-mtl-code-user-guide.md](2026-04-28-mtl-code-user-guide.md): user-facing Argus guide covering projects, conversations, model settings, Agent, Skill, MCP, Hub, Worktree, permissions, and caveats.
- [2026-04-29-openmythos-runtime.md](2026-04-29-openmythos-runtime.md): OpenMythos-inspired runtime controls, saved settings shape, launch environment mapping, diagnostics, and verification steps.
- [2026-04-29-mimo-model-profiles.md](2026-04-29-mimo-model-profiles.md): multi-model profile settings and Xiaomi MiMo Anthropic-compatible setup.
- [2026-04-28-redmine-mcp-agent-setup.md](2026-04-28-redmine-mcp-agent-setup.md): SOC Redmine Agent dependency wiring, MCP env storage, `REDMINE_API_KEY` handling, `ainwork-code-search` root setup, and GitNexus package fallback behavior.
- Agent knowledge/RAG upload and retrieval is removed from the product runtime. Keep Agent context to prompt, Skills, MCP bindings, memory metadata, and normal workspace files.
- [2026-04-27-session-agent-slots.md](2026-04-27-session-agent-slots.md): per-conversation Agent selection, required slot setup, backend persistence, and project/conversation state separation.
- [2026-04-27-agent-skill-repository.md](2026-04-27-agent-skill-repository.md): remote catalog support for agent prompt templates and Skills, including upload, install, and likes.
- [2026-04-27-agent-skill-hub-extraction.md](2026-04-27-agent-skill-hub-extraction.md): extraction of the embedded remote repository server into the standalone Agent/Skill Hub project.
- [2026-04-27-remote-agent-repository-server.md](2026-04-27-remote-agent-repository-server.md): standalone Hub API for shared submissions, review/publish, global likes, and public catalog hosting.
- [2026-04-28-worktree-dispatch.md](2026-04-28-worktree-dispatch.md): Codex-style managed detached worktree dispatch, session linkage, and delete/branch behavior.
- [2026-04-28-context-compaction-user-guide.md](2026-04-28-context-compaction-user-guide.md): user-facing guide for automatic/manual context compaction, GUI boundary cards, summaries, and caveats.
- [2026-04-28-core-smoke-checklist.md](2026-04-28-core-smoke-checklist.md): manual smoke checklist for project/conversation, Agent, Skill, MCP, Hub, Worktree, permissions, delete, and file mentions.
- [2026-04-27-unrestricted-workspace-paths.md](2026-04-27-unrestricted-workspace-paths.md): project creation can use normal folders outside the home directory, with system-critical paths still blocked.
- [2026-04-26-local-first-frontend.md](2026-04-26-local-first-frontend.md): frontend auth/Git removal for first-use simplicity.
- [2026-04-26-mtl-code-backend-integration.md](2026-04-26-mtl-code-backend-integration.md): Argus backend executable, config paths, and provider compatibility.
- [2026-04-26-mtlcode-agent-openai-model-config.md](2026-04-26-mtlcode-agent-openai-model-config.md): Agent settings simplification, Argus-only model surface, Anthropic-compatible backend config, and context-window propagation.
- [desktop-packaging-plan.md](desktop-packaging-plan.md): plan for bundling frontend and backend into a desktop installer.

## How To Use

1. Start with K1 to name the domain concept.
2. Use K2 to confirm whether the change belongs to frontend, backend, provider, storage, or realtime boundaries.
3. Use K3 to pick the owner module and first file to inspect.
4. Use K4 to check affected runtime flows.
5. Use K5 to choose the smallest useful verification.

## Maintenance Rules

Update these docs when changing:

- public API routes or WebSocket message types
- provider contracts, provider IDs, model lists, or normalized message shapes
- module ownership, directory structure, or dependency boundaries
- auth/settings/storage/project discovery/workspace safety behavior
- local development, lint, typecheck, build, desktop packaging, or installer commands
