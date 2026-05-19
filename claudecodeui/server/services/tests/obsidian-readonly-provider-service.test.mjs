import { describe, expect, it, vi } from 'vitest';

describe('obsidian read-only semantic provider service', () => {
  it('detects local HTTP capabilities without requiring note write permissions', async () => {
    const service = await import('../obsidian-readonly-provider-service.js');
    const fetchImpl = vi.fn(async (url, options) => {
      expect(String(url)).toBe('http://127.0.0.1:27777/status');
      expect(options.headers.Authorization).toBeUndefined();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerId: 'smart-connections-mcp',
          capabilities: ['search', 'related', 'content', 'graph', 'indexStatus'],
          index: { itemCount: 7, embeddingModel: 'bge-m3' },
        }),
      };
    });

    const diagnostics = await service.detectReadOnlyObsidianProviderCapabilities({
      transport: 'local-http',
      endpoint: 'http://127.0.0.1:27777',
      timeoutMs: 1000,
    }, { fetchImpl, now: () => 1000 });

    expect(diagnostics).toMatchObject({
      status: 'ready',
      providerId: 'smart-connections-mcp',
      transport: 'local-http',
      readOnly: true,
      capabilities: {
        search: true,
        related: true,
        content: true,
        graph: true,
        indexStatus: true,
        write: false,
      },
      index: { itemCount: 7, embeddingModel: 'bge-m3' },
    });
  });

  it('queries local HTTP provider and returns latency/result diagnostics', async () => {
    const service = await import('../obsidian-readonly-provider-service.js');
    const fetchImpl = vi.fn(async (url, options) => {
      expect(String(url)).toBe('http://127.0.0.1:27777/search');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBeUndefined();
      const payload = JSON.parse(options.body);
      expect(payload).toMatchObject({ query: 'rollback', limit: 3 });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ path: 'Argus/Wiki/App/Rollback.md', title: 'Rollback' }],
        }),
      };
    });
    const ticks = [1000, 1042];

    const result = await service.queryReadOnlyObsidianProvider({
      query: 'rollback',
      limit: 3,
    }, {
      config: {
        transport: 'local-http',
        endpoint: 'http://127.0.0.1:27777',
        providerId: 'smart-connections-mcp',
      },
      fetchImpl,
      now: () => ticks.shift(),
    });

    expect(result).toMatchObject({
      success: true,
      providerId: 'smart-connections-mcp',
      transport: 'local-http',
      readOnly: true,
      diagnostics: {
        status: 'ready',
        latencyMs: 42,
        resultCount: 1,
      },
      results: [{ path: 'Argus/Wiki/App/Rollback.md', title: 'Rollback' }],
    });
  });

  it('reports timeout diagnostics instead of throwing when local service is down', async () => {
    const service = await import('../obsidian-readonly-provider-service.js');
    const fetchImpl = vi.fn(async () => {
      throw new Error('The operation was aborted');
    });

    const result = await service.detectReadOnlyObsidianProviderCapabilities({
      transport: 'local-http',
      endpoint: 'http://127.0.0.1:27777',
      providerId: 'open-connections',
      timeoutMs: 1,
    }, { fetchImpl });

    expect(result).toMatchObject({
      status: 'down',
      providerId: 'open-connections',
      transport: 'local-http',
      capabilities: { search: false, write: false },
      error: 'The operation was aborted',
    });
  });
});
