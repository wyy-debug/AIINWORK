import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSwarmsRouter } from '../../routes/swarms.js';

const listen = (app) => new Promise((resolve, reject) => {
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

describe('swarms route', () => {
  const servers = [];

  afterEach(async () => {
    while (servers.length) await close(servers.pop());
  });

  async function createClient(overrides = {}) {
    const orchestrator = {
      startRun: vi.fn(async () => ({ id: 'run-1', status: 'running', templateId: 'review-swarm' })),
      listRunSummaries: vi.fn(() => [{ id: 'run-1', status: 'running', templateId: 'review-swarm' }]),
      getRunSnapshot: vi.fn(() => ({ id: 'run-1', status: 'running', agents: [], messages: [], events: [] })),
      listEvents: vi.fn(() => [{ id: 'event-1', type: 'swarm_run_created' }]),
      listMessageTrace: vi.fn(() => [{ id: 'trace-1', messageId: 'message-1', status: 'published' }]),
      sendMessage: vi.fn(() => ({ id: 'message-1', status: 'published' })),
      replayMessages: vi.fn(() => [{ id: 'message-1', status: 'published' }]),
      controlRun: vi.fn(async () => ({ success: true, action: 'pause' })),
      listMemory: vi.fn(() => [{ id: 'memory-1', title: 'Fact', scope: 'facts' }]),
      recordMemory: vi.fn((entry) => ({ id: 'memory-2', ...entry })),
      updateMemory: vi.fn((input, patch) => {
        if (input && typeof input === 'object') return { id: input.memoryId, ...(input.patch || {}) };
        return { id: input, ...patch };
      }),
      deleteMemory: vi.fn(() => ({ success: true })),
      ...overrides,
    };
    const app = express();
    app.use(express.json());
    app.use('/api/swarms', createSwarmsRouter({ orchestrator }));
    const server = await listen(app);
    servers.push(server);
    const address = server.address();
    return { orchestrator, baseUrl: `http://127.0.0.1:${address.port}` };
  }

  async function createClientWithFactory(orchestratorFactory) {
    const app = express();
    app.use(express.json());
    app.use('/api/swarms', createSwarmsRouter({ orchestratorFactory }));
    const server = await listen(app);
    servers.push(server);
    const address = server.address();
    return { baseUrl: `http://127.0.0.1:${address.port}` };
  }

  it('validates templates and creates runs through the orchestrator', async () => {
    const { orchestrator, baseUrl } = await createClient();
    const manifest = {
      id: 'review-swarm',
      kind: 'swarm-template',
      topology: { type: 'mesh' },
      roles: [{ id: 'reviewer', agentTemplateId: 'security-reviewer' }],
    };

    const validateResponse = await fetch(`${baseUrl}/api/swarms/templates/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest }),
    });
    const validateBody = await validateResponse.json();
    expect(validateResponse.status).toBe(200);
    expect(validateBody.manifest).toMatchObject({ kind: 'swarm-template', id: 'review-swarm' });

    const runResponse = await fetch(`${baseUrl}/api/swarms/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: manifest, objective: 'Review auth', sessionId: 'parent-session' }),
    });
    expect(runResponse.status).toBe(200);
    expect(await runResponse.json()).toMatchObject({ run: { id: 'run-1', status: 'running' } });
    expect(orchestrator.startRun).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'Review auth',
      sessionId: 'parent-session',
      runtimeMode: 'coordinator-subagents',
      background: true,
    }));
  });

  it('does not trust top-level permission bypass fields when creating swarm runs', async () => {
    const { orchestrator, baseUrl } = await createClient();
    const manifest = {
      id: 'review-swarm',
      kind: 'swarm-template',
      topology: { type: 'mesh' },
      roles: [{ id: 'reviewer', agentTemplateId: 'security-reviewer' }],
    };

    const runResponse = await fetch(`${baseUrl}/api/swarms/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: manifest,
        objective: 'Review auth',
        permissionMode: 'bypassPermissions',
        toolsSettings: { skipPermissions: true, allowedTools: ['Bash'] },
        skipPermissions: true,
      }),
    });

    expect(runResponse.status).toBe(200);
    expect(orchestrator.startRun).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: '',
      toolsSettings: null,
      skipPermissions: false,
    }));
  });

  it('initializes an async orchestrator factory only once for concurrent requests', async () => {
    const orchestrator = {
      listRunSummaries: vi.fn(() => []),
    };
    const orchestratorFactory = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return orchestrator;
    });
    const { baseUrl } = await createClientWithFactory(orchestratorFactory);

    await Promise.all([
      fetch(`${baseUrl}/api/swarms/runs`),
      fetch(`${baseUrl}/api/swarms/runs`),
    ]);

    expect(orchestratorFactory).toHaveBeenCalledTimes(1);
  });

  it('returns snapshots, events, publishes messages, and controls runs', async () => {
    const { orchestrator, baseUrl } = await createClient();

    expect((await fetch(`${baseUrl}/api/swarms/runs/run-1`)).status).toBe(200);
    expect(await (await fetch(`${baseUrl}/api/swarms/runs/run-1/events`)).json()).toMatchObject({
      events: [{ id: 'event-1', type: 'swarm_run_created' }],
    });

    const messageResponse = await fetch(`${baseUrl}/api/swarms/runs/run-1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAgentId: 'queen', topic: 'review.findings', type: 'finding', payload: { severity: 'high' } }),
    });
    expect(await messageResponse.json()).toMatchObject({ message: { id: 'message-1', status: 'published' } });
    expect(orchestrator.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }));

    const controlResponse = await fetch(`${baseUrl}/api/swarms/runs/run-1/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(await controlResponse.json()).toMatchObject({ result: { success: true, action: 'pause' } });
    expect(orchestrator.controlRun).toHaveBeenCalledWith({ runId: 'run-1', action: 'pause' });
  });

  it('lists persisted runs, inspects message traces, replays messages, and manages memory', async () => {
    const { orchestrator, baseUrl } = await createClient();

    expect(await (await fetch(`${baseUrl}/api/swarms/runs?limit=5&status=running`)).json()).toMatchObject({
      runs: [{ id: 'run-1', status: 'running' }],
    });
    expect(orchestrator.listRunSummaries).toHaveBeenCalledWith({ limit: 5, status: 'running', templateId: '' });

    expect(await (await fetch(`${baseUrl}/api/swarms/runs/run-1/messages/message-1/trace`)).json()).toMatchObject({
      trace: [{ id: 'trace-1', status: 'published' }],
    });
    expect(orchestrator.listMessageTrace).toHaveBeenCalledWith({ runId: 'run-1', messageId: 'message-1' });

    const replayResponse = await fetch(`${baseUrl}/api/swarms/runs/run-1/messages/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusFilter: 'dead_lettered' }),
    });
    expect(await replayResponse.json()).toMatchObject({ messages: [{ id: 'message-1', status: 'published' }] });
    expect(orchestrator.replayMessages).toHaveBeenCalledWith({ runId: 'run-1', statusFilter: 'dead_lettered', messageIds: [] });

    expect(await (await fetch(`${baseUrl}/api/swarms/runs/run-1/memory`)).json()).toMatchObject({
      memory: [{ id: 'memory-1', title: 'Fact' }],
    });
    const createMemory = await fetch(`${baseUrl}/api/swarms/runs/run-1/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'facts', title: 'Decision', content: 'Ship it' }),
    });
    expect(await createMemory.json()).toMatchObject({ memory: { id: 'memory-2', title: 'Decision' } });

    const patchMemory = await fetch(`${baseUrl}/api/swarms/runs/run-1/memory/memory-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(await patchMemory.json()).toMatchObject({ memory: { id: 'memory-1', title: 'Updated' } });
    expect(orchestrator.updateMemory).toHaveBeenCalledWith({
      runId: 'run-1',
      memoryId: 'memory-1',
      patch: { title: 'Updated' },
    });

    const deleteMemory = await fetch(`${baseUrl}/api/swarms/runs/run-1/memory/memory-1`, { method: 'DELETE' });
    expect(await deleteMemory.json()).toMatchObject({ success: true });
    expect(orchestrator.deleteMemory).toHaveBeenCalledWith({ runId: 'run-1', memoryId: 'memory-1' });
  });
});
