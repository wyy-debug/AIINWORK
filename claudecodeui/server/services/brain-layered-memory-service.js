import crypto from 'node:crypto';

import { brainStore as defaultBrainStore } from './brain-store-service.js';

const ATOM_TYPES = [
  'goal',
  'decision',
  'constraint',
  'command',
  'error',
  'fix',
  'blocker',
  'file-change',
  'verification',
  'lesson',
  'next-action',
  'artifact',
];

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const compactText = (value = '', max = 260) => {
  const text = readString(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const stableHash = (value = '') => crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);

export function tokenizeBrainText(text = '') {
  return [...new Set(String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5_.:/-]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 120))];
}

export function extractBrainEntities(text = '') {
  const source = String(text || '');
  const filePaths = source.match(/[A-Za-z]:[\\/][^\s'"`]+|(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]+/g) || [];
  const issueRefs = source.match(/#[0-9]{1,7}\b/g) || [];
  const symbols = source.match(/\b[A-Z][A-Za-z0-9]+(?:Service|Runtime|Store|Config|Provider|Panel|Route|Context)\b/g) || [];
  const commands = source.match(/\b(?:npm|pnpm|yarn|git|node|vitest|tsx|tsc)\s+[^\n\r]{1,120}/g) || [];
  return [...new Set([...filePaths, ...issueRefs, ...symbols, ...commands].map(compactText))].slice(0, 24);
}

export function classifyBrainEvent(event = {}) {
  const eventType = readString(event.eventType).toLowerCase();
  const text = `${event.title || ''}\n${event.content || ''}`.toLowerCase();
  if (eventType === 'command') return 'goal';
  if (eventType === 'assistant_summary') return 'next-action';
  if (eventType === 'artifact') return 'artifact';
  if (eventType === 'checkpoint') return 'file-change';
  if (eventType === 'tool_result' && /test|typecheck|lint|vitest|passed|failed/.test(text)) return 'verification';
  if (/decision|decide|chosen|chose|选择|决定|采用|保留|移除/.test(text)) return 'decision';
  if (/constraint|must|never|不得|必须|边界|guardrail|invariant/.test(text)) return 'constraint';
  if (/lesson|learned|经验|复盘|以后/.test(text)) return 'lesson';
  if (/fix|fixed|修复|解决|patched/.test(text)) return 'fix';
  if (/blocker|blocked|conflict|cannot|无法|阻塞/.test(text)) return 'blocker';
  if (/error|failed|timeout|abort|exception|失败|报错/.test(text)) return 'error';
  if (eventType.includes('tool')) return 'command';
  return ATOM_TYPES.includes(eventType) ? eventType : 'command';
}

function buildAtomFromEvent(event = {}) {
  const atomType = classifyBrainEvent(event);
  const rawTitle = readString(event.title) || readString(event.content) || event.eventType || 'Task event';
  const title = compactText(rawTitle, 160);
  const summary = compactText(event.content || rawTitle, 360);
  const entities = extractBrainEntities(`${title}\n${summary}`);
  const sourceEventIds = event.id ? [event.id] : [];
  const refIds = Array.isArray(event.refs) ? event.refs.map((ref) => ref.id).filter(Boolean) : [];
  return {
    atomType,
    title,
    summary,
    status: ['error', 'blocker'].includes(atomType) ? 'active' : 'active',
    stableKey: `${atomType}:${stableHash(`${atomType}:${title}:${entities.join('|')}`)}`,
    confidence: atomType === 'decision' || atomType === 'goal' ? 0.88 : 0.72,
    entities,
    sourceEventIds,
    refIds,
  };
}

function buildProfileSummary(atoms = []) {
  const decisions = atoms.filter((atom) => atom.atomType === 'decision').slice(0, 8);
  const constraints = atoms.filter((atom) => atom.atomType === 'constraint').slice(0, 6);
  const lessons = atoms.filter((atom) => atom.atomType === 'lesson' || atom.atomType === 'fix').slice(0, 6);
  return [
    decisions.length ? `Decisions: ${decisions.map((atom) => atom.title).join('; ')}` : '',
    constraints.length ? `Constraints: ${constraints.map((atom) => atom.title).join('; ')}` : '',
    lessons.length ? `Lessons: ${lessons.map((atom) => atom.title).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

export function createBrainLayeredMemoryService({ store = defaultBrainStore, logger = console } = {}) {
  const materializeSessionLayers = ({ sessionId = '', provider = 'claude', projectName = '', limit = 500 } = {}) => {
    if (!readString(sessionId)) {
      return { atoms: [], scenarios: [], projectProfile: null };
    }
    try {
      const events = store.listEvents({ sessionId, provider, limit });
      const atoms = events
        .map(buildAtomFromEvent)
        .filter((atom) => atom.title)
        .map((atom) => store.upsertAtom({
          ...atom,
          sessionId,
          provider,
          projectName: projectName || events.find((event) => event.projectName)?.projectName || '',
        }))
        .filter(Boolean);
      const activeAtomIds = atoms.map((atom) => atom.id);
      const scenario = atoms.length
        ? store.upsertScenario({
          sessionId,
          provider,
          projectName: projectName || atoms.find((atom) => atom.projectName)?.projectName || '',
          scenarioKey: `session:${stableHash(sessionId)}`,
          title: `Session working memory ${sessionId}`,
          summary: compactText(atoms.map((atom) => `${atom.atomType}: ${atom.title}`).join('; '), 900),
          atomIds: activeAtomIds,
          metrics: {
            eventCount: events.length,
            atomCount: atoms.length,
            decisionCount: atoms.filter((atom) => atom.atomType === 'decision').length,
            riskCount: atoms.filter((atom) => ['error', 'blocker'].includes(atom.atomType)).length,
          },
        })
        : null;
      const effectiveProjectName = projectName || atoms.find((atom) => atom.projectName)?.projectName || '';
      const projectAtoms = effectiveProjectName
        ? store.listAtoms({ projectName: effectiveProjectName, provider, limit: 120 })
        : atoms;
      const projectProfile = effectiveProjectName
        ? store.upsertProjectProfile({
          projectName: effectiveProjectName,
          provider,
          profileType: 'working-memory',
          summary: buildProfileSummary(projectAtoms),
          content: {
            decisions: projectAtoms.filter((atom) => atom.atomType === 'decision').slice(0, 12),
            constraints: projectAtoms.filter((atom) => atom.atomType === 'constraint').slice(0, 12),
            lessons: projectAtoms.filter((atom) => ['lesson', 'fix'].includes(atom.atomType)).slice(0, 12),
          },
          sourceAtomIds: projectAtoms.map((atom) => atom.id).slice(0, 80),
        })
        : null;
      return {
        atoms,
        scenarios: scenario ? [scenario] : [],
        projectProfile,
      };
    } catch (error) {
      logger.warn?.('[Argus Brain] layered materialization failed:', error?.message || error);
      return { atoms: [], scenarios: [], projectProfile: null, error: error?.message || String(error) };
    }
  };

  return {
    classifyBrainEvent,
    extractBrainEntities,
    materializeSessionLayers,
    tokenizeBrainText,
  };
}

export const brainLayeredMemoryService = createBrainLayeredMemoryService();
