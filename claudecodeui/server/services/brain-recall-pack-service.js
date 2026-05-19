const SECTION_ORDER = [
  'stale-warning',
  'current-goal',
  'status',
  'active-decisions',
  'open-risks',
  'next-action',
  'canvas',
  'relevant-memory',
  'refs',
];

const FIX_TEST_SECTION_ORDER = [
  'stale-warning',
  'current-goal',
  'status',
  'lessons',
  'open-risks',
  'active-decisions',
  'next-action',
  'canvas',
  'relevant-memory',
  'refs',
];

const SECTION_TITLES = {
  'stale-warning': 'Stale warning',
  'current-goal': 'Current goal',
  status: 'Status',
  lessons: 'Lessons for similar failures',
  'active-decisions': 'Active decisions',
  'open-risks': 'Open risks and blockers',
  'next-action': 'Next action',
  canvas: 'Canvas',
  'relevant-memory': 'Relevant memory',
  refs: 'Refs',
};

const DEFAULT_RATIOS = {
  'stale-warning': 0.08,
  'current-goal': 0.12,
  status: 0.12,
  lessons: 0.14,
  'active-decisions': 0.16,
  'open-risks': 0.14,
  'next-action': 0.1,
  canvas: 0.18,
  'relevant-memory': 0.18,
  refs: 0.08,
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

export const estimateRecallTokens = (value = '') => Math.ceil(String(value || '').length / 4);

const truncateToTokens = (text = '', maxTokens = 80) => {
  const clean = readString(text);
  const maxChars = Math.max(24, Number(maxTokens || 80) * 4);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 14)).trim()} [truncated]`;
};

const tokenize = (text = '') => [...new Set(String(text || '')
  .toLowerCase()
  .split(/[^a-z0-9\u4e00-\u9fa5_.:/-]+/u)
  .map((part) => part.trim())
  .filter((part) => part.length >= 2))];

const unique = (items = []) => [...new Set(items.filter(Boolean))];

export function detectRecallPackMode(command = '') {
  const text = String(command || '').toLowerCase();
  if (/fix|failing|failed|test|vitest|typecheck|lint/.test(text)) return 'fix-tests';
  if (/review|diff|pr|risk/.test(text)) return 'review';
  if (/explain|why|how/.test(text)) return 'explain';
  if (/research|investigate|lookup|search/.test(text)) return 'research';
  if (/wiki|obsidian|note/.test(text)) return 'wiki-lookup';
  return 'resume';
}

export function allocateRecallSectionBudgets({ maxTokens = 1200, mode = 'resume' } = {}) {
  const total = Math.max(Number(maxTokens) || 1200, 80);
  const order = mode === 'fix-tests' ? FIX_TEST_SECTION_ORDER : SECTION_ORDER;
  const budgets = {};
  let allocated = 0;
  for (const sectionId of order) {
    const hardCap = sectionId === 'canvas' ? Math.min(45, Math.floor(total * DEFAULT_RATIOS[sectionId])) : Math.floor(total * DEFAULT_RATIOS[sectionId]);
    budgets[sectionId] = Math.max(sectionId === 'stale-warning' ? 12 : 8, hardCap);
    allocated += budgets[sectionId];
  }
  while (allocated > total) {
    const largest = Object.entries(budgets).sort((left, right) => right[1] - left[1])[0]?.[0];
    if (!largest || budgets[largest] <= 8) break;
    budgets[largest] -= 1;
    allocated -= 1;
  }
  return budgets;
}

function scoreHit(hit = {}, queryTokens = []) {
  const hitTokens = tokenize(`${hit.title || ''} ${hit.summary || ''}`);
  const queryMatches = queryTokens.filter((token) => hitTokens.includes(token)).length;
  const reasons = [];
  let score = Number(hit.score || 0) * 10;
  if (hit.status === 'active' || !hit.status) {
    score += 2;
    reasons.push('active-status');
  }
  if (hit.pinned) {
    score += 10;
    reasons.push('explicit-pin');
  }
  if (Number(hit.confidence || 0) > 0.75) {
    score += Number(hit.confidence || 0);
    reasons.push('source-confidence');
  }
  if (queryMatches > 0) {
    score += queryMatches;
    reasons.push('query-match');
  }
  for (const reason of Array.isArray(hit.reasons) ? hit.reasons : []) {
    if (reason.signal) reasons.push(`retrieval:${reason.signal}`);
  }
  return {
    ...hit,
    packScore: score,
    packReasons: unique(reasons),
  };
}

function rankHits(hits = [], command = '') {
  const queryTokens = tokenize(command);
  return [...hits]
    .map((hit) => scoreHit(hit, queryTokens))
    .sort((left, right) => (
      right.packScore - left.packScore
      || String(left.id || left.title).localeCompare(String(right.id || right.title))
    ));
}

function createSection(id, lines = [], budget = 80) {
  const content = lines.map(readString).filter(Boolean).join('\n');
  return {
    id,
    title: SECTION_TITLES[id] || id,
    content: truncateToTokens(content, budget),
  };
}

function formatRefs(compactionRefs = [], refs = []) {
  const explicitRefs = refs.map((ref) => [
    ref.id,
    ref.refType,
    ref.label || ref.refId,
  ].map(readString).filter(Boolean).join(' '));
  const compactRefs = compactionRefs.map((refId) => String(refId || '').trim()).filter(Boolean);
  return unique([...compactRefs, ...explicitRefs]);
}

export function buildBrainRecallPack({
  command = '',
  maxTokens = 1200,
  compaction = null,
  retrievalHits = [],
  refs = [],
  symbolicCanvas = null,
} = {}) {
  const mode = detectRecallPackMode(command);
  const budgets = allocateRecallSectionBudgets({ maxTokens, mode });
  const rankedHits = rankHits(retrievalHits, command);
  const lessons = rankedHits.filter((hit) => hit.atomType === 'lesson' || /lesson/i.test(hit.title || ''));
  const relevantMemory = rankedHits.slice(0, 8).map((hit) => `- ${hit.title}: ${hit.summary || ''}`);
  const refLines = formatRefs(compaction?.refs || [], refs).map((ref) => `- ${ref}`);
  const canvas = symbolicCanvas?.mermaid || compaction?.mermaid || '';
  const order = mode === 'fix-tests' ? FIX_TEST_SECTION_ORDER : SECTION_ORDER;
  const byId = new Map([
    ['stale-warning', createSection('stale-warning', ['Verify historical Brain state against current files and runtime before acting.'], budgets['stale-warning'])],
    ['current-goal', createSection('current-goal', [compaction?.currentGoal || 'Continue the current task.'], budgets['current-goal'])],
    ['status', createSection('status', [compaction?.summary || 'No compact status summary yet.'], budgets.status)],
    ['lessons', createSection('lessons', lessons.map((hit) => `- ${hit.title}: ${hit.summary || ''}`), budgets.lessons)],
    ['active-decisions', createSection('active-decisions', (compaction?.activeDecisions || []).map((item) => `- ${item}`), budgets['active-decisions'])],
    ['open-risks', createSection('open-risks', (compaction?.openRisks || []).map((item) => `- ${item}`), budgets['open-risks'])],
    ['next-action', createSection('next-action', [compaction?.nextAction || 'Inspect current state and continue.'], budgets['next-action'])],
    ['canvas', createSection('canvas', canvas ? ['```mermaid', canvas, '```'] : [], budgets.canvas)],
    ['relevant-memory', createSection('relevant-memory', relevantMemory, budgets['relevant-memory'])],
    ['refs', createSection('refs', refLines, budgets.refs)],
  ]);
  let sections = order.map((id) => byId.get(id)).filter((section) => section?.content);
  let prompt = [
    '## Argus Brain Recall Pack',
    `Mode: ${mode}`,
    ...sections.flatMap((section) => [
      `### ${section.title}`,
      section.content,
    ]),
  ].join('\n');
  if (estimateRecallTokens(prompt) > maxTokens) {
    prompt = truncateToTokens(prompt, maxTokens);
    sections = sections.map((section) => (section.id === sections.at(-1)?.id
      ? { ...section, content: truncateToTokens(section.content, Math.max(8, budgets[section.id] - 4)) }
      : section));
  }
  return {
    mode,
    prompt,
    sections,
    tokenEstimate: estimateRecallTokens(prompt),
    diagnostics: {
      mode,
      budgets,
      includedItems: rankedHits.map((hit) => ({
        id: hit.id,
        kind: hit.kind,
        title: hit.title,
        score: hit.packScore,
        reasons: hit.packReasons,
      })),
    },
  };
}
