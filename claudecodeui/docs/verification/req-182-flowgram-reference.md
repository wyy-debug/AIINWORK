# REQ-182 FlowGram WorkGraph Reference

## Reference Pulled

- Repository: `bytedance/flowgram.ai`
- Local checkout: `C:\Users\yckui\.mtl-code\reference-repos\flowgram.ai`
- Commit inspected: `1532343`
- License: MIT

## Borrowed Patterns

- Node registries: FlowGram separates node metadata, defaults, add behavior, and form metadata.
- Line insertion: FlowGram lets users add a node from the middle of an existing line and rebuilds the surrounding connections.
- Variable model: FlowGram treats references and templates as typed values instead of plain strings.
- Plugin layering: canvas, minimap, lines, node panel, history, runtime, and variable panels are independent plugins.

## Implemented In This Pass

Workflow Studio now includes an edge inspector action that mirrors FlowGram's line-add behavior in our React Flow data model:

1. Select an edge.
2. Choose a node type in `Insert node on edge`.
3. Click `Insert`.
4. The original edge is replaced with two edges: `source -> inserted -> target`.
5. The inserted node is positioned between the original endpoints and selected for configuration.

## Verification

- `npm run test:unit -- src/components/workflows/view/WorkflowStudio.test.tsx`

## Notes

The FlowGram source was used as an MIT-licensed reference. No upstream files were vendored into the product.
