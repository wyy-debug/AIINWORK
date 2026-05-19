import crypto from 'node:crypto';

import { appConfigDb } from '../database/db.js';

const CONFIG_KEY = 'obsidian_wiki_candidates';
let wikiCandidateStore = appConfigDb;

export const setObsidianWikiCandidateStoreForTests = (store) => {
  wikiCandidateStore = store || appConfigDb;
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeText = (value = '') => readString(value).replace(/\s+/g, ' ');
const slug = (value = '') => normalizeText(value)
  .replace(/[\\/]+/g, ' ')
  .replace(/\.\.+/g, ' ')
  .replace(/[<>:"|?*\x00-\x1f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 100) || 'Wiki Candidate';

const stableSlug = (value = '') => slug(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');

const readCandidates = () => {
  try {
    const parsed = JSON.parse(wikiCandidateStore.get(CONFIG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeCandidates = (candidates) => {
  wikiCandidateStore.set(CONFIG_KEY, JSON.stringify(candidates));
};

const firstHeading = (content = '') => readString(content.match(/^#{1,3}\s+(.+)$/m)?.[1] || '');

const stripMarkdownTitle = (content = '') => content.replace(/^#{1,3}\s+.+$/m, '').trim();

const extractBacklinks = (content = '') => [...new Set(
  [...String(content || '').matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
    .map((match) => readString(match[1]))
    .filter(Boolean),
)];

const sourceRefsFor = (source = {}) => [
  readString(source.messageId) ? { type: 'message', id: readString(source.messageId) } : null,
  readString(source.artifactId) ? { type: 'artifact', id: readString(source.artifactId) } : null,
  readString(source.sourceId) ? { type: 'source', id: readString(source.sourceId) } : null,
].filter(Boolean);

const targetPathFor = ({ title = '', source = {} } = {}) => (
  `Argus/Wiki/${slug(source.projectName || 'General')}/${slug(title)}.md`
);

const duplicateWarningsFor = (candidate, existing = []) => existing
  .map((entry) => {
    if (entry.id === candidate.id || entry.status === 'discarded') return null;
    if (readString(entry.targetPath).toLowerCase() === readString(candidate.targetPath).toLowerCase()) {
      return { reason: 'same-target-path', candidateId: entry.id, targetPath: entry.targetPath };
    }
    if (stableSlug(entry.title) === stableSlug(candidate.title)) {
      return { reason: 'similar-title', candidateId: entry.id, title: entry.title };
    }
    if (normalizeText(entry.text).toLowerCase() === normalizeText(candidate.text).toLowerCase()) {
      return { reason: 'same-content', candidateId: entry.id };
    }
    return null;
  })
  .filter(Boolean);

const buildCandidate = (candidate = {}, existing = []) => {
  const text = readString(candidate.text || candidate.content);
  const source = candidate.source && typeof candidate.source === 'object' ? candidate.source : {};
  const title = readString(candidate.title) || firstHeading(text) || normalizeText(text).slice(0, 80) || 'Wiki Candidate';
  const summary = normalizeText(candidate.summary || stripMarkdownTitle(text)).slice(0, 280);
  const kind = readString(candidate.kind) || 'reference';
  const tags = Array.isArray(candidate.tags) && candidate.tags.length > 0
    ? [...new Set(candidate.tags.map(readString).filter(Boolean))]
    : ['argus', 'wiki', kind];
  const now = new Date().toISOString();
  const next = {
    id: readString(candidate.id) || `wiki_${crypto.randomUUID()}`,
    kind,
    title,
    summary,
    text,
    status: readString(candidate.status) || 'pending-review',
    action: 'save-to-wiki',
    target: 'wiki',
    targetPath: readString(candidate.targetPath) || targetPathFor({ title, source }),
    tags,
    backlinks: Array.isArray(candidate.backlinks) ? candidate.backlinks.map(readString).filter(Boolean) : extractBacklinks(text),
    source,
    sourceRefs: Array.isArray(candidate.sourceRefs) ? candidate.sourceRefs : sourceRefsFor(source),
    confidence: Number.isFinite(Number(candidate.confidence)) ? Math.min(Math.max(Number(candidate.confidence), 0), 1) : 1,
    frontmatter: {
      source: 'argus',
      project: readString(source.projectName),
      createdBy: readString(source.provider || 'argus'),
      updatedAt: now,
      confidence: Number.isFinite(Number(candidate.confidence)) ? Math.min(Math.max(Number(candidate.confidence), 0), 1) : 1,
      status: 'draft',
      sourceRefs: sourceRefsFor(source),
    },
    createdAt: readString(candidate.createdAt) || now,
    updatedAt: now,
  };
  const duplicateWarnings = duplicateWarningsFor(next, existing);
  if (duplicateWarnings.length > 0) {
    next.status = 'duplicate-warning';
  }
  return { ...next, duplicateWarnings };
};

export const listWikiCandidates = ({ includeDiscarded = false } = {}) => ({
  success: true,
  candidates: readCandidates().filter((candidate) => includeDiscarded || candidate.status !== 'discarded'),
});

export const createWikiCandidates = (payload = {}) => {
  const existing = readCandidates();
  const source = payload.source && typeof payload.source === 'object' ? payload.source : {};
  const incoming = Array.isArray(payload.candidates) ? payload.candidates : [];
  const created = incoming
    .map((candidate) => buildCandidate({ ...candidate, source: { ...source, ...(candidate.source || {}) } }, existing))
    .filter((candidate) => candidate.text);
  writeCandidates([...existing, ...created]);
  return { success: true, candidates: created };
};

export const editWikiCandidate = ({ candidateId = '', patch = {} } = {}) => {
  const candidates = readCandidates();
  const index = candidates.findIndex((candidate) => candidate.id === candidateId);
  if (index === -1) return { success: false, error: 'Wiki candidate not found.' };
  candidates[index] = buildCandidate({
    ...candidates[index],
    ...patch,
    id: candidates[index].id,
    source: candidates[index].source,
    status: patch.status || candidates[index].status,
  }, candidates.filter((candidate) => candidate.id !== candidateId));
  writeCandidates(candidates);
  return { success: true, candidate: candidates[index] };
};

export const discardWikiCandidate = ({ candidateId = '' } = {}) => {
  const candidates = readCandidates();
  const candidate = candidates.find((entry) => entry.id === candidateId);
  if (!candidate) return { success: false, error: 'Wiki candidate not found.' };
  candidate.status = 'discarded';
  candidate.updatedAt = new Date().toISOString();
  writeCandidates(candidates);
  return { success: true, candidate };
};

export const commitWikiCandidates = async (payload = {}, {
  ingestKnowledgeSourceToWiki,
} = {}) => {
  const ids = new Set((Array.isArray(payload.candidateIds) ? payload.candidateIds : []).map(readString));
  const candidates = readCandidates();
  const committed = [];
  for (const candidate of candidates) {
    if (!ids.has(candidate.id) || candidate.status === 'discarded') continue;
    if (typeof ingestKnowledgeSourceToWiki !== 'function') continue;
    const result = await ingestKnowledgeSourceToWiki({
      source: 'explicit-wiki-candidate',
      sourceId: candidate.id,
      title: candidate.title,
      content: candidate.text,
      projectName: candidate.source?.projectName,
      kind: candidate.kind,
      metadata: {
        ...candidate.frontmatter,
        tags: candidate.tags,
        backlinks: candidate.backlinks,
        sourceRefs: candidate.sourceRefs,
      },
    });
    candidate.status = 'committed';
    candidate.wikiPath = result?.wikiPath || result?.path || candidate.targetPath;
    candidate.updatedAt = new Date().toISOString();
    committed.push(candidate);
  }
  writeCandidates(candidates);
  return { success: true, committed };
};
