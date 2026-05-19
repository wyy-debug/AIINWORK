# Workflow Studio REQ-102 to REQ-111 Verification

Scope: node configuration completeness and typed dataflow UX.

## Requirements

- `REQ-102 Workflow Node Schema Versioning`: Inspector shows node schema version and compatibility state.
- `REQ-103 Workflow Node Config Presets`: Node config presets can be saved and applied per node type.
- `REQ-104 Workflow Required Field Guard`: Required node fields are checked and displayed before save/run.
- `REQ-105 Workflow Secret Field Type`: Secret-like node config is masked and treated as a reference.
- `REQ-106 Workflow JSON Config Editor`: Node config can be edited as JSON with parse errors.
- `REQ-107 Workflow Typed Variable Picker`: Variables show token, source, type, and example value.
- `REQ-108 Workflow Mapping Preview`: Run setup shows node input mapping before execution.
- `REQ-109 Workflow Transform Functions`: Common transform helpers are visible and insertable.
- `REQ-110 Workflow Output Contract Test`: Node output schema is checked against run output.
- `REQ-111 Workflow Data Lineage View`: Inspector shows incoming/outgoing edges and variable lineage.

## Evidence

Expected Playwright screenshots:

- `REQ-102-workflow-node-schema-versioning.png`
- `REQ-103-workflow-node-config-presets.png`
- `REQ-104-workflow-required-field-guard.png`
- `REQ-105-workflow-secret-field-type.png`
- `REQ-106-workflow-json-config-editor.png`
- `REQ-107-workflow-typed-variable-picker.png`
- `REQ-108-workflow-mapping-preview.png`
- `REQ-109-workflow-transform-functions.png`
- `REQ-110-workflow-output-contract-test.png`
- `REQ-111-workflow-data-lineage-view.png`

## Verification Commands

- `npm run test:unit -- WorkflowStudio.test.tsx e2e-screenshot-gate.test.ts`
- `npm run typecheck`
- `npm run test:e2e:workflow-real`
- `npm run test:unit`
- `npm run build`
- `npm run check:mojibake`

## Close Rule

Close GitHub issues and kanban cards only after the commands above pass and screenshots are generated from the real Workflow Studio Playwright smoke.
