const MODES = ['project-knowledge', 'second-brain', 'ai-memory'];
const DEFAULT_BASE_FOLDER = 'Argus';

const toDate = (value) => (value instanceof Date ? value : new Date(value || Date.now()));

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const sanitizePathSegment = (value, fallback = 'Untitled') => {
  const sanitized = readString(value)
    .replace(/[\\/]+/g, ' ')
    .replace(/\.\.+/g, ' ')
    .replace(/[<>:"|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return sanitized || fallback;
};

const sanitizeFileName = (value) => sanitizePathSegment(value, 'Untitled');

const normalizeMode = (mode) => (MODES.includes(mode) ? mode : 'project-knowledge');

const normalizeTags = (tags) => (
  Array.isArray(tags)
    ? [...new Set(tags.map(readString).filter(Boolean))]
    : []
);

const normalizePayload = (payload = {}) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const title = readString(source.title);
  if (!title) {
    throw new Error('Document title is required.');
  }
  if (typeof source.content !== 'string') {
    throw new Error('Document content is required.');
  }

  return {
    title,
    content: source.content,
    mode: normalizeMode(source.mode),
    projectName: readString(source.projectName),
    sessionId: readString(source.sessionId),
    argusId: readString(source.argusId),
    tags: normalizeTags(source.tags),
    metadata: source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
      ? source.metadata
      : {},
    baseFolder: readString(source.baseFolder || source.writeBaseFolder),
    kind: readString(source.kind),
    status: readString(source.status),
    sourceArtifactId: readString(source.sourceArtifactId),
    templateId: readString(source.templateId),
    related: normalizeTags(source.related),
    confidence: Number.isFinite(Number(source.confidence)) ? Math.min(Math.max(Number(source.confidence), 0), 1) : null,
  };
};

const getYear = (now) => String(toDate(now).getUTCFullYear());

const buildTargetDirectory = (payload = {}, now = new Date(), options = {}) => {
  const document = { mode: normalizeMode(payload.mode), projectName: readString(payload.projectName) };
  const baseFolder = sanitizePathSegment(options.baseFolder || DEFAULT_BASE_FOLDER, DEFAULT_BASE_FOLDER);

  if (document.mode === 'second-brain') {
    return `${baseFolder}/SecondBrain/${getYear(now)}`;
  }

  if (document.mode === 'ai-memory') {
    return `${baseFolder}/AIMemory/${sanitizePathSegment(document.projectName, 'General')}`;
  }

  return `${baseFolder}/Projects/${sanitizePathSegment(document.projectName, 'General')}`;
};

const buildFileName = (title) => `${sanitizeFileName(title)}.md`;

const buildDocumentPath = (payload = {}, now = new Date(), options = {}) => {
  const folder = buildTargetDirectory(payload, now, options);
  const fileName = buildFileName(payload.title);
  return `${folder}/${fileName}`;
};

const getDay = (now) => toDate(now).toISOString().slice(0, 10);

const buildWikiRawPath = (payload = {}, now = new Date(), options = {}) => {
  const baseFolder = sanitizePathSegment(options.baseFolder || DEFAULT_BASE_FOLDER, DEFAULT_BASE_FOLDER);
  const projectName = sanitizePathSegment(payload.projectName, 'General');
  return `${baseFolder}/Raw/${projectName}/${getDay(now)}/${buildFileName(payload.title)}`;
};

const buildWikiPath = (payload = {}, _now = new Date(), options = {}) => {
  const baseFolder = sanitizePathSegment(options.baseFolder || DEFAULT_BASE_FOLDER, DEFAULT_BASE_FOLDER);
  const projectName = sanitizePathSegment(payload.projectName, 'General');
  return `${baseFolder}/Wiki/${projectName}/${buildFileName(payload.topicKey || payload.title)}`;
};

const buildWikiSchemaPath = (options = {}) => {
  const baseFolder = sanitizePathSegment(options.baseFolder || DEFAULT_BASE_FOLDER, DEFAULT_BASE_FOLDER);
  return `${baseFolder}/_Meta/Schema.md`;
};

const buildWikiIndexPath = (options = {}) => {
  const baseFolder = sanitizePathSegment(options.baseFolder || DEFAULT_BASE_FOLDER, DEFAULT_BASE_FOLDER);
  return `${baseFolder}/_Indexes/Uploads.md`;
};

const assertSafeVaultPath = (path) => {
  const value = readString(path);
  if (!value || value.includes('\\') || value.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error('Unsafe vault path.');
  }
  if (!value.endsWith('.md')) {
    throw new Error('Argus bridge only writes Markdown files.');
  }
  return value;
};

const yamlKey = (key) => readString(key).replace(/[^a-zA-Z0-9_-]/g, '');

const needsQuotes = (value) => (
  value === ''
    || /^[\s[\]{}#&*!|>'"%@`,]/.test(value)
    || /[:]\s/.test(value)
    || /\n/.test(value)
);

const quoteYaml = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const formatYamlScalar = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  const stringValue = value == null ? '' : String(value);
  return needsQuotes(stringValue) ? quoteYaml(stringValue) : stringValue;
};

const formatYamlValue = (key, value) => {
  const cleanKey = yamlKey(key);
  if (!cleanKey) {
    return [];
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (entry == null ? '' : String(entry).trim()))
      .filter(Boolean);
    if (items.length === 0) {
      return [`${cleanKey}: []`];
    }
    return [
      `${cleanKey}:`,
      ...items.map((entry) => `  - ${formatYamlScalar(entry)}`),
    ];
  }
  if (value && typeof value === 'object') {
    return [`${cleanKey}: ${quoteYaml(JSON.stringify(value))}`];
  }
  return [`${cleanKey}: ${formatYamlScalar(value)}`];
};

const buildProperties = (payload = {}, now = new Date(), options = {}) => {
  const document = normalizePayload(payload);
  const timestamp = toDate(now).toISOString();
  const properties = {
    type: document.mode,
    source: 'argus',
    project: document.projectName,
    sessionId: document.sessionId,
    created: options.created || timestamp,
    updated: timestamp,
    tags: document.tags,
    argusId: document.argusId,
    kind: document.kind,
    status: document.status,
    related: document.related,
    confidence: document.confidence,
    sourceArtifactId: document.sourceArtifactId,
    templateId: document.templateId,
  };

  const reserved = new Set(Object.keys(properties));
  for (const [key, value] of Object.entries(document.metadata || {})) {
    const cleanKey = yamlKey(key);
    if (!cleanKey || reserved.has(cleanKey)) {
      continue;
    }
    properties[cleanKey] = value;
  }

  return properties;
};

const formatFrontmatter = (properties) => {
  const lines = ['---'];
  for (const [key, value] of Object.entries(properties)) {
    if (value === '' || value == null || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    lines.push(...formatYamlValue(key, value));
  }
  lines.push('---');
  return lines.join('\n');
};

const renderTemplate = (template, document) => (
  String(template || '{{content}}').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = document[key];
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    return value == null ? '' : String(value);
  })
);

const selectTemplate = (document, templates = {}) => {
  if (!templates || typeof templates !== 'object') {
    return '{{content}}';
  }
  return templates[document.templateId]
    || templates[document.mode]
    || templates[document.kind]
    || '{{content}}';
};

const formatDocument = (payload = {}, now = new Date(), options = {}) => {
  const document = normalizePayload(payload);
  const properties = buildProperties(document, now, options);
  const content = renderTemplate(selectTemplate(document, options.templates), document);
  return `${formatFrontmatter(properties)}\n\n${content}`;
};

const normalizeStringArray = (value) => (
  Array.isArray(value)
    ? [...new Set(value.map(readString).filter(Boolean))]
    : []
);

const buildWikiProperties = (payload = {}, now = new Date(), type = 'raw-source') => {
  const timestamp = toDate(now).toISOString();
  const properties = {
    type,
    source: readString(payload.source) || 'argus',
    project: readString(payload.projectName),
    created: payload.created || timestamp,
    updated: timestamp,
    tags: normalizeStringArray(payload.tags || ['argus', type === 'raw-source' ? 'raw' : 'wiki']),
    argusId: readString(payload.argusId),
    importBatchId: readString(payload.importBatchId),
    contentHash: readString(payload.contentHash),
    sourcePath: readString(payload.sourcePath),
    sourceIds: normalizeStringArray(payload.sourceIds),
    compiledFrom: normalizeStringArray(payload.compiledFrom),
    rawPath: readString(payload.rawPath),
    wikiPath: readString(payload.wikiPath),
    classificationMode: readString(payload.classificationMode),
    classificationReason: readString(payload.classificationReason),
    extractionStatus: readString(payload.extractionStatus),
    wikiStatus: readString(payload.wikiStatus) || (type === 'raw-source' ? 'raw' : 'compiled'),
    status: readString(payload.status) || (type === 'wiki-note' ? 'active' : ''),
    related: normalizeStringArray(payload.related),
    compiler: readString(payload.compiler || payload.wikiCompiler),
    compileStrategy: readString(payload.compileStrategy || payload.wikiCompileStrategy),
    wikiCompileChunks: Number(payload.wikiCompileChunks) || undefined,
    wikiCompileTokenBudget: payload.wikiCompileTokenBudget && typeof payload.wikiCompileTokenBudget === 'object'
      ? payload.wikiCompileTokenBudget
      : undefined,
    wikiCompileModel: readString(payload.wikiCompileModel),
    wikiCompileFallbackReason: readString(payload.wikiCompileFallbackReason),
  };

  return Object.fromEntries(Object.entries(properties).filter(([, value]) => !(
    value === '' || value == null || (Array.isArray(value) && value.length === 0)
  )));
};

const formatWikiSourceDocument = (payload = {}, now = new Date()) => {
  const properties = buildWikiProperties({
    ...payload,
    wikiStatus: payload.wikiStatus || 'raw',
  }, now, 'raw-source');
  return `${formatFrontmatter(properties)}\n\n${String(payload.content || '').trimEnd()}\n`;
};

const formatWikiCompiledDocument = (payload = {}, now = new Date()) => {
  const properties = buildWikiProperties({
    ...payload,
    source: payload.source || 'argus',
    wikiStatus: payload.wikiStatus || 'compiled',
    status: payload.status || 'active',
  }, now, 'wiki-note');
  return `${formatFrontmatter(properties)}\n\n${String(payload.content || '').trimEnd()}\n`;
};

const formatWikiSchemaDocument = (baseFolder = DEFAULT_BASE_FOLDER) => [
  '# Argus Wiki Schema',
  '',
  '## Core folders',
  `- \`${baseFolder}/Raw/<project>/<YYYY-MM-DD>/\`: immutable extracted source notes.`,
  `- \`${baseFolder}/Wiki/<project>/\`: compiled, linked, durable wiki pages.`,
  `- \`${baseFolder}/_Indexes/\`: generated import and topic indexes.`,
  '',
  '## Required Properties',
  '- Raw notes: `type`, `source`, `project`, `contentHash`, `importBatchId`, `wikiStatus`.',
  '- Wiki notes: `type`, `project`, `compiledFrom`, `wikiStatus`, `status`.',
  '',
  '## Managed Policy',
  'Argus only rewrites managed Raw/Wiki notes by `argusId` and managed index blocks.',
].join('\n');

const buildWikiUploadIndex = ({ entries = [], existingContent = '' } = {}) => {
  const start = '<!-- argus-bridge:wiki-imports:start -->';
  const end = '<!-- argus-bridge:wiki-imports:end -->';
  const lines = [
    start,
    ...entries.map((entry) => {
      const title = readString(entry.title || entry.path || 'Import');
      const raw = entry.rawPath ? ` raw: ${noteLinkForPath(entry.rawPath, title)}` : '';
      const wiki = entry.wikiPath ? ` wiki: ${noteLinkForPath(entry.wikiPath, title)}` : '';
      const status = entry.wikiStatus ? ` status: ${entry.wikiStatus}` : '';
      return `- ${title}${status}${raw}${wiki}`;
    }),
    end,
  ];
  const block = lines.join('\n');
  const content = existingContent && String(existingContent).trim()
    ? String(existingContent)
    : `# Argus Wiki Imports\n\n${start}\n${end}\n`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return `${content.trim()}\n\n${block}\n`;
};

const resolveUniquePath = (basePath, exists) => {
  const safePath = assertSafeVaultPath(basePath);
  if (!exists(safePath)) {
    return safePath;
  }

  const withoutExt = safePath.replace(/\.md$/i, '');
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${withoutExt} ${index}.md`;
    if (!exists(candidate)) {
      return candidate;
    }
  }
  throw new Error('Could not choose a unique note path.');
};

const getFrontmatter = (content = '') => {
  const text = String(content || '');
  if (!text.startsWith('---\n')) {
    return '';
  }
  const endIndex = text.indexOf('\n---', 4);
  return endIndex === -1 ? '' : text.slice(4, endIndex);
};

const splitFrontmatter = (content = '') => {
  const text = String(content || '');
  if (!text.startsWith('---\n')) {
    return { frontmatter: '', body: text };
  }
  const endIndex = text.indexOf('\n---', 4);
  if (endIndex === -1) {
    return { frontmatter: '', body: text };
  }
  const bodyStart = endIndex + '\n---'.length;
  return {
    frontmatter: text.slice(4, endIndex),
    body: text.slice(text[bodyStart] === '\n' ? bodyStart + 1 : bodyStart),
  };
};

const parseYamlScalar = (value) => {
  const raw = String(value ?? '').trim();
  const unquoted = raw.replace(/^['"]|['"]$/g, '');
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return unquoted;
};

const parseInlineArray = (value) => String(value || '')
  .replace(/^\[|\]$/g, '')
  .split(',')
  .map((entry) => parseYamlScalar(entry))
  .filter((entry) => entry !== '');

const parseFrontmatter = (content = '') => {
  const yaml = getFrontmatter(content);
  const properties = {};
  const lines = yaml.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value === '') {
      const items = [];
      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(parseYamlScalar(lines[index].replace(/^\s+-\s+/, '')));
      }
      properties[key] = items;
      continue;
    }
    properties[key] = /^\[.*\]$/.test(value) ? parseInlineArray(value) : parseYamlScalar(value);
  }
  return properties;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findPathByArgusId = (files = [], argusId = '') => {
  const id = readString(argusId);
  if (!id) {
    return null;
  }
  const pattern = new RegExp(`^argusId:\\s*['"]?${escapeRegExp(id)}['"]?\\s*$`, 'm');
  const match = files.find((file) => (
    file?.path
      && String(file.path).endsWith('.md')
      && pattern.test(getFrontmatter(file.content))
  ));
  return match?.path || null;
};

const readProperty = (content = '', propertyName = '') => {
  const key = yamlKey(propertyName);
  if (!key) {
    return '';
  }
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*['"]?(.+?)['"]?\\s*$`, 'm');
  const match = getFrontmatter(content).match(pattern);
  return match?.[1]?.trim() || '';
};

const fileNameFromPath = (path = '') => String(path).split('/').pop() || 'Untitled';
const baseNameFromPath = (path = '') => fileNameFromPath(path).replace(/\.(canvas|md)$/i, '').replace(/\.excalidraw$/i, '');

const titleFromContent = (content = '', fallback = 'Untitled') => {
  const heading = String(content || '').match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
};

const noteLinkForPath = (path = '', title = '') => {
  const baseName = String(path).split('/').pop()?.replace(/\.md$/i, '') || title || 'Untitled';
  return `[[${baseName}|${title || baseName}]]`;
};

const buildProjectIndex = ({ projectName = 'General', entries = [], existingContent = '' } = {}) => {
  const title = sanitizePathSegment(projectName, 'General');
  const start = '<!-- argus-bridge:index:start -->';
  const end = '<!-- argus-bridge:index:end -->';
  const lines = [
    start,
    ...entries
      .filter((entry) => entry?.path && String(entry.path).endsWith('.md') && !String(entry.path).endsWith('/Index.md'))
      .map((entry) => `- ${noteLinkForPath(entry.path, entry.title)}${entry.kind ? ` - ${entry.kind}` : ''}`),
    end,
  ];
  const block = lines.join('\n');
  const content = existingContent && String(existingContent).trim()
    ? String(existingContent)
    : `# ${title}\n\n## Argus Knowledge\n\n${start}\n${end}\n`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return `${content.trim()}\n\n## Argus Knowledge\n\n${block}\n`;
};

const modeViewTitle = (mode = 'project-knowledge', projectName = 'General', now = new Date()) => {
  if (mode === 'second-brain') {
    return String(toDate(now).getFullYear());
  }
  return sanitizePathSegment(projectName, 'General');
};

const buildWikiViewIndex = ({
  mode = 'project-knowledge',
  projectName = 'General',
  entries = [],
  existingContent = '',
  now = new Date(),
} = {}) => {
  const title = modeViewTitle(mode, projectName, now);
  const start = '<!-- argus-bridge:wiki-view:start -->';
  const end = '<!-- argus-bridge:wiki-view:end -->';
  const existingBlock = String(existingContent || '').match(new RegExp(`${start}([\\s\\S]*?)${end}`))?.[1] || '';
  const existingLines = existingBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
  const newLines = entries
    .filter((entry) => entry?.wikiPath && String(entry.wikiPath).endsWith('.md'))
    .map((entry) => [
      `- ${noteLinkForPath(entry.wikiPath, entry.title)}`,
      entry.kind ? ` - ${entry.kind}` : '',
      entry.classificationReason ? ` - ${entry.classificationReason}` : '',
      entry.rawPath ? ` (source: ${noteLinkForPath(entry.rawPath, 'Raw')})` : '',
    ].join(''));
  const replacedTitles = new Set(entries.map((entry) => String(entry?.title || '').toLowerCase()).filter(Boolean));
  const lines = [
    start,
    ...newLines,
    ...existingLines.filter((line) => {
      const titleMatch = line.match(/\[\[[^\]|]+(?:\|([^\]]+))?\]\]/)?.[1];
      return !titleMatch || !replacedTitles.has(titleMatch.toLowerCase());
    }),
    end,
  ];
  const block = lines.join('\n');
  const content = existingContent && String(existingContent).trim()
    ? String(existingContent)
    : `# ${title}\n\n## Argus Wiki Index\n\n${start}\n${end}\n`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return `${content.trim()}\n\n## Argus Wiki Index\n\n${block}\n`;
};

const normalizeReadableFolder = (folder) => sanitizePathSegment(folder, '')
  .replace(/ /g, '/')
  .replace(/\/+/g, '/')
  .replace(/^\/+|\/+$/g, '');

const isPathInReadableFolder = (path = '', readableFolders = []) => {
  const value = String(path || '').replace(/\\/g, '/');
  return readableFolders.some((folder) => {
    const normalized = normalizeReadableFolder(folder);
    return normalized && (value === normalized || value.startsWith(`${normalized}/`));
  });
};

const detectSourceType = (file = {}) => {
  const path = String(file.path || '').toLowerCase();
  if (path.endsWith('.canvas')) return 'canvas';
  if (path.endsWith('.excalidraw.md') || path.endsWith('.excalidraw')) return 'excalidraw';
  return 'markdown';
};

const extractCanvasText = (content = '') => {
  try {
    const canvas = JSON.parse(String(content || '{}'));
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
    const edges = Array.isArray(canvas.edges) ? canvas.edges : [];
    return [
      ...nodes.map((node) => [node.text, node.label, node.file, node.url].filter(Boolean).join(' ')),
      ...edges.map((edge) => [edge.label, edge.fromNode, edge.toNode].filter(Boolean).join(' ')),
    ].filter(Boolean).join('\n');
  } catch {
    return '';
  }
};

const normalizeLinkTitle = (value = '') => String(value || '').split('|')[0].split('#')[0].trim();

const extractWikiLinks = (content = '') => {
  const links = [];
  const seen = new Set();
  const pattern = /\[\[([^\]]+)\]\]/g;
  let match = pattern.exec(String(content || ''));
  while (match) {
    const title = normalizeLinkTitle(match[1]);
    if (title && !seen.has(title)) {
      seen.add(title);
      links.push(title);
    }
    match = pattern.exec(String(content || ''));
  }
  return links;
};

const extractHeadings = (content = '') => {
  const headings = [];
  String(content || '').split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: index,
      });
    }
  });
  return headings;
};

const extractNoteMetadata = (file = {}, options = {}) => {
  const sourceType = detectSourceType(file);
  const path = String(file.path || '');
  const rawContent = String(file.content || '');
  const indexedContent = sourceType === 'canvas' ? extractCanvasText(rawContent) : rawContent;
  const properties = sourceType === 'markdown' || sourceType === 'excalidraw'
    ? parseFrontmatter(rawContent)
    : {};
  const headings = sourceType === 'canvas' ? [] : extractHeadings(rawContent);
  const links = extractWikiLinks(rawContent);
  const title = titleFromContent(rawContent, baseNameFromPath(path));
  return {
    vaultId: readString(file.vaultId || options.vaultId),
    vaultName: readString(file.vaultName || options.vaultName),
    path,
    title,
    content: options.includeContent === false ? undefined : rawContent,
    indexedContent,
    selection: typeof file.selection === 'string' ? file.selection : undefined,
    cursor: file.cursor,
    properties,
    headings,
    links,
    sourceType,
  };
};

const snippetForQuery = (content = '', query = '') => {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  const needle = readString(query).toLowerCase();
  if (!needle) {
    return text.slice(0, 240);
  }
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) {
    return text.slice(0, 240);
  }
  return text.slice(Math.max(0, index - 80), index + 160);
};

const lookupFilterValue = (note, field = '') => {
  const key = String(field || '').trim();
  if (!key) return undefined;
  if (key === 'path') return note.path;
  if (key === 'title') return note.title;
  if (key === 'content') return note.indexedContent || note.content || '';
  if (key === 'headings') return note.headings.map((heading) => heading.text);
  if (key === 'links') return note.links;
  if (key === 'sourceType') return note.sourceType;
  if (key === 'tags') return note.properties.tags || [];
  return note.properties[key];
};

const compareValues = (actual, op, expected) => {
  if (op === 'exists') {
    return actual !== undefined && actual !== null && actual !== '' && (!Array.isArray(actual) || actual.length > 0);
  }
  if (op === 'contains') {
    if (Array.isArray(actual)) {
      return actual.map((entry) => String(entry).toLowerCase()).includes(String(expected).toLowerCase());
    }
    return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
  }
  if (op === 'in') {
    const expectedList = Array.isArray(expected) ? expected : [expected];
    if (Array.isArray(actual)) {
      return actual.some((entry) => expectedList.map(String).includes(String(entry)));
    }
    return expectedList.map(String).includes(String(actual));
  }
  if (op === 'neq') {
    return String(actual) !== String(expected);
  }
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    const left = Number(actual);
    const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (op === 'gt') return left > right;
    if (op === 'gte') return left >= right;
    if (op === 'lt') return left < right;
    return left <= right;
  }
  return String(actual) === String(expected);
};

const queryReadableFiles = (files = [], options = {}) => {
  const query = readString(options.query).toLowerCase();
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(Number(options.limit), 100)) : 10;
  const readableFolders = Array.isArray(options.readableFolders) ? options.readableFolders : [];
  const sourceTypes = Array.isArray(options.sourceTypes) && options.sourceTypes.length > 0
    ? new Set(options.sourceTypes)
    : null;
  const filters = Array.isArray(options.filters) ? options.filters : [];

  return files
    .map((file) => extractNoteMetadata(file))
    .filter((note) => note.path && isPathInReadableFolder(note.path, readableFolders))
    .filter((note) => !sourceTypes || sourceTypes.has(note.sourceType))
    .filter((note) => {
      if (!query) return true;
      return [
        note.path,
        note.title,
        note.indexedContent || note.content || '',
        note.headings.map((heading) => heading.text).join('\n'),
        note.links.join('\n'),
      ].join('\n').toLowerCase().includes(query);
    })
    .filter((note) => filters.every((filter) => compareValues(
      lookupFilterValue(note, filter.field),
      filter.op || 'eq',
      filter.value,
    )))
    .slice(0, limit)
    .map((note) => ({
      path: note.path,
      title: note.title,
      snippet: snippetForQuery(note.indexedContent || note.content || '', query),
      properties: note.properties,
      tags: Array.isArray(note.properties.tags) ? note.properties.tags : [],
      headings: note.headings,
      links: note.links,
      sourceType: note.sourceType,
    }));
};

const searchReadableFiles = (files = [], options = {}) => {
  return queryReadableFiles(files, {
    ...options,
    sourceTypes: ['markdown'],
  }).map((result) => ({
    path: result.path,
    title: result.title,
    snippet: result.snippet,
  }));
};

const buildContextFromSearchResults = (results = []) => (
  results.map((result) => [
    `Path: ${result.path}`,
    `Title: ${result.title}`,
    result.snippet,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')
);

const normalizeHeadingText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

const findHeadingSection = (lines, heading, occurrence = 1) => {
  const target = normalizeHeadingText(heading);
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match || normalizeHeadingText(match[2]) !== target) {
      continue;
    }
    seen += 1;
    if (seen !== occurrence) {
      continue;
    }
    const level = match[1].length;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = lines[cursor].match(/^(#{1,6})\s+/);
      if (nextHeading && nextHeading[1].length <= level) {
        end = cursor;
        break;
      }
    }
    return { start: index, end, level, count: seen };
  }
  return null;
};

const patchMarkdownContent = (content = '', payload = {}) => {
  const operation = payload.operation;
  if (operation === 'upsert-frontmatter') {
    const { body } = splitFrontmatter(content);
    const properties = {
      ...parseFrontmatter(content),
      ...(payload.properties && typeof payload.properties === 'object' ? payload.properties : {}),
    };
    return {
      changed: true,
      content: `${formatFrontmatter(properties)}\n${body.startsWith('\n') ? body : `\n${body}`}`,
    };
  }

  if (!['append-heading', 'replace-heading'].includes(operation)) {
    throw new Error('Unsupported patch operation.');
  }
  const heading = readString(payload.heading);
  if (!heading) {
    throw new Error('Patch heading is required.');
  }
  const lines = String(content || '').split(/\r?\n/);
  const section = findHeadingSection(lines, heading, Math.max(1, Number.parseInt(String(payload.occurrence || 1), 10) || 1));
  const patchContent = String(payload.content || '').replace(/\s+$/g, '');

  if (!section) {
    if (!payload.createHeading) {
      throw new Error('Heading not found.');
    }
    const prefix = lines.join('\n').trimEnd();
    return {
      changed: true,
      matchedHeadingCount: 0,
      content: `${prefix}${prefix ? '\n\n' : ''}## ${heading}\n${patchContent}`,
    };
  }

  const nextLines = [...lines];
  if (operation === 'replace-heading') {
    nextLines.splice(section.start + 1, section.end - section.start - 1, patchContent);
  } else {
    const sectionBody = nextLines.slice(section.start + 1, section.end).join('\n').trimEnd();
    const replacement = sectionBody ? `${sectionBody}\n\n${patchContent}` : patchContent;
    nextLines.splice(section.start + 1, section.end - section.start - 1, replacement);
  }

  return {
    changed: true,
    matchedHeadingCount: section.count,
    content: nextLines.join('\n'),
  };
};

const appendToPeriodicContent = (existingContent = '', options = {}) => {
  const heading = readString(options.heading) || 'Argus';
  const title = readString(options.title) || new Date().toISOString().slice(0, 10);
  const content = String(options.content || '').trimEnd();
  const initial = readString(existingContent)
    ? String(existingContent)
    : `# ${title}\n`;
  return patchMarkdownContent(initial, {
    operation: 'append-heading',
    heading,
    content,
    createHeading: true,
  }).content;
};

const extractManagedMocEntries = (content = '') => {
  const start = '<!-- argus-bridge:index:start -->';
  const end = '<!-- argus-bridge:index:end -->';
  const match = String(content || '').match(new RegExp(`${start}([\\s\\S]*?)${end}`));
  if (!match) return [];
  return extractWikiLinks(match[1]).map((title) => ({ title }));
};

const buildKnowledgeGraph = (files = [], options = {}) => {
  const readableFolders = Array.isArray(options.readableFolders) ? options.readableFolders : [];
  const notes = files
    .map((file) => extractNoteMetadata(file))
    .filter((note) => note.path && isPathInReadableFolder(note.path, readableFolders));
  const nodes = notes.map((note) => ({
    path: note.path,
    title: note.title,
    sourceType: note.sourceType,
    properties: note.properties,
  }));
  const edges = [];
  const mocEntries = [];

  for (const note of notes) {
    for (const link of note.links) {
      edges.push({ from: note.path, toTitle: link, type: 'link' });
    }
    const related = Array.isArray(note.properties.related) ? note.properties.related : [];
    for (const item of related) {
      const title = normalizeLinkTitle(String(item).replace(/^\[\[|\]\]$/g, ''));
      if (title) {
        edges.push({ from: note.path, toTitle: title, type: 'related' });
      }
    }
    const noteMocEntries = extractManagedMocEntries(note.content || '');
    for (const entry of noteMocEntries) {
      mocEntries.push(entry);
      edges.push({ from: note.path, toTitle: entry.title, type: 'moc' });
    }
  }

  return { nodes, edges, mocEntries };
};

const duplicateKeyForNote = (file = {}) => {
  const properties = parseFrontmatter(file.content || '');
  const argusId = readString(properties.argusId);
  if (argusId) return `argusId:${argusId}`;
  const sourceArtifactId = readString(properties.sourceArtifactId);
  if (sourceArtifactId) return `sourceArtifactId:${sourceArtifactId}`;
  const contentHash = readString(properties.contentHash);
  if (contentHash) return `contentHash:${contentHash}`;
  return '';
};

const noteUpdatedTime = (file = {}) => {
  const properties = parseFrontmatter(file.content || '');
  const candidates = [
    properties.updated,
    properties.updatedAt,
    properties.created,
    file.mtime,
  ];
  for (const value of candidates) {
    const time = value instanceof Date ? value.getTime() : Number.isFinite(Number(value)) ? Number(value) : Date.parse(String(value || ''));
    if (Number.isFinite(time)) return time;
  }
  return 0;
};

const archiveDate = (now = new Date()) => toDate(now).toISOString().slice(0, 10);

const makeUniqueArchivePath = (targetPath, used) => {
  const safePath = assertSafeVaultPath(targetPath);
  if (!used.has(safePath)) {
    used.add(safePath);
    return safePath;
  }
  const withoutExt = safePath.replace(/\.md$/i, '');
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${withoutExt} ${index}.md`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error('Could not choose a unique duplicate archive path.');
};

const planDuplicateArchives = (files = [], options = {}) => {
  const archiveRoot = String(options.archiveRoot || 'Argus/_duplicates')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const groupsByKey = new Map();
  for (const file of files) {
    if (!file?.path || !String(file.path).endsWith('.md')) continue;
    const key = duplicateKeyForNote(file);
    if (!key) continue;
    const group = groupsByKey.get(key) || [];
    group.push({
      ...file,
      duplicateKey: key,
      updatedTime: noteUpdatedTime(file),
    });
    groupsByKey.set(key, group);
  }

  const usedArchivePaths = new Set();
  const groups = [];
  const moves = [];
  const datedArchiveRoot = `${archiveRoot}/${archiveDate(options.now)}`;

  for (const [key, group] of groupsByKey.entries()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((left, right) => (
      right.updatedTime - left.updatedTime || String(right.path).localeCompare(String(left.path))
    ));
    const retained = sorted[0];
    const archiveMoves = sorted.slice(1).map((file) => {
      const targetPath = makeUniqueArchivePath(`${datedArchiveRoot}/${fileNameFromPath(file.path)}`, usedArchivePaths);
      return {
        key,
        from: file.path,
        to: targetPath,
        retainedPath: retained.path,
      };
    });
    groups.push({
      key,
      retainedPath: retained.path,
      duplicatePaths: sorted.slice(1).map((file) => file.path),
      count: group.length,
    });
    moves.push(...archiveMoves);
  }

  return { groups, moves };
};

const titleKeyForWiki = (note) => normalizeHeadingText(note.title || baseNameFromPath(note.path));

const lintWikiFiles = (files = [], options = {}) => {
  const baseFolder = sanitizePathSegment(options.baseFolder || DEFAULT_BASE_FOLDER, DEFAULT_BASE_FOLDER);
  const rawPrefix = `${baseFolder}/Raw/`;
  const wikiPrefix = `${baseFolder}/Wiki/`;
  const notes = files
    .filter((file) => file?.path && String(file.path).endsWith('.md'))
    .map((file) => extractNoteMetadata(file));
  const wikiNotes = notes.filter((note) => note.path.startsWith(wikiPrefix));
  const rawNotes = notes.filter((note) => note.path.startsWith(rawPrefix));
  const allTitles = new Set(notes.flatMap((note) => [
    titleKeyForWiki(note),
    normalizeHeadingText(baseNameFromPath(note.path)),
  ]).filter(Boolean));
  const issues = [];

  for (const note of rawNotes) {
    const missing = ['type', 'contentHash', 'importBatchId', 'wikiStatus']
      .filter((key) => !compareValues(note.properties[key], 'exists'));
    if (missing.length > 0) {
      issues.push({ type: 'missing-properties', path: note.path, missing });
    }
    if (note.properties.wikiStatus !== 'compiled' || !note.properties.wikiPath) {
      issues.push({ type: 'uncompiled-raw', path: note.path, title: note.title });
    }
  }

  for (const note of wikiNotes) {
    const missing = ['type', 'compiledFrom', 'wikiStatus']
      .filter((key) => !compareValues(note.properties[key], 'exists'));
    if (missing.length > 0) {
      issues.push({ type: 'missing-properties', path: note.path, missing });
    }
    for (const link of note.links) {
      if (!allTitles.has(normalizeHeadingText(link))) {
        issues.push({ type: 'broken-link', path: note.path, target: link });
      }
    }
  }

  const wikiByTitle = new Map();
  for (const note of wikiNotes) {
    const key = titleKeyForWiki(note);
    const group = wikiByTitle.get(key) || [];
    group.push(note);
    wikiByTitle.set(key, group);
  }
  for (const [key, group] of wikiByTitle.entries()) {
    if (key && group.length > 1) {
      issues.push({
        type: 'duplicate-topic',
        title: group[0].title,
        paths: group.map((note) => note.path),
      });
    }
  }

  const inbound = new Set();
  for (const note of wikiNotes) {
    for (const link of note.links) {
      inbound.add(normalizeHeadingText(link));
    }
  }
  for (const note of wikiNotes) {
    const key = titleKeyForWiki(note);
    if (wikiNotes.length > 1 && key && !inbound.has(key) && note.links.length === 0) {
      issues.push({ type: 'orphan-wiki', path: note.path, title: note.title });
    }
  }

  return {
    success: true,
    checked: rawNotes.length + wikiNotes.length,
    issues,
  };
};

module.exports = {
  MODES,
  DEFAULT_BASE_FOLDER,
  appendToPeriodicContent,
  assertSafeVaultPath,
  buildKnowledgeGraph,
  buildDocumentPath,
  buildFileName,
  buildWikiIndexPath,
  buildWikiPath,
  buildWikiRawPath,
  buildWikiSchemaPath,
  buildContextFromSearchResults,
  buildProjectIndex,
  buildWikiViewIndex,
  buildProperties,
  buildTargetDirectory,
  buildWikiUploadIndex,
  findPathByArgusId,
  formatDocument,
  formatFrontmatter,
  formatWikiCompiledDocument,
  formatWikiSchemaDocument,
  formatWikiSourceDocument,
  extractNoteMetadata,
  lintWikiFiles,
  normalizeMode,
  normalizePayload,
  parseFrontmatter,
  patchMarkdownContent,
  planDuplicateArchives,
  queryReadableFiles,
  readProperty,
  resolveUniquePath,
  sanitizePathSegment,
  searchReadableFiles,
};
