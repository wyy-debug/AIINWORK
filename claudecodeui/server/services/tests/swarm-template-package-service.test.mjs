import { describe, expect, it } from 'vitest';

import {
  exportSwarmTemplatePackage,
  importSwarmTemplatePackage,
  resolveSwarmRoleBindings,
} from '../swarm-template-package-service.js';

const manifest = {
  schemaVersion: 1,
  id: 'review-swarm',
  version: '1.0.0',
  kind: 'swarm-template',
  topology: { type: 'mesh', edges: [] },
  roles: [
    { id: 'queen', agentTemplateId: 'review-coordinator' },
    { id: 'reviewer', agentTemplateId: 'security-reviewer' },
  ],
  dialogs: {
    launch: {
      fields: [{ id: 'objective', label: 'Objective', type: 'textarea', required: true }],
    },
  },
  examples: [{ title: 'Safe example', transcript: [{ role: 'user', content: 'Review auth' }] }],
};

describe('swarm-template-package-service', () => {
  it('resolves role bindings against installed agents and bundled agent templates', () => {
    const result = resolveSwarmRoleBindings({
      manifest,
      installedAgents: [{ id: 'review-coordinator' }],
      bundledAgentTemplates: [{ id: 'security-reviewer' }],
    });

    expect(result.status).toBe('ready');
    expect(result.roles).toEqual([
      expect.objectContaining({ roleId: 'queen', agentTemplateId: 'review-coordinator', status: 'available' }),
      expect.objectContaining({ roleId: 'reviewer', agentTemplateId: 'security-reviewer', status: 'bundled' }),
    ]);
    expect(result.blockingMissing).toEqual([]);
  });

  it('marks missing required role bindings as draft blockers', () => {
    const result = resolveSwarmRoleBindings({
      manifest,
      installedAgents: [{ id: 'review-coordinator' }],
      bundledAgentTemplates: [],
    });

    expect(result.status).toBe('draft');
    expect(result.blockingMissing).toEqual([
      expect.objectContaining({ roleId: 'reviewer', agentTemplateId: 'security-reviewer', status: 'missing' }),
    ]);
  });

  it('exports and imports data-only swarm packages without real transcript history', () => {
    const exported = exportSwarmTemplatePackage({
      manifest,
      roleBindingResolution: { status: 'ready' },
      examples: manifest.examples,
      transcript: [{ role: 'user', content: 'real private history' }],
    });

    expect(exported).toMatchObject({
      kind: 'swarm-template-package',
      manifest: expect.objectContaining({ id: 'review-swarm', dialogs: manifest.dialogs }),
    });
    expect(JSON.stringify(exported)).not.toContain('real private history');

    const imported = importSwarmTemplatePackage(exported);
    expect(imported.manifest).toMatchObject({ id: 'review-swarm', kind: 'swarm-template' });
  });
});
