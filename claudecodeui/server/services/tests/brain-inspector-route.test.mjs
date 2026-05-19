import http from 'node:http';

import express from 'express';
import { describe, expect, it } from 'vitest';

import { createBrainRouter } from '../../routes/brain.js';
import { createBrainInspectorService } from '../brain-inspector-service.js';
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

describe('Brain inspector routes', () => {
  it('returns inspectable layers, recall reasons, controls, canvas, and redaction-safe raw refs', async () => {
    const { store } = createMemoryBrainStore();
    const event = store.addEvent({
      sessionId: 'inspector-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Decision: inspect Brain memory',
      content: 'SECRET_TOKEN=abc123 should never be in preview',
      refs: [{
        refType: 'raw_text',
        refId: 'raw-1',
        label: 'Raw tool output',
        content: 'SECRET_TOKEN=abc123 raw output',
      }],
    });
    const atom = store.upsertAtom({
      sessionId: 'inspector-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Inspect Brain memory',
      summary: 'Show what Brain remembered and why.',
      stableKey: 'decision:inspect',
      sourceEventIds: [event.id],
      refIds: event.refs.map((ref) => ref.id),
      pinned: true,
    });
    store.upsertScenario({
      sessionId: 'inspector-1',
      projectName: 'Argus',
      scenarioKey: 'session:inspector',
      title: 'Inspector scenario',
      atomIds: [atom.id],
    });
    store.upsertProjectProfile({
      projectName: 'Argus',
      profileType: 'working-memory',
      summary: 'Project profile summary.',
      sourceAtomIds: [atom.id],
    });
    store.addCompaction({
      sessionId: 'inspector-1',
      projectName: 'Argus',
      mermaid: 'flowchart TD\n  brain_decision_x["Inspect Brain memory"]',
      currentGoal: 'Inspect Brain memory',
      refs: event.refs.map((ref) => ref.id),
    });
    store.addRetrievalRun({
      sessionId: 'inspector-1',
      projectName: 'Argus',
      query: 'why was inspect memory recalled',
      mode: 'hybrid',
      hits: [{ id: atom.id, title: atom.title, reasons: [{ signal: 'explicit-pin', rank: 1 }] }],
      metrics: { degraded: false, signals: ['explicit-pin'] },
    });
    const app = express();
    app.use(createBrainRouter({
      store,
      brainInspectorService: createBrainInspectorService({ store }),
      readConfig: async () => ({ enabled: true }),
    }));
    const server = await listen(app);
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${baseUrl}/session/inspector-1/inspector?projectName=Argus`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.inspector.layers.rawRefs[0]).toMatchObject({
        id: event.refs[0].id,
        label: 'Raw tool output',
        contentPreview: '[hidden: expand through safe evidence drill-down]',
        sensitiveHidden: true,
      });
      expect(JSON.stringify(payload.inspector)).not.toContain('SECRET_TOKEN');
      expect(payload.inspector.layers.atoms[0]).toMatchObject({ id: atom.id, pinned: true });
      expect(payload.inspector.layers.scenarios[0].title).toBe('Inspector scenario');
      expect(payload.inspector.layers.projectProfile.summary).toContain('Project profile');
      expect(payload.inspector.recallHits[0].reasons[0].signal).toBe('explicit-pin');
      expect(payload.inspector.canvas.mermaid).toContain('flowchart TD');
      expect(payload.inspector.controls).toEqual(expect.arrayContaining(['pin', 'archive', 'mark-stale', 'merge', 'clear-session', 'clear-project', 'export-report']));
    } finally {
      await close(server);
    }
  });

  it('makes disabled and empty states obvious and actionable', async () => {
    const { store } = createMemoryBrainStore();
    const app = express();
    app.use(createBrainRouter({
      store,
      brainInspectorService: createBrainInspectorService({ store }),
      readConfig: async () => ({ enabled: false }),
    }));
    const server = await listen(app);
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/session/empty/inspector`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.inspector.status).toBe('disabled');
      expect(payload.inspector.actions).toEqual(expect.arrayContaining(['Enable Argus Brain in Runtime Settings']));
    } finally {
      await close(server);
    }
  });
});
