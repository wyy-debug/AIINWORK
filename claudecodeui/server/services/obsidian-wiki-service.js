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
import { completeSmallModelJson as defaultCompleteSmallModelJson } from './small-model-service.js';

const WIKI_UPLOAD_COMPILE_STRATEGY = 'quality';
const WIKI_UPLOAD_CHUNK_CHARS = 6000;
const WIKI_UPLOAD_MAX_CHUNKS = 24;
const WIKI_UPLOAD_OVERLAP_CHARS = 300;
const WIKI_UPLOAD_TOKEN_BUDGET = {
  chunkChars: WIKI_UPLOAD_CHUNK_CHARS,
  maxChunks: WIKI_UPLOAD_MAX_CHUNKS,
  overlapChars: WIKI_UPLOAD_OVERLAP_CHARS,
  chunkMaxTokens: 900,
  finalMaxTokens: 2200,
  chunkTimeoutMs: 20000,
  finalTimeoutMs: 30000,
  maxAttempts: 2,
};

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

const splitMeaningfulLines = (content = '') => String(content || '')
  .replace(/\r/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !/^```/.test(line) && line !== '---');

const stripMarkdownLine = (line = '') => normalizeWhitespace(String(line || '')
  .replace(/^#{1,6}\s+/, '')
  .replace(/^>\s*/, '')
  .replace(/^[-*+]\s+/, '')
  .replace(/^\d+[.)]\s+/, '')
  .replace(/^Key fact:\s*/i, '')
  .replace(/^Decision:\s*/i, '')
  .replace(/^Open question:\s*/i, ''));

const clampLine = (line = '', max = 320) => {
  const clean = stripMarkdownLine(line);
  return clean.length > max ? `${clean.slice(0, max).trim()}...` : clean;
};

const uniqueLimited = (items = [], limit = 8) => {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const clean = clampLine(item);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
};

const matchingLines = (lines = [], patterns = [], limit = 8) => uniqueLimited(
  lines.filter((line) => patterns.some((pattern) => pattern.test(line))),
  limit,
);

const buildDeterministicSummary = (content = '') => {
  const paragraphs = String(content || '')
    .split(/\n{2,}/)
    .map((block) => normalizeWhitespace(block.replace(/^#{1,6}\s+/gm, '')))
    .filter((block) => block.length > 20 && !block.startsWith('|'));
  const summary = paragraphs.slice(0, 3).join('\n\n')
    || splitMeaningfulLines(content).slice(0, 8).map(clampLine).join('\n');
  return summary.slice(0, 2600) || '原文没有可提取的正文。';
};

const buildDeterministicSections = (content = '') => {
  const lines = splitMeaningfulLines(content);
  const bulletLines = lines.filter((line) => /^[-*+]\s+/.test(line));
  const facts = matchingLines(lines, [
    /^[-*+]\s*Key fact:/i,
    /\bfact\b/i,
    /关键|事实|发现|风险|优化|性能|减少|降低|提升/i,
    /\breduce|improve|risk|allocation|latency|memory\b/i,
  ]);
  const decisions = matchingLines(lines, [
    /^[-*+]\s*Decision:/i,
    /\bdecision|conclusion\b/i,
    /决策|结论|建议|采用|保留|需要|必须|应该/i,
    /\bshould|must|keep|use|enable|disable\b/i,
  ]);
  const details = matchingLines(lines, [
    /实现|细节|架构|流程|接口|模块|路径|函数|服务/i,
    /\bimplementation|detail|architecture|pipeline|renderer|mesh|service|API\b/i,
  ]);
  const questions = matchingLines(lines, [
    /^[-*+]\s*Open question:/i,
    /\bopen question|question|todo\b/i,
    /未解决|问题|疑问|是否|待确认/i,
    /[?？]/,
  ]);
  return {
    facts: facts.length > 0 ? facts : uniqueLimited(bulletLines, 6),
    decisions,
    details,
    questions,
  };
};

const markdownList = (items = [], fallback = '原文未明确给出。') => (
  items.length > 0 ? items : [fallback]
).map((item) => `- ${item}`);

const buildCompiledContent = ({ title, content, rawPath, sourceIds = [] }) => {
  const sections = buildDeterministicSections(content);
  return [
    `# ${title}`,
    '',
    '> Argus Wiki Compiler 在小模型不可用时使用规则摘要生成，保留原始来源并尽量提取可读结论。',
    '',
    '## 摘要',
    '',
    buildDeterministicSummary(content),
    '',
    '## 关键事实',
    '',
    ...markdownList(sections.facts),
    '',
    '## 决策/结论',
    '',
    ...markdownList(sections.decisions),
    '',
    '## 实现细节',
    '',
    ...markdownList(sections.details),
    '',
    '## 未解决问题',
    '',
    ...markdownList(sections.questions),
    '',
    '## Sources',
    '',
    rawPath ? `- [[${path.basename(rawPath, '.md')}]]` : '- Raw source',
    ...sourceIds.map((sourceId) => `- ${sourceId}`),
  ].join('\n');
};

export const buildDeterministicCompiledContent = buildCompiledContent;

export const chunkWikiSourceContent = (
  content = '',
  {
    chunkChars = WIKI_UPLOAD_CHUNK_CHARS,
    maxChunks = WIKI_UPLOAD_MAX_CHUNKS,
    overlapChars = WIKI_UPLOAD_OVERLAP_CHARS,
  } = {},
) => {
  const text = String(content || '').trim();
  if (!text) return [];
  const safeChunkChars = Math.max(500, Number(chunkChars) || WIKI_UPLOAD_CHUNK_CHARS);
  const safeMaxChunks = Math.max(1, Number(maxChunks) || WIKI_UPLOAD_MAX_CHUNKS);
  const safeOverlap = Math.max(0, Math.min(Number(overlapChars) || 0, safeChunkChars - 1));
  const chunks = [];
  let start = 0;

  while (start < text.length && chunks.length < safeMaxChunks) {
    const end = Math.min(text.length, start + safeChunkChars);
    chunks.push({ start, end, text: text.slice(start, end) });
    if (end >= text.length) break;
    start = Math.max(end - safeOverlap, start + 1);
  }

  const truncated = chunks.length > 0 && chunks[chunks.length - 1].end < text.length;
  const total = chunks.length;
  return chunks.map((chunk, index) => ({
    index: index + 1,
    total,
    text: chunk.text,
    truncated,
  }));
};

const normalizeStringList = (value) => {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => readString(entry)).filter(Boolean))];
};

const normalizeChunkSummary = (value = {}, chunk = {}) => ({
  chunkIndex: chunk.index,
  summary: readString(value.summary) || readString(value.title) || '',
  keyFacts: normalizeStringList(value.keyFacts || value.facts),
  decisions: normalizeStringList(value.decisions || value.conclusions),
  implementationDetails: normalizeStringList(value.implementationDetails || value.details),
  openQuestions: normalizeStringList(value.openQuestions || value.questions),
  tags: normalizeStringList(value.tags),
  relatedTopics: normalizeStringList(value.relatedTopics || value.related),
});

const compileFallbackReason = (stage, result = {}) => `${stage}_${readString(result.reason) || 'failed'}`;

const completeJsonWithRetries = async ({
  completeJson,
  request,
  maxAttempts = WIKI_UPLOAD_TOKEN_BUDGET.maxAttempts,
}) => {
  let lastResult = null;
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastResult = await completeJson(request);
    } catch (error) {
      lastResult = {
        success: false,
        reason: 'request_failed',
        error: error?.message || 'Small model request failed.',
      };
    }
    if (lastResult?.success && lastResult.json) {
      return lastResult;
    }
  }
  return lastResult || { success: false, reason: 'failed' };
};

const ensureSourcesSection = (markdown = '', { rawPath = '', sourceIds = [] } = {}) => {
  const content = String(markdown || '').trim();
  const sourceLines = [
    rawPath ? `- [[${path.basename(rawPath, '.md')}]]` : '- Raw source',
    ...sourceIds.map((sourceId) => `- ${sourceId}`),
  ];
  if (/^##\s+Sources\b/im.test(content)) {
    return content;
  }
  return [content, '', '## Sources', '', ...sourceLines].join('\n').trim();
};

const markdownFromCompiledJson = ({
  title = 'Untitled',
  json = {},
  rawPath = '',
  sourceIds = [],
}) => {
  const listSection = (heading, items, fallback = '原文未明确给出。') => [
    `## ${heading}`,
    '',
    ...(
      normalizeStringList(items).length > 0
        ? normalizeStringList(items).map((item) => `- ${item}`)
        : [`- ${fallback}`]
    ),
  ];
  const lines = [
    `# ${title}`,
    '',
    '## 摘要',
    '',
    readString(json.summary) || readString(json.overview) || '原文未明确给出摘要。',
    '',
    ...listSection('关键事实', json.keyFacts || json.facts),
    '',
    ...listSection('决策/结论', json.decisions || json.conclusions),
    '',
    ...listSection('实现细节', json.implementationDetails || json.details),
    '',
    ...listSection('未解决问题', json.openQuestions || json.questions),
  ];
  return ensureSourcesSection(lines.join('\n'), { rawPath, sourceIds });
};

const buildPartialCompiledContentFromSummaries = ({
  title = 'Untitled',
  summaries = [],
  rawPath = '',
  sourceIds = [],
}) => {
  const uniqueItems = (field) => [
    ...new Set(summaries.flatMap((summary) => normalizeStringList(summary[field]))),
  ];
  const summaryText = summaries
    .map((summary) => readString(summary.summary))
    .filter(Boolean)
    .join('\n\n');
  const listSection = (heading, items) => [
    `## ${heading}`,
    '',
    ...(items.length > 0 ? items.map((item) => `- ${item}`) : ['- 原文未明确给出。']),
  ];
  return ensureSourcesSection([
    `# ${title}`,
    '',
    '> Argus Wiki Compiler used completed chunk summaries because one later model call failed.',
    '',
    '## 摘要',
    '',
    summaryText || '原文未明确给出摘要。',
    '',
    ...listSection('关键事实', uniqueItems('keyFacts')),
    '',
    ...listSection('决策/结论', uniqueItems('decisions')),
    '',
    ...listSection('实现细节', uniqueItems('implementationDetails')),
    '',
    ...listSection('未解决问题', uniqueItems('openQuestions')),
  ].join('\n'), { rawPath, sourceIds });
};

export const compileWikiContentWithSmallModel = async ({
  title = '',
  content = '',
  rawPath = '',
  sourceIds = [],
  projectName = '',
  completeJson = defaultCompleteSmallModelJson,
} = {}) => {
  const chunks = chunkWikiSourceContent(content);
  const deterministic = (reason = '') => ({
    content: buildDeterministicCompiledContent({ title, content, rawPath, sourceIds }),
    compiler: 'deterministic',
    compileStrategy: WIKI_UPLOAD_COMPILE_STRATEGY,
    chunks: chunks.length,
    tokenBudget: WIKI_UPLOAD_TOKEN_BUDGET,
    model: '',
    fallbackReason: reason,
  });
  const summaries = [];
  let model = '';
  const partial = (reason = '') => ({
    content: buildPartialCompiledContentFromSummaries({
      title,
      summaries,
      rawPath,
      sourceIds,
    }),
    compiler: 'small-model',
    compileStrategy: WIKI_UPLOAD_COMPILE_STRATEGY,
    chunks: summaries.length,
    tokenBudget: WIKI_UPLOAD_TOKEN_BUDGET,
    model,
    fallbackReason: reason,
  });

  if (chunks.length === 0 || typeof completeJson !== 'function') {
    return deterministic(chunks.length === 0 ? 'empty_content' : 'small_model_unavailable');
  }

  for (const chunk of chunks) {
    const result = await completeJsonWithRetries({
      completeJson,
      request: {
        purpose: 'wiki-upload-chunk-summary',
        maxTokens: WIKI_UPLOAD_TOKEN_BUDGET.chunkMaxTokens,
        timeoutMs: WIKI_UPLOAD_TOKEN_BUDGET.chunkTimeoutMs,
        systemPrompt: [
          'You are the Argus Wiki upload compiler.',
          'Your main job is to produce a useful Obsidian summary, not to classify the text.',
          'Summarize one source chunk into strict JSON only. Extract concrete facts, decisions, implementation details, risks, and open questions.',
          'Return: {"summary":"","keyFacts":[],"decisions":[],"implementationDetails":[],"openQuestions":[],"tags":[],"relatedTopics":[]}.',
        ].join('\n'),
        userPrompt: JSON.stringify({
          title,
          projectName,
          chunkIndex: chunk.index,
          chunkTotal: chunk.total,
          truncated: chunk.truncated,
          chunkText: chunk.text,
        }),
      },
    });
    if (!result?.success || !result.json) {
      if (summaries.length > 0) {
        return partial(compileFallbackReason('partial_chunk_summary', result));
      }
      return deterministic(compileFallbackReason('chunk_summary', result));
    }
    model = readString(result.model || result.profileModel) || model;
    summaries.push(normalizeChunkSummary(result.json, chunk));
  }

  const finalResult = await completeJsonWithRetries({
    completeJson,
    request: {
      purpose: 'wiki-upload-final-compile',
      maxTokens: WIKI_UPLOAD_TOKEN_BUDGET.finalMaxTokens,
      timeoutMs: WIKI_UPLOAD_TOKEN_BUDGET.finalTimeoutMs,
      systemPrompt: [
        'You are the Argus Wiki compiler.',
        'Merge chunk summaries into a polished, useful Markdown summary for an Obsidian Wiki page.',
        'Do not leave placeholder text. If a section has no explicit items, say that briefly.',
        'Return strict JSON only. Prefer {"markdown":"..."}; otherwise return structured fields.',
        'The Markdown must include: 摘要, 关键事实, 决策/结论, 实现细节, 未解决问题, Sources.',
      ].join('\n'),
      userPrompt: JSON.stringify({
        title,
        projectName,
        rawPath,
        sourceIds,
        chunks: summaries,
      }),
    },
  });
  if (!finalResult?.success || !finalResult.json) {
    if (summaries.length > 0) {
      return partial(compileFallbackReason('partial_final_compile', finalResult));
    }
    return deterministic(compileFallbackReason('final_compile', finalResult));
  }

  model = readString(finalResult.model || finalResult.profileModel) || model;
  const markdown = readString(finalResult.json.markdown)
    || markdownFromCompiledJson({
      title,
      json: finalResult.json,
      rawPath,
      sourceIds,
    });
  if (!markdown) {
    return deterministic('final_compile_empty_markdown');
  }

  return {
    content: ensureSourcesSection(markdown, { rawPath, sourceIds }),
    compiler: 'small-model',
    compileStrategy: WIKI_UPLOAD_COMPILE_STRATEGY,
    chunks: chunks.length,
    tokenBudget: WIKI_UPLOAD_TOKEN_BUDGET,
    model,
    fallbackReason: '',
  };
};

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
  completeSmallModelJson = defaultCompleteSmallModelJson,
  compileWikiContent = compileWikiContentWithSmallModel,
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
        wikiCompiler: existing.metadata?.wikiCompiler || '',
        wikiCompileStrategy: existing.metadata?.wikiCompileStrategy || '',
        wikiCompileChunks: existing.metadata?.wikiCompileChunks || 0,
        wikiCompileFallbackReason: existing.metadata?.wikiCompileFallbackReason || '',
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
    const shouldCompile = config.wikiCompilerEnabled !== false
      && extractionStatus === 'extracted'
      && normalizeWhitespace(cleanContent);
    let wikiCompileMeta = {
      wikiCompiler: '',
      wikiCompileStrategy: '',
      wikiCompileChunks: 0,
      wikiCompileTokenBudget: null,
      wikiCompileModel: '',
      wikiCompileFallbackReason: '',
    };

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
        const compiledContent = await compileWikiContent({
          title: cleanTitle,
          content: cleanContent,
          rawPath,
          sourceIds,
          projectName: cleanProjectName,
          completeJson: completeSmallModelJson,
        });
        wikiCompileMeta = {
          wikiCompiler: compiledContent.compiler || 'deterministic',
          wikiCompileStrategy: compiledContent.compileStrategy || WIKI_UPLOAD_COMPILE_STRATEGY,
          wikiCompileChunks: Number(compiledContent.chunks) || 0,
          wikiCompileTokenBudget: compiledContent.tokenBudget || WIKI_UPLOAD_TOKEN_BUDGET,
          wikiCompileModel: readString(compiledContent.model),
          wikiCompileFallbackReason: readString(compiledContent.fallbackReason),
        };
        const compileResult = await sendObsidianWikiCompile({
          title: cleanTitle,
          projectName: cleanProjectName,
          content: compiledContent.content,
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
          compiler: wikiCompileMeta.wikiCompiler,
          compileStrategy: wikiCompileMeta.wikiCompileStrategy,
          wikiCompiler: wikiCompileMeta.wikiCompiler,
          wikiCompileStrategy: wikiCompileMeta.wikiCompileStrategy,
          wikiCompileChunks: wikiCompileMeta.wikiCompileChunks,
          wikiCompileTokenBudget: wikiCompileMeta.wikiCompileTokenBudget,
          wikiCompileModel: wikiCompileMeta.wikiCompileModel,
          wikiCompileFallbackReason: wikiCompileMeta.wikiCompileFallbackReason,
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
      ...wikiCompileMeta,
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
      ...wikiCompileMeta,
      obsidianBridge: {
        destination,
        rawPath,
        wikiPath,
        indexPaths,
        viewModes,
        path: wikiPath,
        fallbackPath: wikiLastError ? rawPath : '',
        error: wikiLastError,
        ...wikiCompileMeta,
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
        wikiCompiler: existing.metadata?.wikiCompiler || '',
        wikiCompileStrategy: existing.metadata?.wikiCompileStrategy || '',
        wikiCompileChunks: existing.metadata?.wikiCompileChunks || 0,
        wikiCompileFallbackReason: existing.metadata?.wikiCompileFallbackReason || '',
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
