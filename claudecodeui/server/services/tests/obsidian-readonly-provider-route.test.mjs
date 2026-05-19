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

describe('Obsidian read-only provider routes', () => {
  let service;

  beforeEach(async () => {
    service = await import('../obsidian-bridge-service.js');
    service.setObsidianBridgeConfigStoreForTests(createMemoryConfigStore());
    service.saveObsidianBridgeConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:27177',
      token: 'secret-token',
      obsidianSemanticProviderTransport: 'local-http',
      obsidianSemanticProviderEndpoint: 'http://127.0.0.1:27777',
      obsidianSemanticProviderTimeoutMs: 250,
    });
  });

  it('exposes read-only provider capabilities through semantic-index diagnostics', async () => {
    const app = express();
    app.use(express.json());
    app.use(obsidianBridgeRoutes);
    const server = await listen(app);
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/semantic-index/capabilities`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.provider.transport).toBe('local-http');
      expect(payload.provider.readOnly).toBe(true);
      expect(payload.provider.capabilities.write).toBe(false);
      expect(JSON.stringify(payload)).not.toContain('secret-token');
    } finally {
      await close(server);
    }
  });
});
