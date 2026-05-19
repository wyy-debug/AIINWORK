import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('useChatComposerState Agent Profile contract', () => {
  it('resolves @profile before @agent and sends the effective profile kind to runtime options', () => {
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('resolveAgentProfileInvocation(currentInput');
    expect(source).toContain('const profileScopedInput = profileInvocation.content || currentInput');
    expect(source).toContain('resolveAgentInvocation(profileScopedInput');
    expect(source).toContain("agentProfileKind: activeAgentProfile?.kind || ''");
  });

  it('lets the selected profile own the permission preset unless a one-shot mode overrides it', () => {
    const source = readFileSync(resolve(currentDir, 'useChatComposerState.ts'), 'utf8');

    expect(source).toContain('const profilePermissionMode');
    expect(source).toContain('const permissionModeForSend = oneShotPermissionModeRef.current || profilePermissionMode || permissionMode');
    expect(source).toContain('mergeAgentProfileSkillNames');
  });
});
