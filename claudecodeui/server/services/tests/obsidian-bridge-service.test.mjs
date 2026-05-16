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

  it('returns an enabled disconnected bridge by default while Memory and CodeGraph are globally enabled', () => {
    const config = service.readObsidianBridgeConfig();

    expect(config).toMatchObject({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      defaultMode: 'project-knowledge',
      aiMemoryReadbackEnabled: true,
      wikiPrimaryEnabled: true,
      wikiReadbackEnabled: true,
      wikiReadbackIncludeRaw: false,
      wikiReadbackMaxResults: 8,
      aiMemoryMaxResults: 8,
      aiMemoryProjectScopeEnabled: true,
      autoExportKnowledgeArtifacts: false,
      readableVaultFolders: expect.arrayContaining(['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory']),
      codegraphEnabled: true,
      codegraphBackgroundSyncEnabled: true,
      codegraphWriteObsidianSummaries: true,
      codegraphLazyLlmSummaries: false,
      codegraphMaxSymbolNotes: 50,
      codegraphImpactMaxDepth: 2,
      codegraphImpactLimit: 50,
      codegraphGhostPolicy: 'deprecate',
      codegraphAutoDeleteGhostNotes: false,
      codegraphStorageRoot: '',
      codegraphExportLevel: 'structural',
      codegraphMaxEmbeddedSymbols: 200,
      tokenConfigured: false,
    });
    expect(config).not.toHaveProperty('token');
  });

  it('treats Memory and CodeGraph switches as global opt-outs, not project-scoped defaults', () => {
    service.saveObsidianBridgeConfig({
      wikiReadbackEnabled: false,
      aiMemoryReadbackEnabled: false,
      codegraphEnabled: false,
    });

    service.saveObsidianBridgeConfig({
      vaults: [{
        vaultId: 'default',
        name: 'WD',
        endpoint: 'http://127.0.0.1:27180',
        readableFolders: ['Argus/Wiki'],
        writeBaseFolder: 'Argus',
      }],
    });

    expect(service.readObsidianBridgeConfig()).toMatchObject({
      wikiReadbackEnabled: false,
      aiMemoryReadbackEnabled: false,
      codegraphEnabled: false,
    });
  });

  it('migrates old normalized false defaults to the new global-on main path', () => {
    store.set('obsidian_bridge', JSON.stringify({
      enabled: false,
      wikiReadbackEnabled: false,
      aiMemoryReadbackEnabled: false,
      codegraphEnabled: false,
    }));

    expect(service.readObsidianBridgeConfig()).toMatchObject({
      enabled: true,
      wikiReadbackEnabled: true,
      aiMemoryReadbackEnabled: true,
      codegraphEnabled: true,
    });
  });

  it('keeps a current-scope explicit bridge disable as a real opt-out', () => {
    service.saveObsidianBridgeConfig({
      enabled: false,
    });

    expect(service.readObsidianBridgeConfig()).toMatchObject({
      enabled: false,
      obsidianMainPathSwitchScope: 'global-v1',
    });
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
      codegraphEnabled: true,
      codegraphMaxSymbolNotes: 500,
      codegraphImpactMaxDepth: 9,
      codegraphImpactLimit: 999,
      codegraphGhostPolicy: 'unknown',
      codegraphStorageRoot: ' D:/Argus CodeGraph ',
      codegraphExportLevel: 'everything',
      codegraphMaxEmbeddedSymbols: 5000,
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
      readableVaultFolders: ['Argus/Projects', 'Argus/AIMemory', 'Argus/Wiki', 'Argus/_Indexes'],
      codegraphEnabled: true,
      codegraphMaxSymbolNotes: 200,
      codegraphImpactMaxDepth: 5,
      codegraphImpactLimit: 200,
      codegraphGhostPolicy: 'deprecate',
      codegraphStorageRoot: 'D:/Argus CodeGraph',
      codegraphExportLevel: 'structural',
      codegraphMaxEmbeddedSymbols: 1000,
    });
    expect(saved).not.toHaveProperty('token');

    expect(service.readObsidianBridgeConfig({ includeToken: true })).toMatchObject({
      token: 'bridge-token',
    });
  });

  it('migrates legacy automatic export settings to manual-first unless explicitly opted in', () => {
    const legacySaved = service.saveObsidianBridgeConfig({
      enabled: true,
      token: 'bridge-token',
      autoExportKnowledgeArtifacts: true,
    });
    expect(legacySaved.autoExportKnowledgeArtifacts).toBe(false);

    const optedIn = service.saveObsidianBridgeConfig({
      autoExportKnowledgeArtifacts: true,
      autoExportKnowledgeArtifactsOptIn: true,
    });
    expect(optedIn.autoExportKnowledgeArtifacts).toBe(true);
    expect(optedIn.autoExportKnowledgeArtifactsOptIn).toBe(true);
  });

  it('rejects non-loopback plugin endpoints', () => {
    expect(() => service.saveObsidianBridgeConfig({
      endpoint: 'https://example.com:27177',
    })).toThrow(/loopback|local/i);
  });

  it('does not write documents when the bridge switch is disabled', async () => {
    service.saveObsidianBridgeConfig({
      enabled: false,
      token: 'bridge-token',
    });
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

  it('repairs a stale configured endpoint from reachable Obsidian vault discovery', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'old-token',
      vaultName: 'self',
      readableVaultFolders: ['Argus/Wiki'],
    });
    const listVaults = vi.fn(async () => [
      {
        name: 'self',
        path: 'C:/Users/yckui/Documents/note/self',
        open: true,
        bridgeEndpoint: 'http://127.0.0.1:27178',
        bridgeReachable: true,
        tokenConfigured: true,
        readableFolders: ['Argus/Wiki', 'Argus/AIMemory'],
        baseFolder: 'Argus',
        statusPluginVersion: '0.1.3',
      },
    ]);
    const readPluginData = vi.fn(async () => ({
      endpoint: 'http://127.0.0.1:27178',
      token: 'new-token',
      readableFolders: ['Argus/Wiki', 'Argus/AIMemory'],
      baseFolder: 'Argus',
    }));

    const repaired = await service.repairObsidianBridgeConfigFromReachableVaults({
      fetchImpl: vi.fn(),
      listVaults,
      readPluginData,
    });

    expect(repaired).toMatchObject({
      endpoint: 'http://127.0.0.1:27178',
      vaultName: 'self',
    });
    expect(service.readObsidianBridgeConfig()).toMatchObject({
      endpoint: 'http://127.0.0.1:27178',
      vaultName: 'self',
      pluginVersion: '0.1.3',
      readableVaultFolders: ['Argus/Wiki', 'Argus/AIMemory', 'Argus/_Indexes'],
      tokenConfigured: true,
    });
    expect(service.readObsidianBridgeConfig()).not.toHaveProperty('token');
    expect(service.readObsidianBridgeConfig({ includeToken: true }).vaults[0]).toMatchObject({
      token: 'new-token',
    });
  });

  it('repairs a stale endpoint from the open vault plugin data even when status probing is transiently stale', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27179',
      token: 'old-token',
      vaultName: 'WD',
      pluginVersion: '0.1.3',
    });
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    const repaired = await service.repairObsidianBridgeConfigFromReachableVaults({
      fetchImpl: vi.fn(),
      logger,
      listVaults: vi.fn(async () => [
        {
          name: 'WD',
          path: 'E:/WD/WD',
          open: true,
          pluginInstalled: true,
          pluginVersion: '0.1.4',
          bridgeEndpoint: 'http://127.0.0.1:27180',
          bridgeReachable: false,
          tokenConfigured: true,
          readableFolders: ['Argus/Wiki', 'Argus/AIMemory'],
          baseFolder: 'Argus',
        },
      ]),
      readPluginData: vi.fn(async () => ({
        endpoint: 'http://127.0.0.1:27180',
        token: 'fresh-token',
        readableFolders: ['Argus/Wiki', 'Argus/AIMemory'],
        baseFolder: 'Argus',
      })),
    });

    expect(repaired).toMatchObject({
      endpoint: 'http://127.0.0.1:27180',
      vaultName: 'WD',
      pluginVersion: '0.1.4',
      token: 'fresh-token',
    });
    expect(service.readObsidianBridgeConfig()).toMatchObject({
      endpoint: 'http://127.0.0.1:27180',
      vaultName: 'WD',
      pluginVersion: '0.1.4',
      tokenConfigured: true,
      readableVaultFolders: ['Argus/Wiki', 'Argus/AIMemory', 'Argus/_Indexes'],
    });
    expect(logger.log.mock.calls.map(([message]) => String(message)).join('\n')).toContain('repair_discovery');
    expect(logger.warn.mock.calls.map(([message]) => String(message)).join('\n')).toContain('repair_saved');
  });

  it('bootstraps a missing bridge config from a reachable Obsidian vault', async () => {
    const listVaults = vi.fn(async () => [
      {
        name: 'self',
        path: 'C:/Users/yckui/Documents/note/self',
        open: true,
        bridgeEndpoint: 'http://127.0.0.1:27178',
        bridgeReachable: true,
        tokenConfigured: true,
        readableFolders: ['Argus/Wiki', 'Argus/AIMemory'],
        baseFolder: 'Argus',
        statusPluginVersion: '0.1.3',
      },
    ]);
    const readPluginData = vi.fn(async () => ({
      endpoint: 'http://127.0.0.1:27178',
      token: 'new-token',
      readableFolders: ['Argus/Wiki', 'Argus/AIMemory'],
      baseFolder: 'Argus',
    }));

    const repaired = await service.repairObsidianBridgeConfigFromReachableVaults({
      allowDisabledBootstrap: true,
      fetchImpl: vi.fn(),
      listVaults,
      readPluginData,
    });

    expect(repaired).toMatchObject({
      endpoint: 'http://127.0.0.1:27178',
      vaultName: 'self',
      token: 'new-token',
    });
    expect(service.readObsidianBridgeConfig()).toMatchObject({
      enabled: true,
      endpoint: 'http://127.0.0.1:27178',
      vaultName: 'self',
      tokenConfigured: true,
      readableVaultFolders: ['Argus/Wiki', 'Argus/AIMemory', 'Argus/_Indexes'],
    });
  });

  it('does not bootstrap when a stored bridge config is explicitly disabled', async () => {
    service.saveObsidianBridgeConfig({
      enabled: false,
      endpoint: 'http://127.0.0.1:27177',
      token: 'old-token',
      vaultName: 'self',
    });

    const repaired = await service.repairObsidianBridgeConfigFromReachableVaults({
      allowDisabledBootstrap: true,
      fetchImpl: vi.fn(),
      listVaults: vi.fn(async () => [
        {
          name: 'self',
          path: 'C:/Users/yckui/Documents/note/self',
          open: true,
          bridgeEndpoint: 'http://127.0.0.1:27178',
          bridgeReachable: true,
          tokenConfigured: true,
        },
      ]),
      readPluginData: vi.fn(async () => ({
        endpoint: 'http://127.0.0.1:27178',
        token: 'new-token',
      })),
    });

    expect(repaired).toBeNull();
    expect(service.readObsidianBridgeConfig()).toMatchObject({
      enabled: false,
      endpoint: 'http://127.0.0.1:27177',
    });
  });

  it('retries document writes after repairing a stale bridge endpoint', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'old-token',
      vaultName: 'self',
    });
    const repairBridgeConfig = vi.fn(async () => {
      service.saveObsidianBridgeConfig({
        enabled: true,
        activeVaultId: 'default',
        vaults: [{
          vaultId: 'default',
          name: 'self',
          endpoint: 'http://127.0.0.1:27178',
          token: 'new-token',
          readableFolders: ['Argus/Wiki', 'Argus/AIMemory'],
          writeBaseFolder: 'Argus',
        }],
      });
      return service.readObsidianBridgeConfig({ includeToken: true });
    });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('27177')) {
        throw new Error('fetch failed');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          path: 'Argus/AIMemory/Feedback/concise.md',
        }),
      };
    });

    await expect(service.sendObsidianDocument({
      title: 'concise',
      content: 'The user prefers concise answers.',
      mode: 'ai-memory',
      projectName: 'Feedback',
    }, { fetchImpl, repairBridgeConfig })).resolves.toMatchObject({
      success: true,
      path: 'Argus/AIMemory/Feedback/concise.md',
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:27177/argus/v1/documents',
      'http://127.0.0.1:27178/argus/v1/documents',
    ]);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer new-token');
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
        readableFolders: ['Argus/Projects', 'Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory'],
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

  it('forwards managed file, patch, query, periodic append, and graph requests to plugin APIs', async () => {
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

    await service.upsertObsidianMarkdownFile({
      path: 'Argus/Wiki/App/CodeGraph/Index.md',
      content: '# CodeGraph',
      kind: 'codegraph',
    }, { fetchImpl });
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
      'http://127.0.0.1:27177/argus/v1/files/upsert',
      'http://127.0.0.1:27177/argus/v1/patch',
      'http://127.0.0.1:27177/argus/v1/query',
      'http://127.0.0.1:27177/argus/v1/periodic/append',
      'http://127.0.0.1:27177/argus/v1/graph',
    ]);
  });

  it('logs Obsidian bridge request lifecycle without leaking token or file content', async () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'super-secret-token',
      vaultName: 'WD',
      pluginVersion: '0.1.4',
    });
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, path: 'Argus/Wiki/App/CodeGraph/Index.md' }),
    }));

    await service.upsertObsidianMarkdownFile({
      path: 'Argus/Wiki/App/CodeGraph/Index.md',
      content: '# Sensitive note body',
      kind: 'codegraph',
    }, { fetchImpl, logger });

    const logs = logger.log.mock.calls.map(([message]) => String(message)).join('\n');
    expect(logs).toContain('[Obsidian Bridge] request_start');
    expect(logs).toContain('[Obsidian Bridge] request_success');
    expect(logs).toContain('/argus/v1/files/upsert');
    expect(logs).toContain('Argus/Wiki/App/CodeGraph/Index.md');
    expect(logs).toContain('"contentBytes"');
    expect(logs).not.toContain('super-secret-token');
    expect(logs).not.toContain('Sensitive note body');
  });
});
