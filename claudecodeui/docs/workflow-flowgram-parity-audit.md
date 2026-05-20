# REQ-197 FlowGram Code-Level Parity Audit

This audit records the current Workflow Studio direction after the code-level FlowGram architecture pass.

## Reference Pattern

FlowGram's free-layout demo centers the editor around a single native stack:

- `FreeLayoutEditor` receives `nodeRegistries`, `getNodeDefaultRegistry`, `materials.renderDefaultNode`, `nodeEngine`, `variableEngine`, `history`, and plugin creators.
- Node behavior is registered as FlowGram native registry metadata plus `formMeta`.
- Node add and line insertion go through the node panel / line plugins.
- Runtime visuals are expressed through node rendering and line hooks such as `isFlowingLine`, `isErrorLine`, `isDisabledLine`, and `setLineClassName`.

## MTL Before This Pass

- `WorkflowFlowGramEditor.tsx` contained the FlowGram editor, registry building, form placeholder, variable catalog, line insertion, runtime visuals, and history bridge in one file.
- `WorkflowStudio.tsx` still owned canvas-level undo/redo fallback state and edge insertion logic.
- The editor looked FlowGram-based, but several behaviors were still MTL overlays.

## Current Parity State

- FlowGram native editor code is split into dedicated modules under `src/components/workflows/view/flowgram`.
- `WorkflowFlowGramEditor.tsx is a compatibility wrapper` that re-exports the native shell and types.
- `FlowGramWorkflowEditorShell.tsx` owns the Free Layout provider, plugin list, node panel, line insertion, history handle, and editor callbacks.
- `FlowGramWorkflowNodeRegistry.tsx` owns stable node registries and `onAdd` factories for every workflow node type.
- `FlowGramWorkflowFormMeta.tsx` owns native form metadata, validation trigger, default values, init/submit formatting, and inspector surface.
- `FlowGramWorkflowVariableCatalog.ts` owns the shared variable catalog used by form/Data UI.
- `FlowGramRuntimeVisualBridge.ts` maps MTL runtime state to FlowGram native node and line visual hooks.

## Boundary

FlowGram native owns editing, canvas state, node registry, form metadata, variable catalog, node panel, line insertion, and history.

MTL runtime owns workflow execution, Agent/Profile integration, approvals, checkpoints, artifacts, Brain, and server APIs.

The adapter remains the boundary between FlowGram JSON and MTL `WorkflowDefinition`, so backend runtime is not coupled to FlowGram internal document shape.

## Remaining Follow-Ups

- Replace the remaining external inspector fields with richer FlowGram form controls.
- Add deeper Playwright interactions for drag-line node creation and variable picker editing.
- Keep runtime execution and checkpoint semantics in MTL services rather than moving them into FlowGram.
