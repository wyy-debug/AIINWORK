import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

describe('AgentRuntimeDiagnosticsPanel source contract', () => {
  it('shows workflow runtime state from session timeline events', () => {
    const source = readFileSync(resolve(currentDir, 'AgentRuntimeDiagnosticsPanel.tsx'), 'utf8');

    expect(source).toContain('Workflow Runtime');
    expect(source).toContain('workflowEvents');
    expect(source).toContain('projectPath');
  });
});
