import crypto from 'node:crypto';

import {
  classifyBrainEvent,
  extractBrainEntities,
  tokenizeBrainText,
} from './brain-layered-memory-service.js';
import { brainStore as defaultBrainStore } from './brain-store-service.js';

const POST_TURN_ATOM_TYPES = [
  'decision',
  'constraint',
  'command',
  'error',
  'fix',
  'blocker',
  'file-change',
  'verification',
  'lesson',
  'anti-pattern',
  'next-action',
];

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const compactText = (value = '', max = 360) => {
  const text = readString(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const stableHash = (value = '') => crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);

const unique = (items = []) => [...new Set(items.filter(Boolean))];

const jaccard = (left = [], right = []) => {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / (a.size + b.size - intersection);
};

function classifyPostTurnAtom(event = {}) {
  const text = `${event.title || ''}\n${event.content || ''}`.toLowerCase();
  if (/anti[- ]pattern|avoid repeating|do not repeat|never repeat/.test(text)) return 'anti-pattern';
  if (/lesson|learned|future|next time/.test(text)) return 'lesson';
  if (/fixed|fix|patched|resolved/.test(text) && /failed|error|leak|rollback|test|vitest/.test(text)) return 'fix';
  const layeredType = classifyBrainEvent(event);
  if (layeredType === 'goal') return 'command';
  return POST_TURN_ATOM_TYPES.includes(layeredType) ? layeredType : 'command';
}

function buildStableKey({ atomType = 'command', title = '', entities = [] } = {}) {
  const normalizedTitle = readString(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_.:/-]+/gu, ' ')
    .replace(/\bretries\b/g, 'retry')
    .trim();
  return `${atomType}:${stableHash(`${atomType}:${normalizedTitle}:${entities.sort().join('|')}`)}`;
}

function attachRefsToEvents(store, events = [], { sessionId = '', provider = 'claude', projectName = '' } = {}) {
  const existingRefs = typeof store.listRefs === 'function'
    ? store.listRefs({ sessionId, provider, projectName, includePruned: true, limit: 2000 })
    : [];
  const refsByEvent = new Map();
  for (const ref of existingRefs) {
    if (!ref.eventId) continue;
    refsByEvent.set(ref.eventId, [...(refsByEvent.get(ref.eventId) || []), ref]);
  }
  return events.map((event) => ({
    ...event,
    refs: Array.isArray(event.refs) && event.refs.length > 0
      ? event.refs
      : refsByEvent.get(event.id) || [],
  }));
}

function buildAtomCandidate(event = {}) {
  const atomType = classifyPostTurnAtom(event);
  const title = compactText(event.title || event.content || event.eventType || 'Task event', 180);
  const summary = compactText(event.content || event.title || title, 420);
  const entities = extractBrainEntities(`${title}\n${summary}`);
  const refIds = Array.isArray(event.refs) ? event.refs.map((ref) => ref.id).filter(Boolean) : [];
  return {
    atomType,
    title,
    summary,
    status: 'active',
    stableKey: buildStableKey({ atomType, title, entities }),
    confidence: ['decision', 'constraint', 'lesson'].includes(atomType) ? 0.88 : 0.72,
    entities,
    sourceEventIds: event.id ? [event.id] : [],
    refIds,
  };
}

function buildLessonCandidate(events = []) {
  const text = events.map((event) => `${event.title || ''}\n${event.content || ''}`).join('\n');
  const lower = text.toLowerCase();
  if (!/(failed|error|rollback|leak|timeout|conflict)/.test(lower) || !/(fixed|passed|resolved|patched)/.test(lower)) {
    return null;
  }
  const failureTitle = events.find((event) => /failed|error|rollback|leak|timeout|conflict/i.test(`${event.title}\n${event.content}`))?.title;
  const title = compactText(`Lesson learned: ${failureTitle || 'failure fixed successfully'}`, 180);
  const summary = compactText(`Lesson: ${text}`, 420);
  const entities = extractBrainEntities(`${title}\n${summary}`);
  return {
    atomType: 'lesson',
    title,
    summary,
    status: 'active',
    stableKey: buildStableKey({ atomType: 'lesson', title, entities }),
    confidence: 0.9,
    entities,
    sourceEventIds: unique(events.map((event) => event.id)),
    refIds: unique(events.flatMap((event) => Array.isArray(event.refs) ? event.refs.map((ref) => ref.id) : [])),
  };
}

function isDuplicate(existing = {}, candidate = {}) {
  if (existing.stableKey === candidate.stableKey) return true;
  if (existing.atomType !== candidate.atomType) return false;
  if (jaccard(tokenizeBrainText(`${existing.title} ${existing.summary}`), tokenizeBrainText(`${candidate.title} ${candidate.summary}`)) >= 0.48) {
    return true;
  }
  if (jaccard(existing.entities || [], candidate.entities || []) >= 0.5) return true;
  if (jaccard(existing.refIds || [], candidate.refIds || []) > 0) return true;
  return false;
}

function isSupersedingDecision(candidate = {}) {
  const text = `${candidate.title || ''}\n${candidate.summary || ''}`.toLowerCase();
  return candidate.atomType === 'decision' && /replace|instead|switch|supersede|no longer|stop using|改用|替换/.test(text);
}

function findConflictingDecisions(existingAtoms = [], candidate = {}) {
  if (!isSupersedingDecision(candidate)) return [];
  const candidateTokens = tokenizeBrainText(`${candidate.title} ${candidate.summary}`);
  return existingAtoms.filter((atom) => (
    atom.atomType === 'decision'
    && atom.status === 'active'
    && atom.stableKey !== candidate.stableKey
    && (
      jaccard(atom.entities || [], candidate.entities || []) >= 0.25
      || jaccard(tokenizeBrainText(`${atom.title} ${atom.summary}`), candidateTokens) >= 0.25
    )
  ));
}

export function createBrainPostTurnExtractionService({ store = defaultBrainStore, logger = console } = {}) {
  const mergeIntoAtom = (existing, candidate) => store.upsertAtom({
    ...existing,
    title: existing.title,
    summary: existing.summary || candidate.summary,
    confidence: Math.max(existing.confidence || 0, candidate.confidence || 0),
    pinned: existing.pinned,
    sourceEventIds: unique([...(existing.sourceEventIds || []), ...(candidate.sourceEventIds || [])]),
    refIds: unique([...(existing.refIds || []), ...(candidate.refIds || [])]),
    entities: unique([...(existing.entities || []), ...(candidate.entities || [])]).slice(0, 24),
    updatedAtMs: Date.now(),
  });

  const extractPostTurn = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    events = [],
    syncEventThreshold = 30,
  } = {}) => {
    try {
      if (!readString(sessionId)) {
        return { mode: 'skipped', extractedAtoms: [], dedupedCount: 0, conflicts: [], blocking: false };
      }
      const eventList = Array.isArray(events) && events.length > 0
        ? events
        : store.listEvents({ sessionId, provider, limit: 20 }).slice(-20);
      if (eventList.length > syncEventThreshold) {
        return { mode: 'queued', queued: true, extractedAtoms: [], dedupedCount: 0, conflicts: [], blocking: false };
      }
      const enrichedEvents = attachRefsToEvents(store, eventList, { sessionId, provider, projectName });
      const candidates = [
        ...enrichedEvents.map(buildAtomCandidate),
        buildLessonCandidate(enrichedEvents),
      ].filter(Boolean);
      let existingAtoms = store.listAtoms({ sessionId, provider, projectName, status: '', limit: 500 });
      const extractedAtoms = [];
      const conflicts = [];
      let dedupedCount = 0;

      for (const candidate of candidates) {
        const duplicate = existingAtoms.find((atom) => isDuplicate(atom, candidate));
        if (duplicate) {
          extractedAtoms.push(mergeIntoAtom(duplicate, candidate));
          dedupedCount += 1;
          existingAtoms = store.listAtoms({ sessionId, provider, projectName, status: '', limit: 500 });
          continue;
        }

        const atom = store.upsertAtom({
          ...candidate,
          sessionId,
          provider,
          projectName: projectName || enrichedEvents.find((event) => event.projectName)?.projectName || '',
        });
        extractedAtoms.push(atom);

        for (const previous of findConflictingDecisions(existingAtoms, candidate)) {
          const updated = store.updateAtom({
            atomId: previous.id,
            status: 'superseded',
            supersededById: atom.id,
            conflictReason: `Superseded by ${atom.id}`,
          });
          conflicts.push({
            atomId: previous.id,
            supersededById: atom.id,
            previousStatus: previous.status,
            newStatus: updated?.status || 'superseded',
          });
        }
        existingAtoms = store.listAtoms({ sessionId, provider, projectName, status: '', limit: 500 });
      }

      return {
        mode: 'sync',
        extractedAtoms: extractedAtoms.filter(Boolean),
        dedupedCount,
        conflicts,
        blocking: false,
      };
    } catch (error) {
      logger.warn?.('[Argus Brain] post-turn extraction failed:', error?.message || error);
      return {
        mode: 'failed',
        extractedAtoms: [],
        dedupedCount: 0,
        conflicts: [],
        failed: true,
        blocking: false,
        error: error?.message || String(error),
      };
    }
  };

  const controlAtom = ({ atomId = '', action = '', targetAtomId = '' } = {}) => {
    const atom = store.getAtom({ atomId });
    if (!atom) return null;
    if (action === 'archive') {
      return store.updateAtom({ atomId, status: 'archived' });
    }
    if (action === 'pin') {
      return store.updateAtom({ atomId, pinned: true });
    }
    if (action === 'unpin') {
      return store.updateAtom({ atomId, pinned: false });
    }
    if (action === 'mark-stale') {
      return store.updateAtom({ atomId, status: 'stale' });
    }
    if (action === 'merge') {
      const target = store.getAtom({ atomId: targetAtomId });
      if (!target || target.id === atom.id) return null;
      store.updateAtom({
        atomId: target.id,
        pinned: target.pinned || atom.pinned,
        sourceEventIds: unique([...(target.sourceEventIds || []), ...(atom.sourceEventIds || [])]),
        refIds: unique([...(target.refIds || []), ...(atom.refIds || [])]),
      });
      return store.updateAtom({
        atomId,
        status: 'superseded',
        supersededById: target.id,
        conflictReason: `Merged into ${target.id}`,
      });
    }
    return null;
  };

  return {
    controlAtom,
    extractPostTurn,
  };
}

export const brainPostTurnExtractionService = createBrainPostTurnExtractionService();
