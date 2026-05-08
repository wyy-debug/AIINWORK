import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMemoryConfigStore = () => {
  const values = new Map();
  return {
    get: vi.fn((key) => values.get(key) || null),
    set: vi.fn((key, value) => {
      values.set(key, value);
    }),
  };
};

describe('obsidian memory service', () => {
  let service;
  let store;

  beforeEach(async () => {
    service = await import('../obsidian-memory-service.js');
    store = createMemoryConfigStore();
    service.setObsidianMemoryStoreForTests(store);
  });

  it('creates review candidates from Obsidian text without committing long-term memory', () => {
    const result = service.createMemoryCandidates({
      source: {
        vaultName: 'Self',
        path: 'Argus/Projects/App/Plan.md',
        title: 'Plan',
      },
      text: 'Preference: keep answers concise.\nDecision: use the Argus bridge.',
    });

    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'preference',
        status: 'pending',
        stableKey: expect.stringContaining('preference:'),
      }),
      expect.objectContaining({
        kind: 'decision',
        status: 'pending',
      }),
    ]));
    expect(store.set).toHaveBeenCalled();
  });

  it('dedupes identical stable keys and flags conflicting candidate text', () => {
    const first = service.createMemoryCandidates({
      candidates: [{
        kind: 'preference',
        text: 'Use concise answers.',
        stableKey: 'preference:answer-style',
        confidence: 0.9,
      }],
    }).candidates[0];
    const second = service.createMemoryCandidates({
      candidates: [{
        kind: 'preference',
        text: 'Use detailed answers.',
        stableKey: 'preference:answer-style',
        confidence: 0.9,
      }],
    }).candidates[0];

    expect(first.status).toBe('pending');
    expect(second.status).toBe('conflict');
    expect(service.listMemoryCandidates().candidates).toHaveLength(2);
  });

  it('commits accepted candidates to Obsidian AIMemory through Wiki', async () => {
    const candidate = service.createMemoryCandidates({
      candidates: [{
        kind: 'fact',
        text: 'Argus uses a self-hosted Obsidian bridge.',
        stableKey: 'fact:bridge',
        confidence: 0.88,
      }],
      source: { artifactId: 'artifact-1' },
    }).candidates[0];
    const sendObsidianDocument = vi.fn();
    const ingestKnowledgeSourceToWiki = vi.fn(async () => ({
      success: true,
      wikiPath: 'Argus/Wiki/App/fact - bridge.md',
      indexPaths: ['Argus/AIMemory/App/Index.md'],
    }));

    const result = await service.commitMemoryCandidates({
      candidateIds: [candidate.id],
      projectName: 'App',
    }, { sendObsidianDocument, ingestKnowledgeSourceToWiki });

    expect(sendObsidianDocument).not.toHaveBeenCalled();
    expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
      title: 'fact - bridge',
      source: 'ai-memory',
      projectName: 'App',
      content: 'Argus uses a self-hosted Obsidian bridge.',
      kind: 'fact',
      metadata: expect.objectContaining({
        memoryStableKey: 'fact:bridge',
        obsidianMode: 'ai-memory',
      }),
    }));
    expect(result.committed).toEqual([
      expect.objectContaining({ id: candidate.id, status: 'accepted' }),
    ]);
  });

  it('commits accepted candidates through the Wiki Compiler primary pipeline', async () => {
    const candidate = service.createMemoryCandidates({
      candidates: [{
        kind: 'preference',
        text: 'User prefers Wiki-first Obsidian storage.',
        stableKey: 'preference:wiki-first',
        confidence: 0.91,
      }],
      source: { artifactId: 'artifact-1', projectName: 'App' },
    }).candidates[0];
    const sendObsidianDocument = vi.fn(async () => {
      throw new Error('direct AIMemory write should not be used');
    });
    const ingestKnowledgeSourceToWiki = vi.fn(async () => ({
      success: true,
      destination: 'obsidian',
      rawPath: 'Argus/Raw/App/2026-05-08/preference - wiki-first.md',
      wikiPath: 'Argus/Wiki/App/preference - wiki-first.md',
      indexPaths: ['Argus/AIMemory/App/Index.md'],
      viewModes: ['ai-memory'],
    }));

    const result = await service.commitMemoryCandidates({
      candidateIds: [candidate.id],
      projectName: 'App',
    }, { sendObsidianDocument, ingestKnowledgeSourceToWiki });

    expect(sendObsidianDocument).not.toHaveBeenCalled();
    expect(ingestKnowledgeSourceToWiki).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ai-memory',
      title: 'preference - wiki-first',
      projectName: 'App',
      content: 'User prefers Wiki-first Obsidian storage.',
      metadata: expect.objectContaining({
        memoryStableKey: 'preference:wiki-first',
        obsidianMode: 'ai-memory',
        obsidianModes: ['ai-memory'],
      }),
    }));
    expect(result.committed).toEqual([
      expect.objectContaining({
        id: candidate.id,
        status: 'accepted',
        wikiPath: 'Argus/Wiki/App/preference - wiki-first.md',
      }),
    ]);
  });
});
