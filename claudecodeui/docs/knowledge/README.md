# MTL-Code UI Five-Layer Knowledge Architecture

Updated: 2026-04-26

This directory is the development entry point for `claudecodeui`, now branded as MTL-Code UI. Use it to answer five practical questions before changing code: what domain concept is involved, which system boundary owns it, which module should change, which runtime flow is affected, and how to verify the result.

## Layers

| Layer | File | Question |
| --- | --- | --- |
| K1 | [01-domain-knowledge.md](01-domain-knowledge.md) | What domain concepts and shared terms does the project use? |
| K2 | [02-system-architecture.md](02-system-architecture.md) | How do frontend, backend, providers, storage, and realtime channels cooperate? |
| K3 | [03-module-map.md](03-module-map.md) | Which files and modules own each capability? |
| K4 | [04-runtime-flows.md](04-runtime-flows.md) | How do common user flows run end to end? |
| K5 | [05-development-playbook.md](05-development-playbook.md) | How should changes be implemented and verified safely? |

## Current Notes

- [2026-04-26-local-first-frontend.md](2026-04-26-local-first-frontend.md): frontend auth/Git removal for first-use simplicity.
- [2026-04-26-mtl-code-backend-integration.md](2026-04-26-mtl-code-backend-integration.md): MTL-Code backend executable, config paths, and provider compatibility.
- [2026-04-26-mtlcode-agent-openai-model-config.md](2026-04-26-mtlcode-agent-openai-model-config.md): Agent settings simplification, MTLCode-only model surface, and Anthropic-compatible backend config.
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
