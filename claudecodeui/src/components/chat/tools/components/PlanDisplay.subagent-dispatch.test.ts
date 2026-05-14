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
    expect(source).not.toContain("permissionMode: 'acceptEdits'");
    expect(source).toContain('submittedPlanKey');
    expect(source).toContain('hasSubmittedProposedPlan');
    expect(source).toContain('是，分派这些代理');
  });

  it('includes the source session id when approving or revising proposed plans', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'PlanDisplay.tsx'), 'utf8');

    expect(source).toContain('sourceSessionId?: string | null');
    expect(source).toContain('const concreteSourceSessionId');
    expect(source).toContain('sourceSessionId: concreteSourceSessionId || undefined');
    expect(source).toContain("permissionMode: 'plan'");
  });

  it('renders proposed plans with the decision prompt layout', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'PlanDisplay.tsx'), 'utf8');

    expect(source).toContain('usesPreviewLayout');
    expect(source).toContain('展开计划');
    expect(source).toContain('实施此计划?');
    expect(source).toContain('是，实施此计划');
    expect(source).toContain('assistantDisplayName');
    expect(source).toContain('否，请告知 {assistantDisplayName} 如何调整');
    expect(source).toContain('忽略');
    expect(source).toContain('提交');
    expect(source).toContain('下载计划');
    expect(source).toContain('复制计划');
    expect(source).toContain('rounded-[14px] border-0 bg-muted/60');
  });
});
