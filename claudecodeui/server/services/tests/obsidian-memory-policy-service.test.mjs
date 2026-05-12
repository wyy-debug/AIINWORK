import { describe, expect, it, vi } from 'vitest';

const saveToObsidianZh = '\u4FDD\u5B58\u5230 Obsidian\uFF1A\u8FD9\u4E2A\u9879\u76EE\u7684 Wiki readback \u53EA\u8BFB Argus/Wiki';
const saveToObsidianBody = '\u8FD9\u4E2A\u9879\u76EE\u7684 Wiki readback \u53EA\u8BFB Argus/Wiki';

describe('obsidian wiki policy service', () => {
  it('only detects explicit Obsidian/Wiki save commands', async () => {
    const service = await import('../obsidian-memory-policy-service.js');

    expect(service.detectExplicitWikiIntent(saveToObsidianZh)).toBe('wiki');
    expect(service.detectExplicitWikiIntent('save to wiki: Keep the runtime diagram in Argus/Wiki')).toBe('wiki');
    expect(service.detectExplicitWikiIntent('save this to Obsidian')).toBe('wiki');
    expect(service.detectExplicitWikiIntent('\u6C89\u6DC0\u5230\u77E5\u8BC6\u5E93\uFF1A\u8BB0\u5F55\u8FD0\u884C\u65F6\u51B3\u7B56')).toBe('wiki');
    expect(service.detectExplicitWikiIntent('\u8BB0\u4F4F\uFF1A\u4EE5\u540E\u56DE\u7B54\u7B80\u6D01')).toBe('none');
    expect(service.detectExplicitWikiIntent('remember this')).toBe('none');
    expect(service.detectExplicitWikiIntent('forget memory: concise answers')).toBe('none');
  });

  it('leaves ordinary remember requests for Claude native memory', async () => {
    const service = await import('../obsidian-memory-policy-service.js');
    const createMemoryCandidates = vi.fn();

    const input = {
      type: 'claude-command',
      command: 'remember: use terse answers',
      options: { projectName: 'App' },
    };
    const result = await service.applyExplicitWikiIntentToChatCommand(input, {
      readObsidianBridgeConfig: () => ({ enabled: true }),
      createMemoryCandidates,
    });

    expect(result).toBe(input);
    expect(createMemoryCandidates).not.toHaveBeenCalled();
  });

  it('creates an auditable Obsidian candidate for explicit save-to-wiki commands without committing it', async () => {
    const service = await import('../obsidian-memory-policy-service.js');
    const createMemoryCandidates = vi.fn(() => ({
      candidates: [{
        id: 'wiki-1',
        kind: 'reference',
        text: saveToObsidianBody,
        status: 'pending',
      }],
    }));
    const commitMemoryCandidates = vi.fn();

    const result = await service.applyExplicitWikiIntentToChatCommand({
      type: 'claude-command',
      command: saveToObsidianZh,
      options: {
        projectName: 'App',
        sessionId: 'session-1',
      },
    }, {
      readObsidianBridgeConfig: () => ({ enabled: true }),
      createMemoryCandidates,
      commitMemoryCandidates,
    });

    expect(createMemoryCandidates).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [
        expect.objectContaining({
          kind: 'reference',
          text: saveToObsidianBody,
          action: 'save-to-wiki',
          target: 'wiki',
          confidence: 1,
        }),
      ],
    }));
    expect(commitMemoryCandidates).not.toHaveBeenCalled();
    expect(result.options.obsidianWiki).toMatchObject({
      used: true,
      intent: 'save-to-wiki',
      status: 'candidate-created',
      kind: 'reference',
      candidateIds: ['wiki-1'],
    });
  });

  it('resolves referential save-to-wiki requests from explicit frontend context', async () => {
    const service = await import('../obsidian-memory-policy-service.js');
    const createMemoryCandidates = vi.fn(() => ({
      candidates: [{
        id: 'wiki-2',
        kind: 'decision',
        text: 'We decided Obsidian is a Wiki readback source, not Claude personal memory.',
        status: 'pending',
      }],
    }));

    const result = await service.applyExplicitWikiIntentToChatCommand({
      type: 'codex-command',
      command: 'save this to wiki',
      options: {
        projectName: 'App',
        explicitWikiContext: {
          text: 'We decided Obsidian is a Wiki readback source, not Claude personal memory.',
          messageId: 'assistant-1',
          messageType: 'assistant',
        },
      },
    }, {
      readObsidianBridgeConfig: () => ({ enabled: true }),
      createMemoryCandidates,
    });

    expect(createMemoryCandidates).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [
        expect.objectContaining({
          kind: 'decision',
          action: 'save-to-wiki',
          text: 'We decided Obsidian is a Wiki readback source, not Claude personal memory.',
        }),
      ],
    }));
    expect(result.options.obsidianWiki).toMatchObject({
      intent: 'save-to-wiki',
      status: 'candidate-created',
      referential: true,
    });
  });

  it('does not block chat when explicit wiki save has no referential context or bridge is disabled', async () => {
    const service = await import('../obsidian-memory-policy-service.js');
    const createMemoryCandidates = vi.fn();

    const needsContext = await service.applyExplicitWikiIntentToChatCommand({
      type: 'claude-command',
      command: 'save this to Obsidian',
      options: { projectName: 'App' },
    }, {
      readObsidianBridgeConfig: () => ({ enabled: true }),
      createMemoryCandidates,
    });
    expect(needsContext.options.obsidianWiki).toMatchObject({
      intent: 'save-to-wiki',
      status: 'needs-context',
    });
    expect(createMemoryCandidates).not.toHaveBeenCalled();

    const disabled = await service.applyExplicitWikiIntentToChatCommand({
      type: 'claude-command',
      command: 'save to wiki: keep this architecture note',
      options: {},
    }, {
      readObsidianBridgeConfig: () => ({ enabled: false }),
      createMemoryCandidates,
    });
    expect(disabled.options.obsidianWiki).toMatchObject({
      intent: 'save-to-wiki',
      status: 'disabled',
    });
  });

  it('injects wiki policy through appendSystemPrompt for Claude and command prefix for other providers', async () => {
    const service = await import('../obsidian-memory-policy-service.js');

    const claude = service.applyObsidianWikiPolicyPromptToChatCommand({
      type: 'claude-command',
      command: 'Continue.',
      options: { appendSystemPrompt: 'Existing prompt.' },
    }, {
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });
    expect(claude.command).toBe('Continue.');
    expect(claude.options.appendSystemPrompt).toContain('Existing prompt.');
    expect(claude.options.appendSystemPrompt).toContain('Obsidian Wiki Policy');
    expect(claude.options.appendSystemPrompt).not.toContain('only long-term memory store');

    const codex = service.applyObsidianWikiPolicyPromptToChatCommand({
      type: 'codex-command',
      command: 'Continue.',
      options: {},
    }, {
      readObsidianBridgeConfig: () => ({ enabled: true }),
    });
    expect(codex.command).toContain('Obsidian Wiki Policy');
    expect(codex.command).toContain('Continue.');
  });
});
