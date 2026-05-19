import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMemoryStore = () => {
  let value = '[]';
  return {
    get: vi.fn(() => value),
    set: vi.fn((_key, nextValue) => {
      value = nextValue;
    }),
  };
};

describe('obsidian wiki candidate service', () => {
  let service;

  beforeEach(async () => {
    service = await import('../obsidian-wiki-candidate-service.js');
    service.setObsidianWikiCandidateStoreForTests(createMemoryStore());
  });

  it('creates reviewable Wiki candidates with schema, target path, tags, backlinks, refs, and duplicate warnings', () => {
    const first = service.createWikiCandidates({
      candidates: [{
        text: '# Runtime Decision\n\nUse read-only Obsidian context. See [[Bridge Health]].',
        kind: 'decision',
        source: {
          projectName: 'App',
          sessionId: 'session-1',
          messageId: 'assistant-1',
          artifactId: 'artifact-1',
          provider: 'codex',
        },
      }],
    });
    const duplicate = service.createWikiCandidates({
      candidates: [{
        text: '# Runtime Decision\n\nUse read-only Obsidian context. See [[Bridge Health]].',
        kind: 'decision',
        source: { projectName: 'App', sessionId: 'session-1' },
      }],
    });

    expect(first.candidates[0]).toMatchObject({
      status: 'pending-review',
      title: 'Runtime Decision',
      summary: 'Use read-only Obsidian context. See [[Bridge Health]].',
      targetPath: 'Argus/Wiki/App/Runtime Decision.md',
      tags: ['argus', 'wiki', 'decision'],
      backlinks: ['Bridge Health'],
      sourceRefs: [
        expect.objectContaining({ type: 'message', id: 'assistant-1' }),
        expect.objectContaining({ type: 'artifact', id: 'artifact-1' }),
      ],
      frontmatter: expect.objectContaining({
        source: 'argus',
        project: 'App',
        createdBy: 'codex',
        confidence: 1,
        status: 'draft',
      }),
    });
    expect(duplicate.candidates[0].status).toBe('duplicate-warning');
    expect(duplicate.candidates[0].duplicateWarnings[0]).toMatchObject({
      reason: 'same-target-path',
      candidateId: first.candidates[0].id,
    });
  });

  it('edits, discards, and commits candidates without writing discarded entries', async () => {
    const created = service.createWikiCandidates({
      candidates: [{
        title: 'Release Notes',
        text: 'Release notes body.',
        kind: 'project',
        source: { projectName: 'App', provider: 'codex' },
      }],
    });
    const candidateId = created.candidates[0].id;

    expect(service.editWikiCandidate({
      candidateId,
      patch: {
        title: 'Release Notes Updated',
        targetPath: 'Argus/Wiki/App/Release Notes Updated.md',
        tags: ['release', 'wiki'],
      },
    }).candidate).toMatchObject({
      title: 'Release Notes Updated',
      targetPath: 'Argus/Wiki/App/Release Notes Updated.md',
      tags: ['release', 'wiki'],
    });
    expect(service.discardWikiCandidate({ candidateId }).candidate.status).toBe('discarded');

    const ingestKnowledgeSourceToWiki = vi.fn();
    const committed = await service.commitWikiCandidates({ candidateIds: [candidateId] }, { ingestKnowledgeSourceToWiki });

    expect(committed.committed).toEqual([]);
    expect(ingestKnowledgeSourceToWiki).not.toHaveBeenCalled();
  });
});
