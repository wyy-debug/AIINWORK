# REQ-212 Custom Node Test Matrix Evidence

REQ-212 closes only when the generated Python custom node sandbox shows all test cases, assertions, and runtime failures with durable evidence.

## Commands

- `npm run test:unit -- server/services/tests/workflow-studio-service.test.mjs`
- `npm run test:unit -- src/components/workflows/view/WorkflowStudio.test.tsx`
- `npm run test:e2e:screenshots -- --grep "REQ-212D"`
- `npm run typecheck`
- `npm run check:mojibake`
- `npm run build`
- `git diff --check`

## Screenshot Evidence

- `claudecodeui/output/playwright/screenshots/REQ-212D-test-matrix-pass.png`
- `claudecodeui/output/playwright/screenshots/REQ-212D-test-matrix-assertion-failure.png`
- `claudecodeui/output/playwright/screenshots/REQ-212D-test-matrix-runtime-error.png`

## Coverage

- Passing matrix: install remains available after all required test cases pass.
- Assertion failure matrix: expectedOutput mismatch is visible with path-level details and install is blocked.
- Runtime failure matrix: stderr and runtime error category are visible, and install is blocked.
