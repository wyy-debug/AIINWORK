import { describe, expect, it } from 'vitest';

describe('obsidian hybrid retrieval service', () => {
  it('fuses semantic, keyword, active note, selected source, recency, and path reasons with stable provenance chunks', async () => {
    const service = await import('../obsidian-hybrid-retrieval-service.js');

    const result = service.buildSourceAwareObsidianContext({
      query: 'release rollback plan',
      maxSources: 3,
      maxTokensPerSource: 40,
      now: new Date('2026-05-19T02:00:00.000Z'),
      activeNote: {
        path: 'Argus/Wiki/App/Active.md',
        title: 'Active Plan',
        selection: 'Current rollback checklist.',
        modifiedAt: '2026-05-19T01:45:00.000Z',
      },
      selectedSources: ['Argus/Wiki/App/Manual.md'],
      semanticResults: [{
        path: 'Argus/Wiki/App/Manual.md',
        title: 'Manual Override',
        content: '# Manual Override\n\nSelected source content.\n\n## Rollback\nManual rollback steps.',
        score: 0.91,
        vaultName: 'Knowledge',
        modifiedAt: '2026-05-19T01:30:00.000Z',
        backlinks: ['Argus/Wiki/App/Active.md'],
      }, {
        path: 'Argus/Wiki/App/Archived.md',
        title: 'Archived',
        snippet: 'Do not include.',
        properties: { status: 'archived' },
      }],
      keywordResults: [{
        path: 'Argus/Wiki/App/Release.md',
        title: 'Release',
        snippet: 'Release plan includes rollback checks.',
        score: 0.62,
        vaultName: 'Knowledge',
        modifiedAt: '2026-05-18T02:00:00.000Z',
      }, {
        path: 'Argus/Wiki/Other/Noise.md',
        title: 'Noise',
        snippet: 'Other project note.',
        score: 0.99,
      }],
    });

    expect(result.sources.map((source) => source.path)).toEqual([
      'Argus/Wiki/App/Active.md',
      'Argus/Wiki/App/Manual.md',
      'Argus/Wiki/App/Release.md',
    ]);
    expect(result.sources[0]).toMatchObject({
      kind: 'active-note',
      headingPath: 'Active selection',
      reasons: expect.arrayContaining(['active-note']),
    });
    expect(result.sources[1]).toMatchObject({
      path: 'Argus/Wiki/App/Manual.md',
      vaultName: 'Knowledge',
      reasons: expect.arrayContaining(['semantic', 'selected-source', 'backlink']),
    });
    expect(result.sources[1].blockId).toMatch(/^obsidian-block:/);
    expect(result.context).toContain('Source: Knowledge / Argus/Wiki/App/Manual.md');
    expect(result.context).toContain('Reasons: semantic, selected-source, backlink');
    expect(result.context).toContain('Manual rollback steps.');
    expect(result.context).toContain('Release plan includes rollback checks.');
    expect(result.context).not.toContain('Do not include.');
    expect(result.context).not.toContain('Other project note.');
    expect(result.diagnostics.excludedCount).toBe(2);
  });
});
