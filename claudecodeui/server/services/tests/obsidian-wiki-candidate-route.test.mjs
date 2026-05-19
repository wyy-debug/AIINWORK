import http from 'node:http';

import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import obsidianBridgeRoutes from '../../routes/obsidian-bridge.js';

const createMemoryStore = () => {
  let value = '[]';
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

describe('Obsidian Wiki candidate routes', () => {
  let wikiCandidates;

  beforeEach(async () => {
    wikiCandidates = await import('../obsidian-wiki-candidate-service.js');
    wikiCandidates.setObsidianWikiCandidateStoreForTests(createMemoryStore());
  });

  it('supports create, list, edit, discard, and commit lifecycle APIs', async () => {
    const app = express();
    app.use(express.json());
    app.use(obsidianBridgeRoutes);
    const server = await listen(app);
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const createdResponse = await fetch(`${baseUrl}/wiki/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: [{
            text: 'Save this candidate to the Wiki.',
            kind: 'reference',
            source: { projectName: 'App', messageId: 'assistant-1' },
          }],
        }),
      });
      const created = await createdResponse.json();
      const candidateId = created.candidates[0].id;

      const list = await (await fetch(`${baseUrl}/wiki/candidates`)).json();
      expect(list.candidates.map((candidate) => candidate.id)).toContain(candidateId);

      const edited = await (await fetch(`${baseUrl}/wiki/candidates/${candidateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Edited Candidate', tags: ['edited'] }),
      })).json();
      expect(edited.candidate).toMatchObject({ title: 'Edited Candidate', tags: ['edited'] });

      const discarded = await (await fetch(`${baseUrl}/wiki/candidates/${candidateId}`, {
        method: 'DELETE',
      })).json();
      expect(discarded.candidate.status).toBe('discarded');

      const committed = await (await fetch(`${baseUrl}/wiki/candidates/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds: [candidateId] }),
      })).json();
      expect(committed.success).toBe(true);
      expect(committed.committed).toEqual([]);
    } finally {
      await close(server);
    }
  });
});
