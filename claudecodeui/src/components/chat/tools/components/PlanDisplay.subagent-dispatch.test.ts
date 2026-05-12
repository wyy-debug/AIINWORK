import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('PlanDisplay subagent dispatch approval', () => {
  it('turns approved subagent dispatch plans into subagent dispatch commands', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'PlanDisplay.tsx'), 'utf8');

    expect(source).toContain('isSubagentDispatchPlanContent(content)');
    expect(source).toContain('subagentDispatch: isSubagentDispatchPlan');
    expect(source).toContain('approvedSubagentPlan: content.trim()');
    expect(source).toContain("permissionMode: 'acceptEdits'");
    expect(source).toContain('submittedPlanKey');
    expect(source).toContain('hasSubmittedProposedPlan');
    expect(source).toContain('Dispatch agents');
  });
});
