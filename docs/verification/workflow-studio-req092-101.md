# Workflow Studio REQ-092 to REQ-101 Verification

Scope: editor graph editing experience.

## Requirements

- `REQ-092 Workflow Multi-select Nodes`: Editor shows selected node count and supports multi-selection state.
- `REQ-093 Workflow Copy Paste Nodes`: Selected nodes can be copied and pasted with offset positions.
- `REQ-094 Workflow Duplicate Subgraph`: Selected node subgraphs can be duplicated with rewritten node and edge ids.
- `REQ-095 Workflow Undo Redo`: Editor changes expose undo and redo controls backed by draft history.
- `REQ-096 Workflow Auto Layout Modes`: Editor supports left-to-right, top-down, and compact layout modes.
- `REQ-097 Workflow Layout Lock`: Selected nodes can be locked so auto layout leaves their positions unchanged.
- `REQ-098 Workflow Edge Route Styles`: Edges support smoothstep, straight, and step route styles.
- `REQ-099 Workflow Edge Branch Labels`: Edge branch labels support success, failure, always, and condition text.
- `REQ-100 Workflow Graph Minimap Filters`: MiniMap can emphasize all nodes, status, type, or risk.
- `REQ-101 Workflow Graph Validation Badges`: Nodes show validation badges for missing config, risk, lock, and connectivity.

## Evidence

Expected Playwright screenshots:

- `REQ-092-workflow-multi-select-nodes.png`
- `REQ-093-workflow-copy-paste-nodes.png`
- `REQ-094-workflow-duplicate-subgraph.png`
- `REQ-095-workflow-undo-redo.png`
- `REQ-096-workflow-auto-layout-modes.png`
- `REQ-097-workflow-layout-lock.png`
- `REQ-098-workflow-edge-route-styles.png`
- `REQ-099-workflow-edge-branch-labels.png`
- `REQ-100-workflow-graph-minimap-filters.png`
- `REQ-101-workflow-graph-validation-badges.png`

## Verification Commands

- `npm run test:unit -- WorkflowStudio.test.tsx e2e-screenshot-gate.test.ts`
- `npm run typecheck`
- `npm run test:e2e:workflow-real`
- `npm run test:unit`
- `npm run build`
- `npm run check:mojibake`

## Close Rule

Close GitHub issues and kanban cards only after the commands above pass and the screenshot files exist under `claudecodeui/output/playwright/screenshots`.
