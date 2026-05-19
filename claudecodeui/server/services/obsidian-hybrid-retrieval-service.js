import crypto from 'node:crypto';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizePath = (value = '') => readString(value).replace(/\\/g, '/').replace(/\/+$/g, '');

const hashBlockId = (...parts) => (
  `obsidian-block:${crypto.createHash('sha1').update(parts.map(readString).join('\n')).digest('hex').slice(0, 16)}`
);

const isArchivedOrDeleted = (result = {}) => {
  const status = readString(result.properties?.status || result.properties?.wikiStatus || result.status || result.wikiStatus).toLowerCase();
  return result.deleted === true || ['archived', 'forgotten', 'deleted', 'trash', 'trashed'].includes(status);
};

const splitHeadingChunks = (result = {}) => {
  const content = readString(result.content || result.markdown || result.snippet);
  const fallbackTitle = readString(result.title) || normalizePath(result.path).split('/').pop()?.replace(/\.md$/i, '') || 'Untitled';
  if (!content) {
    return [{
      headingPath: fallbackTitle,
      text: readString(result.snippet || result.summary || fallbackTitle),
    }];
  }

  const lines = content.split(/\r?\n/);
  const chunks = [];
  let currentHeading = fallbackTitle;
  let buffer = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (buffer.join('\n').trim()) {
        chunks.push({ headingPath: currentHeading, text: buffer.join('\n').trim() });
      }
      currentHeading = heading[2].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.join('\n').trim()) {
    chunks.push({ headingPath: currentHeading, text: buffer.join('\n').trim() });
  }
  return chunks.length > 0 ? chunks : [{ headingPath: fallbackTitle, text: content }];
};

const clampSourceText = (value = '', maxTokens = 600) => {
  const text = readString(value).replace(/\n{3,}/g, '\n\n');
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxTokens) {
    return text;
  }
  return `${words.slice(0, maxTokens).join(' ')} ...`;
};

const modifiedRecencyScore = (modifiedAt = '', now = new Date()) => {
  const modified = new Date(modifiedAt);
  if (!Number.isFinite(modified.getTime())) return 0;
  const ageDays = Math.max(0, (now.getTime() - modified.getTime()) / 86400000);
  return Math.max(0, 1 - ageDays / 30);
};

const inferProjectSegment = ({ projectName = '', activeNote = null, selectedSources = [] } = {}) => {
  if (readString(projectName)) return readString(projectName);
  const candidates = [
    activeNote?.path,
    ...selectedSources,
  ].map(normalizePath);
  for (const path of candidates) {
    const match = path.match(/^Argus\/(?:Wiki|AIMemory|Raw)\/([^/]+)/i);
    if (match?.[1]) return match[1];
  }
  return '';
};

const isProjectScopedPath = (filePath = '', projectSegment = '') => {
  if (!projectSegment) return true;
  const path = normalizePath(filePath);
  return path.startsWith(`Argus/Wiki/${projectSegment}/`)
    || path.startsWith(`Argus/AIMemory/${projectSegment}/`)
    || path.startsWith(`Argus/Raw/${projectSegment}/`)
    || path.startsWith(`Argus/_Indexes/${projectSegment}/`);
};

const addReason = (reasons, reason) => {
  if (reason && !reasons.includes(reason)) reasons.push(reason);
};

const upsertCandidate = (map, result, reason, rank, scoreBoost = 0) => {
  const path = normalizePath(result?.path);
  if (!path) return;
  const existing = map.get(path) || {
    ...result,
    path,
    reasons: [],
    score: 0,
    ranks: {},
  };
  addReason(existing.reasons, reason);
  existing.score += scoreBoost + (1 / (60 + rank));
  existing.ranks[reason] = rank;
  map.set(path, existing);
};

export const buildSourceAwareObsidianContext = ({
  query = '',
  semanticResults = [],
  keywordResults = [],
  activeNote = null,
  selectedSources = [],
  maxSources = 8,
  maxTokensPerSource = 600,
  now = new Date(),
  projectName = '',
  vaultName = '',
} = {}) => {
  const candidates = new Map();
  const excluded = [];
  const selectedPaths = new Set((Array.isArray(selectedSources) ? selectedSources : []).map(normalizePath).filter(Boolean));
  const projectSegment = inferProjectSegment({ projectName, activeNote, selectedSources: [...selectedPaths] });

  if (activeNote?.path) {
    const activePath = normalizePath(activeNote.path);
    candidates.set(activePath, {
      ...activeNote,
      path: activePath,
      kind: 'active-note',
      headingPath: 'Active selection',
      text: readString(activeNote.selection || activeNote.snippet || activeNote.title),
      reasons: ['active-note'],
      score: 100,
      ranks: { 'active-note': 0 },
    });
  }

  const addResultGroup = (results, reason) => {
    (Array.isArray(results) ? results : []).forEach((result, index) => {
      const path = normalizePath(result?.path);
      if (!path) return;
      if (isArchivedOrDeleted(result)) {
        excluded.push({ path, reason: 'archived-or-deleted' });
        return;
      }
      if (!selectedPaths.has(path) && !isProjectScopedPath(path, projectSegment)) {
        excluded.push({ path, reason: 'outside-project-scope' });
        return;
      }
      const explicitScore = Number.isFinite(Number(result.score)) ? Number(result.score) / 10 : 0;
      upsertCandidate(candidates, result, reason, index + 1, explicitScore);
    });
  };

  addResultGroup(semanticResults, 'semantic');
  addResultGroup(keywordResults, 'keyword');

  for (const selectedPath of selectedPaths) {
    const existing = candidates.get(selectedPath);
    if (existing) {
      addReason(existing.reasons, 'selected-source');
      existing.score += 50;
    }
  }

  for (const candidate of candidates.values()) {
    if (Array.isArray(candidate.backlinks) && candidate.backlinks.length > 0) {
      addReason(candidate.reasons, 'backlink');
      candidate.score += Math.min(candidate.backlinks.length, 5) * 0.5;
    }
    const recency = modifiedRecencyScore(candidate.modifiedAt || candidate.mtime || candidate.updatedAt, now);
    if (recency > 0) {
      addReason(candidate.reasons, 'recency');
      candidate.score += recency;
    }
  }

  const ranked = [...candidates.values()]
    .sort((a, b) => b.score - a.score || normalizePath(a.path).localeCompare(normalizePath(b.path)))
    .slice(0, Math.max(1, Number(maxSources) || 8));

  const sources = ranked.map((result) => {
    const chunks = result.kind === 'active-note'
      ? [{ headingPath: result.headingPath || 'Active selection', text: result.text || result.selection || result.snippet || result.title }]
      : splitHeadingChunks(result);
    const bestChunk = chunks.find((chunk) => readString(query) && chunk.text.toLowerCase().includes(readString(query).toLowerCase()))
      || chunks[chunks.length - 1]
      || chunks[0]
      || { headingPath: result.title || 'Untitled', text: result.snippet || result.title || '' };
    return {
      kind: result.kind || 'context-result',
      vaultName: readString(result.vaultName || vaultName),
      path: normalizePath(result.path),
      title: readString(result.title),
      headingPath: readString(bestChunk.headingPath),
      snippet: clampSourceText(bestChunk.text || result.snippet || result.summary, maxTokensPerSource),
      score: Number(result.score.toFixed(4)),
      reasons: result.reasons,
      modifiedAt: readString(result.modifiedAt || result.mtime || result.updatedAt),
      blockId: hashBlockId(result.path, bestChunk.headingPath, bestChunk.text),
    };
  });

  const context = sources.map((source) => [
    source.kind === 'active-note' ? 'Active Obsidian note' : '',
    `Source: ${source.vaultName ? `${source.vaultName} / ` : ''}${source.path}`,
    source.headingPath ? `Heading: ${source.headingPath}` : '',
    `Block: ${source.blockId}`,
    source.modifiedAt ? `Modified: ${source.modifiedAt}` : '',
    `Score: ${source.score}`,
    `Reasons: ${source.reasons.join(', ')}`,
    'Snippet:',
    source.snippet,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');

  return {
    context,
    sources,
    diagnostics: {
      query: readString(query),
      candidateCount: candidates.size,
      selectedCount: sources.length,
      excludedCount: excluded.length,
      excluded,
    },
  };
};
