import { describe, expect, it, vi } from 'vitest';

import { createBrainLegacyKnowledgeMigrationService } from '../brain-legacy-knowledge-migration-service.js';
import { createMemoryBrainStore } from './brain-test-store.mjs';

describe('Brain legacy knowledge migration service', () => {
  it('previews and imports Argus-known Obsidian-derived knowledge idempotently', async () => {
    const { store } = createMemoryBrainStore();
    const listLegacyCandidates = vi.fn(() => ([
      {
        id: 'wiki_1',
        title: 'Runtime Decision',
        summary: 'Use Brain as the built-in project memory layer.',
        kind: 'decision',
        status: 'pending-review',
        targetPath: 'Argus/Wiki/AIINWORK/Runtime Decision.md',
        tags: ['argus', 'wiki', 'decision'],
        confidence: 0.9,
        source: { projectName: 'AIINWORK', sessionId: 'session-1' },
        sourceRefs: [{ type: 'message', id: 'msg-1' }],
      },
      {
        id: 'wiki_discarded',
        title: 'Discarded',
        summary: 'Should not migrate.',
        status: 'discarded',
      },
    ]));
    const listArtifacts = vi.fn(async () => ([
      {
        id: 'artifact_1',
        title: 'Review Summary',
        kind: 'review',
        projectName: 'AIINWORK',
        sessionId: 'session-2',
        metadata: {
          wikiStatus: 'compiled',
          wikiPath: 'Argus/Wiki/AIINWORK/Review Summary.md',
          routingReason: 'manual review',
          tags: ['review'],
        },
      },
      {
        id: 'artifact_plain',
        title: 'Plain Result',
        projectName: 'AIINWORK',
        metadata: {},
      },
    ]));

    const service = createBrainLegacyKnowledgeMigrationService({
      store,
      listLegacyCandidates,
      listArtifacts,
    });

    const preview = await service.preview({ projectName: 'AIINWORK' });
    expect(preview).toMatchObject({
      dryRun: true,
      importableCount: 2,
      skippedCount: 2,
      sources: { wikiCandidates: 2, artifacts: 2 },
    });
    expect(preview.entries.map((entry) => entry.title)).toEqual([
      'Runtime Decision',
      'Review Summary',
    ]);

    const firstImport = await service.importKnowledge({ projectName: 'AIINWORK' });
    expect(firstImport).toMatchObject({ importedCount: 2, skippedCount: 2 });
    expect(store.listAtoms({ sessionId: 'legacy-knowledge', projectName: 'AIINWORK', status: '' })).toHaveLength(2);
    expect(store.getProjectProfile({ projectName: 'AIINWORK', profileType: 'legacy-knowledge' })?.summary)
      .toContain('Imported 2 legacy knowledge items');

    const secondImport = await service.importKnowledge({ projectName: 'AIINWORK' });
    expect(secondImport).toMatchObject({ importedCount: 0, alreadyImportedCount: 2 });
    expect(store.listAtoms({ sessionId: 'legacy-knowledge', projectName: 'AIINWORK', status: '' })).toHaveLength(2);
  });
});
