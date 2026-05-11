import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { normalizeSwarmTemplateManifest } from '../swarm-template-manifest-service.js';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe('sample swarm-template package', () => {
  it('ships a valid first-party review swarm template', async () => {
    const manifestPath = join(repoRoot, '..', 'examples', 'swarm-templates', 'review-swarm-pack', 'manifest.json');
    const manifest = normalizeSwarmTemplateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));

    expect(manifest).toMatchObject({
      kind: 'swarm-template',
      id: 'review-swarm-pack',
      topology: { type: 'queen', coordinatorRoleId: 'queen' },
      bus: { provider: 'local-sqlite', ackPolicy: 'at_least_once' },
      memory: { enabled: true, promotion: 'manual' },
    });
    expect(manifest.roles.map((role) => role.id)).toEqual(['queen', 'security-reviewer', 'test-writer', 'summarizer']);
    expect(manifest.dialogs.launch?.presets?.[0]?.answers).toHaveProperty('objective');
  });

  it('ships a valid first-party map-reduce research swarm template', async () => {
    const manifestPath = join(repoRoot, '..', 'examples', 'swarm-templates', 'map-reduce-research-swarm', 'manifest.json');
    const manifest = normalizeSwarmTemplateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));

    expect(manifest).toMatchObject({
      kind: 'swarm-template',
      id: 'map-reduce-research-swarm',
      topology: { type: 'map_reduce' },
      memory: { enabled: true, promotion: 'manual' },
    });
    expect(manifest.roles.map((role) => role.id)).toEqual(['planner', 'researcher', 'synthesizer']);
    expect(manifest.routing.topics.map((topic) => topic.name)).toContain('research.assignments');
    expect(manifest.dialogs.launch?.presets?.[0]?.answers).toHaveProperty('research_question');
  });
});
