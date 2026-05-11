import { describe, expect, it } from 'vitest';

import { normalizeSwarmTemplateManifest } from '../swarm-template-manifest-service.js';

describe('swarm-template-manifest-service', () => {
  it('normalizes topology, roles, bus, memory, policies, dependencies, and dialogs', () => {
    const manifest = normalizeSwarmTemplateManifest({
      schemaVersion: 1,
      id: 'review-swarm',
      version: '1.2.0',
      kind: 'swarm-template',
      topology: {
        type: 'queen',
        coordinatorRoleId: 'queen',
        edges: [
          { from: 'queen', to: 'reviewer', topic: 'review.assignments' },
          { from: 'reviewer', to: 'tester', topic: 'review.findings' },
        ],
      },
      roles: [
        {
          id: 'queen',
          label: 'Queen Coordinator',
          agentTemplateId: 'review-queen',
          count: 1,
          runtime: { tools: ['Read'], model: 'sonnet' },
          topics: ['review.assignments'],
        },
        {
          id: 'reviewer',
          agentTemplateId: 'security-reviewer',
          count: 2,
          dependencies: { required: { skills: ['security-review'] } },
          dialogs: {
            launch: {
              fields: [{ id: 'scope', label: 'Scope', type: 'textarea' }],
              presets: [{ id: 'critical', label: 'Critical files', answers: { scope: 'auth and payments' } }],
            },
          },
        },
        { id: 'tester', agentTemplateId: 'test-writer' },
      ],
      routing: {
        topics: [
          { name: 'review.assignments', subscribers: ['reviewer'], ackPolicy: 'at_least_once' },
        ],
      },
      bus: { provider: 'local-sqlite', ackPolicy: 'at_least_once', retryLimit: 4, ttlMs: 120000 },
      memory: { enabled: true, promotion: 'manual', scopes: ['facts', 'decisions'] },
      policies: { maxAgents: 6, maxDepth: 3, tokenBudget: 200000, timeoutMs: 3600000, messageSizeLimit: 32768 },
      dependencies: { optional: { mcpServers: ['linear'] } },
      dialogs: {
        launch: {
          fields: [{ id: 'objective', label: 'Objective', type: 'textarea', required: true }],
        },
      },
      compat: { argusUi: '>=1.31.0' },
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: 'review-swarm',
      version: '1.2.0',
      kind: 'swarm-template',
      topology: {
        type: 'queen',
        coordinatorRoleId: 'queen',
        edges: [
          { from: 'queen', to: 'reviewer', topic: 'review.assignments' },
          { from: 'reviewer', to: 'tester', topic: 'review.findings' },
        ],
      },
      roles: [
        {
          id: 'queen',
          label: 'Queen Coordinator',
          agentTemplateId: 'review-queen',
          count: 1,
          runtime: { tools: ['Read'], model: 'sonnet' },
          topics: ['review.assignments'],
        },
        {
          id: 'reviewer',
          label: 'reviewer',
          agentTemplateId: 'security-reviewer',
          count: 2,
          dependencies: {
            skills: [{ kind: 'skill', name: 'security-review', optional: false }],
          },
          dialogs: {
            launch: {
              presets: [{ id: 'critical', label: 'Critical files', answers: { scope: 'auth and payments' } }],
            },
        },
      },
      {
        id: 'tester',
        label: 'tester',
        agentTemplateId: 'test-writer',
        count: 1,
      },
    ],
      routing: {
        topics: [
          { name: 'review.assignments', subscribers: ['reviewer'], ackPolicy: 'at_least_once' },
        ],
      },
      bus: { provider: 'local-sqlite', ackPolicy: 'at_least_once', retryLimit: 4, ttlMs: 120000 },
      memory: { enabled: true, promotion: 'manual', scopes: ['facts', 'decisions'] },
      policies: { maxAgents: 6, maxDepth: 3, tokenBudget: 200000, timeoutMs: 3600000, messageSizeLimit: 32768 },
      dependencies: {
        mcpServers: [{ kind: 'mcp-server', name: 'linear', optional: true }],
      },
      dialogs: {
        launch: {
          fields: [{ id: 'objective', label: 'Objective', type: 'textarea', required: true }],
        },
      },
      compat: { argusUi: '>=1.31.0' },
    });
  });

  it('rejects unsafe executable config, invalid topology, missing roles, and excessive policies', () => {
    expect(() => normalizeSwarmTemplateManifest({
      id: 'bad-topology',
      kind: 'swarm-template',
      topology: { type: 'ring' },
      roles: [{ id: 'a', agentTemplateId: 'a' }],
    })).toThrow(/unsupported swarm topology/i);

    expect(() => normalizeSwarmTemplateManifest({
      id: 'bad-edge',
      kind: 'swarm-template',
      topology: { type: 'mesh', edges: [{ from: 'a', to: 'missing' }] },
      roles: [{ id: 'a', agentTemplateId: 'a' }],
    })).toThrow(/unknown swarm role/i);

    expect(() => normalizeSwarmTemplateManifest({
      id: 'bad-role',
      kind: 'swarm-template',
      topology: { type: 'mesh' },
      roles: [{ id: 'runner', agentTemplateId: 'agent', remoteUrl: 'https://example.com/agent.js' }],
    })).toThrow(/unsupported executable swarm key/i);

    expect(() => normalizeSwarmTemplateManifest({
      id: 'too-many',
      kind: 'swarm-template',
      topology: { type: 'mesh' },
      roles: [{ id: 'runner', agentTemplateId: 'agent' }],
      policies: { maxAgents: 101 },
    })).toThrow(/maxAgents/i);
  });
});
