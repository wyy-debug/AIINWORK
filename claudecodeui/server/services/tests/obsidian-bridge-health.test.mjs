import http from 'node:http';

import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import obsidianBridgeRoutes from '../../routes/obsidian-bridge.js';

const createMemoryConfigStore = () => {
  let value = null;
  return {
    get: vi.fn(() => value),
    set: vi.fn((_key, nextValue) => {
      value = nextValue;
    }),
  };
};

const listen = async (app) => new Promise((resolve, reject) => {
  const server = http.createServer(app);
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error);
    else resolve();
  });
});

describe('Obsidian bridge health contract', () => {
  let service;
  let store;

  beforeEach(async () => {
    service = await import('../obsidian-bridge-service.js');
    store = createMemoryConfigStore();
    service.setObsidianBridgeConfigStoreForTests(store);
  });

  it('normalizes disabled, unpaired, stale-token, read-only, and write-failed states without leaking token', () => {
    service.saveObsidianBridgeConfig({
      enabled: true,
      vaultName: 'Knowledge',
      token: 'secret-token',
      pluginVersion: '',
      wikiPrimaryEnabled: false,
      lastError: '401 stale token write failed',
      vaults: [{
        vaultId: 'knowledge',
        name: 'Knowledge',
        endpoint: 'http://127.0.0.1:27177',
        token: 'secret-token',
        readableFolders: ['Argus/Wiki'],
        writeBaseFolder: '',
      }],
    });

    const health = service.getObsidianBridgeHealth();

    expect(health.status).toBe('degraded');
    expect(health.states).toEqual(expect.arrayContaining([
      'not-installed',
      'stale-token',
      'read-only-mode',
      'write-failed',
      'indexing-missing',
    ]));
    expect(health.contract).toMatchObject({
      bridgeEnabled: true,
      vaultSelected: true,
      tokenStatus: 'stale',
      pluginStatus: 'not-installed',
      writableFolders: [],
      readableFolders: ['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory'],
      lastError: '401 stale token write failed',
    });
    expect(JSON.stringify(health)).not.toContain('secret-token');
    expect(health.repairActions.map((action) => action.id)).toEqual(expect.arrayContaining([
      'reconnect',
      'reinstall-plugin',
      'select-vault',
      'refresh-folders',
      'run-test-query',
      'run-test-write',
    ]));
  });

  it('exposes route health payload for Settings and runtime diagnostics', async () => {
    service.saveObsidianBridgeConfig({
      enabled: false,
      lastError: 'Bridge disabled by user',
    });
    const app = express();
    app.use(obsidianBridgeRoutes);
    const server = await listen(app);
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.health.status).toBe('disabled');
      expect(payload.health.states).toContain('disabled');
      expect(payload.health.actions).toContain('Enable Obsidian Bridge in Settings');
    } finally {
      await close(server);
    }
  });
});
