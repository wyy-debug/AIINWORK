# REQ-183 FlowGram WorkGraph Parity

Reference repository: `bytedance/flowgram.ai`

Local reference checkout: `C:\Users\yckui\.mtl-code\reference-repos\flowgram.ai`

Inspected reference commit: `1532343`

License: MIT, Copyright (c) 2025 Bytedance Ltd. and/or its affiliates.

## Integration Boundary

This pass does not vendor FlowGram.AI source code into MTL-Code. It introduces an
MTL-owned WorkGraph adapter and node registry shaped after the FlowGram concepts
that matter for Workflow Studio:

- document-level node and edge model
- node registry and palette grouping
- form metadata as the source for node configuration
- typed flow values for constants, references, and templates
- migration compatibility checks before replacing the existing editor path

If a future ticket copies FlowGram.AI source files or bundles FlowGram packages,
the copied or bundled material must retain the MIT license notice.

## Implemented In This Pass

- `src/components/workflows/model/workflowGraphAdapter.ts`
  - Converts `WorkflowDefinition` to a FlowGram-style WorkGraph document.
  - Converts the WorkGraph document back to `WorkflowDefinition`.
  - Preserves unknown metadata and reports compatibility warnings.
  - Parses `{{inputs.x}}` and `{{nodes.x.output.y}}` into typed flow values.

- `src/components/workflows/model/workflowNodeRegistry.ts`
  - Defines default node registry metadata for Agent, Subagent, MCP, Tool,
    Shell, Approval, Condition, Join, and Artifact nodes.
  - Defines palette groups for Agents, Integrations, Execution, Control Flow,
    and Outputs.
  - Merges backend node type overrides without dropping default output schema.

- `src/components/workflows/view/WorkflowStudio.tsx`
  - Uses the node registry for palette material.
  - Displays WorkGraph adapter and migration compatibility status in the
    Workflow Command Center.

## Verification

Run:

```bash
npm run test:unit -- src/components/workflows/model/workflowNodeRegistry.test.ts src/components/workflows/model/workflowGraphAdapter.test.ts src/components/workflows/view/WorkflowStudio.test.tsx
npm run typecheck
```

Expected:

- Workflow node registry tests pass.
- Workflow graph adapter tests pass.
- WorkflowStudio source contract still passes.
- TypeScript typecheck passes for frontend and server projects.
