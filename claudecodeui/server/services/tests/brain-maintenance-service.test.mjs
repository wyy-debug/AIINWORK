import { describe, expect, it } from 'vitest';

import { createBrainMaintenanceService } from '../brain-maintenance-service.js';
import { createMemoryBrainStore } from './brain-test-store.mjs';

describe('Brain maintenance service', () => {
  it('exports and imports a schema-versioned package with integrity manifest', () => {
    const { store } = createMemoryBrainStore();
    const event = store.addEvent({
      sessionId: 'maintenance-1',
      projectName: 'Argus',
      eventType: 'command',
      title: 'Export Brain package',
      content: 'Export Brain package with integrity manifest.',
      refs: [{ refType: 'raw_text', refId: 'cmd', label: 'Command', content: 'raw command' }],
    });
    const atom = store.upsertAtom({
      sessionId: 'maintenance-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Export packages',
      summary: 'Export packages with checksums.',
      stableKey: 'decision:export',
      sourceEventIds: [event.id],
      refIds: event.refs.map((ref) => ref.id),
    });
    store.upsertScenario({
      sessionId: 'maintenance-1',
      projectName: 'Argus',
      scenarioKey: 'session:maintenance',
      title: 'Maintenance scenario',
      atomIds: [atom.id],
    });
    const maintenance = createBrainMaintenanceService({ store });

    const packageData = maintenance.exportPackage({ sessionId: 'maintenance-1', projectName: 'Argus' });
    expect(packageData.schemaVersion).toBe(2);
    expect(packageData.manifest.counts).toMatchObject({ events: 1, refs: 1, atoms: 1, scenarios: 1 });
    expect(packageData.manifest.integritySha256).toMatch(/^[a-f0-9]{64}$/);

    const { store: cleanStore } = createMemoryBrainStore();
    const imported = createBrainMaintenanceService({ store: cleanStore }).importPackage({ packageData });
    expect(imported).toMatchObject({ imported: true, integrityVerified: true });
    expect(cleanStore.exportSession({ sessionId: 'maintenance-1' }).atoms[0].id).toBe(atom.id);
  });

  it('previews retention per layer without deleting summaries', () => {
    const { store } = createMemoryBrainStore();
    for (let index = 0; index < 3; index += 1) {
      store.addEvent({
        sessionId: 'retention-1',
        projectName: 'Argus',
        eventType: 'tool_result',
        title: `Tool ${index}`,
        content: 'x'.repeat(80),
        refs: [{ refType: 'raw_text', refId: `raw-${index}`, label: `Raw ${index}`, content: 'x'.repeat(80) }],
      });
      store.upsertAtom({
        sessionId: 'retention-1',
        projectName: 'Argus',
        atomType: 'command',
        title: `Atom ${index}`,
        stableKey: `atom:${index}`,
      });
    }
    store.addCompaction({
      sessionId: 'retention-1',
      projectName: 'Argus',
      summary: 'Keep summary',
      currentGoal: 'Keep summary',
    });

    const preview = createBrainMaintenanceService({ store }).previewLayerRetention({
      sessionId: 'retention-1',
      projectName: 'Argus',
      rawRefsMaxSizeBytes: 100,
      perSessionMaxEvents: 1,
      maxAtoms: 2,
      maxScenarios: 1,
      maxCompactions: 1,
    });

    expect(preview.dryRun).toBe(true);
    expect(preview.layers.rawRefs.wouldPruneCount).toBeGreaterThan(0);
    expect(preview.layers.events.wouldDeleteCount).toBe(2);
    expect(preview.layers.atoms.wouldArchiveCount).toBe(1);
    expect(store.getLatestCompaction({ sessionId: 'retention-1' }).summary).toBe('Keep summary');
  });

  it('repairs sessions and reports broken atom/node ref edges', () => {
    const { store } = createMemoryBrainStore();
    store.addEvent({
      sessionId: 'repair-1',
      projectName: 'Argus',
      eventType: 'command',
      title: 'Repair Brain',
    });
    store.upsertAtom({
      sessionId: 'repair-1',
      projectName: 'Argus',
      atomType: 'decision',
      title: 'Broken atom edge',
      stableKey: 'decision:broken',
      refIds: ['missing-ref'],
    });
    store.upsertNode({
      id: 'brain_decision_broken',
      sessionId: 'repair-1',
      projectName: 'Argus',
      nodeType: 'decision',
      title: 'Broken node edge',
      refIds: ['missing-node-ref'],
    });

    const report = createBrainMaintenanceService({ store }).repairAndReport({
      sessionId: 'repair-1',
      projectName: 'Argus',
    });

    expect(report.repaired).toBe(true);
    expect(report.brokenEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerType: 'atom', refId: 'missing-ref' }),
      expect.objectContaining({ ownerType: 'node', refId: 'missing-node-ref' }),
    ]));
    expect(report.health.warnings).toContain('broken-ref-edges');
  });
});
