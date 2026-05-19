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

describe('Obsidian semantic index routes', () => {
  let service;

  beforeEach(async () => {
    service = await import('../obsidian-bridge-service.js');
    service.setObsidianBridgeConfigStoreForTests(createMemoryConfigStore());
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'secret-token',
      vaultName: 'Knowledge',
      pluginVersion: '0.2.0',
      obsidianSemanticProvider: 'smart-connections',
      obsidianSemanticFallbackEnabled: true,
      obsidianSemanticIndexMetadata: {
        providerId: 'smart-connections',
        embeddingModel: 'bge-m3',
        itemCount: 12,
        lastIndexedAt: '2026-05-19T02:00:00.000Z',
      },
    });
  });

  it('exposes semantic index status without leaking the bridge token', async () => {
    const app = express();
    app.use(express.json());
    app.use(obsidianBridgeRoutes);
    const server = await listen(app);
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/semantic-index/status`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.semanticIndex.status).toBe('ready');
      expect(payload.semanticIndex.provider.id).toBe('smart-connections');
      expect(payload.semanticIndex.indexMetadata.itemCount).toBe(12);
      expect(JSON.stringify(payload)).not.toContain('secret-token');
    } finally {
      await close(server);
    }
  });

  it('makes semantic index state visible through bridge health diagnostics', async () => {
    const app = express();
    app.use(express.json());
    app.use(obsidianBridgeRoutes);
    const server = await listen(app);
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.health.semanticIndex).toMatchObject({
        status: 'ready',
        provider: { id: 'smart-connections' },
        fallbackMode: 'semantic',
      });
    } finally {
      await close(server);
    }
  });
});
