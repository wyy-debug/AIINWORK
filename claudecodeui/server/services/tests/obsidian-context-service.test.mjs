import { describe, expect, it, vi } from 'vitest';

describe('obsidian context service', () => {
  it('adds Obsidian context to the current Claude request without changing the user command', async () => {
    const service = await import('../obsidian-context-service.js');
    const buildObsidianContext = vi.fn(async () => ({
      success: true,
      context: 'Path: Argus/AIMemory/App/Prefs.md\nTitle: Prefs\nUse concise answers.',
      results: [{ path: 'Argus/AIMemory/App/Prefs.md' }],
    }));

    const result = await service.applyObsidianContextToChatCommand({
      type: 'claude-command',
      command: 'Summarize today.',
      options: {
        projectName: 'App',
        appendSystemPrompt: 'Existing prompt.',
      },
    }, {
      buildObsidianContext,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
        aiMemoryMaxResults: 3,
        aiMemoryProjectScopeEnabled: true,
        readableVaultFolders: ['Argus/Projects', 'Argus/AIMemory'],
      }),
    });

    expect(result.command).toBe('Summarize today.');
    expect(result.options.appendSystemPrompt).toContain('Existing prompt.');
    expect(result.options.appendSystemPrompt).toContain('Argus Wiki Context');
    expect(result.options.appendSystemPrompt).toContain('Use concise answers.');
    expect(result.options.obsidianContext).toMatchObject({
      used: true,
      resultCount: 1,
    });
    expect(buildObsidianContext).toHaveBeenCalledWith({
      query: 'Summarize today.',
      projectName: 'App',
      folders: ['Argus/Wiki/App', 'Argus/_Indexes', 'Argus/AIMemory/App'],
      limit: 3,
    });
  });

  it('uses Wiki readback defaults when the new wiki flags are enabled', async () => {
    const service = await import('../obsidian-context-service.js');
    const buildObsidianContext = vi.fn(async () => ({
      success: true,
      context: 'Path: Argus/Wiki/App/GPUScene.md\nTitle: GPUScene\nUse the compiled wiki as the source of truth.',
      results: [{ path: 'Argus/Wiki/App/GPUScene.md', title: 'GPUScene' }],
    }));

    const result = await service.applyObsidianContextToChatCommand({
      type: 'codex-command',
      command: 'Continue the GPUScene review.',
      options: { projectName: 'App' },
    }, {
      buildObsidianContext,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        wikiReadbackEnabled: true,
        wikiReadbackMaxResults: 8,
        aiMemoryProjectScopeEnabled: true,
        readableVaultFolders: ['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory'],
      }),
    });

    expect(result.command).toContain('Argus Wiki Context');
    expect(result.command).toContain('Use the compiled wiki as the source of truth.');
    expect(result.options.obsidianContext).toMatchObject({
      used: true,
      resultCount: 1,
      source: 'wiki',
    });
    expect(buildObsidianContext).toHaveBeenCalledWith({
      query: 'Continue the GPUScene review.',
      projectName: 'App',
      folders: ['Argus/Wiki/App', 'Argus/_Indexes', 'Argus/AIMemory/App'],
      limit: 8,
    });
  });

  it('does not block chat when Obsidian context retrieval fails', async () => {
    const service = await import('../obsidian-context-service.js');
    const input = {
      type: 'codex-command',
      command: 'Keep working.',
      options: { projectName: 'App' },
    };

    await expect(service.applyObsidianContextToChatCommand(input, {
      buildObsidianContext: vi.fn(async () => {
        throw new Error('Obsidian is closed');
      }),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
        aiMemoryMaxResults: 5,
        aiMemoryProjectScopeEnabled: true,
        readableVaultFolders: ['Argus/Projects'],
      }),
    })).resolves.toMatchObject({
      command: 'Keep working.',
      options: expect.objectContaining({
        obsidianContext: expect.objectContaining({
          used: false,
          error: 'Obsidian is closed',
        }),
      }),
    });
  });

  it('can include active note and structured sources in readback metadata', async () => {
    const service = await import('../obsidian-context-service.js');
    const buildObsidianContext = vi.fn(async () => ({
      success: true,
      context: 'Path: Argus/Projects/App/Plan.md\nTitle: Plan\nShip it.',
      results: [{ path: 'Argus/Projects/App/Plan.md', title: 'Plan' }],
    }));
    const getActiveObsidianNote = vi.fn(async () => ({
      success: true,
      note: {
        path: 'Argus/Projects/App/Active.md',
        title: 'Active',
        selection: 'Current note selection.',
      },
    }));

    const result = await service.applyObsidianContextToChatCommand({
      type: 'claude-command',
      command: 'Continue this.',
      options: { projectName: 'App' },
    }, {
      buildObsidianContext,
      getActiveObsidianNote,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: true,
        activeNoteReadbackEnabled: true,
        aiMemoryMaxResults: 3,
        aiMemoryProjectScopeEnabled: true,
        readableVaultFolders: ['Argus/Projects', 'Argus/AIMemory'],
      }),
    });

    expect(result.options.appendSystemPrompt).toContain('Active Obsidian note');
    expect(result.options.appendSystemPrompt).toContain('Current note selection.');
    expect(result.options.obsidianContext.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'active-note', path: 'Argus/Projects/App/Active.md' }),
      expect.objectContaining({ kind: 'context-result', path: 'Argus/Projects/App/Plan.md' }),
    ]));
  });

  it('uses the small model refinement before injecting wiki readback context', async () => {
    const service = await import('../obsidian-context-service.js');
    const refineWikiReadbackContext = vi.fn(async () => ({
      refined: true,
      model: 'mimo-v2-flash',
      context: 'Path: Argus/Wiki/App/Plan.md\nTitle: Plan\nRefined snippet.',
      sources: [{
        kind: 'context-result',
        path: 'Argus/Wiki/App/Plan.md',
        title: 'Plan',
        hitReason: '小模型判断与当前问题相关',
      }],
    }));

    const result = await service.applyObsidianContextToChatCommand({
      type: 'codex-command',
      command: 'Continue the plan.',
      options: { projectName: 'App' },
    }, {
      buildObsidianContext: vi.fn(async () => ({
        success: true,
        context: 'Unrefined context',
        results: [{ path: 'Argus/Wiki/App/Plan.md', title: 'Plan' }],
      })),
      refineWikiReadbackContext,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        wikiReadbackEnabled: true,
        wikiReadbackMaxResults: 8,
        wikiReadbackRefineEnabled: true,
        aiMemoryProjectScopeEnabled: true,
      }),
    });

    expect(result.command).toContain('Refined snippet.');
    expect(result.options.obsidianContext).toMatchObject({
      used: true,
      refined: true,
      refinementModel: 'mimo-v2-flash',
      sources: [
        expect.objectContaining({
          path: 'Argus/Wiki/App/Plan.md',
          hitReason: '小模型判断与当前问题相关',
        }),
      ],
    });
    expect(refineWikiReadbackContext).toHaveBeenCalledWith(expect.objectContaining({
      query: 'Continue the plan.',
      projectName: 'App',
      context: 'Unrefined context',
      results: [{ path: 'Argus/Wiki/App/Plan.md', title: 'Plan' }],
    }));
  });
});
