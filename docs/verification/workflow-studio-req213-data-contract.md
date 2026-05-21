# Workflow Data Contract Debugger Evidence

`REQ-213D` closes the Workflow Data Contract Debugger only when both successful lineage and missing-variable failure evidence are reproducible.

Run commands:

```powershell
npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs
npm run test:unit -- src/components/workflows
npm run test:e2e:screenshots -- --grep "REQ-213B|REQ-213C"
npm run typecheck
npm run check:mojibake
npm run build
```

Required screenshots:

- `claudecodeui/output/playwright/screenshots/REQ-213B-variable-debugger.png`
- `claudecodeui/output/playwright/screenshots/REQ-213B-run-lineage-detail.png`
- `claudecodeui/output/playwright/screenshots/REQ-213C-missing-variable-diagnostics.png`
- `claudecodeui/output/playwright/screenshots/REQ-213C-missing-variable-click-select.png`

Close criteria:

- The variable debugger screenshot shows the consuming node field, source expression, source type, and example value for a valid mapping.
- The run lineage screenshot shows actual run input lineage, including `inputs.change_request`.
- The missing variable diagnostics screenshot shows the broken expression and affected node field.
- The click-to-select screenshot shows the affected node selected and its missing-variable badge visible in the Inspector.
- Resolver and UI tests from `REQ-213A`, `REQ-213B`, and `REQ-213C` remain green.
- GitHub issue and kanban close comments must include the command list and screenshot paths above.
