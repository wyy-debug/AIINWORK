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
  return [...new Set([...filePaths, ...issueRefs, ...symbols, ...commands].map((entity) => compactText(entity)))].slice(0, 24);
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

function isLowValueAtom(atom = {}) {
  const title = readString(atom.title).toLowerCase();
  const summary = readString(atom.summary).toLowerCase();
  return (
    title === 'tool_result'
    || title.startsWith('tool_use:')
    || title.startsWith('checkpoint captured')
    || summary === 'tool_result'
    || summary === 'no matches found'
    || summary.startsWith('checkpoint captured')
  );
}

function buildProfileSummary(atoms = []) {
  const usefulAtoms = atoms.filter((atom) => !isLowValueAtom(atom));
  const decisions = usefulAtoms.filter((atom) => atom.atomType === 'decision').slice(0, 8);
  const constraints = usefulAtoms.filter((atom) => atom.atomType === 'constraint').slice(0, 6);
  const lessons = usefulAtoms.filter((atom) => atom.atomType === 'lesson' || atom.atomType === 'fix').slice(0, 6);
  return [
    decisions.length ? `Decisions: ${decisions.map((atom) => atom.title).join('; ')}` : '',
    constraints.length ? `Constraints: ${constraints.map((atom) => atom.title).join('; ')}` : '',
    lessons.length ? `Lessons: ${lessons.map((atom) => atom.title).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

function isPersonalPreferenceMemoryEvent(event = {}) {
  const text = `${event.title || ''}\n${event.content || ''}`.toLowerCase();
  const asksRememberForget = /\b(remember|forget)\b|记住|忘记|鍏ㄥ眬璁板繂|个人偏好/.test(text);
  const personalSignal = /\b(my|me|i like|favorite|prefer|preference|persona)\b|我喜欢|我的|偏好/.test(text);
  const projectSignal = /\b(project|repo|repository|code|test|build|architecture|constraint|command|file|api)\b|项目|代码|测试|架构/.test(text);
  return asksRememberForget && personalSignal && !projectSignal;
}

function attachRefsToEvents(store, events = [], { sessionId = '', provider = 'claude', projectName = '' } = {}) {
  const refs = typeof store.listRefs === 'function'
    ? store.listRefs({ sessionId, provider, projectName, includePruned: true, limit: 2000 })
    : [];
  const refsByEvent = new Map();
  for (const ref of refs) {
    if (!ref.eventId) continue;
    refsByEvent.set(ref.eventId, [...(refsByEvent.get(ref.eventId) || []), ref]);
  }
  return events.map((event) => ({
    ...event,
    refs: refsByEvent.get(event.id) || [],
  }));
}

function getEvidenceSummary(store, atoms = [], { sessionId = '', provider = 'claude', projectName = '' } = {}) {
  const refs = typeof store.listRefs === 'function'
    ? store.listRefs({ sessionId, provider, projectName, includePruned: false, limit: 2000 })
    : [];
  const availableRefIds = new Set(refs.map((ref) => ref.id));
  const expectedRefIds = atoms.flatMap((atom) => Array.isArray(atom.refIds) ? atom.refIds : []);
  const missingRefIds = expectedRefIds.filter((refId) => !availableRefIds.has(refId));
  return {
    expectedRefCount: expectedRefIds.length,
    availableRefCount: expectedRefIds.length - missingRefIds.length,
    missingRefCount: missingRefIds.length,
    missingRefIds,
  };
}

function buildTopLayersFromAtoms(store, {
  atoms = [],
  sessionId = '',
  provider = 'claude',
  projectName = '',
} = {}) {
  if (atoms.length === 0) {
    return { atoms, scenarios: [], projectProfile: null, evidence: getEvidenceSummary(store, atoms, { sessionId, provider, projectName }) };
  }
  const activeAtomIds = atoms.map((atom) => atom.id);
  const effectiveProjectName = projectName || atoms.find((atom) => atom.projectName)?.projectName || '';
  const scenario = store.upsertScenario({
    sessionId,
    provider,
    projectName: effectiveProjectName,
    scenarioKey: `session:${stableHash(sessionId)}`,
    title: `Session working memory ${sessionId}`,
    summary: compactText(atoms.map((atom) => `${atom.atomType}: ${atom.title}`).join('; '), 900),
    atomIds: activeAtomIds,
    metrics: {
      atomCount: atoms.length,
      decisionCount: atoms.filter((atom) => atom.atomType === 'decision').length,
      riskCount: atoms.filter((atom) => ['error', 'blocker'].includes(atom.atomType)).length,
      missingRefCount: getEvidenceSummary(store, atoms, { sessionId, provider, projectName: effectiveProjectName }).missingRefCount,
    },
  });
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
        decisions: projectAtoms.filter((atom) => atom.atomType === 'decision' && !isLowValueAtom(atom)).slice(0, 12),
        constraints: projectAtoms.filter((atom) => atom.atomType === 'constraint' && !isLowValueAtom(atom)).slice(0, 12),
        lessons: projectAtoms.filter((atom) => ['lesson', 'fix'].includes(atom.atomType) && !isLowValueAtom(atom)).slice(0, 12),
        evidence: getEvidenceSummary(store, projectAtoms, { sessionId, provider, projectName: effectiveProjectName }),
      },
      sourceAtomIds: projectAtoms.map((atom) => atom.id).slice(0, 80),
    })
    : null;
  return {
    atoms,
    scenarios: scenario ? [scenario] : [],
    projectProfile,
    evidence: getEvidenceSummary(store, atoms, { sessionId, provider, projectName: effectiveProjectName }),
  };
}

export function createBrainLayeredMemoryService({ store = defaultBrainStore, logger = console } = {}) {
  const materializeSessionLayers = ({ sessionId = '', provider = 'claude', projectName = '', limit = 500 } = {}) => {
    if (!readString(sessionId)) {
      return { atoms: [], scenarios: [], projectProfile: null, evidence: { expectedRefCount: 0, availableRefCount: 0, missingRefCount: 0, missingRefIds: [] } };
    }
    try {
      const rawEvents = store.listEvents({ sessionId, provider, limit });
      const events = attachRefsToEvents(store, rawEvents, { sessionId, provider, projectName })
        .filter((event) => !isPersonalPreferenceMemoryEvent(event));
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
      return buildTopLayersFromAtoms(store, { atoms, sessionId, provider, projectName });
    } catch (error) {
      logger.warn?.('[Argus Brain] layered materialization failed:', error?.message || error);
      return { atoms: [], scenarios: [], projectProfile: null, evidence: { expectedRefCount: 0, availableRefCount: 0, missingRefCount: 0, missingRefIds: [] }, error: error?.message || String(error) };
    }
  };

  const rebuildTopLayers = ({ sessionId = '', provider = 'claude', projectName = '', limit = 500 } = {}) => {
    const atoms = store.listAtoms({ sessionId, provider, projectName, status: 'active', limit });
    return buildTopLayersFromAtoms(store, { atoms, sessionId, provider, projectName });
  };

  const migrateLegacyNodesToLayers = ({ sessionId = '', provider = 'claude', projectName = '', limit = 200 } = {}) => {
    const nodes = store.listProjectNodes({ projectName, provider, limit })
      .filter((node) => !sessionId || node.sessionId === sessionId);
    const atoms = nodes
      .map((node) => store.upsertAtom({
        sessionId: node.sessionId || sessionId,
        provider,
        projectName: node.projectName || projectName,
        atomType: ATOM_TYPES.includes(node.nodeType) ? node.nodeType : 'decision',
        title: node.title,
        summary: node.summary || node.title,
        status: node.status || 'active',
        stableKey: `legacy-node:${node.id}`,
        confidence: node.confidence || 0.7,
        entities: extractBrainEntities(`${node.title}\n${node.summary}`),
        sourceEventIds: node.sourceEventIds || [],
        refIds: node.refIds || [],
      }))
      .filter(Boolean);
    return buildTopLayersFromAtoms(store, { atoms, sessionId, provider, projectName });
  };

  return {
    classifyBrainEvent,
    extractBrainEntities,
    materializeSessionLayers,
    migrateLegacyNodesToLayers,
    rebuildTopLayers,
    tokenizeBrainText,
  };
}

export const brainLayeredMemoryService = createBrainLayeredMemoryService();
