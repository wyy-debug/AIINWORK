import { describe, expect, it, vi } from 'vitest';

describe('obsidian context service', () => {
  it('adds Obsidian context to the current Claude request without changing the user command', async () => {
    const service = await import('../obsidian-context-service.js');
    const buildObsidianContext = vi.fn(async () => ({
      success: true,
      context: '',
      results: [],
    }));
    const queryObsidianNotes = vi.fn(async () => ({
      success: true,
      results: [{
        path: 'Argus/AIMemory/App/Prefs.md',
        title: 'Prefs',
        snippet: 'Use concise answers.',
      }],
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
      queryObsidianNotes,
      refineWikiReadbackContext: vi.fn(async ({ context }) => ({
        refined: false,
        context,
        sources: [],
      })),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        wikiReadbackEnabled: false,
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
    expect(buildObsidianContext).not.toHaveBeenCalled();
    expect(queryObsidianNotes).toHaveBeenCalledWith({
      query: '',
      projectName: 'App',
      folders: ['Argus/AIMemory/App'],
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
      refineWikiReadbackContext: vi.fn(async ({ context }) => ({
        refined: false,
        context,
        sources: [],
      })),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        wikiReadbackEnabled: true,
        aiMemoryReadbackEnabled: false,
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
      folders: [
        'Argus/Wiki/App',
        'Argus/_Indexes',
      ],
      limit: 8,
    });
  });

  it('searches project Wiki and reads project AIMemory deterministically', async () => {
    const service = await import('../obsidian-context-service.js');
    const buildObsidianContext = vi.fn(async () => ({
      success: true,
      context: 'Path: Argus/Wiki/SOC trunk/Index.md\nTitle: Index\nProject wiki note.',
      results: [{ path: 'Argus/Wiki/SOC trunk/Index.md', title: 'Index' }],
    }));
    const queryObsidianNotes = vi.fn(async () => ({
      success: true,
      results: [{
        path: 'Argus/AIMemory/SOC trunk/Style.md',
        title: 'Style',
        snippet: 'The user prefers concise Chinese answers.',
      }],
    }));

    await service.applyObsidianContextToChatCommand({
      type: 'claude-command',
      command: '继续这个问题。',
      options: { projectName: 'SOC trunk' },
    }, {
      buildObsidianContext,
      queryObsidianNotes,
      refineWikiReadbackContext: vi.fn(async ({ context }) => ({
        refined: false,
        context,
        sources: [],
      })),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        wikiReadbackEnabled: true,
        aiMemoryReadbackEnabled: true,
        wikiReadbackMaxResults: 6,
        wikiReadbackProjectScopeEnabled: true,
        aiMemoryProjectScopeEnabled: true,
      }),
    });

    expect(buildObsidianContext).toHaveBeenCalledWith({
      query: '继续这个问题。',
      projectName: 'SOC trunk',
      folders: [
        'Argus/Wiki/SOC trunk',
        'Argus/_Indexes',
      ],
      limit: 6,
    });
    expect(queryObsidianNotes).toHaveBeenCalledWith({
      query: '',
      projectName: 'SOC trunk',
      folders: ['Argus/AIMemory/SOC trunk'],
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
        wikiReadbackEnabled: true,
        aiMemoryReadbackEnabled: false,
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
      refineWikiReadbackContext: vi.fn(async ({ context }) => ({
        refined: false,
        context,
        sources: [],
      })),
      readObsidianBridgeConfig: () => ({
        enabled: true,
        aiMemoryReadbackEnabled: false,
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
      reranked: true,
      model: 'mimo-v2-flash',
      rerankModel: 'mimo-v2-flash',
      tokenBudgetUsed: 128,
      context: 'Path: Argus/Wiki/App/Plan.md\nTitle: Plan\nRefined snippet.',
      sources: [{
        kind: 'context-result',
        path: 'Argus/Wiki/App/Plan.md',
        title: 'Plan',
        snippet: 'Refined snippet.',
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
        aiMemoryReadbackEnabled: false,
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
      reranked: true,
      rerankModel: 'mimo-v2-flash',
      tokenBudgetUsed: 128,
      sources: [
        expect.objectContaining({
          path: 'Argus/Wiki/App/Plan.md',
          snippet: 'Refined snippet.',
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

  it('filters archived AIMemory entries from injected readback context', async () => {
    const service = await import('../obsidian-context-service.js');
    const queryObsidianNotes = vi.fn(async () => ({
      success: true,
      results: [
        {
          path: 'Argus/AIMemory/App/Active.md',
          title: 'Active',
          snippet: 'Use concise answers.',
          properties: { status: 'active' },
        },
        {
          path: 'Argus/AIMemory/App/Archived.md',
          title: 'Archived',
          snippet: 'Old memory that should not be injected.',
          properties: { status: 'archived' },
        },
      ],
    }));

    const result = await service.applyObsidianContextToChatCommand({
      type: 'claude-command',
      command: 'Continue.',
      options: { projectName: 'App' },
    }, {
      queryObsidianNotes,
      readObsidianBridgeConfig: () => ({
        enabled: true,
        wikiReadbackEnabled: false,
        aiMemoryReadbackEnabled: true,
        aiMemoryMaxResults: 5,
        aiMemoryProjectScopeEnabled: true,
      }),
      refineWikiReadbackContext: vi.fn(async ({ context, results }) => ({
        refined: false,
        context,
        sources: results,
      })),
    });

    expect(result.options.appendSystemPrompt).toContain('Use concise answers.');
    expect(result.options.appendSystemPrompt).not.toContain('Old memory that should not be injected.');
    expect(result.options.appendSystemPrompt).toContain('Wiki context is historical project material.');
    expect(result.options.obsidianContext).toMatchObject({
      used: true,
      resultCount: 1,
      archivedResultCount: 1,
    });
  });
});
