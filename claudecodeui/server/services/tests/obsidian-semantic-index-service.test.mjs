import { describe, expect, it, vi } from 'vitest';

describe('obsidian semantic index service', () => {
  it('normalizes Smart Connections/Open Connections provider metadata into a stable local index contract', async () => {
    const service = await import('../obsidian-semantic-index-service.js');

    const state = service.buildObsidianSemanticIndexState({
      config: {
        obsidianSemanticProvider: 'smart-connections',
        obsidianSemanticFallbackEnabled: true,
        obsidianSemanticIndexMetadata: {
          providerId: 'smart-connections',
          embeddingModel: 'bge-m3',
          itemCount: 42,
          dimensions: 1024,
          lastIndexedAt: '2026-05-19T02:00:00.000Z',
          storagePath: '.smart-connections/index.sqlite',
        },
      },
      status: {
        semanticProviders: [{
          id: 'smart-connections',
          label: 'Smart Connections',
          available: true,
          readOnly: true,
          itemCount: 42,
          embeddingModel: 'bge-m3',
        }, {
          id: 'open-connections',
          label: 'Open Connections',
          available: false,
        }],
      },
    });

    expect(state.status).toBe('ready');
    expect(state.provider).toMatchObject({
      id: 'smart-connections',
      label: 'Smart Connections',
      available: true,
      readOnly: true,
    });
    expect(state.indexMetadata).toMatchObject({
      providerId: 'smart-connections',
      embeddingModel: 'bge-m3',
      itemCount: 42,
      dimensions: 1024,
      storagePath: '.smart-connections/index.sqlite',
    });
    expect(state.fallbackMode).toBe('semantic');
    expect(state.repairActions.map((action) => action.id)).toEqual(expect.arrayContaining([
      'refresh-semantic-index',
      'open-provider-settings',
    ]));
  });

  it('marks missing index metadata as degraded and keeps keyword bridge fallback available', async () => {
    const service = await import('../obsidian-semantic-index-service.js');

    const state = service.buildObsidianSemanticIndexState({
      config: {
        obsidianSemanticProvider: 'open-connections',
        obsidianSemanticFallbackEnabled: true,
      },
      status: {
        semanticProviders: [{
          id: 'open-connections',
          label: 'Open Connections',
          available: true,
          readOnly: true,
        }],
      },
    });

    expect(state.status).toBe('degraded');
    expect(state.states).toContain('index-metadata-missing');
    expect(state.fallbackMode).toBe('keyword-bridge-search');
    expect(state.actions).toContain('Refresh semantic index metadata from Obsidian');
  });

  it('falls back to bridge keyword search when the semantic provider fails', async () => {
    const service = await import('../obsidian-semantic-index-service.js');
    const semanticSearch = vi.fn(async () => {
      throw new Error('Smart Connections index unavailable');
    });
    const fallbackSearch = vi.fn(async () => ({
      success: true,
      results: [{ path: 'Argus/Wiki/App/Plan.md', title: 'Plan' }],
    }));

    const result = await service.queryObsidianSemanticIndex({
      query: 'release plan',
      folders: ['Argus/Wiki/App'],
      limit: 5,
    }, {
      state: service.buildObsidianSemanticIndexState({
        config: {
          obsidianSemanticProvider: 'smart-connections',
          obsidianSemanticFallbackEnabled: true,
          obsidianSemanticIndexMetadata: { providerId: 'smart-connections', itemCount: 2 },
        },
        status: {
          semanticProviders: [{ id: 'smart-connections', available: true, readOnly: true }],
        },
      }),
      semanticSearch,
      fallbackSearch,
    });

    expect(result).toMatchObject({
      success: true,
      providerUsed: 'bridge-keyword',
      fallback: true,
      fallbackReason: 'Smart Connections index unavailable',
      results: [{ path: 'Argus/Wiki/App/Plan.md', title: 'Plan' }],
    });
    expect(fallbackSearch).toHaveBeenCalledWith(expect.objectContaining({
      query: 'release plan',
      folders: ['Argus/Wiki/App'],
      limit: 5,
    }));
  });
});
