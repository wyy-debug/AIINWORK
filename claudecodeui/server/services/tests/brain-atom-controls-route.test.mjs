import http from 'node:http';

import express from 'express';
import { describe, expect, it } from 'vitest';

import { createBrainRouter } from '../../routes/brain.js';
import { createBrainPostTurnExtractionService } from '../brain-post-turn-extraction-service.js';
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

const postJson = async (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('Brain atom manual controls route', () => {
  it('archives, pins, marks stale, and merges duplicates from diagnostics controls', async () => {
    const { store } = createMemoryBrainStore();
    const first = store.upsertAtom({
      sessionId: 'controls-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Use event stream bridge health',
      summary: 'Use event stream bridge health.',
      stableKey: 'decision:event-stream',
      sourceEventIds: ['event-a'],
      refIds: ['ref-a'],
    });
    const duplicate = store.upsertAtom({
      sessionId: 'controls-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Use streaming bridge health',
      summary: 'Duplicate event stream bridge health decision.',
      stableKey: 'decision:event-stream-dupe',
      sourceEventIds: ['event-b'],
      refIds: ['ref-b'],
    });
    const app = express();
    app.use(express.json());
    app.use(createBrainRouter({
      store,
      postTurnExtractionService: createBrainPostTurnExtractionService({ store }),
      readConfig: async () => ({ enabled: true }),
    }));
    const server = await listen(app);
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const pinResponse = await postJson(`${baseUrl}/atom/${first.id}/control`, { action: 'pin' });
      const pinned = await pinResponse.json();
      expect(pinResponse.status).toBe(200);
      expect(pinned.atom.pinned).toBe(true);

      const staleResponse = await postJson(`${baseUrl}/atom/${first.id}/control`, { action: 'mark-stale' });
      const stale = await staleResponse.json();
      expect(stale.atom.status).toBe('stale');

      const archiveResponse = await postJson(`${baseUrl}/atom/${first.id}/control`, { action: 'archive' });
      const archived = await archiveResponse.json();
      expect(archived.atom.status).toBe('archived');

      const mergeResponse = await postJson(`${baseUrl}/atom/${duplicate.id}/control`, {
        action: 'merge',
        targetAtomId: first.id,
      });
      const merged = await mergeResponse.json();
      const target = store.listAtoms({ sessionId: 'controls-1', status: '', limit: 20 })
        .find((atom) => atom.id === first.id);
      expect(mergeResponse.status).toBe(200);
      expect(merged.atom.status).toBe('superseded');
      expect(merged.atom.supersededById).toBe(first.id);
      expect(target.sourceEventIds).toEqual(expect.arrayContaining(['event-a', 'event-b']));
      expect(target.refIds).toEqual(expect.arrayContaining(['ref-a', 'ref-b']));
    } finally {
      await close(server);
    }
  });
});
