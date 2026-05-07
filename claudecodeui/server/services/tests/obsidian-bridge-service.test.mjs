import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMemoryConfigStore = () => {
  let value = null;
  return {
    get: vi.fn(() => value),
    set: vi.fn((_key, nextValue) => {
      value = nextValue;
    }),
  };
};

describe('obsidian bridge service', () => {
  let service;
  let store;

  beforeEach(async () => {
    service = await import('../obsidian-bridge-service.js');
    store = createMemoryConfigStore();
    service.setObsidianBridgeConfigStoreForTests(store);
  });

  it('returns a disabled local bridge config by default without exposing the token', () => {
    const config = service.readObsidianBridgeConfig();

    expect(config).toMatchObject({
      enabled: false,
      endpoint: 'http://127.0.0.1:27177',
      defaultMode: 'project-knowledge',
      aiMemoryReadbackEnabled: false,
      aiMemoryMaxResults: 5,
      aiMemoryProjectScopeEnabled: true,
      tokenConfigured: false,
    });
    expect(config).not.toHaveProperty('token');
  });

  it('persists normalized settings and keeps the token available for internal calls', () => {
    const saved = service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://localhost:27177/',
      token: ' bridge-token ',
      defaultMode: 'ai-memory',
      autoExportKnowledgeArtifacts: false,
      fallbackToProjectKnowledge: true,
      aiMemoryReadbackEnabled: true,
      aiMemoryMaxResults: 99,
      aiMemoryProjectScopeEnabled: false,
      readableVaultFolders: [' Argus/Projects ', '../Private', 'Argus/AIMemory'],
    });

    expect(saved).toMatchObject({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      defaultMode: 'ai-memory',
      tokenConfigured: true,
      autoExportKnowledgeArtifacts: false,
      fallbackToProjectKnowledge: true,
      aiMemoryReadbackEnabled: true,
      aiMemoryMaxResults: 20,
      aiMemoryProjectScopeEnabled: false,
      readableVaultFolders: ['Argus/Projects', 'Argus/AIMemory'],
    });
    expect(saved).not.toHaveProperty('token');

    expect(service.readObsidianBridgeConfig({ includeToken: true })).toMatchObject({
      token: 'bridge-token',
    });
  });

  it('rejects non-loopback plugin endpoints', () => {
    expect(() => service.saveObsidianBridgeConfig({
      endpoint: 'https://example.com:27177',
    })).toThrow(/loopback|local/i);
  });

  it('does not write documents when the bridge switch is disabled', async () => {
    const fetchImpl = vi.fn();

    await expect(service.sendObsidianDocument({
      title: 'Project summary',
      content: 'Done',
      mode: 'project-knowledge',
    }, { fetchImpl })).rejects.toMatchObject({
      code: 'OBSIDIAN_BRIDGE_DISABLED',
      statusCode: 409,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards a normalized document payload to the local Obsidian plugin', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'bridge-token',
      defaultMode: 'second-brain',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        path: 'Argus/Projects/Argus UI/Sprint Summary.md',
        vaultName: 'Knowledge',
      }),
    }));

    const result = await service.sendObsidianDocument({
      title: 'Sprint Summary',
      content: '# Sprint Summary',
      mode: 'project-knowledge',
      kind: 'review-notes',
      status: 'final',
      sourceArtifactId: 'artifact-1',
      templateId: 'project-summary',
      related: ['ADR-1', 'Session 1'],
      confidence: 0.82,
      projectName: 'Argus UI',
      sessionId: 'session-1',
      tags: [' argus ', '', 'summary'],
      metadata: { sourceArtifact: 'artifact-1' },
    }, { fetchImpl });

    expect(result).toMatchObject({
      success: true,
      path: 'Argus/Projects/Argus UI/Sprint Summary.md',
      vaultName: 'Knowledge',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:27177/argus/v1/documents');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer bridge-token');
    expect(JSON.parse(options.body)).toMatchObject({
      title: 'Sprint Summary',
      content: '# Sprint Summary',
      mode: 'project-knowledge',
      projectName: 'Argus UI',
      sessionId: 'session-1',
      kind: 'review-notes',
      status: 'final',
      sourceArtifactId: 'artifact-1',
      templateId: 'project-summary',
      related: ['ADR-1', 'Session 1'],
      confidence: 0.82,
      tags: ['argus', 'summary'],
    });
  });

  it('checks plugin status through the configured local endpoint', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://localhost:27177',
      token: 'bridge-token',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        vaultName: 'Knowledge',
        plugin: 'argus-bridge',
      }),
    }));

    await expect(service.testObsidianBridgeConnection({ fetchImpl })).resolves.toMatchObject({
      success: true,
      vaultName: 'Knowledge',
      plugin: 'argus-bridge',
    });
    expect(service.readObsidianBridgeConfig()).toMatchObject({
      vaultName: 'Knowledge',
      pluginVersion: 'unknown',
      lastError: '',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:27177/argus/v1/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer bridge-token',
        }),
      }),
    );
  });

  it('records plugin version and last connection after a successful status check', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'bridge-token',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        vaultName: 'Knowledge',
        plugin: 'argus-bridge',
        pluginVersion: '0.2.0',
      }),
    }));

    await service.testObsidianBridgeConnection({ fetchImpl });

    expect(service.readObsidianBridgeConfig()).toMatchObject({
      vaultName: 'Knowledge',
      pluginVersion: '0.2.0',
      lastError: '',
    });
    expect(service.readObsidianBridgeConfig().lastConnection).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('forwards search and context requests to the plugin read APIs', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'bridge-token',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, results: [{ path: 'Argus/AIMemory/App/Prefs.md' }] }),
    }));

    await expect(service.searchObsidianBridge({
      query: 'prefs',
      folders: ['Argus/AIMemory'],
      limit: 5,
    }, { fetchImpl })).resolves.toMatchObject({
      success: true,
      results: [{ path: 'Argus/AIMemory/App/Prefs.md' }],
    });

    await service.buildObsidianContext({ query: 'prefs' }, { fetchImpl });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:27177/argus/v1/search',
      'http://127.0.0.1:27177/argus/v1/context',
    ]);
  });

  it('migrates legacy single-vault settings into a redacted multi-vault config', () => {
    const saved = service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27179',
      token: 'legacy-token',
      vaultName: 'Self',
      readableVaultFolders: ['Argus/Projects'],
      writeBaseFolder: 'Argus',
    });

    expect(saved.activeVaultId).toBe('default');
    expect(saved.vaults).toEqual([
      expect.objectContaining({
        vaultId: 'default',
        name: 'Self',
        endpoint: 'http://127.0.0.1:27179',
        tokenConfigured: true,
        readableFolders: ['Argus/Projects'],
        writeBaseFolder: 'Argus',
      }),
    ]);
    expect(saved.vaults[0]).not.toHaveProperty('token');
    expect(service.readObsidianBridgeConfig({ includeToken: true }).vaults[0]).toMatchObject({
      token: 'legacy-token',
    });
  });

  it('normalizes explicit multi-vault settings and selects a vault for client calls', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      activeVaultId: 'work',
      vaults: [
        {
          vaultId: 'self',
          name: 'Self',
          endpoint: 'http://127.0.0.1:27177',
          token: 'self-token',
          readableFolders: ['Argus/AIMemory'],
          writeBaseFolder: 'Argus',
        },
        {
          vaultId: 'work',
          name: 'Work',
          endpoint: 'http://localhost:27178',
          token: 'work-token',
          readableFolders: ['Argus/Projects'],
          writeBaseFolder: 'ArgusWork',
          projectMappings: { App: 'Argus/Projects/App' },
        },
      ],
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, note: { path: 'Argus/Projects/App/Plan.md' } }),
    }));

    await expect(service.getActiveObsidianNote({
      vaultId: 'work',
      includeContent: true,
      includeSelection: true,
    }, { fetchImpl })).resolves.toMatchObject({
      success: true,
      note: { path: 'Argus/Projects/App/Plan.md' },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:27178/argus/v1/active?includeContent=true&includeSelection=true',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer work-token' }),
      }),
    );
  });

  it('forwards patch, query, periodic append, and graph requests to plugin APIs', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'bridge-token',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, path: 'Argus/Projects/App/Plan.md' }),
    }));

    await service.patchObsidianNote({
      target: { path: 'Argus/Projects/App/Plan.md' },
      operation: 'append-heading',
      heading: 'Argus',
      content: 'Note',
    }, { fetchImpl });
    await service.queryObsidianNotes({
      query: 'decision',
      filters: [{ field: 'type', op: 'eq', value: 'decision' }],
      sourceTypes: ['markdown'],
    }, { fetchImpl });
    await service.appendObsidianPeriodicNote({ content: 'Daily item' }, { fetchImpl });
    await service.getObsidianGraph({ projectName: 'App' }, { fetchImpl });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:27177/argus/v1/patch',
      'http://127.0.0.1:27177/argus/v1/query',
      'http://127.0.0.1:27177/argus/v1/periodic/append',
      'http://127.0.0.1:27177/argus/v1/graph',
    ]);
  });
});
