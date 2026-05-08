import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { db as defaultDb } from '../database/db.js';
import { extractProjectDirectory as defaultExtractProjectDirectory } from '../projects.js';

import {
  createArtifact as defaultCreateArtifact,
  getArtifact as defaultGetArtifact,
  updateArtifactMetadata as defaultUpdateArtifactMetadata,
} from './artifact-service.js';
import { assessChatKnowledgeCapture } from './chat-knowledge-capture-service.js';
import {
  lintObsidianWiki as defaultLintObsidianWiki,
  readObsidianBridgeConfig as defaultReadObsidianBridgeConfig,
  sendObsidianWikiCompile as defaultSendObsidianWikiCompile,
  sendObsidianWikiIngest as defaultSendObsidianWikiIngest,
  updateObsidianWikiViews as defaultUpdateObsidianWikiViews,
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

const topicKeyFromTitle = (value = 'Untitled') => slug(value)
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 100) || 'untitled';

const projectKey = (value = '') => slug(value || 'General');

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

const buildCompiledContent = ({ title, content, rawPath, sourceIds = [] }) => [
  `# ${title}`,
  '',
  '> Argus Wiki Compiler 根据 Raw source 自动生成。后续可以由 AI 继续精炼、拆分和补链。',
  '',
  '## 摘要',
  '',
  String(content || '').trim().slice(0, 8000),
  '',
  '## 关键事实',
  '',
  '- 待后续编译器继续提炼。',
  '',
  '## 决策/结论',
  '',
  '- 待后续编译器继续提炼。',
  '',
  '## 未解决问题',
  '',
  '- 待补充。',
  '',
  '## Sources',
  '',
  rawPath ? `- [[${path.basename(rawPath, '.md')}]]` : '- Raw source',
  ...sourceIds.map((sourceId) => `- ${sourceId}`),
].join('\n');

const normalizeModes = (value, fallback = 'project-knowledge') => {
  const candidates = Array.isArray(value) ? value : [value];
  const modes = [];
  for (const mode of [...candidates, fallback]) {
    const clean = readString(mode);
    if (['project-knowledge', 'second-brain', 'ai-memory'].includes(clean) && !modes.includes(clean)) {
      modes.push(clean);
    }
  }
  return modes.length > 0 ? modes : ['project-knowledge'];
};

const writeWikiFallback = async ({
  projectRoot = '',
  projectName = '',
  title = '',
  content = '',
  metadata = {},
  reason = '',
} = {}) => {
  if (!projectRoot) {
    return '';
  }
  const folder = path.join(projectRoot, 'docs', 'knowledge', 'wiki-fallback', projectKey(projectName));
  await fs.mkdir(folder, { recursive: true });
  const filePath = path.join(folder, `${slug(title)}.md`);
  const now = new Date().toISOString();
  const frontmatter = [
    '---',
    'type: wiki-fallback',
    `project: ${projectKey(projectName)}`,
    `created: ${now}`,
    `updated: ${now}`,
    'obsidianFallback: true',
    `obsidianFallbackReason: ${JSON.stringify(reason || 'Obsidian wiki unavailable.')}`,
    metadata.contentHash ? `contentHash: ${metadata.contentHash}` : '',
    metadata.sourceId ? `sourceId: ${JSON.stringify(metadata.sourceId)}` : '',
    '---',
  ].filter(Boolean).join('\n');
  await fs.writeFile(filePath, `${frontmatter}\n\n${content}`, 'utf8');
  return filePath;
};

export const createObsidianWikiService = ({
  db = defaultDb,
  createArtifact = defaultCreateArtifact,
  getArtifact = defaultGetArtifact,
  updateArtifactMetadata = defaultUpdateArtifactMetadata,
  sendObsidianWikiIngest = defaultSendObsidianWikiIngest,
  sendObsidianWikiCompile = defaultSendObsidianWikiCompile,
  updateObsidianWikiViews = defaultUpdateObsidianWikiViews,
  lintObsidianWiki = defaultLintObsidianWiki,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  extractProjectDirectory = defaultExtractProjectDirectory,
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

  const resolveProjectRoot = async (projectName = '') => {
    if (!projectName) return '';
    try {
      return await extractProjectDirectory(projectName);
    } catch {
      return '';
    }
  };

  const ingestKnowledgeSourceToWiki = async ({
    artifact = null,
    source = 'artifact',
    sourceId = '',
    title = '',
    projectName = '',
    sessionId = '',
    content = '',
    kind = '',
    metadata = {},
    modes = [],
    topicKey = '',
    forceRecompile = false,
    projectRoot = '',
  } = {}) => {
    const sourceMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    const cleanContent = typeof content === 'string' ? content : artifact?.content || '';
    const cleanTitle = readString(title) || readString(artifact?.title) || 'Untitled';
    const cleanProjectName = readString(projectName) || readString(artifact?.projectName);
    const cleanSessionId = readString(sessionId) || readString(artifact?.sessionId);
    const cleanSource = readString(source) || readString(sourceMetadata.source) || 'artifact';
    const cleanSourceId = readString(sourceId) || readString(sourceMetadata.sourceId) || readString(artifact?.id);
    const contentHash = readString(sourceMetadata.contentHash) || hashText([
      cleanSource,
      cleanSourceId,
      normalizeWhitespace(cleanContent),
    ].join('\n'));
    const existing = !artifact && !forceRecompile ? findExisting(contentHash) : null;
    if (existing) {
      return {
        success: true,
        duplicate: true,
        destination: existing.metadata?.wikiPath ? 'obsidian' : 'not_sent',
        artifactId: existing.id,
        rawPath: existing.metadata?.rawPath || '',
        wikiPath: existing.metadata?.wikiPath || '',
        indexPaths: existing.metadata?.indexPaths || [],
        viewModes: existing.metadata?.viewModes || existing.metadata?.classificationModes || [],
        contentHash,
      };
    }

    const config = readObsidianBridgeConfig();
    const classification = classifyWikiSource({
      title: cleanTitle,
      content: cleanContent,
      defaultMode: sourceMetadata.obsidianMode || config.defaultMode || 'project-knowledge',
      routingRules: config.routingRules || {},
      extractionStatus: sourceMetadata.extractionStatus || 'extracted',
    });
    const viewModes = normalizeModes(
      modes.length > 0
        ? modes
        : sourceMetadata.obsidianModes || sourceMetadata.routingModes || classification.classificationModes,
      sourceMetadata.obsidianMode || classification.classificationMode || config.defaultMode || 'project-knowledge',
    );
    const selectedTopicKey = readString(topicKey) || readString(sourceMetadata.topicKey) || topicKeyFromTitle(cleanTitle);
    const artifactRecord = artifact || (await createArtifact({
      kind: readString(kind) || readString(sourceMetadata.kind) || classification.classificationMode || 'wiki-source',
      title: cleanTitle,
      projectName: cleanProjectName,
      sessionId: cleanSessionId,
      content: cleanContent,
      metadata: {
        ...sourceMetadata,
        source: cleanSource,
        sourceId: cleanSourceId,
        contentHash,
        wikiStatus: 'raw',
        classificationMode: classification.classificationMode,
        classificationModes: viewModes,
        classificationReason: sourceMetadata.routingReason || classification.classificationReason,
        routingMode: sourceMetadata.routingMode || classification.classificationMode,
        routingModes: viewModes,
        routingScores: sourceMetadata.routingScores || classification.routingScores,
        routingSignals: sourceMetadata.routingSignals || classification.routingSignals,
        routingReason: sourceMetadata.routingReason || classification.classificationReason,
        routingConfidence: sourceMetadata.routingConfidence || classification.routingConfidence,
        obsidianMode: viewModes[0],
        obsidianModes: viewModes,
        topicKey: selectedTopicKey,
      },
    }, { autoExport: false })).artifact;
    const sourceIds = [...new Set([artifactRecord?.id, cleanSourceId].map(readString).filter(Boolean))];

    let rawPath = '';
    let wikiPath = '';
    let indexPaths = [];
    let wikiLastError = '';
    let destination = 'obsidian';
    const extractionStatus = readString(sourceMetadata.extractionStatus) || 'extracted';
    const shouldCompile = extractionStatus === 'extracted' && normalizeWhitespace(cleanContent);

    try {
      const rawResult = await sendObsidianWikiIngest({
        title: cleanTitle,
        content: cleanContent,
        projectName: cleanProjectName,
        sessionId: cleanSessionId,
        source: cleanSource,
        sourceId: cleanSourceId,
        importBatchId: sourceMetadata.importBatchId || '',
        contentHash,
        argusId: `wiki-source:${contentHash}`,
        extractionStatus,
        classificationMode: classification.classificationMode,
        classificationModes: viewModes,
        classificationReason: sourceMetadata.routingReason || classification.classificationReason,
        tags: ['argus', 'raw', cleanSource],
      });
      rawPath = rawResult.path || rawResult.rawPath || '';

      if (shouldCompile) {
        const compileResult = await sendObsidianWikiCompile({
          title: cleanTitle,
          projectName: cleanProjectName,
          content: buildCompiledContent({
            title: cleanTitle,
            content: cleanContent,
            rawPath,
            sourceIds,
          }),
          sessionId: cleanSessionId,
          source: cleanSource,
          sourceId: cleanSourceId,
          importBatchId: sourceMetadata.importBatchId || '',
          contentHash,
          wikiPath,
          rawPath,
          rawPaths: rawPath ? [rawPath] : [],
          sourceIds,
          compiledFrom: sourceIds,
          topicKey: selectedTopicKey,
          argusId: `wiki:${projectKey(cleanProjectName)}:${selectedTopicKey}`,
          classificationMode: classification.classificationMode,
          classificationModes: viewModes,
          classificationReason: sourceMetadata.routingReason || classification.classificationReason,
          viewModes,
          kind: readString(kind) || readString(sourceMetadata.kind) || artifactRecord.kind || '',
          tags: ['argus', 'wiki'],
        });
        wikiPath = compileResult?.path || compileResult?.wikiPath || '';
        indexPaths = Array.isArray(compileResult?.indexPaths) ? compileResult.indexPaths : [];

        if (wikiPath && indexPaths.length === 0) {
          const viewResult = await updateObsidianWikiViews({
            title: cleanTitle,
            projectName: cleanProjectName,
            sessionId: cleanSessionId,
            wikiPath,
            rawPath,
            sourceIds,
            viewModes,
            classificationMode: classification.classificationMode,
            classificationModes: viewModes,
            classificationReason: sourceMetadata.routingReason || classification.classificationReason,
            kind: readString(kind) || readString(sourceMetadata.kind) || artifactRecord.kind || '',
          });
          indexPaths = Array.isArray(viewResult?.indexPaths) ? viewResult.indexPaths : [];
        }
      }
    } catch (error) {
      wikiLastError = error?.message || 'Failed to write Obsidian wiki source.';
      destination = 'fallback';
      const root = projectRoot || await resolveProjectRoot(cleanProjectName);
      rawPath = rawPath || await writeWikiFallback({
        projectRoot: root,
        projectName: cleanProjectName,
        title: cleanTitle,
        content: cleanContent,
        metadata: { ...sourceMetadata, contentHash, sourceId: cleanSourceId },
        reason: wikiLastError,
      });
    }

    const patch = {
      rawPath,
      wikiPath,
      wikiStatus: wikiLastError ? 'failed' : wikiPath ? 'compiled' : 'raw',
      wikiLastError,
      compiledFrom: wikiPath ? sourceIds : [],
      sourceIds,
      contentHash,
      topicKey: selectedTopicKey,
      classificationMode: classification.classificationMode,
      classificationModes: viewModes,
      classificationReason: sourceMetadata.routingReason || classification.classificationReason,
      viewModes,
      indexPaths,
      obsidianStatus: wikiLastError ? 'fallback' : 'synced',
      obsidianMode: viewModes[0],
      obsidianModes: viewModes,
      obsidianPath: wikiPath,
      obsidianFallbackPath: wikiLastError ? rawPath : '',
      obsidianLastError: wikiLastError,
      obsidianSyncedAt: wikiLastError ? '' : new Date().toISOString(),
    };
    updateArtifactMetadata(artifactRecord.id, patch);

    return {
      success: true,
      captured: true,
      destination,
      artifact: {
        ...artifactRecord,
        metadata: {
          ...(artifactRecord.metadata || {}),
          ...patch,
        },
      },
      artifactId: artifactRecord.id,
      rawPath,
      wikiPath,
      indexPaths,
      viewModes,
      contentHash,
      topicKey: selectedTopicKey,
      mode: viewModes[0],
      modes: viewModes,
      error: wikiLastError,
      obsidianBridge: {
        destination,
        rawPath,
        wikiPath,
        indexPaths,
        viewModes,
        path: wikiPath,
        fallbackPath: wikiLastError ? rawPath : '',
        error: wikiLastError,
        targets: viewModes.map((mode) => ({
          mode,
          destination,
          path: wikiPath,
          rawPath,
          indexPaths,
        })),
      },
    };
  };

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
    const result = await ingestKnowledgeSourceToWiki({
      source: 'file-upload',
      sourceId: sourcePath,
      title: extracted.title,
      projectName,
      sessionId,
      content: extracted.content,
      kind: 'wiki-source',
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
      modes: classification.classificationModes,
    });

    return {
      ...result,
      title: extracted.title,
      wikiStatus: result.error ? 'failed' : result.wikiPath ? 'compiled' : 'raw',
      classificationMode: classification.classificationMode,
      classificationModes: classification.classificationModes,
      classificationReason: classification.classificationReason,
      extractionStatus: extracted.extractionStatus,
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

  const compileWikiImport = async ({ artifactId = '', topicKey = '', forceRecompile = false } = {}) => {
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
    return ingestKnowledgeSourceToWiki({
      artifact,
      source: artifact.metadata?.source || 'artifact',
      sourceId: artifact.metadata?.sourceId || artifact.id,
      title: artifact.title,
      projectName: artifact.projectName,
      sessionId: artifact.sessionId,
      content: artifact.content || '',
      kind: artifact.kind,
      metadata: artifact.metadata || {},
      modes: artifact.metadata?.obsidianModes || artifact.metadata?.routingModes || [],
      topicKey,
      forceRecompile,
    });
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
    ingestKnowledgeSourceToWiki,
    ingestUploadedFilesToObsidian,
    lintWiki,
  };
};

export const obsidianWikiService = createObsidianWikiService();

export const ingestUploadedFilesToObsidian = (...args) => obsidianWikiService.ingestUploadedFilesToObsidian(...args);
export const ingestKnowledgeSourceToWiki = (...args) => obsidianWikiService.ingestKnowledgeSourceToWiki(...args);
export const compileWikiImport = (...args) => obsidianWikiService.compileWikiImport(...args);
export const lintWiki = (...args) => obsidianWikiService.lintWiki(...args);
export const getWikiImportBatch = (...args) => obsidianWikiService.getWikiImportBatch(...args);
