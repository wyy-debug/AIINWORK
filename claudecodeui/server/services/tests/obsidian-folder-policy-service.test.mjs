import { describe, expect, it } from 'vitest';

describe('obsidian folder policy service', () => {
  it('defines current Wiki/Raw/Index/Archive folders and excludes AIMemory from default readback', async () => {
    const service = await import('../obsidian-folder-policy-service.js');

    const policy = service.buildObsidianFolderPolicy({ projectName: 'App' });

    expect(policy.currentFolders).toMatchObject({
      wiki: 'Argus/Wiki/App',
      raw: 'Argus/Raw/App',
      indexes: 'Argus/_Indexes',
      archive: 'Argus/Archive',
    });
    expect(policy.defaultReadableFolders).toEqual(['Argus/Wiki', 'Argus/_Indexes']);
    expect(policy.legacyReadOnlyFolders).toEqual(['Argus/AIMemory']);
  });

  it('validates folder settings and flags legacy AIMemory readback', async () => {
    const service = await import('../obsidian-folder-policy-service.js');

    const validation = service.validateObsidianFolderPolicy({
      readableVaultFolders: ['Argus/Wiki', 'Argus/_Indexes', 'Argus/AIMemory'],
      wikiFolder: 'Argus/Wiki',
      wikiRawFolder: 'Argus/Raw',
      wikiIndexFolder: 'Argus/_Indexes',
      wikiArchiveFolder: 'Argus/Archive',
    });

    expect(validation.status).toBe('needs-cleanup');
    expect(validation.states).toContain('legacy-aimemory-readback');
    expect(validation.repairActions.map((action) => action.id)).toContain('remove-aimemory-readback');
  });

  it('builds a dry-run migration plan without touching manually curated Wiki notes', async () => {
    const service = await import('../obsidian-folder-policy-service.js');

    const preview = service.previewObsidianLegacyMigration({
      notes: [{
        path: 'Argus/AIMemory/App/Preference.md',
        title: 'Preference',
        properties: { source: 'argus', type: 'ai-memory' },
      }, {
        path: 'Argus/Wiki/App/Manual.md',
        title: 'Manual',
        properties: { source: 'human', type: 'wiki-note' },
      }, {
        path: 'Argus/Projects/App/Old Generated.md',
        title: 'Old Generated',
        properties: { source: 'argus', kind: 'project-summary' },
      }],
      projectName: 'App',
    });

    expect(preview.dryRun).toBe(true);
    expect(preview.actions).toEqual([
      expect.objectContaining({
        action: 'relabel-legacy-aimemory',
        fromPath: 'Argus/AIMemory/App/Preference.md',
        toPath: 'Argus/Archive/Legacy/AIMemory/App/Preference.md',
      }),
      expect.objectContaining({
        action: 'move-generated-project-note',
        fromPath: 'Argus/Projects/App/Old Generated.md',
        toPath: 'Argus/Wiki/App/Old Generated.md',
      }),
    ]);
    expect(preview.skipped).toEqual([
      expect.objectContaining({
        path: 'Argus/Wiki/App/Manual.md',
        reason: 'manual-wiki-note',
      }),
    ]);
  });
});
