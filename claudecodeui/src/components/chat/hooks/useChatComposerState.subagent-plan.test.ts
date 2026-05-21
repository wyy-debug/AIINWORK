import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('useChatComposerState OpenCode-style subagent invocation', () => {
  it('invokes selected subagent agents through the agent invoke API', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain("activeAgent?.mode === 'subagent'");
    expect(source).toContain('/api/agents/${encodeURIComponent(activeAgent.id)}/invoke');
    expect(source).toContain("source: 'manual'");
    expect(source).toContain("tab: 'subagents'");
    expect(source).not.toContain('coordinatorMode: true');
    expect(source).not.toContain('subagentRuntimeSnapshot');
    expect(source).not.toContain('dispatchPlanId');
  });

  it('resumes the source session when proposed plan actions submit programmatically', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('sourceSessionId?: string');
    expect(source).toContain('oneShotSourceSessionIdRef');
    expect(source).toContain('resolveChatSendSessionRouting');
    expect(source).toContain('oneShotSourceSessionId: oneShotSourceSessionIdRef.current');
    expect(source).toContain('const backendSessionId = sessionRouting.backendSessionId');
    expect(source).toContain('oneShotSourceSessionIdRef.current = null');
  });
});
