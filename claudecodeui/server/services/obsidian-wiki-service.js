import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { db as defaultDb } from '../database/db.js';

import {
  createArtifact as defaultCreateArtifact,
  exportArtifactToObsidianModes as defaultExportArtifactToObsidianModes,
  getArtifact as defaultGetArtifact,
  updateArtifactMetadata as defaultUpdateArtifactMetadata,
} from './artifact-service.js';
import { assessChatKnowledgeCapture } from './chat-knowledge-capture-service.js';
import {
  lintObsidianWiki as defaultLintObsidianWiki,
  readObsidianBridgeConfig as defaultReadObsidianBridgeConfig,
  sendObsidianWikiCompile as defaultSendObsidianWikiCompile,
  sendObsidianWikiIngest as defaultSendObsidianWikiIngest,
} from './obsidian-bridge-service.js';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.log',
  '.csv',
  '.json',
  '.jsonl',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
]);

const BINARY_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']);

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeWhitespace = (value) => readString(value).replace(/\s+/g, ' ');

const slug = (value = 'Untitled') => normalizeWhitespace(value)
  .replace(/[\\/]+/g, ' ')
  .replace(/\.\.+/g, ' ')
  .replace(/[<>:"|?*\x00-\x1f]/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^\.+|\.+$/g, '')
  .trim() || 'Untitled';

const titleFromName = (fileName = '') => {
  const baseName = path.basename(String(fileName || 'Imported file'));
  return slug(baseName.replace(/\.[^.]+$/, ''));
};

const hashText = (value) => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex')
  .slice(0, 16);

const safeJson = (value) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

const parseJson = (value) => {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const decodeUtf8 = (buffer) => buffer.toString('utf8').replace(/\u0000/g, '').trim();

const htmlToMarkdownText = (html = '') => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<\/(h1|h2|h3|p|li|tr|div|section)>/gi, '\n')
  .replace(/<h1[^>]*>/gi, '# ')
  .replace(/<h2[^>]*>/gi, '## ')
  .replace(/<h3[^>]*>/gi, '### ')
  .replace(/<li[^>]*>/gi, '- ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const csvToMarkdown = (csv = '') => {
  const rows = String(csv || '').split(/\r?\n/).map((line) => line.split(',').map((cell) => cell.trim())).filter((row) => row.some(Boolean));
  if (rows.length === 0) return '';
  const header = rows[0];
  const body = rows.slice(1, 80);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${header.map((_cell, index) => row[index] || '').join(' | ')} |`),
  ].join('\n');
};

export const extractWikiFileContent = async (file = {}) => {
  const filePath = readString(file.path || file.filePath);
  if (!filePath) {
    throw new Error('Uploaded file path is required.');
  }
  const name = readString(file.name) || path.basename(filePath);
  const extension = path.extname(name || filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);
  const title = titleFromName(name);

  if (TEXT_EXTENSIONS.has(extension) || /^text\//i.test(readString(file.mimeType))) {
    const raw = decodeUtf8(buffer);
    if (extension === '.html' || extension === '.htm') {
      return { title, content: htmlToMarkdownText(raw), extractionStatus: 'extracted', extension };
    }
    if (extension === '.json') {
      try {
        return {
          title,
          content: `\`\`\`json\n${JSON.stringify(JSON.parse(raw), null, 2)}\n\`\`\``,
          extractionStatus: 'extracted',
          extension,
        };
      } catch {
        return { title, content: raw, extractionStatus: 'extracted', extension };
      }
    }
    if (extension === '.csv') {
      return { title, content: csvToMarkdown(raw), extractionStatus: 'extracted', extension };
    }
    return { title, content: raw, extractionStatus: 'extracted', extension };
  }

  if (BINARY_DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      title,
      content: [
        `# ${title}`,
        '',
        `Argus 保存了原始文件元数据，但当前运行环境还没有可用的 ${extension.slice(1).toUpperCase()} 文本抽取器。`,
        '',
        `- 原始文件: ${filePath}`,
        `- MIME: ${readString(file.mimeType) || 'unknown'}`,
        `- Size: ${Number(file.size) || buffer.length}`,
      ].join('\n'),
      extractionStatus: 'extract_failed',
      extension,
    };
  }

  return {
    title,
    content: [
      `# ${title}`,
      '',
      'Argus 保存了原始文件元数据，但该文件类型暂不支持文本抽取。',
      '',
      `- 原始文件: ${filePath}`,
      `- MIME: ${readString(file.mimeType) || 'unknown'}`,
      `- Size: ${Number(file.size) || buffer.length}`,
    ].join('\n'),
    extractionStatus: 'extract_failed',
    extension,
  };
};

const positiveModesFromAssessment = (assessment = {}) => (
  Object.entries(assessment.routingScores || {})
    .filter(([, score]) => Number(score) > 0)
    .map(([mode]) => mode)
);

const classifyWikiSource = ({
  title = '',
  content = '',
  defaultMode = 'project-knowledge',
  routingRules = {},
  extractionStatus = 'extracted',
} = {}) => {
  if (extractionStatus !== 'extracted') {
    return {
      classificationMode: 'raw',
      classificationModes: [],
      classificationReason: '无法抽取正文，只保存 Raw 元数据。',
      routingScores: {},
      routingSignals: [],
      routingConfidence: 0,
    };
  }
  const assessment = assessChatKnowledgeCapture({
    content,
    userPrompt: title,
    defaultMode,
    routingRules,
  });
  const modes = assessment.shouldCapture
    ? assessment.routingModes || [assessment.routingMode || assessment.mode].filter(Boolean)
    : positiveModesFromAssessment(assessment);
  return {
    classificationMode: modes[0] || 'raw',
    classificationModes: [...new Set(modes)],
    classificationReason: assessment.routingReason || '已保存为 Raw，等待后续编译。',
    routingScores: assessment.routingScores || {},
    routingSignals: assessment.routingSignals || [],
    routingConfidence: assessment.routingConfidence || assessment.confidence || 0,
    memoryCapturePolicy: assessment.memoryCapturePolicy || 'not-memory',
  };
};

const buildCompiledContent = ({ title, content, rawPath }) => [
  `# ${title}`,
  '',
  '> Argus Wiki Compiler 根据 Raw source 自动生成。后续可以由 AI 继续精炼、拆分和补链。',
  '',
  '## 摘要',
  '',
  String(content || '').trim().slice(0, 8000),
  '',
  '## Sources',
  '',
  rawPath ? `- [[${path.basename(rawPath, '.md')}]]` : '- Raw source',
].join('\n');

export const createObsidianWikiService = ({
  db = defaultDb,
  createArtifact = defaultCreateArtifact,
  getArtifact = defaultGetArtifact,
  updateArtifactMetadata = defaultUpdateArtifactMetadata,
  sendObsidianWikiIngest = defaultSendObsidianWikiIngest,
  sendObsidianWikiCompile = defaultSendObsidianWikiCompile,
  lintObsidianWiki = defaultLintObsidianWiki,
  exportArtifactToObsidianModes = defaultExportArtifactToObsidianModes,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  findExistingImportByContentHash,
  now = () => new Date(),
} = {}) => {
  const defaultFindExistingImportByContentHash = (contentHash) => {
    if (!contentHash) return null;
    const row = db.prepare(`
      SELECT * FROM artifacts
      WHERE json_extract(COALESCE(metadata_json, '{}'), '$.source') = 'file-upload'
        AND json_extract(COALESCE(metadata_json, '{}'), '$.contentHash') = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(contentHash);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      projectName: row.project_name || '',
      sessionId: row.session_id || '',
      content: row.content || '',
      metadata: parseJson(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };
  const findExisting = findExistingImportByContentHash || defaultFindExistingImportByContentHash;

  const ingestUploadedFile = async ({
    file,
    projectName = '',
    sessionId = '',
    batchId = '',
  }) => {
    const extracted = await extractWikiFileContent(file);
    const config = readObsidianBridgeConfig();
    const contentHash = hashText([
      extracted.content,
      extracted.extractionStatus,
      readString(file.mimeType),
    ].join('\n'));
    const existing = findExisting(contentHash);
    if (existing) {
      return {
        duplicate: true,
        artifactId: existing.id,
        title: existing.title,
        rawPath: existing.metadata?.rawPath || '',
        wikiPath: existing.metadata?.wikiPath || '',
        wikiStatus: existing.metadata?.wikiStatus || 'compiled',
        contentHash,
      };
    }

    const classification = classifyWikiSource({
      title: extracted.title,
      content: extracted.content,
      defaultMode: config.defaultMode || 'project-knowledge',
      routingRules: config.routingRules || {},
      extractionStatus: extracted.extractionStatus,
    });
    const importBatchId = readString(batchId) || `import-${Date.now()}`;
    const sourcePath = readString(file.path || file.filePath);
    const artifactResult = await createArtifact({
      kind: 'wiki-source',
      title: extracted.title,
      projectName,
      sessionId,
      content: extracted.content,
      metadata: {
        source: 'file-upload',
        sourcePath,
        originalName: readString(file.name),
        mimeType: readString(file.mimeType),
        size: Number(file.size) || 0,
        importBatchId,
        contentHash,
        wikiStatus: 'raw',
        extractionStatus: extracted.extractionStatus,
        classificationMode: classification.classificationMode,
        classificationModes: classification.classificationModes,
        classificationReason: classification.classificationReason,
        routingMode: classification.classificationMode,
        routingModes: classification.classificationModes,
        routingScores: classification.routingScores,
        routingSignals: classification.routingSignals,
        routingReason: classification.classificationReason,
        routingConfidence: classification.routingConfidence,
      },
    }, {
      autoExport: false,
    });
    const artifact = artifactResult.artifact;

    let rawPath = '';
    let wikiPath = '';
    let obsidianBridge = null;
    let wikiLastError = '';

    try {
      const rawResult = await sendObsidianWikiIngest({
        title: extracted.title,
        content: extracted.content,
        projectName,
        sessionId,
        source: 'file-upload',
        sourcePath,
        importBatchId,
        contentHash,
        argusId: `wiki-source:${contentHash}`,
        extractionStatus: extracted.extractionStatus,
        classificationMode: classification.classificationMode,
        classificationReason: classification.classificationReason,
        tags: ['argus', 'raw', 'file-upload'],
      });
      rawPath = rawResult.path || rawResult.rawPath || '';

      let compileResult = null;
      if (extracted.extractionStatus === 'extracted') {
        compileResult = await sendObsidianWikiCompile({
          title: extracted.title,
          content: buildCompiledContent({
            title: extracted.title,
            content: extracted.content,
            rawPath,
          }),
          projectName,
          sessionId,
          source: 'file-upload',
          importBatchId,
          contentHash,
          rawPath,
          sourceIds: [artifact.id],
          compiledFrom: [artifact.id],
          argusId: `wiki:${contentHash}`,
          classificationMode: classification.classificationMode,
          classificationReason: classification.classificationReason,
          tags: ['argus', 'wiki'],
        });
      }
      wikiPath = compileResult?.path || compileResult?.wikiPath || '';
    } catch (error) {
      wikiLastError = error?.message || 'Failed to write Obsidian wiki source.';
    }

    const patch = {
      rawPath,
      wikiPath,
      wikiStatus: wikiLastError ? 'failed' : wikiPath ? 'compiled' : extracted.extractionStatus === 'extracted' ? 'failed' : 'raw',
      wikiLastError,
      compiledFrom: wikiPath ? [artifact.id] : [],
      classificationMode: classification.classificationMode,
      classificationModes: classification.classificationModes,
      classificationReason: classification.classificationReason,
      contentHash,
      importBatchId,
    };
    updateArtifactMetadata(artifact.id, patch);

    if (!wikiLastError && classification.classificationModes.length > 0) {
      try {
        obsidianBridge = await exportArtifactToObsidianModes({
          ...artifact,
          metadata: {
            ...artifact.metadata,
            ...patch,
            obsidianModes: classification.classificationModes,
            routingModes: classification.classificationModes,
            routingMode: classification.classificationMode,
            routingReason: classification.classificationReason,
          },
        }, {
          modes: classification.classificationModes,
          automatic: true,
        });
      } catch (error) {
        obsidianBridge = {
          destination: 'error',
          error: error?.message || 'Failed to export compiled wiki artifact.',
        };
      }
    }

    return {
      artifactId: artifact.id,
      title: extracted.title,
      rawPath,
      wikiPath,
      wikiStatus: patch.wikiStatus,
      contentHash,
      classificationMode: classification.classificationMode,
      classificationModes: classification.classificationModes,
      classificationReason: classification.classificationReason,
      extractionStatus: extracted.extractionStatus,
      obsidianBridge,
      error: wikiLastError,
    };
  };

  const ingestUploadedFilesToObsidian = async ({
    files = [],
    projectName = '',
    sessionId = '',
    batchId = '',
  } = {}) => {
    const importBatchId = readString(batchId) || `import-${now().toISOString().replace(/[:.]/g, '-')}`;
    const imported = [];
    for (const file of files) {
      imported.push(await ingestUploadedFile({
        file,
        projectName,
        sessionId,
        batchId: importBatchId,
      }));
    }
    return {
      success: true,
      importBatchId,
      imported,
    };
  };

  const compileWikiImport = async ({ artifactId = '' } = {}) => {
    if (!readString(artifactId)) {
      return {
        success: true,
        artifactId: '',
        wikiPath: '',
        rawPath: '',
        skipped: true,
        reason: 'No wiki import artifact selected.',
      };
    }
    const artifact = await getArtifact(artifactId, { includeContent: true });
    if (!artifact) {
      throw new Error('Wiki import artifact not found.');
    }
    const contentHash = artifact.metadata?.contentHash || hashText(artifact.content || artifact.id);
    const rawPath = artifact.metadata?.rawPath || '';
    const compileResult = await sendObsidianWikiCompile({
      title: artifact.title,
      content: buildCompiledContent({
        title: artifact.title,
        content: artifact.content || '',
        rawPath,
      }),
      projectName: artifact.projectName,
      sessionId: artifact.sessionId,
      source: artifact.metadata?.source || 'artifact',
      importBatchId: artifact.metadata?.importBatchId || '',
      contentHash,
      rawPath,
      sourceIds: [artifact.id],
      compiledFrom: [artifact.id],
      argusId: `wiki:${contentHash}`,
      classificationMode: artifact.metadata?.classificationMode || '',
      classificationReason: artifact.metadata?.classificationReason || '',
    });
    const wikiPath = compileResult.path || compileResult.wikiPath || '';
    updateArtifactMetadata(artifact.id, {
      wikiPath,
      wikiStatus: wikiPath ? 'compiled' : 'failed',
      compiledFrom: [artifact.id],
    });
    return {
      success: true,
      artifactId: artifact.id,
      wikiPath,
      rawPath,
    };
  };

  const lintWiki = async (payload = {}) => lintObsidianWiki(payload);

  const getWikiImportBatch = (importBatchId = '') => {
    const rows = db.prepare(`
      SELECT id, kind, title, project_name, session_id, metadata_json, created_at, updated_at
      FROM artifacts
      WHERE json_extract(COALESCE(metadata_json, '{}'), '$.importBatchId') = ?
      ORDER BY created_at ASC
    `).all(importBatchId);
    return {
      success: true,
      importBatchId,
      imports: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        projectName: row.project_name || '',
        sessionId: row.session_id || '',
        metadata: parseJson(row.metadata_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  };

  return {
    compileWikiImport,
    extractWikiFileContent,
    getWikiImportBatch,
    ingestUploadedFilesToObsidian,
    lintWiki,
  };
};

export const obsidianWikiService = createObsidianWikiService();

export const ingestUploadedFilesToObsidian = (...args) => obsidianWikiService.ingestUploadedFilesToObsidian(...args);
export const compileWikiImport = (...args) => obsidianWikiService.compileWikiImport(...args);
export const lintWiki = (...args) => obsidianWikiService.lintWiki(...args);
export const getWikiImportBatch = (...args) => obsidianWikiService.getWikiImportBatch(...args);
