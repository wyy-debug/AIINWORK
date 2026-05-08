import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));
const core = require(resolve(currentDir, '..', 'core.cjs'));

const fixedDate = new Date('2026-05-07T04:05:06.000Z');

describe('argus bridge Obsidian core', () => {
  it('builds safe default paths for all output modes', () => {
    expect(core.buildDocumentPath({
      title: 'Sprint: Summary?',
      mode: 'project-knowledge',
      projectName: 'Argus UI',
    }, fixedDate)).toBe('Argus/Projects/Argus UI/Sprint Summary.md');

    expect(core.buildDocumentPath({
      title: 'Daily note',
      mode: 'second-brain',
    }, fixedDate)).toBe('Argus/SecondBrain/2026/Daily note.md');

    expect(core.buildDocumentPath({
      title: 'Preference index',
      mode: 'ai-memory',
      projectName: '',
    }, fixedDate)).toBe('Argus/AIMemory/General/Preference index.md');
  });

  it('builds safe Raw and Wiki paths for imported source files', () => {
    expect(core.buildWikiRawPath({
      title: '../../GPU: Notes?',
      projectName: '../GPUScene\\Test',
    }, fixedDate)).toBe('Argus/Raw/GPUScene Test/2026-05-07/GPU Notes.md');

    expect(core.buildWikiPath({
      title: 'Streaming Renderer',
      projectName: 'GPUScene',
    })).toBe('Argus/Wiki/GPUScene/Streaming Renderer.md');

    expect(core.buildWikiSchemaPath()).toBe('Argus/_Meta/Schema.md');
  });

  it('removes traversal and illegal characters from path segments', () => {
    const path = core.buildDocumentPath({
      title: '../../System: Plan?',
      mode: 'project-knowledge',
      projectName: '../Outside\\Vault',
    }, fixedDate);

    expect(path).toBe('Argus/Projects/Outside Vault/System Plan.md');
    expect(path).not.toContain('..');
    expect(path).not.toContain('\\');
  });

  it('formats Obsidian properties and document content', () => {
    const markdown = core.formatDocument({
      title: 'Sprint Summary',
      content: '# Sprint Summary\n\nDone.',
      mode: 'project-knowledge',
      projectName: 'Argus UI',
      sessionId: 'session-1',
      argusId: 'argus-note-1',
      kind: 'review-notes',
      status: 'final',
      sourceArtifactId: 'artifact-1',
      templateId: 'project-summary',
      related: ['ADR-1'],
      confidence: 0.91,
      tags: ['argus', 'summary'],
      metadata: { artifactId: 'artifact-1' },
    }, fixedDate);

    expect(markdown).toContain('---\n');
    expect(markdown).toContain('type: project-knowledge');
    expect(markdown).toContain('source: argus');
    expect(markdown).toContain('project: Argus UI');
    expect(markdown).toContain('sessionId: session-1');
    expect(markdown).toContain('argusId: argus-note-1');
    expect(markdown).toContain('kind: review-notes');
    expect(markdown).toContain('status: final');
    expect(markdown).toContain('sourceArtifactId: artifact-1');
    expect(markdown).toContain('templateId: project-summary');
    expect(markdown).toContain('related:\n  - ADR-1');
    expect(markdown).toContain('confidence: 0.91');
    expect(markdown).toContain('created: 2026-05-07T04:05:06.000Z');
    expect(markdown).toContain('updated: 2026-05-07T04:05:06.000Z');
    expect(markdown).toContain('tags:\n  - argus\n  - summary');
    expect(markdown).toContain('artifactId: artifact-1');
    expect(markdown).toContain('\n---\n\n# Sprint Summary\n\nDone.');
  });

  it('chooses a renamed path when a note already exists', () => {
    const existing = new Set([
      'Argus/Projects/App/Summary.md',
      'Argus/Projects/App/Summary 2.md',
    ]);

    expect(core.resolveUniquePath(
      'Argus/Projects/App/Summary.md',
      (candidate) => existing.has(candidate),
    )).toBe('Argus/Projects/App/Summary 3.md');
  });

  it('finds existing markdown files by argusId for update writes', () => {
    expect(core.findPathByArgusId([
      { path: 'Argus/Projects/App/Other.md', content: '---\nargusId: other\n---\n' },
      { path: 'Argus/Projects/App/Summary.md', content: '---\nargusId: argus-note-1\n---\nBody' },
    ], 'argus-note-1')).toBe('Argus/Projects/App/Summary.md');

    expect(core.findPathByArgusId([
      { path: 'Argus/Projects/App/Summary.md', content: 'No frontmatter' },
    ], 'argus-note-1')).toBeNull();
  });

  it('renders configured templates with document variables', () => {
    const markdown = core.formatDocument({
      title: 'Decision Log',
      content: 'Use the bridge.',
      mode: 'project-knowledge',
      projectName: 'Argus UI',
      templateId: 'decision',
      kind: 'architecture-decision',
    }, fixedDate, {
      templates: {
        decision: '# {{title}}\n\nProject: {{projectName}}\n\n{{content}}',
      },
    });

    expect(markdown).toContain('# Decision Log\n\nProject: Argus UI\n\nUse the bridge.');
  });

  it('builds a project index with links to project knowledge notes', () => {
    const index = core.buildProjectIndex({
      projectName: 'Argus UI',
      entries: [
        { path: 'Argus/Projects/Argus UI/Sprint Summary.md', title: 'Sprint Summary', kind: 'project-summary' },
        { path: 'Argus/Projects/Argus UI/ADR 1.md', title: 'ADR 1', kind: 'architecture-decision' },
      ],
    });

    expect(index).toContain('# Argus UI');
    expect(index).toContain('<!-- argus-bridge:index:start -->');
    expect(index).toContain('[[Sprint Summary|Sprint Summary]]');
    expect(index).toContain('project-summary');
  });

  it('builds Wiki-backed view indexes without duplicating the compiled note body', () => {
    const index = core.buildWikiViewIndex({
      mode: 'project-knowledge',
      projectName: 'GPUScene',
      entries: [
        {
          title: 'GPUScene Review',
          wikiPath: 'Argus/Wiki/GPUScene/GPUScene Review.md',
          rawPath: 'Argus/Raw/GPUScene/2026-05-08/GPUScene Review.md',
          kind: 'review-notes',
          classificationReason: 'Matched project implementation.',
        },
      ],
    });

    expect(index).toContain('# GPUScene');
    expect(index).toContain('<!-- argus-bridge:wiki-view:start -->');
    expect(index).toContain('[[GPUScene Review|GPUScene Review]]');
    expect(index).toContain('review-notes');
    expect(index).toContain('Matched project implementation.');
    expect(index).not.toContain('## 摘要');
    expect(index).not.toContain('Compiled page.');
  });

  it('filters search results to configured readable folders only', () => {
    const results = core.searchReadableFiles([
      { path: 'Argus/AIMemory/App/Prefs.md', content: '# Prefs\nUse concise answers.' },
      { path: 'Private/Journal.md', content: '# Prefs\nHidden.' },
      { path: 'Argus/Projects/App/Plan.md', content: '# Plan\nShip Obsidian bridge.' },
    ], {
      query: 'prefs',
      readableFolders: ['Argus/AIMemory'],
      limit: 10,
    });

    expect(results).toEqual([
      expect.objectContaining({
        path: 'Argus/AIMemory/App/Prefs.md',
        title: 'Prefs',
      }),
    ]);
  });

  it('extracts active note metadata from markdown content', () => {
    const note = core.extractNoteMetadata({
      vaultId: 'vault-1',
      vaultName: 'Knowledge',
      path: 'Argus/Projects/App/ADR-001.md',
      content: [
        '---',
        'type: decision',
        'project: App',
        'confidence: 0.82',
        'tags:',
        '  - argus',
        '  - architecture',
        'related:',
        '  - [[Session 1]]',
        '---',
        '# ADR 001',
        '',
        'See [[Project Index]] and [[Session 1]].',
        '## Context',
        'Details',
      ].join('\n'),
      selection: 'Details',
      cursor: { line: 14, ch: 3 },
    });

    expect(note).toMatchObject({
      vaultId: 'vault-1',
      vaultName: 'Knowledge',
      path: 'Argus/Projects/App/ADR-001.md',
      title: 'ADR 001',
      selection: 'Details',
      cursor: { line: 14, ch: 3 },
      sourceType: 'markdown',
    });
    expect(note.properties).toMatchObject({
      type: 'decision',
      project: 'App',
      confidence: 0.82,
      tags: ['argus', 'architecture'],
    });
    expect(note.headings).toEqual([
      { level: 1, text: 'ADR 001', line: 10 },
      { level: 2, text: 'Context', line: 13 },
    ]);
    expect(note.links).toEqual(['Session 1', 'Project Index']);
  });

  it('patches markdown headings and frontmatter without replacing the full note', () => {
    const source = [
      '---',
      'status: draft',
      'tags:',
      '  - argus',
      '---',
      '# Sprint',
      '',
      '## Summary',
      'Old summary.',
      '',
      '## Notes',
      'Keep this.',
      '',
      '## Summary',
      'Second summary.',
    ].join('\n');

    const appended = core.patchMarkdownContent(source, {
      operation: 'append-heading',
      heading: 'Notes',
      content: 'New note.',
    });
    expect(appended.content).toContain('## Notes\nKeep this.\n\nNew note.');

    const replaced = core.patchMarkdownContent(source, {
      operation: 'replace-heading',
      heading: 'Summary',
      occurrence: 2,
      content: 'Replacement.',
    });
    expect(replaced.content).toContain('## Summary\nOld summary.');
    expect(replaced.content).toContain('## Summary\nReplacement.');

    const withMissingHeading = core.patchMarkdownContent(source, {
      operation: 'append-heading',
      heading: 'Decisions',
      content: '- Ship bridge.',
      createHeading: true,
    });
    expect(withMissingHeading.content).toContain('\n## Decisions\n- Ship bridge.');

    const frontmatter = core.patchMarkdownContent(source, {
      operation: 'upsert-frontmatter',
      properties: {
        status: 'active',
        confidence: 0.9,
        related: ['[[ADR-001]]'],
      },
    });
    expect(frontmatter.content).toContain('status: active');
    expect(frontmatter.content).toContain('confidence: 0.9');
    expect(frontmatter.content).toContain('related:\n  - "[[ADR-001]]"');
    expect(frontmatter.content).toContain('# Sprint');
  });

  it('queries markdown, canvas, and excalidraw notes with structured filters', () => {
    const results = core.queryReadableFiles([
      {
        path: 'Argus/Projects/App/ADR-001.md',
        content: [
          '---',
          'type: decision',
          'project: App',
          'confidence: 0.82',
          'tags: [argus, architecture]',
          '---',
          '# ADR 001',
          'Use local bridge.',
          '## Decision',
          'Self-host plugin.',
        ].join('\n'),
      },
      {
        path: 'Argus/Projects/App/Board.canvas',
        content: JSON.stringify({
          nodes: [
            { id: 'a', type: 'text', text: 'Canvas decision node' },
            { id: 'b', type: 'file', file: 'Argus/Projects/App/ADR-001.md' },
          ],
          edges: [{ fromNode: 'a', toNode: 'b' }],
        }),
      },
      {
        path: 'Argus/Projects/App/Sketch.excalidraw.md',
        content: '# Sketch\n\nBridge diagram text',
      },
      {
        path: 'Private/Decision.md',
        content: '---\ntype: decision\nconfidence: 0.99\n---\nHidden',
      },
    ], {
      query: 'decision',
      readableFolders: ['Argus/Projects'],
      sourceTypes: ['markdown', 'canvas', 'excalidraw'],
      filters: [
        { field: 'type', op: 'eq', value: 'decision' },
        { field: 'confidence', op: 'gt', value: 0.7 },
        { field: 'tags', op: 'contains', value: 'argus' },
      ],
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: 'Argus/Projects/App/ADR-001.md',
      sourceType: 'markdown',
      title: 'ADR 001',
      properties: expect.objectContaining({
        type: 'decision',
        confidence: 0.82,
      }),
    });

    const indexed = core.queryReadableFiles([
      { path: 'Argus/Projects/App/Board.canvas', content: '{"nodes":[{"type":"text","text":"Canvas task"}]}' },
      { path: 'Argus/Projects/App/Sketch.excalidraw.md', content: '%%\n# Text Elements\nMemory map\n%%' },
    ], {
      query: 'map',
      readableFolders: ['Argus/Projects'],
      sourceTypes: ['canvas', 'excalidraw'],
      limit: 10,
    });

    expect(indexed.map((result) => result.sourceType)).toContain('excalidraw');
  });

  it('formats Raw and compiled Wiki notes with traceable properties', () => {
    const raw = core.formatWikiSourceDocument({
      title: 'Design',
      content: '# Design\nRaw source.',
      projectName: 'GPUScene',
      source: 'file-upload',
      importBatchId: 'batch-1',
      contentHash: 'abc123',
      sourcePath: 'C:/tmp/Design.md',
      classificationMode: 'project-knowledge',
      classificationReason: 'Matched project implementation.',
      argusId: 'wiki-source:abc123',
    }, fixedDate);

    expect(raw).toContain('type: raw-source');
    expect(raw).toContain('source: file-upload');
    expect(raw).toContain('project: GPUScene');
    expect(raw).toContain('importBatchId: batch-1');
    expect(raw).toContain('contentHash: abc123');
    expect(raw).toContain('wikiStatus: raw');
    expect(raw).toContain('# Design\nRaw source.');

    const compiled = core.formatWikiCompiledDocument({
      title: 'Design',
      content: '# Design\nCompiled page.',
      projectName: 'GPUScene',
      compiledFrom: ['artifact-1'],
      rawPath: 'Argus/Raw/GPUScene/2026-05-07/Design.md',
      sourceIds: ['artifact-1'],
      related: ['[[GPUScene Index]]'],
      argusId: 'wiki:GPUScene:Design',
    }, fixedDate);

    expect(compiled).toContain('type: wiki-note');
    expect(compiled).toContain('compiledFrom:\n  - artifact-1');
    expect(compiled).toContain('rawPath: Argus/Raw/GPUScene/2026-05-07/Design.md');
    expect(compiled).toContain('wikiStatus: compiled');
    expect(compiled).toContain('related:\n  - "[[GPUScene Index]]"');
  });

  it('lints wiki files for missing properties, uncompiled raw notes, duplicate topics, and broken links', () => {
    const result = core.lintWikiFiles([
      {
        path: 'Argus/Raw/App/2026-05-07/Source.md',
        content: '---\ntype: raw-source\ncontentHash: abc\nwikiStatus: raw\n---\n# Source',
      },
      {
        path: 'Argus/Wiki/App/Topic.md',
        content: '---\ntype: wiki-note\ncompiledFrom:\n  - artifact-1\nwikiStatus: compiled\n---\n# Topic\nSee [[Missing]].',
      },
      {
        path: 'Argus/Wiki/App/Topic 2.md',
        content: '---\ntype: wiki-note\ncompiledFrom:\n  - artifact-2\nwikiStatus: compiled\n---\n# Topic',
      },
      {
        path: 'Argus/Wiki/App/NoProps.md',
        content: '# NoProps',
      },
    ], {
      baseFolder: 'Argus',
    });

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'uncompiled-raw', path: 'Argus/Raw/App/2026-05-07/Source.md' }),
      expect.objectContaining({ type: 'broken-link', path: 'Argus/Wiki/App/Topic.md', target: 'Missing' }),
      expect.objectContaining({ type: 'duplicate-topic', title: 'Topic' }),
      expect.objectContaining({ type: 'missing-properties', path: 'Argus/Wiki/App/NoProps.md' }),
    ]));
  });

  it('appends to a daily note heading while preserving user content', () => {
    const created = core.appendToPeriodicContent('', {
      title: '2026-05-07',
      heading: 'Argus',
      content: '- Review notes',
    });
    expect(created).toContain('# 2026-05-07');
    expect(created).toContain('## Argus\n- Review notes');

    const appended = core.appendToPeriodicContent('# 2026-05-07\n\n## Journal\nHuman note.\n\n## Argus\nOld item.', {
      heading: 'Argus',
      content: 'New item.',
    });
    expect(appended).toContain('## Journal\nHuman note.');
    expect(appended).toContain('## Argus\nOld item.\n\nNew item.');
  });

  it('builds a knowledge graph from links, related properties, and project index entries', () => {
    const graph = core.buildKnowledgeGraph([
      {
        path: 'Argus/Projects/App/Index.md',
        content: '# App\n\n<!-- argus-bridge:index:start -->\n- [[ADR-001]]\n<!-- argus-bridge:index:end -->',
      },
      {
        path: 'Argus/Projects/App/ADR-001.md',
        content: '---\nrelated:\n  - [[Session 1]]\n---\n# ADR 001\nLinks to [[Project Index]].',
      },
      {
        path: 'Argus/Projects/App/Session 1.md',
        content: '# Session 1\nBacklink target.',
      },
    ], {
      readableFolders: ['Argus/Projects'],
      projectName: 'App',
    });

    expect(graph.nodes.map((node) => node.path)).toContain('Argus/Projects/App/ADR-001.md');
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'Argus/Projects/App/ADR-001.md', toTitle: 'Session 1', type: 'related' }),
      expect.objectContaining({ from: 'Argus/Projects/App/Index.md', toTitle: 'ADR-001', type: 'moc' }),
    ]));
    expect(graph.mocEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'ADR-001' }),
    ]));
  });

  it('plans duplicate note cleanup by retaining the latest note and archiving the rest', () => {
    const plan = core.planDuplicateArchives([
      {
        path: 'Argus/Projects/App/Summary.md',
        content: '---\nargusId: artifact:1\ncontentHash: hash-a\nupdated: 2026-05-07T10:00:00.000Z\n---\n# Summary',
        mtime: 1000,
      },
      {
        path: 'Argus/Projects/App/Summary 2.md',
        content: '---\nargusId: artifact:1\ncontentHash: hash-a\nupdated: 2026-05-07T11:00:00.000Z\n---\n# Summary',
        mtime: 2000,
      },
      {
        path: 'Argus/SecondBrain/2026/Idea.md',
        content: '---\nargusId: artifact:2\ncontentHash: hash-b\n---\n# Idea',
        mtime: 1500,
      },
    ], {
      archiveRoot: 'Argus/_duplicates',
      now: new Date('2026-05-07T12:00:00.000Z'),
    });

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({
      key: 'argusId:artifact:1',
      retainedPath: 'Argus/Projects/App/Summary 2.md',
    });
    expect(plan.moves).toEqual([
      expect.objectContaining({
        from: 'Argus/Projects/App/Summary.md',
        to: 'Argus/_duplicates/2026-05-07/Summary.md',
        retainedPath: 'Argus/Projects/App/Summary 2.md',
      }),
    ]);
  });
});
