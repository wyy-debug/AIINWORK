import http from 'node:http';

import express from 'express';
import { describe, expect, it } from 'vitest';

import obsidianBridgeRoutes from '../../routes/obsidian-bridge.js';

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

describe('Obsidian folder policy routes', () => {
  it('exposes folder policy and legacy migration dry-run preview', async () => {
    const app = express();
    app.use(express.json());
    app.use(obsidianBridgeRoutes);
    const server = await listen(app);
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const policy = await (await fetch(`${baseUrl}/wiki/folder-policy?projectName=App`)).json();
      expect(policy.folderPolicy.defaultReadableFolders).toEqual(['Argus/Wiki', 'Argus/_Indexes']);

      const preview = await (await fetch(`${baseUrl}/wiki/migration-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'App',
          notes: [{ path: 'Argus/AIMemory/App/Preference.md', properties: { source: 'argus' } }],
        }),
      })).json();
      expect(preview.success).toBe(true);
      expect(preview.preview.dryRun).toBe(true);
      expect(preview.preview.actions[0].action).toBe('relabel-legacy-aimemory');
    } finally {
      await close(server);
    }
  });
});
