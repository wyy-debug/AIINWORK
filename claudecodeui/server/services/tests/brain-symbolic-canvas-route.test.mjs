import http from 'node:http';

import Database from 'better-sqlite3';
import express from 'express';
import { describe, expect, it } from 'vitest';

import {
  BRAIN_ATOMS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_SESSION_INDEX_SQL,
  BRAIN_ATOMS_STABLE_INDEX_SQL,
  BRAIN_ATOMS_TABLE_SQL,
  BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
  BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
  BRAIN_COMPACTIONS_TABLE_SQL,
  BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
  BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
  BRAIN_EVENTS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_SESSION_INDEX_SQL,
  BRAIN_EVENTS_TABLE_SQL,
  BRAIN_NODES_PROJECT_INDEX_SQL,
  BRAIN_NODES_SESSION_INDEX_SQL,
  BRAIN_NODES_TABLE_SQL,
  BRAIN_PROJECT_PROFILES_INDEX_SQL,
  BRAIN_PROJECT_PROFILES_TABLE_SQL,
  BRAIN_REFS_EVENT_INDEX_SQL,
  BRAIN_REFS_REF_INDEX_SQL,
  BRAIN_REFS_SESSION_INDEX_SQL,
  BRAIN_REFS_TABLE_SQL,
  BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
  BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
  BRAIN_SCENARIOS_SESSION_INDEX_SQL,
  BRAIN_SCENARIOS_TABLE_SQL,
  BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
  BRAIN_SESSIONS_PROJECT_INDEX_SQL,
  BRAIN_SESSIONS_TABLE_SQL,
} from '../../database/schema.js';
import { createBrainRouter } from '../../routes/brain.js';
import {
  createBrainSymbolicCanvasService,
  createStableSymbolicNodeId,
} from '../brain-symbolic-canvas-service.js';
import { createBrainStore } from '../brain-store-service.js';

const createStore = () => {
  const db = new Database(':memory:');
  db.exec([
    BRAIN_SESSIONS_TABLE_SQL,
    BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
    BRAIN_SESSIONS_PROJECT_INDEX_SQL,
    BRAIN_EVENTS_TABLE_SQL,
    BRAIN_EVENTS_SESSION_INDEX_SQL,
    BRAIN_EVENTS_PROJECT_INDEX_SQL,
    BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
    BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
    BRAIN_REFS_TABLE_SQL,
    BRAIN_REFS_SESSION_INDEX_SQL,
    BRAIN_REFS_EVENT_INDEX_SQL,
    BRAIN_REFS_REF_INDEX_SQL,
    BRAIN_NODES_TABLE_SQL,
    BRAIN_NODES_SESSION_INDEX_SQL,
    BRAIN_NODES_PROJECT_INDEX_SQL,
    BRAIN_COMPACTIONS_TABLE_SQL,
    BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
    BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
    BRAIN_ATOMS_TABLE_SQL,
    BRAIN_ATOMS_SESSION_INDEX_SQL,
    BRAIN_ATOMS_PROJECT_INDEX_SQL,
    BRAIN_ATOMS_STABLE_INDEX_SQL,
    BRAIN_SCENARIOS_TABLE_SQL,
    BRAIN_SCENARIOS_SESSION_INDEX_SQL,
    BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
    BRAIN_PROJECT_PROFILES_TABLE_SQL,
    BRAIN_PROJECT_PROFILES_INDEX_SQL,
    BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
    BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
    BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
  ].join('\n'));
  return createBrainStore({ db });
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

const seedNode = (store) => {
  const event = store.addEvent({
    sessionId: 'route-canvas-1',
    projectName: 'Argus',
    eventType: 'artifact',
    artifactId: 'artifact-77',
    title: 'Artifact summarizes impact analysis',
    content: 'RAW_ARTIFACT_EVIDENCE belongs in drill-down only.',
    refs: [{
      refType: 'artifact',
      refId: 'artifact-77',
      label: 'Impact analysis artifact',
      artifactId: 'artifact-77',
      content: 'RAW_ARTIFACT_EVIDENCE body',
    }],
  });
  const id = createStableSymbolicNodeId({
    sessionId: 'route-canvas-1',
    nodeType: 'artifact',
    meaning: 'Artifact summarizes impact analysis',
  });
  return store.upsertNode({
    id,
    sessionId: 'route-canvas-1',
    projectName: 'Argus',
    nodeType: 'artifact',
    title: 'Artifact summarizes impact analysis',
    sourceEventIds: [event.id],
    refIds: event.refs.map((ref) => ref.id),
  });
};

describe('Brain symbolic canvas routes', () => {
  it('exposes compact canvas diagnostics and raw-evidence node drill-down separately', async () => {
    const store = createStore();
    const node = seedNode(store);
    const app = express();
    app.use(createBrainRouter({
      store,
      symbolicCanvasService: createBrainSymbolicCanvasService({ store }),
      readConfig: async () => ({ enabled: true }),
    }));
    const server = await listen(app);
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const canvasResponse = await fetch(`${baseUrl}/session/route-canvas-1/canvas?projectName=Argus`);
      const canvas = await canvasResponse.json();
      expect(canvasResponse.status).toBe(200);
      expect(canvas.success).toBe(true);
      expect(canvas.canvas.mermaid).toContain(`click ${node.id}`);
      expect(canvas.canvas.textFallback).toContain(node.id);
      expect(JSON.stringify(canvas.canvas)).not.toContain('RAW_ARTIFACT_EVIDENCE');

      const nodeResponse = await fetch(`${baseUrl}/session/route-canvas-1/node/${node.id}`);
      const detail = await nodeResponse.json();
      expect(nodeResponse.status).toBe(200);
      expect(detail.success).toBe(true);
      expect(detail.detail.refs[0].content).toContain('RAW_ARTIFACT_EVIDENCE');
      expect(detail.detail.openTargets).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'artifact', id: 'artifact-77' }),
      ]));
      expect(detail.detail.copyEvidence).toContain(node.id);
    } finally {
      await close(server);
    }
  });
});
