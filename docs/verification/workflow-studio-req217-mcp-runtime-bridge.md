# REQ-217 Workflow MCP Tool Runtime Bridge

## Scope

Workflow MCP nodes now use a typed, permissioned runtime bridge instead of a placeholder executor. The editor can read MCP tool metadata, render schema-driven argument fields, and the runtime writes normalized MCP outputs or errors to the node run.

## Evidence

- Backend unit coverage: `server/services/tests/workflow-studio-service.test.mjs`
- Frontend source contract: `src/components/workflows/view/WorkflowStudio.test.tsx`
- Screenshot gates:
  - `output/playwright/screenshots/REQ-217C-mcp-node-config.png`
  - `output/playwright/screenshots/REQ-217D-mcp-runtime-success.png`
  - `output/playwright/screenshots/REQ-217D-mcp-permission-deny.png`

## Validation Commands

```bash
npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs src/components/workflows/view/WorkflowStudio.test.tsx
npm run test:e2e:screenshots -- --grep "REQ-217"
npm run typecheck
npm run check:mojibake
npm run build
```

## Acceptance Notes

- MCP registry entries normalize `serverId`, `toolName`, `label`, availability, allowlist state, and argument schema fields.
- MCP runtime executor validates arguments before invocation and sends `serverId`, `toolName`, `arguments`, `timeoutMs`, and `permissionSnapshot`.
- MCP success output includes `status`, `summary`, `result`, `toolName`, and `serverId`.
- MCP failures write structured `output.error` with categories such as `tool_not_found`, `schema_invalid`, `server_not_found`, and `permission_denied`.
- Workflow editor loads MCP catalog in Editor mode so MCP node config renders schema fields without opening unrelated debug panels.
