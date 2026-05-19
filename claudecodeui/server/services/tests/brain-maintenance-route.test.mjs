import http from 'node:http';

import express from 'express';
import { describe, expect, it } from 'vitest';

import { createBrainRouter } from '../../routes/brain.js';
import { createBrainMaintenanceService } from '../brain-maintenance-service.js';
import { createMemoryBrainStore } from './brain-test-store.mjs';

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

describe('Brain maintenance routes', () => {
  it('exposes export, import, retention preview, and repair APIs', async () => {
    const { store } = createMemoryBrainStore();
    store.addEvent({
      sessionId: 'maintenance-route-1',
      projectName: 'Argus',
      eventType: 'command',
      title: 'Route export',
      refs: [{ refType: 'raw_text', refId: 'route', label: 'Route', content: 'route raw' }],
    });
    store.upsertAtom({
      sessionId: 'maintenance-route-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Route maintenance',
      stableKey: 'decision:route-maintenance',
      refIds: ['missing-route-ref'],
    });
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use(createBrainRouter({
      store,
      brainMaintenanceService: createBrainMaintenanceService({ store }),
      readConfig: async () => ({ enabled: true }),
    }));
    const server = await listen(app);
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const exportResponse = await fetch(`${baseUrl}/session/maintenance-route-1/export?projectName=Argus`);
      const exported = await exportResponse.json();
      expect(exportResponse.status).toBe(200);
      expect(exported.packageData.schemaVersion).toBe(2);

      const previewResponse = await fetch(`${baseUrl}/session/maintenance-route-1/retention-preview?projectName=Argus&rawRefsMaxSizeBytes=1`);
      const preview = await previewResponse.json();
      expect(preview.preview.dryRun).toBe(true);
      expect(preview.preview.layers.rawRefs.wouldPruneCount).toBeGreaterThan(0);

      const repairResponse = await fetch(`${baseUrl}/session/maintenance-route-1/repair?projectName=Argus`, { method: 'POST' });
      const repair = await repairResponse.json();
      expect(repair.report.brokenEdges[0]).toMatchObject({ ownerType: 'atom', refId: 'missing-route-ref' });

      const importResponse = await fetch(`${baseUrl}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageData: exported.packageData, overwrite: true }),
      });
      const imported = await importResponse.json();
      expect(importResponse.status).toBe(200);
      expect(imported.result).toMatchObject({ imported: true, integrityVerified: true });
    } finally {
      await close(server);
    }
  });
});
