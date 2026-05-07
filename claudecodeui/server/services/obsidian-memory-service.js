import crypto from 'crypto';

import { appConfigDb } from '../database/db.js';

import { sendObsidianDocument as defaultSendObsidianDocument } from './obsidian-bridge-service.js';

const CONFIG_KEY = 'obsidian_memory_candidates';

let memoryStore = appConfigDb;

export const setObsidianMemoryStoreForTests = (store) => {
  memoryStore = store || appConfigDb;
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeKind = (value = '') => {
  const kind = readString(value).toLowerCase();
  return ['fact', 'preference', 'decision', 'person', 'project', 'technology'].includes(kind) ? kind : 'fact';
};

const normalizeText = (value = '') => readString(value).replace(/\s+/g, ' ');

const slug = (value = '') => normalizeText(value)
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'memory';

const createId = () => `memory_${crypto.randomUUID()}`;

const readCandidates = () => {
  try {
    const parsed = JSON.parse(memoryStore.get(CONFIG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeCandidates = (candidates) => {
  memoryStore.set(CONFIG_KEY, JSON.stringify(candidates));
};

const inferKindAndText = (line = '') => {
  const text = normalizeText(line);
  const match = text.match(/^(preference|pref|decision|fact|person|project|technology)\s*[:：-]\s*(.+)$/i);
  if (!match) {
    return { kind: 'fact', text };
  }
  const kind = match[1].toLowerCase() === 'pref' ? 'preference' : match[1].toLowerCase();
  return { kind: normalizeKind(kind), text: normalizeText(match[2]) };
};

const buildCandidate = (candidate = {}, source = {}) => {
  const inferred = candidate.text ? candidate : inferKindAndText(candidate);
  const kind = normalizeKind(candidate.kind || inferred.kind);
  const text = normalizeText(candidate.text || inferred.text);
  const stableKey = readString(candidate.stableKey) || `${kind}:${slug(text)}`;
  return {
    id: readString(candidate.id) || createId(),
    kind,
    text,
    source: candidate.source || source || {},
    confidence: Number.isFinite(Number(candidate.confidence)) ? Math.min(Math.max(Number(candidate.confidence), 0), 1) : 0.75,
    stableKey,
    status: readString(candidate.status) || 'pending',
    expiresAt: readString(candidate.expiresAt),
    createdAt: readString(candidate.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

const candidatesFromInput = ({ text = '', candidates = [], source = {} } = {}) => {
  if (Array.isArray(candidates) && candidates.length > 0) {
    return candidates.map((candidate) => buildCandidate(candidate, source)).filter((candidate) => candidate.text);
  }
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .map((line) => buildCandidate(inferKindAndText(line), source))
    .filter((candidate) => candidate.text);
};

export const listMemoryCandidates = ({ includeExpired = false } = {}) => {
  const now = Date.now();
  const candidates = readCandidates().filter((candidate) => (
    includeExpired
    || !candidate.expiresAt
    || Number.isNaN(Date.parse(candidate.expiresAt))
    || Date.parse(candidate.expiresAt) > now
  ));
  return { success: true, candidates };
};

export const createMemoryCandidates = (payload = {}) => {
  const existing = readCandidates();
  const nextCandidates = [];

  for (const candidate of candidatesFromInput(payload)) {
    const previous = existing.find((entry) => entry.stableKey === candidate.stableKey);
    if (previous && normalizeText(previous.text).toLowerCase() === normalizeText(candidate.text).toLowerCase()) {
      nextCandidates.push(previous);
      continue;
    }
    const next = {
      ...candidate,
      status: previous ? 'conflict' : candidate.status,
      conflictWith: previous?.id || '',
    };
    existing.push(next);
    nextCandidates.push(next);
  }

  writeCandidates(existing);
  return { success: true, candidates: nextCandidates };
};

const titleForCandidate = (candidate) => {
  const stableTail = candidate.stableKey.includes(':') ? candidate.stableKey.split(':').slice(1).join(':') : slug(candidate.text);
  return `${candidate.kind} - ${stableTail}`;
};

export const commitMemoryCandidates = async (payload = {}, {
  sendObsidianDocument = defaultSendObsidianDocument,
} = {}) => {
  const candidateIds = Array.isArray(payload.candidateIds) ? new Set(payload.candidateIds.map(readString)) : new Set();
  const candidates = readCandidates();
  const committed = [];

  for (const candidate of candidates) {
    if (!candidateIds.has(candidate.id) || candidate.status === 'rejected' || candidate.status === 'expired') {
      continue;
    }
    await sendObsidianDocument({
      title: titleForCandidate(candidate),
      content: candidate.text,
      mode: 'ai-memory',
      projectName: readString(payload.projectName) || readString(candidate.source?.projectName),
      argusId: `memory:${candidate.stableKey}`,
      kind: candidate.kind,
      status: 'active',
      tags: ['argus', 'ai-memory', candidate.kind],
      confidence: candidate.confidence,
      metadata: {
        memoryStableKey: candidate.stableKey,
        memoryCandidateId: candidate.id,
        memorySource: candidate.source,
      },
    });
    candidate.status = 'accepted';
    candidate.updatedAt = new Date().toISOString();
    committed.push(candidate);
  }

  writeCandidates(candidates);
  return { success: true, committed };
};

export const updateMemoryCandidateStatus = ({ candidateId = '', status = 'rejected' } = {}) => {
  const candidates = readCandidates();
  const candidate = candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    return { success: false, error: 'Memory candidate not found.' };
  }
  candidate.status = ['pending', 'accepted', 'rejected', 'conflict', 'expired'].includes(status) ? status : 'rejected';
  candidate.updatedAt = new Date().toISOString();
  writeCandidates(candidates);
  return { success: true, candidate };
};
