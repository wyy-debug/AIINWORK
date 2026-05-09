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
const WIKI_TOPIC_SUGGEST_TIMEOUT_MS = 8000;
const WIKI_TOPIC_SUGGEST_MAX_TOKENS = 500;
const WIKI_TOPIC_SUGGEST_CONTENT_CHARS = 5000;
const PDF_TEXT_EXTRACT_MAX_PAGES = 80;
const PDF_TEXT_EXTRACT_MAX_CHARS = 250_000;
const PDF_EXTRACTION_ENGINE = 'pdfjs-dist';

const SUMMARY_TYPES = new Set([
  'auto',
  'technical-review',
  'project-summary',
  'reading-note',
  'decision-adr',
  'meeting-notes',
  'general-wiki',
]);

const SUMMARY_TYPE_GUIDANCE = {
  'technical-review': [
    'Compile this as a technical review.',
    'The final Wiki page must include: overall assessment, severe issues, architecture risks, performance/stability risks, priority recommendations, affected modules, and Sources.',
  ].join(' '),
  'project-summary': 'Compile this as a project summary with goals, current state, decisions, risks, next steps, and Sources.',
  'reading-note': 'Compile this as a reading note with thesis, useful ideas, reusable patterns, questions, and Sources.',
  'decision-adr': 'Compile this as an ADR-style note with context, decision, alternatives, consequences, status, and Sources.',
  'meeting-notes': 'Compile this as meeting notes with attendees/topics when available, decisions, action items, open questions, and Sources.',
  'general-wiki': 'Compile this as a durable Wiki note with summary, key facts, conclusions, implementation/details, open questions, and Sources.',
  auto: 'Infer the most useful Wiki shape from the source, then compile a durable note with concrete details and Sources.',
};

const PLACEHOLDER_PATTERNS = [
  /pending compiler refinement/i,
  /to be refined/i,
  /needs? further refinement/i,
  /待后续/i,
  /待补充/i,
  /原文未明确给出/i,
  /后续编译器/i,
  /TODO\b/i,
];

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

const normalizeSummaryType = (value = 'auto') => {
  const clean = readString(value) || 'auto';
  return SUMMARY_TYPES.has(clean) ? clean : 'auto';
};

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

const SECTION_TITLE_PATTERNS = [
  /^\d{1,3}\s*[-.、)]\s*\S+/,
  /^[一二三四五六七八九十百]+[、.）)]\s*\S+/,
  /^第[一二三四五六七八九十百\d]+[章节部分][、.：:\s-]*\S*/,
];

const stripSectionTitlePrefix = (value = '') => normalizeWhitespace(value)
  .replace(/^#{1,6}\s+/, '')
  .replace(/^\d{1,3}\s*[-.、)]\s*/, '')
  .replace(/^[一二三四五六七八九十百]+[、.）)]\s*/, '')
  .replace(/^第[一二三四五六七八九十百\d]+[章节部分][、.：:\s-]*/, '')
  .trim();

const isSectionLikeWikiTitle = (value = '') => {
  const clean = normalizeWhitespace(value).replace(/^#{1,6}\s+/, '');
  return SECTION_TITLE_PATTERNS.some((pattern) => pattern.test(clean));
};

const sameTitleKey = (left = '', right = '') => topicKeyFromTitle(left) === topicKeyFromTitle(right);

const hasExplicitWikiTopicTitle = ({ sourceMetadata = {}, artifact = null } = {}) => [
  sourceMetadata.wikiTitle,
  sourceMetadata.topicTitle,
  sourceMetadata.documentTitle,
  sourceMetadata.sourceTitle,
  sourceMetadata.artifactTitle,
  artifact?.metadata?.wikiTitle,
  artifact?.metadata?.topicTitle,
  artifact?.metadata?.documentTitle,
  artifact?.metadata?.sourceTitle,
  artifact?.metadata?.artifactTitle,
  artifact?.title,
].some((candidate) => {
  const clean = readString(candidate);
  return clean && !isSectionLikeWikiTitle(clean);
});

const withProjectTitlePrefix = ({ projectName = '', title = '' } = {}) => {
  const cleanProject = projectKey(projectName);
  const cleanTitle = slug(title);
  if (!cleanTitle || cleanProject === 'General') return cleanTitle;
  if (sameTitleKey(cleanProject, cleanTitle)) return cleanTitle;
  if (cleanTitle.toLowerCase().startsWith(`${cleanProject.toLowerCase()} `)) return cleanTitle;
  return `${cleanProject} ${cleanTitle}`;
};

const inferProjectTopicName = ({ projectName = '', content = '' } = {}) => {
  const cleanProject = projectKey(projectName);
  const text = String(content || '');
  const afterProjectPattern = cleanProject && cleanProject !== 'General'
    ? new RegExp(`${cleanProject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:的|项目|project)?\\s*([A-Z][A-Za-z0-9_.-]{2,80})`)
    : null;
  const afterProjectMatch = afterProjectPattern ? text.match(afterProjectPattern) : null;
  if (afterProjectMatch?.[1] && !sameTitleKey(afterProjectMatch[1], cleanProject)) {
    return slug(afterProjectMatch[1]);
  }
  const candidates = text.match(/\b[A-Z][A-Za-z0-9_]*(?:Graphics|Scene|Renderer|RenderPipeline|Pipeline|Streaming|System|Service|Manager|Module|Graph|Resource|Engine)\b/g) || [];
  for (const candidate of candidates) {
    if (!sameTitleKey(candidate, cleanProject)) return slug(candidate);
  }
  return '';
};

const resolveWikiTopicIdentity = ({
  title = '',
  projectName = '',
  content = '',
  sourceMetadata = {},
  artifact = null,
} = {}) => {
  const cleanTitle = readString(title) || readString(artifact?.title) || 'Untitled';
  if (!isSectionLikeWikiTitle(cleanTitle)) {
    return {
      wikiTitle: cleanTitle,
      sourceHeading: '',
      topicKey: topicKeyFromTitle(cleanTitle),
    };
  }

  const sourceTitleCandidates = [
    sourceMetadata.wikiTitle,
    sourceMetadata.topicTitle,
    sourceMetadata.documentTitle,
    sourceMetadata.sourceTitle,
    sourceMetadata.artifactTitle,
    artifact?.metadata?.wikiTitle,
    artifact?.metadata?.topicTitle,
    artifact?.metadata?.documentTitle,
    artifact?.metadata?.sourceTitle,
    artifact?.metadata?.artifactTitle,
    artifact?.title,
  ].map(readString).filter(Boolean);
  const explicitTopicTitle = sourceTitleCandidates.find((candidate) => !isSectionLikeWikiTitle(candidate));
  const sourceHeading = cleanTitle;
  const cleanProject = projectKey(projectName);
  const sectionTitle = stripSectionTitlePrefix(cleanTitle) || cleanTitle;
  const inferredTopic = inferProjectTopicName({ projectName: cleanProject, content });
  const wikiTitle = explicitTopicTitle
    || [cleanProject && cleanProject !== 'General' ? cleanProject : '', inferredTopic, sectionTitle]
      .filter(Boolean)
      .join(' ')
    || sectionTitle;

  return {
    wikiTitle: slug(wikiTitle),
    sourceHeading,
    topicKey: topicKeyFromTitle(wikiTitle),
  };
};

const isWeakWikiTopicTitle = (value = '') => {
  const clean = topicKeyFromTitle(value);
  return !clean
    || isSectionLikeWikiTitle(value)
    || ['untitled', 'summary', 'chat-summary', 'review', 'notes', 'analysis', 'report'].includes(clean);
};

const isProjectTechnicalWikiSource = ({
  projectName = '',
  title = '',
  content = '',
} = {}) => {
  const cleanProject = projectKey(projectName);
  if (!cleanProject || cleanProject === 'General') return false;
  const text = `${title}\n${content}`.toLowerCase();
  const projectSignals = [
    cleanProject.toLowerCase(),
    'project',
    'package',
    'module',
    'architecture',
    'pipeline',
    'renderer',
    'shader',
    'unity',
    'srp',
    'urp',
    'hdrp',
    'review',
    'risk',
    'performance',
    'stability',
    'code',
    '项目',
    '模块',
    '架构',
    '管线',
    '渲染',
    '代码',
    '评审',
    '风险',
    '性能',
    '稳定性',
  ];
  let hits = 0;
  for (const signal of projectSignals) {
    if (signal && text.includes(signal)) hits += 1;
  }
  return hits >= 2;
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

const normalizePdfPageText = (items = []) => normalizeWhitespace(
  items
    .map((item) => readString(item?.str))
    .filter(Boolean)
    .join(' '),
);

const pdfExtractionFailureReason = (error) => {
  const name = readString(error?.name);
  const message = readString(error?.message).toLowerCase();
  if (/password|encrypted/.test(`${name} ${message}`)) return 'pdf_encrypted';
  if (/invalid|missing|unexpected|xref|trailer|parse/.test(`${name} ${message}`)) return 'pdf_parse_failed';
  if (/import|module|cannot find/.test(`${name} ${message}`)) return 'pdf_engine_unavailable';
  return 'pdf_extract_failed';
};

const buildPdfExtractFailedContent = ({
  title = '',
  filePath = '',
  mimeType = '',
  size = 0,
  reason = '',
} = {}) => [
  `# ${title}`,
  '',
  'Argus saved the original PDF metadata, but could not extract usable text from this PDF.',
  '',
  `- Original file: ${filePath}`,
  `- MIME: ${mimeType || 'application/pdf'}`,
  `- Size: ${Number(size) || 0}`,
  `- Failure reason: ${reason || 'pdf_extract_failed'}`,
].join('\n');

export const extractPdfTextContent = async (filePath, {
  title = '',
  mimeType = 'application/pdf',
  size = 0,
  maxPages = PDF_TEXT_EXTRACT_MAX_PAGES,
  maxChars = PDF_TEXT_EXTRACT_MAX_CHARS,
} = {}) => {
  const cleanTitle = readString(title) || titleFromName(filePath);
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const buffer = await fs.readFile(filePath);
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    const pageCount = Number(document.numPages) || 0;
    const safeMaxPages = Math.max(1, Number(maxPages) || PDF_TEXT_EXTRACT_MAX_PAGES);
    const safeMaxChars = Math.max(1_000, Number(maxChars) || PDF_TEXT_EXTRACT_MAX_CHARS);
    const pageLimit = Math.min(pageCount, safeMaxPages);
    const pages = [];
    let extractedChars = 0;
    let truncated = pageCount > pageLimit;

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      if (extractedChars >= safeMaxChars) {
        truncated = true;
        break;
      }
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = normalizePdfPageText(textContent.items);
      if (!pageText) continue;
      const remainingChars = safeMaxChars - extractedChars;
      const clippedText = pageText.length > remainingChars ? pageText.slice(0, remainingChars).trim() : pageText;
      if (pageText.length > remainingChars) truncated = true;
      pages.push({ pageNumber, text: clippedText });
      extractedChars += clippedText.length;
    }

    await loadingTask.destroy().catch(() => undefined);

    if (pages.length === 0 || extractedChars === 0) {
      return {
        title: cleanTitle,
        content: buildPdfExtractFailedContent({
          title: cleanTitle,
          filePath,
          mimeType,
          size: size || buffer.length,
          reason: 'pdf_no_text_layer',
        }),
        extractionStatus: 'extract_failed',
        extractionEngine: PDF_EXTRACTION_ENGINE,
        extractionFailureReason: 'pdf_no_text_layer',
        extension: '.pdf',
        pdfPageCount: pageCount,
        pdfExtractedPages: 0,
        pdfExtractedChars: 0,
        pdfTruncated: false,
      };
    }

    return {
      title: cleanTitle,
      content: [
        `# ${cleanTitle}`,
        '',
        '> PDF extracted by Argus',
        '',
        ...pages.flatMap((page) => [
          `## Page ${page.pageNumber}`,
          '',
          page.text,
          '',
        ]),
      ].join('\n').trim(),
      extractionStatus: 'extracted',
      extractionEngine: PDF_EXTRACTION_ENGINE,
      extractionFailureReason: '',
      extension: '.pdf',
      pdfPageCount: pageCount,
      pdfExtractedPages: pages.length,
      pdfExtractedChars: extractedChars,
      pdfTruncated: truncated,
    };
  } catch (error) {
    const reason = pdfExtractionFailureReason(error);
    return {
      title: cleanTitle,
      content: buildPdfExtractFailedContent({
        title: cleanTitle,
        filePath,
        mimeType,
        size,
        reason,
      }),
      extractionStatus: 'extract_failed',
      extractionEngine: PDF_EXTRACTION_ENGINE,
      extractionFailureReason: reason,
      extension: '.pdf',
      pdfPageCount: 0,
      pdfExtractedPages: 0,
      pdfExtractedChars: 0,
      pdfTruncated: false,
    };
  }
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

  if (extension === '.pdf' || /^application\/pdf$/i.test(readString(file.mimeType))) {
    return extractPdfTextContent(filePath, {
      title,
      mimeType: readString(file.mimeType) || 'application/pdf',
      size: Number(file.size) || buffer.length,
    });
  }

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
  projectName = '',
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
  const projectTechnical = isProjectTechnicalWikiSource({ projectName, title, content });
  const resolvedModes = projectTechnical
    ? ['project-knowledge', ...modes.filter((mode) => mode !== 'project-knowledge')]
    : modes;
  const routingScores = {
    ...(assessment.routingScores || {}),
    ...(projectTechnical ? { 'project-knowledge': Math.max(Number(assessment.routingScores?.['project-knowledge']) || 0, 1) } : {}),
  };
  const routingSignals = assessment.routingSignals || [];
  return {
    classificationMode: resolvedModes[0] || 'raw',
    classificationModes: [...new Set(resolvedModes)],
    classificationReason: assessment.routingReason || '已保存为 Raw，等待后续编译。',
    routingScores,
    routingSignals: projectTechnical ? [...new Set([...routingSignals, 'project technical source'])] : routingSignals,
    routingConfidence: assessment.routingConfidence || assessment.confidence || 0,
    memoryCapturePolicy: assessment.memoryCapturePolicy || 'not-memory',
    projectTechnical,
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

const suggestWikiTopicWithSmallModel = async ({
  title = '',
  projectName = '',
  content = '',
  sourceMetadata = {},
  artifact = null,
  completeJson = null,
} = {}) => {
  if (typeof completeJson !== 'function') return null;
  if (readString(sourceMetadata.topicKey)) return null;
  if (hasExplicitWikiTopicTitle({ sourceMetadata, artifact })) return null;
  if (!isWeakWikiTopicTitle(title)) return null;

  const result = await completeJsonWithRetries({
    completeJson,
    maxAttempts: 1,
    request: {
      purpose: 'wiki-topic-suggest',
      maxTokens: WIKI_TOPIC_SUGGEST_MAX_TOKENS,
      timeoutMs: WIKI_TOPIC_SUGGEST_TIMEOUT_MS,
      systemPrompt: [
        'You suggest stable topic titles for Argus Obsidian Wiki pages.',
        'Return strict JSON only: {"topicTitle":"","reason":""}.',
        'The topicTitle must be a durable note title, not a numbered section heading.',
        'Prefer project/component/topic names. Do not include markdown formatting.',
      ].join('\n'),
      userPrompt: JSON.stringify({
        currentTitle: title,
        projectName,
        source: sourceMetadata.source || artifact?.metadata?.source || '',
        sourceHeading: isSectionLikeWikiTitle(title) ? title : '',
        contentExcerpt: String(content || '').slice(0, WIKI_TOPIC_SUGGEST_CONTENT_CHARS),
      }),
    },
  });

  if (!result?.success || !result.json) return null;
  const suggestedTitle = readString(result.json.topicTitle || result.json.title || result.json.wikiTitle);
  if (!suggestedTitle || isWeakWikiTopicTitle(suggestedTitle) || sameTitleKey(suggestedTitle, title)) {
    return null;
  }
  return {
    topicTitle: withProjectTitlePrefix({ projectName, title: suggestedTitle }),
    reason: readString(result.json.reason),
    model: readString(result.model || result.profileModel),
  };
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

const containsPlaceholderText = (markdown = '') => PLACEHOLDER_PATTERNS
  .some((pattern) => pattern.test(String(markdown || '')));

const assessCompiledWikiQuality = (markdown = '', { summaryType = 'auto' } = {}) => {
  const content = String(markdown || '').trim();
  const warnings = [];
  if (!content) {
    warnings.push('empty_content');
  }
  if (containsPlaceholderText(content)) {
    warnings.push('placeholder_content');
  }
  if (!/^##\s+Sources\b/im.test(content)) {
    warnings.push('missing_sources');
  }
  if (normalizeWhitespace(content).length < 80) {
    warnings.push('too_short');
  }
  if (normalizeSummaryType(summaryType) === 'technical-review') {
    const requiredPatterns = [
      /overall|整体|评价|assessment/i,
      /severe|critical|严重|问题/i,
      /risk|风险/i,
      /priority|优先级|recommendation|建议/i,
      /module|模块|file|路径/i,
    ];
    const missingTechnicalSections = requiredPatterns
      .filter((pattern) => !pattern.test(content))
      .length;
    if (missingTechnicalSections >= 3) {
      warnings.push('weak_technical_review_structure');
    }
  }
  return {
    passed: warnings.length === 0,
    warnings: [...new Set(warnings)],
  };
};

const withQualityMetadata = (compiled = {}, patch = {}) => ({
  ...compiled,
  qualityStatus: patch.qualityStatus || compiled.qualityStatus || 'passed',
  repairAttempts: Number.isFinite(Number(patch.repairAttempts))
    ? Number(patch.repairAttempts)
    : Number(compiled.repairAttempts) || 0,
  warnings: Array.isArray(patch.warnings)
    ? [...new Set(patch.warnings.map(readString).filter(Boolean))]
    : Array.isArray(compiled.warnings)
      ? [...new Set(compiled.warnings.map(readString).filter(Boolean))]
      : [],
});

const buildNeedsReviewContent = ({
  title = 'Untitled',
  content = '',
  summaries = [],
  rawPath = '',
  sourceIds = [],
} = {}) => {
  const partialContent = summaries.length > 0
    ? buildPartialCompiledContentFromSummaries({ title, summaries, rawPath, sourceIds })
    : buildDeterministicCompiledContent({ title, content, rawPath, sourceIds });
  const sourceExcerpt = buildDeterministicSummary(content);
  const baseContent = ensureSourcesSection(
    String(partialContent || '')
      .replace(/^>\s*Argus Wiki Compiler.*$/gmi, '> Argus Wiki Compiler could not complete a high-quality model pass. This page is readable but marked for review.')
      .replace(PLACEHOLDER_PATTERNS[0], 'Needs human review')
      .replace(/待后续编译器继续提炼。?/g, 'Needs human review.'),
    { rawPath, sourceIds },
  );
  return sourceExcerpt ? `${baseContent}\n\n## Source excerpt\n\n${sourceExcerpt}` : baseContent;
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
  summaryType = 'auto',
  completeJson = defaultCompleteSmallModelJson,
} = {}) => {
  const normalizedSummaryType = normalizeSummaryType(summaryType);
  const summaryGuidance = SUMMARY_TYPE_GUIDANCE[normalizedSummaryType] || SUMMARY_TYPE_GUIDANCE.auto;
  const chunks = chunkWikiSourceContent(content);
  const deterministic = (reason = '') => ({
    content: buildDeterministicCompiledContent({ title, content, rawPath, sourceIds }),
    compiler: 'deterministic',
    compileStrategy: WIKI_UPLOAD_COMPILE_STRATEGY,
    chunks: chunks.length,
    tokenBudget: WIKI_UPLOAD_TOKEN_BUDGET,
    model: '',
    fallbackReason: reason,
    summaryType: normalizedSummaryType,
    qualityStatus: reason === 'empty_content' ? 'needs-review' : 'partial',
    repairAttempts: 0,
    warnings: reason ? [reason] : [],
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
    summaryType: normalizedSummaryType,
    qualityStatus: 'partial',
    repairAttempts: 0,
    warnings: reason ? [reason] : [],
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
          summaryGuidance,
          'Summarize one source chunk into strict JSON only. Extract concrete facts, decisions, implementation details, risks, and open questions.',
          'Return: {"summary":"","keyFacts":[],"decisions":[],"implementationDetails":[],"openQuestions":[],"tags":[],"relatedTopics":[]}.',
        ].join('\n'),
        userPrompt: JSON.stringify({
          title,
          projectName,
          summaryType: normalizedSummaryType,
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
        summaryGuidance,
        'Do not leave placeholder text. If a section has no explicit items, omit it or explain the limitation with concrete source context.',
        'Return strict JSON only. Prefer {"markdown":"..."}; otherwise return structured fields.',
        'The Markdown must include: 摘要, 关键事实, 决策/结论, 实现细节, 未解决问题, Sources.',
      ].join('\n'),
      userPrompt: JSON.stringify({
        title,
        projectName,
        summaryType: normalizedSummaryType,
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

  const initialContent = ensureSourcesSection(markdown, { rawPath, sourceIds });
  const initialQuality = assessCompiledWikiQuality(initialContent, {
    summaryType: normalizedSummaryType,
  });
  if (initialQuality.passed) {
    return withQualityMetadata({
      content: initialContent,
      compiler: 'small-model',
      compileStrategy: WIKI_UPLOAD_COMPILE_STRATEGY,
      chunks: chunks.length,
      tokenBudget: WIKI_UPLOAD_TOKEN_BUDGET,
      model,
      fallbackReason: '',
      summaryType: normalizedSummaryType,
    }, {
      qualityStatus: 'passed',
      repairAttempts: 0,
      warnings: [],
    });
  }

  const repairResult = await completeJsonWithRetries({
    completeJson,
    request: {
      purpose: 'wiki-upload-quality-repair',
      maxTokens: WIKI_UPLOAD_TOKEN_BUDGET.finalMaxTokens,
      timeoutMs: WIKI_UPLOAD_TOKEN_BUDGET.finalTimeoutMs,
      systemPrompt: [
        'You repair an Argus Wiki page that failed quality checks.',
        summaryGuidance,
        'Remove placeholders, keep only claims supported by the chunk summaries/source excerpts, and keep Sources.',
        'Return strict JSON only as {"markdown":"..."}.',
      ].join('\n'),
      userPrompt: JSON.stringify({
        title,
        projectName,
        summaryType: normalizedSummaryType,
        rawPath,
        sourceIds,
        qualityWarnings: initialQuality.warnings,
        currentMarkdown: initialContent,
        chunks: summaries,
      }),
    },
  });

  if (repairResult?.success && repairResult.json) {
    model = readString(repairResult.model || repairResult.profileModel) || model;
    const repairedMarkdown = readString(repairResult.json.markdown)
      || markdownFromCompiledJson({
        title,
        json: repairResult.json,
        rawPath,
        sourceIds,
      });
    const repairedContent = ensureSourcesSection(repairedMarkdown, { rawPath, sourceIds });
    const repairedQuality = assessCompiledWikiQuality(repairedContent, {
      summaryType: normalizedSummaryType,
    });
    if (repairedQuality.passed) {
      return withQualityMetadata({
        content: repairedContent,
        compiler: 'small-model',
        compileStrategy: WIKI_UPLOAD_COMPILE_STRATEGY,
        chunks: chunks.length,
        tokenBudget: WIKI_UPLOAD_TOKEN_BUDGET,
        model,
        fallbackReason: '',
        summaryType: normalizedSummaryType,
      }, {
        qualityStatus: 'repaired',
        repairAttempts: 1,
        warnings: initialQuality.warnings,
      });
    }
  }

  return withQualityMetadata({
    content: buildNeedsReviewContent({
      title,
      content,
      summaries,
      rawPath,
      sourceIds,
    }),
    compiler: 'small-model',
    compileStrategy: WIKI_UPLOAD_COMPILE_STRATEGY,
    chunks: chunks.length,
    tokenBudget: WIKI_UPLOAD_TOKEN_BUDGET,
    model,
    fallbackReason: 'quality_gate_failed',
    summaryType: normalizedSummaryType,
  }, {
    qualityStatus: 'needs-review',
    repairAttempts: 1,
    warnings: initialQuality.warnings,
  });
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
    summaryType = '',
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
    const cleanSummaryType = normalizeSummaryType(summaryType || sourceMetadata.summaryType || artifact?.metadata?.summaryType || 'auto');
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
        summaryType: existing.metadata?.summaryType || 'auto',
        compileQualityStatus: existing.metadata?.compileQualityStatus || '',
        compileRepairAttempts: existing.metadata?.compileRepairAttempts || 0,
        compileWarnings: existing.metadata?.compileWarnings || [],
      };
    }

    const config = readObsidianBridgeConfig();
    const topicSuggestion = await suggestWikiTopicWithSmallModel({
      title: cleanTitle,
      projectName: cleanProjectName,
      content: cleanContent,
      sourceMetadata,
      artifact,
      completeJson: completeSmallModelJson,
    });
    const topicIdentity = resolveWikiTopicIdentity({
      title: cleanTitle,
      projectName: cleanProjectName,
      content: cleanContent,
      sourceMetadata: topicSuggestion?.topicTitle
        ? { ...sourceMetadata, topicTitle: topicSuggestion.topicTitle }
        : sourceMetadata,
      artifact,
    });
    const wikiTitle = topicIdentity.wikiTitle;
    const sourceHeading = topicIdentity.sourceHeading;
    const classification = classifyWikiSource({
      title: wikiTitle,
      content: cleanContent,
      projectName: cleanProjectName,
      defaultMode: sourceMetadata.obsidianMode || config.defaultMode || 'project-knowledge',
      routingRules: config.routingRules || {},
      extractionStatus: sourceMetadata.extractionStatus || 'extracted',
    });
    const sourceModeInput = modes.length > 0
      ? modes
      : sourceMetadata.obsidianModes || sourceMetadata.routingModes || classification.classificationModes;
    const preferredModeInput = classification.projectTechnical && modes.length === 0
      ? ['project-knowledge', ...normalizeModes(sourceModeInput, classification.classificationMode)]
      : sourceModeInput;
    const viewModes = normalizeModes(
      preferredModeInput,
      sourceMetadata.obsidianMode || classification.classificationMode || config.defaultMode || 'project-knowledge',
    );
    const selectedTopicKey = readString(topicKey) || (!sourceHeading ? readString(sourceMetadata.topicKey) : '') || topicIdentity.topicKey;
    const wikiTopicSuggestedBy = topicSuggestion?.topicTitle ? 'small-model' : '';
    const wikiTopicSuggestionReason = topicSuggestion?.topicTitle ? topicSuggestion.reason : '';
    const wikiTopicSuggestionModel = topicSuggestion?.topicTitle ? topicSuggestion.model : '';
    const resolvedClassificationReason = classification.projectTechnical
      ? classification.classificationReason
      : sourceMetadata.routingReason || classification.classificationReason;
    const resolvedRoutingMode = classification.projectTechnical
      ? classification.classificationMode
      : sourceMetadata.routingMode || classification.classificationMode;
    const resolvedRoutingSignals = classification.projectTechnical
      ? [...new Set([...(Array.isArray(sourceMetadata.routingSignals) ? sourceMetadata.routingSignals : []), ...classification.routingSignals])]
      : sourceMetadata.routingSignals || classification.routingSignals;
    const resolvedRoutingScores = classification.projectTechnical
      ? { ...(sourceMetadata.routingScores || {}), ...classification.routingScores }
      : sourceMetadata.routingScores || classification.routingScores;
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
        wikiTitle,
        sourceHeading,
        wikiTopicSuggestedBy,
        wikiTopicSuggestionReason,
        wikiTopicSuggestionModel,
        summaryType: cleanSummaryType,
        classificationMode: classification.classificationMode,
        classificationModes: viewModes,
        classificationReason: resolvedClassificationReason,
        routingMode: resolvedRoutingMode,
        routingModes: viewModes,
        routingScores: resolvedRoutingScores,
        routingSignals: resolvedRoutingSignals,
        routingReason: resolvedClassificationReason,
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
    const extractionEngine = readString(sourceMetadata.extractionEngine);
    const extractionFailureReason = readString(sourceMetadata.extractionFailureReason);
    const pdfPageCount = Number(sourceMetadata.pdfPageCount) || 0;
    const pdfExtractedPages = Number(sourceMetadata.pdfExtractedPages) || 0;
    const pdfExtractedChars = Number(sourceMetadata.pdfExtractedChars) || 0;
    const pdfTruncated = Boolean(sourceMetadata.pdfTruncated);
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
      summaryType: cleanSummaryType,
      compileQualityStatus: 'raw',
      compileRepairAttempts: 0,
      compileWarnings: [],
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
        extractionEngine,
        extractionFailureReason,
        pdfPageCount,
        pdfExtractedPages,
        pdfExtractedChars,
        pdfTruncated,
        classificationMode: classification.classificationMode,
        classificationModes: viewModes,
        classificationReason: resolvedClassificationReason,
        sourceHeading,
        wikiTitle,
        wikiTopicSuggestedBy,
        wikiTopicSuggestionReason,
        wikiTopicSuggestionModel,
        tags: ['argus', 'raw', cleanSource],
      });
      rawPath = rawResult.path || rawResult.rawPath || '';

      if (shouldCompile) {
        const compiledContent = await compileWikiContent({
          title: wikiTitle,
          content: cleanContent,
          rawPath,
          sourceIds,
          projectName: cleanProjectName,
          summaryType: cleanSummaryType,
          completeJson: completeSmallModelJson,
        });
        wikiCompileMeta = {
          wikiCompiler: compiledContent.compiler || 'deterministic',
          wikiCompileStrategy: compiledContent.compileStrategy || WIKI_UPLOAD_COMPILE_STRATEGY,
          wikiCompileChunks: Number(compiledContent.chunks) || 0,
          wikiCompileTokenBudget: compiledContent.tokenBudget || WIKI_UPLOAD_TOKEN_BUDGET,
          wikiCompileModel: readString(compiledContent.model),
          wikiCompileFallbackReason: readString(compiledContent.fallbackReason),
          summaryType: compiledContent.summaryType || cleanSummaryType,
          compileQualityStatus: compiledContent.qualityStatus || 'passed',
          compileRepairAttempts: Number(compiledContent.repairAttempts) || 0,
          compileWarnings: Array.isArray(compiledContent.warnings) ? compiledContent.warnings : [],
        };
        const compileResult = await sendObsidianWikiCompile({
          title: wikiTitle,
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
          sourceHeading,
          wikiTopicSuggestedBy,
          wikiTopicSuggestionReason,
          wikiTopicSuggestionModel,
          classificationMode: classification.classificationMode,
          classificationModes: viewModes,
          classificationReason: resolvedClassificationReason,
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
          summaryType: wikiCompileMeta.summaryType,
          compileQualityStatus: wikiCompileMeta.compileQualityStatus,
          compileRepairAttempts: wikiCompileMeta.compileRepairAttempts,
          compileWarnings: wikiCompileMeta.compileWarnings,
        });
        wikiPath = compileResult?.path || compileResult?.wikiPath || '';
        indexPaths = Array.isArray(compileResult?.indexPaths) ? compileResult.indexPaths : [];

        if (wikiPath && indexPaths.length === 0) {
          const viewResult = await updateObsidianWikiViews({
            title: wikiTitle,
            projectName: cleanProjectName,
            sessionId: cleanSessionId,
            wikiPath,
            rawPath,
            sourceIds,
            viewModes,
            classificationMode: classification.classificationMode,
            classificationModes: viewModes,
            classificationReason: resolvedClassificationReason,
            sourceHeading,
            wikiTopicSuggestedBy,
            wikiTopicSuggestionReason,
            wikiTopicSuggestionModel,
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

    const nextWikiStatus = wikiLastError
      ? 'failed'
      : wikiPath
        ? wikiCompileMeta.compileQualityStatus === 'needs-review'
          ? 'needs-review'
          : 'compiled'
        : 'raw';
    const patch = {
      rawPath,
      wikiPath,
      wikiStatus: nextWikiStatus,
      wikiLastError,
      compiledFrom: wikiPath ? sourceIds : [],
      sourceIds,
      contentHash,
      topicKey: selectedTopicKey,
      wikiTitle,
      sourceHeading,
      wikiTopicSuggestedBy,
      wikiTopicSuggestionReason,
      wikiTopicSuggestionModel,
      extractionStatus,
      extractionEngine,
      extractionFailureReason,
      pdfPageCount,
      pdfExtractedPages,
      pdfExtractedChars,
      pdfTruncated,
      classificationMode: classification.classificationMode,
      classificationModes: viewModes,
      classificationReason: resolvedClassificationReason,
      summaryType: cleanSummaryType,
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
      wikiStatus: nextWikiStatus,
      indexPaths,
      viewModes,
      contentHash,
      topicKey: selectedTopicKey,
      wikiTitle,
      sourceHeading,
      wikiTopicSuggestedBy,
      wikiTopicSuggestionReason,
      wikiTopicSuggestionModel,
      mode: viewModes[0],
      modes: viewModes,
      error: wikiLastError,
      ...wikiCompileMeta,
      obsidianBridge: {
        destination,
        rawPath,
        wikiPath,
        wikiStatus: nextWikiStatus,
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
    summaryType = 'auto',
  }) => {
    const extracted = await extractWikiFileContent(file);
    const config = readObsidianBridgeConfig();
    const cleanSummaryType = normalizeSummaryType(summaryType);
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
        summaryType: existing.metadata?.summaryType || cleanSummaryType,
        compileQualityStatus: existing.metadata?.compileQualityStatus || '',
        compileRepairAttempts: existing.metadata?.compileRepairAttempts || 0,
        compileWarnings: existing.metadata?.compileWarnings || [],
      };
    }

    const classification = classifyWikiSource({
      title: extracted.title,
      content: extracted.content,
      projectName,
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
        summaryType: cleanSummaryType,
        extractionStatus: extracted.extractionStatus,
        extractionEngine: extracted.extractionEngine || '',
        extractionFailureReason: extracted.extractionFailureReason || '',
        pdfPageCount: Number(extracted.pdfPageCount) || 0,
        pdfExtractedPages: Number(extracted.pdfExtractedPages) || 0,
        pdfExtractedChars: Number(extracted.pdfExtractedChars) || 0,
        pdfTruncated: Boolean(extracted.pdfTruncated),
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
      summaryType: cleanSummaryType,
    });

    return {
      ...result,
      title: extracted.title,
      wikiStatus: result.wikiStatus || (result.error ? 'failed' : result.wikiPath ? 'compiled' : 'raw'),
      summaryType: cleanSummaryType,
      classificationMode: classification.classificationMode,
      classificationModes: classification.classificationModes,
      classificationReason: classification.classificationReason,
      extractionStatus: extracted.extractionStatus,
      extractionEngine: extracted.extractionEngine || '',
      extractionFailureReason: extracted.extractionFailureReason || '',
      pdfPageCount: Number(extracted.pdfPageCount) || 0,
      pdfExtractedPages: Number(extracted.pdfExtractedPages) || 0,
      pdfExtractedChars: Number(extracted.pdfExtractedChars) || 0,
      pdfTruncated: Boolean(extracted.pdfTruncated),
    };
  };

  const ingestUploadedFilesToObsidian = async ({
    files = [],
    projectName = '',
    sessionId = '',
    batchId = '',
    summaryType = 'auto',
  } = {}) => {
    const importBatchId = readString(batchId) || `import-${now().toISOString().replace(/[:.]/g, '-')}`;
    const imported = [];
    for (const file of files) {
      imported.push(await ingestUploadedFile({
        file,
        projectName,
        sessionId,
        batchId: importBatchId,
        summaryType,
      }));
    }
    return {
      success: true,
      importBatchId,
      imported,
    };
  };

  const compileWikiImport = async ({
    artifactId = '',
    topicKey = '',
    summaryType = '',
    forceRecompile = false,
  } = {}) => {
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
      summaryType,
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
