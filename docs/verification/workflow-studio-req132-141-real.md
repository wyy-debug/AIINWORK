# Workflow Studio REQ-132..141 Real Verification

Scope:
- `REQ-132 Workflow Agent Session Link`
- `REQ-133 Workflow Agent Prompt Preview`
- `REQ-134 Workflow Agent Result Contract`
- `REQ-135 Workflow Subagent Pool Limit`
- `REQ-136 Workflow Subagent Cancellation Bridge`
- `REQ-137 Workflow MCP Tool Catalog Sync`
- `REQ-138 Workflow MCP Argument Builder`
- `REQ-139 Workflow MCP Error Normalization`
- `REQ-140 Workflow Tool Node Registry`
- `REQ-141 Workflow Browser Screenshot Node`

Real implementation evidence:
- Backend exposes `GET /api/workflows/:id/agent-bridge` with agent/subagent prompt previews, result contracts, session links, and subagent pool limits.
- Agent and subagent outputs are normalized to a contract with `summary`, `artifacts`, `diffRefs`, `status`, `sessionId`, and `sessionLink`.
- Workflow cancellation now stops child subagent runs through the subagent run store and records stopped run refs in the timeline event.
- Backend exposes `GET /api/workflows/tool-registry` for built-in tool node definitions.
- Backend exposes `GET /api/workflows/mcp-tool-catalog` and `GET /api/workflows/mcp-argument-schema`.
- MCP execution errors are normalized into stable categories such as `server_not_found`, `tool_not_found`, `schema_invalid`, and `timeout`.
- The `browser-screenshot` tool creates a real PNG artifact file and returns `screenshotPath` plus `artifactId`.
- Frontend now reads the real backend bridge/catalog/registry state instead of only rendering static placeholders.

Verification commands:
- `npm run test:unit -- workflow-studio-service.test.mjs WorkflowStudio.test.tsx`
- `npm run typecheck`
- `DESKTOP_MODE=true WORKFLOW_REAL_SMOKE=1 npm run test:e2e:workflow-real`

Screenshot evidence:
- `REQ-132-workflow-agent-session-link.png`
- `REQ-133-workflow-agent-prompt-preview.png`
- `REQ-134-workflow-agent-result-contract.png`
- `REQ-135-workflow-subagent-pool-limit.png`
- `REQ-136-workflow-subagent-cancellation-bridge.png`
- `REQ-137-workflow-mcp-tool-catalog-sync.png`
- `REQ-138-workflow-mcp-argument-builder.png`
- `REQ-139-workflow-mcp-error-normalization.png`
- `REQ-140-workflow-tool-node-registry.png`
- `REQ-141-workflow-browser-screenshot-node.png`
