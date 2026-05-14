import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('useChatComposerState subagent dispatch approval', () => {
  it('requests a model-generated plan before sending subagentDispatch commands', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('shouldRequestSubagentDispatchPlan');
    expect(source).toContain('buildSubagentDispatchPlanRequest');
    expect(source).toContain('buildSubagentRuntimeSnapshot');
    expect(source).toContain('getSubagentRuntimeDispatchPlanId');
    expect(source).toContain('oneShotSubagentDispatchRef');
    expect(source).toContain('coordinatorMode: true');
    expect(source).toContain('subagentRuntimeSnapshot');
    expect(source).toContain('dispatchPlanId');
    expect(source).toContain("subagentPlanRequestActive ? 'plan'");
    expect(source).toContain('pendingSubmitChatInputRef');
    expect(source).toContain('isLoadingRef.current');
    expect(source).toContain('submitProgrammaticChatInput');
    expect(source).not.toContain('pendingSubagentDispatchPlan');
  });

  it('resumes the source session when proposed plan actions submit programmatically', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('sourceSessionId?: string');
    expect(source).toContain('oneShotSourceSessionIdRef');
    expect(source).toContain('const concreteProgrammaticSessionId');
    expect(source).toContain('concreteProgrammaticSessionId || fallbackConcreteSessionId');
    expect(source).toContain('oneShotSourceSessionIdRef.current = null');
  });
});
