import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createObsidianWikiService } from '../obsidian-wiki-service.js';

const tempDir = () => mkdtemp(path.join(os.tmpdir(), 'argus-wiki-service-'));

describe('obsidian wiki service', () => {
  it('ingests uploaded markdown into Raw, compiles Wiki, exports matched modes, and stores trace metadata', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Design.md');
    await writeFile(filePath, '# GPU Scene Notes\n\n## Decision\nUse a streaming renderer.\n\n- project implementation\n- reading notes\n', 'utf8');

    const createdArtifacts = [];
    const metadataPatches = [];
    const rawWrites = [];
    const compileWrites = [];
    const modeExports = [];
    const viewUpdates = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => {
        const artifact = {
          id: `artifact-${createdArtifacts.length + 1}`,
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        };
        createdArtifacts.push({ payload, artifact });
        return { artifact, obsidianBridge: null };
      }),
      getArtifact: vi.fn(async (id) => createdArtifacts.find((entry) => entry.artifact.id === id)?.artifact || null),
      updateArtifactMetadata: vi.fn((artifactId, patch) => {
        metadataPatches.push({ artifactId, patch });
        const entry = createdArtifacts.find((candidate) => candidate.artifact.id === artifactId);
        entry.artifact.metadata = { ...entry.artifact.metadata, ...patch };
        return entry.artifact.metadata;
      }),
      sendObsidianWikiIngest: vi.fn(async (payload) => {
        rawWrites.push(payload);
        return { success: true, path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md` };
      }),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { success: true, path: `Argus/Wiki/${payload.projectName}/${payload.title}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async (payload) => {
        viewUpdates.push(payload);
        return { indexPaths: ['Argus/Projects/GPUScene/Index.md', 'Argus/SecondBrain/2026/Index.md'] };
      }),
      exportArtifactToObsidianModes: vi.fn(async (artifact, options) => {
        modeExports.push({ artifact, options });
        return { destination: 'obsidian', targets: options.modes.map((mode) => ({ mode, destination: 'obsidian' })) };
      }),
      findExistingImportByContentHash: vi.fn(() => null),
      now: () => new Date('2026-05-08T09:10:11.000Z'),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'GPUScene',
      sessionId: 'session-1',
      batchId: 'batch-1',
      files: [{ name: 'Design.md', path: filePath, size: 98, mimeType: 'text/markdown' }],
    });

    expect(result).toMatchObject({
      success: true,
      importBatchId: 'batch-1',
      imported: [
        expect.objectContaining({
          artifactId: 'artifact-1',
          rawPath: 'Argus/Raw/GPUScene/2026-05-08/Design.md',
          wikiPath: 'Argus/Wiki/GPUScene/Design.md',
          wikiStatus: 'compiled',
        }),
      ],
    });
    expect(createdArtifacts[0].payload).toMatchObject({
      kind: 'wiki-source',
      title: 'Design',
      projectName: 'GPUScene',
      metadata: expect.objectContaining({
        source: 'file-upload',
        importBatchId: 'batch-1',
        wikiStatus: 'raw',
        extractionStatus: 'extracted',
      }),
    });
    expect(rawWrites[0]).toMatchObject({
      title: 'Design',
      content: expect.stringContaining('Use a streaming renderer'),
      source: 'file-upload',
      importBatchId: 'batch-1',
      contentHash: expect.any(String),
    });
    expect(compileWrites[0]).toMatchObject({
      title: 'Design',
      compiledFrom: expect.arrayContaining(['artifact-1']),
      rawPath: 'Argus/Raw/GPUScene/2026-05-08/Design.md',
      content: expect.stringContaining('Use a streaming renderer'),
    });
    expect(modeExports).toHaveLength(0);
    expect(viewUpdates[0]).toMatchObject({
      wikiPath: 'Argus/Wiki/GPUScene/Design.md',
      viewModes: expect.arrayContaining(['project-knowledge', 'second-brain']),
    });
    expect(metadataPatches.at(-1).patch).toMatchObject({
      rawPath: 'Argus/Raw/GPUScene/2026-05-08/Design.md',
      wikiPath: 'Argus/Wiki/GPUScene/Design.md',
      wikiStatus: 'compiled',
      classificationMode: expect.any(String),
      classificationReason: expect.any(String),
      indexPaths: ['Argus/Projects/GPUScene/Index.md', 'Argus/SecondBrain/2026/Index.md'],
    });
  });

  it('uses contentHash idempotency for repeat uploaded files', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Notes.txt');
    await writeFile(filePath, 'same durable project summary', 'utf8');
    const existing = {
      id: 'artifact-existing',
      title: 'Notes',
      metadata: {
        contentHash: 'existing-hash',
        rawPath: 'Argus/Raw/App/2026-05-08/Notes.md',
        wikiPath: 'Argus/Wiki/App/Notes.md',
      },
    };
    const createArtifact = vi.fn();
    const sendObsidianWikiIngest = vi.fn();

    const service = createObsidianWikiService({
      createArtifact,
      sendObsidianWikiIngest,
      sendObsidianWikiCompile: vi.fn(),
      exportArtifactToObsidianModes: vi.fn(),
      updateArtifactMetadata: vi.fn(),
      findExistingImportByContentHash: vi.fn(() => existing),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'batch-repeat',
      files: [{ name: 'Notes.txt', path: filePath, size: 28, mimeType: 'text/plain' }],
    });

    expect(result.imported[0]).toMatchObject({
      duplicate: true,
      artifactId: 'artifact-existing',
      rawPath: 'Argus/Raw/App/2026-05-08/Notes.md',
      wikiPath: 'Argus/Wiki/App/Notes.md',
    });
    expect(createArtifact).not.toHaveBeenCalled();
    expect(sendObsidianWikiIngest).not.toHaveBeenCalled();
  });

  it('keeps extract-failed uploads in Raw without compiling a Wiki page', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Legacy.pdf');
    await writeFile(filePath, Buffer.from([0x25, 0x50, 0x44, 0x46]));
    const compile = vi.fn();
    const metadataPatches = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-pdf',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((artifactId, patch) => {
        metadataPatches.push({ artifactId, patch });
        return patch;
      }),
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: compile,
      updateObsidianWikiViews: vi.fn(),
      findExistingImportByContentHash: vi.fn(() => null),
      now: () => new Date('2026-05-08T09:10:11.000Z'),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'binary-batch',
      files: [{ name: 'Legacy.pdf', path: filePath, size: 4, mimeType: 'application/pdf' }],
    });

    expect(result.imported[0]).toMatchObject({
      artifactId: 'artifact-pdf',
      rawPath: 'Argus/Raw/App/2026-05-08/Legacy.md',
      wikiPath: '',
      wikiStatus: 'raw',
      extractionStatus: 'extract_failed',
    });
    expect(compile).not.toHaveBeenCalled();
    expect(metadataPatches.at(-1).patch).toMatchObject({
      rawPath: 'Argus/Raw/App/2026-05-08/Legacy.md',
      wikiPath: '',
      wikiStatus: 'raw',
    });
  });

  it('keeps the source artifact when Obsidian wiki writes fail', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Offline.md');
    await writeFile(filePath, '# Offline\n\nProject summary that should not be lost.', 'utf8');
    const metadataPatches = [];
    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-offline',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((artifactId, patch) => {
        metadataPatches.push({ artifactId, patch });
        return patch;
      }),
      sendObsidianWikiIngest: vi.fn(async () => {
        throw new Error('Obsidian is closed.');
      }),
      sendObsidianWikiCompile: vi.fn(),
      exportArtifactToObsidianModes: vi.fn(),
      findExistingImportByContentHash: vi.fn(() => null),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'offline-batch',
      files: [{ name: 'Offline.md', path: filePath, size: 48, mimeType: 'text/markdown' }],
    });

    expect(result.imported[0]).toMatchObject({
      artifactId: 'artifact-offline',
      wikiStatus: 'failed',
      error: 'Obsidian is closed.',
    });
    expect(metadataPatches.at(-1)).toMatchObject({
      artifactId: 'artifact-offline',
      patch: expect.objectContaining({
        wikiStatus: 'failed',
        wikiLastError: 'Obsidian is closed.',
      }),
    });
  });

  it('ingests arbitrary knowledge sources as one Wiki page plus multiple view indexes', async () => {
    const createdArtifacts = [];
    const rawWrites = [];
    const compileWrites = [];
    const viewUpdates = [];
    const metadataPatches = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => {
        const artifact = {
          id: `artifact-${createdArtifacts.length + 1}`,
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        };
        createdArtifacts.push({ payload, artifact });
        return { artifact };
      }),
      updateArtifactMetadata: vi.fn((artifactId, patch) => {
        metadataPatches.push({ artifactId, patch });
        const entry = createdArtifacts.find((candidate) => candidate.artifact.id === artifactId);
        entry.artifact.metadata = { ...entry.artifact.metadata, ...patch };
        return entry.artifact.metadata;
      }),
      sendObsidianWikiIngest: vi.fn(async (payload) => {
        rawWrites.push(payload);
        return { path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md` };
      }),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async (payload) => {
        viewUpdates.push(payload);
        return {
          indexPaths: [
            'Argus/Projects/App/Index.md',
            'Argus/SecondBrain/2026/Index.md',
          ],
        };
      }),
      findExistingImportByContentHash: vi.fn(() => null),
      now: () => new Date('2026-05-08T09:10:11.000Z'),
    });

    const result = await service.ingestKnowledgeSourceToWiki({
      source: 'chat-auto-capture',
      sourceId: 'chat:session-1:message-1',
      title: 'GPUScene Review',
      projectName: 'App',
      sessionId: 'session-1',
      content: [
        '# GPUScene Review',
        '',
        '- Summary: compile to one Wiki page.',
        '- Decision: Projects and SecondBrain are index views only.',
      ].join('\n'),
      metadata: {
        obsidianMode: 'project-knowledge',
        obsidianModes: ['project-knowledge', 'second-brain'],
        routingReason: 'Matched project implementation and idea.',
      },
    });

    expect(result).toMatchObject({
      success: true,
      destination: 'obsidian',
      artifactId: 'artifact-1',
      rawPath: 'Argus/Raw/App/2026-05-08/GPUScene Review.md',
      wikiPath: 'Argus/Wiki/App/gpuscene-review.md',
      indexPaths: ['Argus/Projects/App/Index.md', 'Argus/SecondBrain/2026/Index.md'],
      viewModes: ['project-knowledge', 'second-brain'],
    });
    expect(rawWrites[0]).toMatchObject({
      argusId: expect.stringMatching(/^wiki-source:/),
      source: 'chat-auto-capture',
      sourceId: 'chat:session-1:message-1',
    });
    expect(compileWrites[0]).toMatchObject({
      argusId: 'wiki:App:gpuscene-review',
      topicKey: 'gpuscene-review',
      viewModes: ['project-knowledge', 'second-brain'],
      sourceIds: expect.arrayContaining(['artifact-1', 'chat:session-1:message-1']),
    });
    expect(compileWrites[0].content).toContain('## 摘要');
    expect(compileWrites[0].content).toContain('## Sources');
    expect(viewUpdates[0]).toMatchObject({
      projectName: 'App',
      viewModes: ['project-knowledge', 'second-brain'],
      wikiPath: 'Argus/Wiki/App/gpuscene-review.md',
    });
    expect(metadataPatches.at(-1).patch).toMatchObject({
      wikiPath: 'Argus/Wiki/App/gpuscene-review.md',
      wikiStatus: 'compiled',
      viewModes: ['project-knowledge', 'second-brain'],
      indexPaths: ['Argus/Projects/App/Index.md', 'Argus/SecondBrain/2026/Index.md'],
    });
  });
});
