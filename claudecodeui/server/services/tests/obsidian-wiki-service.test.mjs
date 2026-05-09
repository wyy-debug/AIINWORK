import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  chunkWikiSourceContent,
  createObsidianWikiService,
  extractWikiFileContent,
} from '../obsidian-wiki-service.js';

const tempDir = () => mkdtemp(path.join(os.tmpdir(), 'argus-wiki-service-'));

const escapePdfText = (value = '') => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)');

const createTextPdfBuffer = (pages = []) => {
  const objects = new Map();
  const pageObjectRefs = [];
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((pageText, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    pageObjectRefs.push(`${pageObject} 0 R`);
    const lines = String(pageText || '').split('\n');
    const streamLines = [
      'BT',
      '/F1 12 Tf',
      '72 720 Td',
      ...lines.flatMap((line, lineIndex) => [
        lineIndex === 0 ? '' : '0 -18 Td',
        `(${escapePdfText(line)}) Tj`,
      ]).filter(Boolean),
      'ET',
    ];
    const stream = streamLines.join('\n');
    objects.set(pageObject, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.set(contentObject, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectRefs.join(' ')}] /Count ${pageObjectRefs.length} >>`);

  let pdf = '%PDF-1.4\n';
  const maxObject = Math.max(...objects.keys());
  const offsets = [0];
  for (let objectNumber = 1; objectNumber <= maxObject; objectNumber += 1) {
    offsets[objectNumber] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${objectNumber} 0 obj\n${objects.get(objectNumber)}\nendobj\n`;
  }
  const startXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${maxObject + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let objectNumber = 1; objectNumber <= maxObject; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

describe('obsidian wiki service', () => {
  it('repairs placeholder small-model Wiki output before writing it to Obsidian', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Review.md');
    await writeFile(filePath, [
      '# GPUScene Review',
      '',
      'The review found serious lifetime risks, missing disposal ownership, and render-thread scheduling pressure.',
      '- Critical issue: NativeArray ownership is unclear.',
      '- Performance risk: upload batches create transient allocations.',
      '- Recommendation: split scheduling from mesh processing.',
    ].join('\n'), 'utf8');
    const compileWrites = [];
    const metadataPatches = [];
    const calls = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-review',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((_artifactId, patch) => {
        metadataPatches.push(patch);
        return patch;
      }),
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: [] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async (request) => {
        calls.push(request);
        if (request.purpose === 'wiki-upload-chunk-summary') {
          return {
            success: true,
            model: 'gpt-5.4-mini',
            json: {
              summary: 'GPUScene review identifies lifetime and scheduling risks.',
              keyFacts: ['NativeArray ownership is unclear.'],
              decisions: ['Split scheduling from mesh processing.'],
              implementationDetails: ['Upload batches create transient allocations.'],
              openQuestions: ['Which system owns disposal?'],
            },
          };
        }
        if (request.purpose === 'wiki-upload-final-compile') {
          expect(request.userPrompt).toContain('"summaryType":"technical-review"');
          expect(request.systemPrompt).toMatch(/technical review/i);
          return {
            success: true,
            model: 'gpt-5.4-mini',
            json: {
              markdown: [
                '# GPUScene Review',
                '',
                '## Summary',
                '- Pending compiler refinement.',
                '',
                '## Sources',
                '- Raw source',
              ].join('\n'),
            },
          };
        }
        expect(request.purpose).toBe('wiki-upload-quality-repair');
        return {
          success: true,
          model: 'gpt-5.4-mini',
          json: {
            markdown: [
              '# GPUScene Review',
              '',
              '## Summary',
              'GPUScene has concrete lifetime, scheduling, and allocation risks that should be fixed before broad rollout.',
              '',
              '## Critical Issues',
              '- NativeArray ownership is unclear.',
              '',
              '## Architecture Risks',
              '- Scheduling and mesh processing are coupled.',
              '',
              '## Performance/Stability Risks',
              '- Upload batches create transient allocations.',
              '',
              '## Recommendations',
              '- P1: split scheduling from mesh processing.',
              '',
              '## Affected Modules',
              '- GPUScene renderer',
              '',
              '## Sources',
              '- Raw source',
            ].join('\n'),
          },
        };
      }),
      now: () => new Date('2026-05-08T09:10:11.000Z'),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'quality-batch',
      summaryType: 'technical-review',
      files: [{ name: 'Review.md', path: filePath, size: 500, mimeType: 'text/markdown' }],
    });

    expect(calls.map((call) => call.purpose)).toContain('wiki-upload-quality-repair');
    expect(compileWrites[0]).toMatchObject({
      summaryType: 'technical-review',
      compileQualityStatus: 'repaired',
      compileRepairAttempts: 1,
      content: expect.stringContaining('Critical Issues'),
    });
    expect(compileWrites[0].content).not.toMatch(/Pending compiler refinement|待后续|待补充/);
    expect(metadataPatches.at(-1)).toMatchObject({
      summaryType: 'technical-review',
      compileQualityStatus: 'repaired',
      compileRepairAttempts: 1,
    });
    expect(result.imported[0]).toMatchObject({
      summaryType: 'technical-review',
      compileQualityStatus: 'repaired',
      wikiStatus: 'compiled',
    });
  });

  it('marks unrepairable placeholder output as needs-review without writing pure placeholders', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'NeedsReview.md');
    await writeFile(filePath, [
      '# Needs Review',
      '',
      'Renderer review: bucket pooling reduces allocations, but ownership and disposal order need confirmation.',
    ].join('\n'), 'utf8');
    const compileWrites = [];
    const metadataPatches = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-needs-review',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((_artifactId, patch) => {
        metadataPatches.push(patch);
        return patch;
      }),
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: [] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async (request) => {
        if (request.purpose === 'wiki-upload-chunk-summary') {
          return { success: true, model: 'gpt-5.4-mini', json: { summary: 'Renderer review.', keyFacts: [] } };
        }
        return {
          success: true,
          model: 'gpt-5.4-mini',
          json: { markdown: '# Needs Review\n\n## Summary\n- Pending compiler refinement.\n\n## Sources\n- Raw source' },
        };
      }),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'needs-review-batch',
      files: [{ name: 'NeedsReview.md', path: filePath, size: 120, mimeType: 'text/markdown' }],
    });

    expect(compileWrites[0]).toMatchObject({
      compileQualityStatus: 'needs-review',
      compileRepairAttempts: 1,
    });
    expect(compileWrites[0].content).toContain('bucket pooling reduces allocations');
    expect(compileWrites[0].content).not.toMatch(/Pending compiler refinement|待后续|待补充/);
    expect(metadataPatches.at(-1)).toMatchObject({
      wikiStatus: 'needs-review',
      compileQualityStatus: 'needs-review',
      compileRepairAttempts: 1,
    });
    expect(result.imported[0]).toMatchObject({
      wikiStatus: 'needs-review',
      compileQualityStatus: 'needs-review',
    });
  });

  it('chunks long uploaded sources for small-model Wiki compilation', () => {
    const content = Array.from({ length: 15 }, (_item, index) => `Section ${index}\n${'x'.repeat(1000)}`).join('\n\n');

    const chunks = chunkWikiSourceContent(content, {
      chunkChars: 3000,
      maxChunks: 3,
      overlapChars: 100,
    });

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.text.length <= 3100)).toBe(true);
    expect(chunks[0]).toMatchObject({ index: 1, total: 3, truncated: true });
    expect(chunks.at(-1)).toMatchObject({ index: 3, total: 3, truncated: true });
  });

  it('uses small-model chunk summaries and final merge when compiling uploaded markdown', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'LongDesign.md');
    const longContent = Array.from({ length: 9 }, (_item, index) => [
      `## Section ${index}`,
      `Durable design decision ${index}.`,
      'project implementation reading notes',
      'A'.repeat(1400),
    ].join('\n')).join('\n\n');
    await writeFile(filePath, longContent, 'utf8');

    const completeJsonCalls = [];
    const compileWrites = [];
    const metadataPatches = [];
    const createdArtifacts = [];
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
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: ['Argus/Projects/App/Index.md'] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async (request) => {
        completeJsonCalls.push(request);
        expect(request.timeoutMs).toBeGreaterThanOrEqual(20000);
        if (request.purpose === 'wiki-upload-chunk-summary') {
          const parsed = JSON.parse(request.userPrompt);
          expect(parsed.chunkText.length).toBeLessThanOrEqual(6200);
          expect(request.userPrompt).not.toContain(longContent);
          return {
            success: true,
            model: 'mimo-flash',
            json: {
              summary: `Summary for chunk ${parsed.chunkIndex}`,
              keyFacts: [`Fact ${parsed.chunkIndex}`],
              decisions: [`Decision ${parsed.chunkIndex}`],
              implementationDetails: [`Detail ${parsed.chunkIndex}`],
              openQuestions: [`Question ${parsed.chunkIndex}`],
              tags: ['argus', 'upload'],
              relatedTopics: ['GPUScene'],
            },
          };
        }
        expect(request.purpose).toBe('wiki-upload-final-compile');
        expect(request.timeoutMs).toBeGreaterThanOrEqual(30000);
        expect(request.userPrompt).not.toContain(longContent);
        return {
          success: true,
          model: 'mimo-flash',
          json: {
            markdown: [
              '# LongDesign',
              '',
              '## 摘要',
              'Small model merged summary.',
              '',
              '## 关键事实',
              '- Fact 1',
              '',
              '## 决策/结论',
              '- Decision 1',
              '',
              '## 实现细节',
              '- Detail 1',
              '',
              '## 未解决问题',
              '- Question 1',
            ].join('\n'),
          },
        };
      }),
      now: () => new Date('2026-05-08T09:10:11.000Z'),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'small-model-batch',
      files: [{ name: 'LongDesign.md', path: filePath, size: longContent.length, mimeType: 'text/markdown' }],
    });

    expect(completeJsonCalls.filter((call) => call.purpose === 'wiki-upload-chunk-summary').length).toBeGreaterThan(1);
    expect(completeJsonCalls.at(-1)).toMatchObject({ purpose: 'wiki-upload-final-compile' });
    expect(compileWrites[0]).toMatchObject({
      compiler: 'small-model',
      compileStrategy: 'quality',
      wikiCompileChunks: expect.any(Number),
      wikiCompileModel: 'mimo-flash',
      content: expect.stringContaining('Small model merged summary.'),
    });
    expect(result.imported[0]).toMatchObject({
      wikiCompiler: 'small-model',
      wikiCompileStrategy: 'quality',
      wikiCompileChunks: expect.any(Number),
      wikiCompileFallbackReason: '',
    });
    expect(metadataPatches.at(-1).patch).toMatchObject({
      wikiCompiler: 'small-model',
      wikiCompileStrategy: 'quality',
      wikiCompileModel: 'mimo-flash',
      wikiCompileFallbackReason: '',
    });
  });

  it('falls back to deterministic compilation when small-model upload compilation fails', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Fallback.md');
    await writeFile(filePath, '# Fallback\n\nDurable project summary and implementation notes.', 'utf8');
    const compileWrites = [];
    const metadataPatches = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-fallback',
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
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: [] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async () => ({ success: false, reason: 'timeout' })),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'fallback-batch',
      files: [{ name: 'Fallback.md', path: filePath, size: 62, mimeType: 'text/markdown' }],
    });

    expect(compileWrites[0]).toMatchObject({
      compiler: 'deterministic',
      compileStrategy: 'quality',
      wikiCompileFallbackReason: 'chunk_summary_timeout',
      content: expect.stringContaining('Durable project summary'),
    });
    expect(result.imported[0]).toMatchObject({
      wikiCompiler: 'deterministic',
      wikiCompileFallbackReason: 'chunk_summary_timeout',
    });
    expect(metadataPatches.at(-1).patch).toMatchObject({
      wikiCompiler: 'deterministic',
      wikiCompileFallbackReason: 'chunk_summary_timeout',
    });
  });

  it('deterministic fallback still creates a useful summary instead of placeholder-only sections', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'UsefulFallback.md');
    await writeFile(filePath, [
      '# Useful Fallback',
      '',
      'This review says the renderer should split upload scheduling from mesh processing.',
      '',
      '- Key fact: bucket pooling reduces transient allocations.',
      '- Decision: keep the GPU streaming path behind a feature flag.',
      '- Open question: whether free list reuse is safe across scenes.',
    ].join('\n'), 'utf8');
    const compileWrites = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-useful-fallback',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((_artifactId, patch) => patch),
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: [] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async () => ({ success: false, reason: 'not_configured' })),
    });

    await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'useful-fallback-batch',
      files: [{ name: 'UsefulFallback.md', path: filePath, size: 200, mimeType: 'text/markdown' }],
    });

    expect(compileWrites[0].content).toContain('## 摘要');
    expect(compileWrites[0].content).toContain('renderer should split upload scheduling');
    expect(compileWrites[0].content).toContain('bucket pooling reduces transient allocations');
    expect(compileWrites[0].content).toContain('feature flag');
    expect(compileWrites[0].content).not.toContain('待后续编译器继续提炼');
  });

  it('retries a transient chunk failure before falling back from small-model compilation', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Retry.md');
    const longContent = Array.from({ length: 5 }, (_item, index) => `## Retry ${index}\n${'r'.repeat(1600)}`).join('\n\n');
    await writeFile(filePath, longContent, 'utf8');
    const calls = [];
    const compileWrites = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-retry',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((_artifactId, patch) => patch),
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: [] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async (request) => {
        calls.push(request);
        if (request.purpose === 'wiki-upload-chunk-summary' && calls.length === 1) {
          return { success: false, reason: 'timeout' };
        }
        if (request.purpose === 'wiki-upload-chunk-summary') {
          const parsed = JSON.parse(request.userPrompt);
          return {
            success: true,
            model: 'gpt-5.4-mini',
            json: {
              summary: `Recovered chunk ${parsed.chunkIndex}`,
              keyFacts: [`Recovered fact ${parsed.chunkIndex}`],
            },
          };
        }
        return {
          success: true,
          model: 'gpt-5.4-mini',
          json: { markdown: '# Retry\n\n## 摘要\nRecovered final compile.' },
        };
      }),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'retry-batch',
      files: [{ name: 'Retry.md', path: filePath, size: longContent.length, mimeType: 'text/markdown' }],
    });

    expect(calls.filter((call) => call.purpose === 'wiki-upload-chunk-summary')).toHaveLength(3);
    expect(compileWrites[0]).toMatchObject({
      compiler: 'small-model',
      wikiCompileModel: 'gpt-5.4-mini',
      wikiCompileFallbackReason: '',
      content: expect.stringContaining('Recovered final compile.'),
    });
    expect(result.imported[0]).toMatchObject({
      wikiCompiler: 'small-model',
      wikiCompileFallbackReason: '',
    });
  });

  it('keeps successful chunk summaries as a partial Wiki page when a later chunk keeps failing', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Partial.md');
    const longContent = Array.from({ length: 6 }, (_item, index) => `## Partial ${index}\n${'p'.repeat(1800)}`).join('\n\n');
    await writeFile(filePath, longContent, 'utf8');
    const compileWrites = [];

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-partial',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((_artifactId, patch) => patch),
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: [] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async (request) => {
        if (request.purpose === 'wiki-upload-chunk-summary') {
          const parsed = JSON.parse(request.userPrompt);
          if (parsed.chunkIndex > 1) return { success: false, reason: 'timeout' };
          return {
            success: true,
            model: 'gpt-5.4-mini',
            json: {
              summary: 'First chunk summary survives.',
              keyFacts: ['First chunk fact'],
              decisions: ['First chunk decision'],
              implementationDetails: ['First chunk detail'],
              openQuestions: ['First chunk question'],
            },
          };
        }
        throw new Error('final compile should not run after partial chunk failure');
      }),
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'partial-batch',
      files: [{ name: 'Partial.md', path: filePath, size: longContent.length, mimeType: 'text/markdown' }],
    });

    expect(compileWrites[0]).toMatchObject({
      compiler: 'small-model',
      wikiCompileFallbackReason: 'partial_chunk_summary_timeout',
      content: expect.stringContaining('First chunk summary survives.'),
    });
    expect(compileWrites[0].content).not.toContain('待后续编译器继续提炼');
    expect(result.imported[0]).toMatchObject({
      wikiCompiler: 'small-model',
      wikiCompileFallbackReason: 'partial_chunk_summary_timeout',
      wikiCompileChunks: 1,
    });
  });

  it('respects the Wiki Compiler switch by keeping extracted uploads as Raw only when disabled', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'RawOnly.md');
    await writeFile(filePath, '# RawOnly\n\nDurable note.', 'utf8');
    const compile = vi.fn();
    const completeJson = vi.fn();

    const service = createObsidianWikiService({
      createArtifact: vi.fn(async (payload) => ({
        artifact: {
          id: 'artifact-raw-only',
          kind: payload.kind,
          title: payload.title,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          content: payload.content,
          metadata: payload.metadata,
        },
      })),
      updateArtifactMetadata: vi.fn((_artifactId, patch) => patch),
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-08/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: compile,
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: [] })),
      findExistingImportByContentHash: vi.fn(() => null),
      readObsidianBridgeConfig: vi.fn(() => ({
        defaultMode: 'project-knowledge',
        wikiCompilerEnabled: false,
      })),
      completeSmallModelJson: completeJson,
    });

    const result = await service.ingestUploadedFilesToObsidian({
      projectName: 'App',
      batchId: 'raw-only-batch',
      files: [{ name: 'RawOnly.md', path: filePath, size: 24, mimeType: 'text/markdown' }],
    });

    expect(compile).not.toHaveBeenCalled();
    expect(completeJson).not.toHaveBeenCalled();
    expect(result.imported[0]).toMatchObject({
      rawPath: 'Argus/Raw/App/2026-05-08/RawOnly.md',
      wikiPath: '',
      wikiStatus: 'raw',
    });
  });

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
      completeSmallModelJson: vi.fn(async () => ({ success: false, reason: 'disabled' })),
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
      completeSmallModelJson: vi.fn(async () => ({ success: false, reason: 'disabled' })),
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

  it('extracts text-layer PDF uploads into paged Markdown', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Review.pdf');
    await writeFile(filePath, createTextPdfBuffer([
      'Argus PDF page one summary',
      'Argus PDF page two decisions',
    ]));

    const extracted = await extractWikiFileContent({
      name: 'Review.pdf',
      path: filePath,
      size: 1024,
      mimeType: 'application/pdf',
    });

    expect(extracted).toMatchObject({
      title: 'Review',
      extension: '.pdf',
      extractionStatus: 'extracted',
      extractionEngine: 'pdfjs-dist',
      pdfPageCount: 2,
      pdfExtractedPages: 2,
      pdfTruncated: false,
      extractionFailureReason: '',
    });
    expect(extracted.pdfExtractedChars).toBeGreaterThan(20);
    expect(extracted.content).toContain('# Review');
    expect(extracted.content).toContain('> PDF extracted by Argus');
    expect(extracted.content).toContain('## Page 1');
    expect(extracted.content).toContain('Argus PDF page one summary');
    expect(extracted.content).toContain('## Page 2');
    expect(extracted.content).toContain('Argus PDF page two decisions');
  });

  it('keeps extract-failed uploads in Raw without compiling a Wiki page', async () => {
    const root = await tempDir();
    const filePath = path.join(root, 'Legacy.pdf');
    await writeFile(filePath, Buffer.from([0x25, 0x50, 0x44, 0x46]));
    const compile = vi.fn();
    const completeJson = vi.fn();
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
      completeSmallModelJson: completeJson,
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
      extractionFailureReason: expect.any(String),
    });
    expect(compile).not.toHaveBeenCalled();
    expect(completeJson).not.toHaveBeenCalled();
    expect(metadataPatches.at(-1).patch).toMatchObject({
      rawPath: 'Argus/Raw/App/2026-05-08/Legacy.md',
      wikiPath: '',
      wikiStatus: 'raw',
      extractionFailureReason: expect.any(String),
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
      completeSmallModelJson: vi.fn(async () => ({ success: false, reason: 'disabled' })),
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
      completeSmallModelJson: vi.fn(async () => ({ success: false, reason: 'disabled' })),
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

  it('promotes numbered section titles to project Wiki topics for technical project notes', async () => {
    const createdArtifacts = [];
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
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-09/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async (payload) => {
        viewUpdates.push(payload);
        return { indexPaths: ['Argus/Projects/D--SOC-trunk/Index.md'] };
      }),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async () => ({ success: false, reason: 'disabled' })),
      now: () => new Date('2026-05-09T03:25:09.020Z'),
    });

    const result = await service.ingestKnowledgeSourceToWiki({
      source: 'artifact',
      sourceId: 'artifact-source',
      title: '1-分析目标与完成标准',
      projectName: 'D--SOC-trunk',
      sessionId: 'session-1',
      content: [
        'D--SOC-trunk 的 SocGraphics 是一个基于 Unity Graphics / Scriptable Render Pipeline 的大型图形库。',
        '本次项目分析覆盖目录、Packages、Tests、TestProjects、package.json、代码规模与关键子模块。',
        '结论包括 URP 是项目主渲染管线，风险最高区域是 HDRP、Shader Graph、VFX Graph。',
        '这是技术评审资料，包含架构风险、性能风险、稳定性风险和模块扫描结果。',
      ].join('\n'),
      metadata: {
        routingMode: 'second-brain',
        routingModes: ['second-brain'],
        routingReason: '命中 reflection，路由到第二大脑。',
      },
    });

    expect(compileWrites[0]).toMatchObject({
      title: 'D--SOC-trunk SocGraphics 分析目标与完成标准',
      topicKey: 'd-soc-trunk-socgraphics-分析目标与完成标准',
      argusId: 'wiki:D--SOC-trunk:d-soc-trunk-socgraphics-分析目标与完成标准',
      sourceHeading: '1-分析目标与完成标准',
      classificationMode: 'project-knowledge',
      viewModes: ['project-knowledge', 'second-brain'],
    });
    expect(viewUpdates[0]).toMatchObject({
      title: 'D--SOC-trunk SocGraphics 分析目标与完成标准',
      viewModes: ['project-knowledge', 'second-brain'],
    });
    expect(metadataPatches.at(-1).patch).toMatchObject({
      wikiTitle: 'D--SOC-trunk SocGraphics 分析目标与完成标准',
      sourceHeading: '1-分析目标与完成标准',
      topicKey: 'd-soc-trunk-socgraphics-分析目标与完成标准',
      classificationMode: 'project-knowledge',
      viewModes: ['project-knowledge', 'second-brain'],
    });
    expect(result).toMatchObject({
      topicKey: 'd-soc-trunk-socgraphics-分析目标与完成标准',
      wikiPath: 'Argus/Wiki/D--SOC-trunk/d-soc-trunk-socgraphics-分析目标与完成标准.md',
      viewModes: ['project-knowledge', 'second-brain'],
    });
  });

  it('uses small-model suggestWikiTopic before deterministic fallback for section-like titles', async () => {
    const createdArtifacts = [];
    const compileWrites = [];
    const topicSuggestCalls = [];
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
      sendObsidianWikiIngest: vi.fn(async (payload) => ({
        path: `Argus/Raw/${payload.projectName}/2026-05-09/${payload.title}.md`,
      })),
      sendObsidianWikiCompile: vi.fn(async (payload) => {
        compileWrites.push(payload);
        return { path: `Argus/Wiki/${payload.projectName}/${payload.topicKey}.md` };
      }),
      updateObsidianWikiViews: vi.fn(async () => ({ indexPaths: ['Argus/Projects/D--SOC-trunk/Index.md'] })),
      findExistingImportByContentHash: vi.fn(() => null),
      completeSmallModelJson: vi.fn(async (request) => {
        if (request.purpose === 'wiki-topic-suggest') {
          topicSuggestCalls.push(request);
          return {
            success: true,
            model: 'gpt-5.4-mini',
            json: {
              topicTitle: 'SocGraphics Render Pipeline Review',
              reason: 'The source is a project-level technical review of the SocGraphics render pipeline.',
            },
          };
        }
        return { success: false, reason: 'disabled' };
      }),
      now: () => new Date('2026-05-09T03:25:09.020Z'),
    });

    await service.ingestKnowledgeSourceToWiki({
      source: 'artifact',
      sourceId: 'artifact-source',
      title: '1-Completion Criteria',
      projectName: 'D--SOC-trunk',
      sessionId: 'session-1',
      content: [
        'D--SOC-trunk SocGraphics is a Unity SRP render pipeline package.',
        'The review covers architecture risks, performance risks, stability risks, and affected modules.',
        'URP is the main path; HDRP, Shader Graph, and VFX Graph are compatibility risk areas.',
      ].join('\n'),
    });

    expect(topicSuggestCalls).toHaveLength(1);
    expect(topicSuggestCalls[0]).toMatchObject({
      purpose: 'wiki-topic-suggest',
      timeoutMs: expect.any(Number),
      maxTokens: expect.any(Number),
    });
    expect(topicSuggestCalls[0].userPrompt).toContain('1-Completion Criteria');
    expect(compileWrites[0]).toMatchObject({
      title: 'D--SOC-trunk SocGraphics Render Pipeline Review',
      topicKey: 'd-soc-trunk-socgraphics-render-pipeline-review',
      argusId: 'wiki:D--SOC-trunk:d-soc-trunk-socgraphics-render-pipeline-review',
      wikiTopicSuggestedBy: 'small-model',
      wikiTopicSuggestionReason: 'The source is a project-level technical review of the SocGraphics render pipeline.',
    });
    expect(metadataPatches.at(-1).patch).toMatchObject({
      wikiTitle: 'D--SOC-trunk SocGraphics Render Pipeline Review',
      topicKey: 'd-soc-trunk-socgraphics-render-pipeline-review',
      wikiTopicSuggestedBy: 'small-model',
      wikiTopicSuggestionReason: 'The source is a project-level technical review of the SocGraphics render pipeline.',
    });
  });
});
