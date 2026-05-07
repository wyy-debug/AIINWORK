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

  it('commits accepted candidates to Obsidian AIMemory', async () => {
    const candidate = service.createMemoryCandidates({
      candidates: [{
        kind: 'fact',
        text: 'Argus uses a self-hosted Obsidian bridge.',
        stableKey: 'fact:bridge',
        confidence: 0.88,
      }],
      source: { artifactId: 'artifact-1' },
    }).candidates[0];
    const sendObsidianDocument = vi.fn(async () => ({
      success: true,
      path: 'Argus/AIMemory/App/Bridge.md',
    }));

    const result = await service.commitMemoryCandidates({
      candidateIds: [candidate.id],
      projectName: 'App',
    }, { sendObsidianDocument });

    expect(sendObsidianDocument).toHaveBeenCalledWith(expect.objectContaining({
      title: 'fact - bridge',
      mode: 'ai-memory',
      projectName: 'App',
      kind: 'fact',
      confidence: 0.88,
      metadata: expect.objectContaining({
        memoryStableKey: 'fact:bridge',
      }),
    }));
    expect(result.committed).toEqual([
      expect.objectContaining({ id: candidate.id, status: 'accepted' }),
    ]);
  });
});
