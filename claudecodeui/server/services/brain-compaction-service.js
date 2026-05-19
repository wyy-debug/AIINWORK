import { brainStore as defaultBrainStore } from './brain-store-service.js';
import {
  canonicalSymbolicNodeType,
  createStableSymbolicNodeId,
} from './brain-symbolic-canvas-service.js';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');
const compactText = (value = '', max = 240) => {
  const text = readString(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const hasAny = (text, words) => words.some((word) => text.includes(word));

const estimateTokens = (text = '') => Math.ceil(String(text || '').length / 4);

function classifyEvent(event) {
  const haystack = `${event.title || ''}\n${event.content || ''}`.toLowerCase();
  if (event.eventType === 'command') return 'goal';
  if (event.eventType === 'checkpoint') return 'checkpoint';
  if (event.eventType === 'artifact') return 'artifact';
  if (event.eventType === 'file') return 'file';
  if (hasAny(haystack, ['blocker', 'blocked', 'blocking'])) return 'blocker';
  if (hasAny(haystack, ['lesson', 'learned', 'learning'])) return 'lesson';
  if (event.eventType === 'error' || event.eventType === 'permission_request' || hasAny(haystack, ['risk', 'blocker', 'failed', 'error', 'abort', 'timeout', 'conflict'])) return 'risk';
  if (hasAny(haystack, ['decide', 'decision', 'chose', 'choose', 'use ', 'keep ', 'remove ', 'instead'])) return 'decision';
  if (event.eventType === 'assistant_summary') return 'next-action';
  return 'step';
}

const unique = (items = []) => [...new Set(items.filter(Boolean))];

const buildRefIdsByEvent = (refs = []) => refs.reduce((acc, ref) => {
  if (!ref.eventId) return acc;
  const existing = acc.get(ref.eventId) || [];
  existing.push(ref.id);
  acc.set(ref.eventId, existing);
  return acc;
}, new Map());

const mergeNodeInputs = (sessionId, inputs = []) => {
  const byId = new Map();
  for (const input of inputs) {
    const title = readString(input.title);
    if (!title) continue;
    const nodeType = canonicalSymbolicNodeType(input.nodeType);
    const id = createStableSymbolicNodeId({ sessionId, nodeType, meaning: title });
    const existing = byId.get(id);
    if (existing) {
      existing.sourceEventIds = unique([...existing.sourceEventIds, ...(input.sourceEventIds || [])]);
      existing.refIds = unique([...existing.refIds, ...(input.refIds || [])]);
      continue;
    }
    byId.set(id, {
      ...input,
      id,
      nodeType,
      title,
      summary: input.summary || title,
      sourceEventIds: unique(input.sourceEventIds || []),
      refIds: unique(input.refIds || []),
    });
  }
  return [...byId.values()];
};

function pickLatest(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function toStep(event) {
  return compactText(event.title || event.content || event.eventType, 180);
}

function createMermaid({ nodes }) {
  const visibleNodes = nodes.slice(0, 12);
  if (visibleNodes.length === 0) {
    return 'flowchart TD\n  empty["No captured task memory yet"]';
  }
  const lines = ['flowchart TD'];
  for (const node of visibleNodes) {
    const label = compactText(node.title || node.summary || node.nodeType, 80).replace(/"/g, '\\"');
    lines.push(`  ${node.id}["${label}"]`);
  }
  for (let index = 1; index < visibleNodes.length; index += 1) {
    lines.push(`  ${visibleNodes[index - 1].id} --> ${visibleNodes[index].id}`);
  }
  return lines.join('\n');
}

export function createBrainCompactionService({ store = defaultBrainStore, logger = console } = {}) {
  const shouldCompact = ({ sessionId = '', provider = 'claude', config = {} } = {}) => {
    if (config?.enabled === false || !sessionId) {
      return false;
    }
    const latest = store.getLatestCompaction({ sessionId, provider });
    const events = store.listEvents({
      sessionId,
      provider,
      afterMs: latest?.createdAtMs || 0,
      limit: Math.max(config.compactEventThreshold || 18, 1) + 1,
    });
    if (events.length >= (config.compactEventThreshold || 18)) {
      return true;
    }
    const textLength = events.reduce((sum, event) => sum + String(event.content || '').length, 0);
    return textLength >= (config.compactTextThreshold || 12000);
  };

  const compactSession = ({ sessionId = '', provider = 'claude', projectName = '', config = {}, force = false } = {}) => {
    if (config?.enabled === false || !sessionId) {
      return null;
    }
    if (!force && !shouldCompact({ sessionId, provider, config })) {
      return null;
    }

    try {
      const events = store.listEvents({ sessionId, provider, limit: 500 });
      if (events.length === 0) {
        return null;
      }
      const refs = typeof store.listRefs === 'function'
        ? store.listRefs({ sessionId, provider, limit: 2000 })
        : [];
      const refIdsByEvent = buildRefIdsByEvent(refs);
      const effectiveProjectName = projectName || events.find((event) => event.projectName)?.projectName || '';
      const latestCommand = pickLatest(events, (event) => event.eventType === 'command');
      const currentGoal = compactText(latestCommand?.content || latestCommand?.title || 'Continue the current task.', 220);
      const completedSteps = events
        .filter((event) => ['checkpoint', 'artifact', 'tool_result'].includes(event.eventType))
        .map(toStep)
        .filter(Boolean)
        .slice(-8);
      const activeDecisions = events
        .filter((event) => classifyEvent(event) === 'decision')
        .map(toStep)
        .filter(Boolean)
        .slice(-6);
      const openRisks = events
        .filter((event) => classifyEvent(event) === 'risk')
        .map(toStep)
        .filter(Boolean)
        .slice(-6);
      const latestAssistant = pickLatest(events, (event) => event.eventType === 'assistant_summary');
      const nextAction = compactText(
        latestAssistant?.content
          || latestAssistant?.title
          || (openRisks.length ? 'Resolve the active risk, then continue the requested implementation.' : 'Continue with the next unfinished implementation step.'),
        220,
      );
      const eventNodeInputs = events.map((event) => {
        const nodeType = classifyEvent(event);
        const title = compactText(event.title || event.content || event.eventType, 180);
        return {
          nodeType,
          title,
          summary: title,
          status: ['checkpoint', 'artifact', 'step', 'lesson'].includes(nodeType) ? 'completed' : 'active',
          sourceEventIds: [event.id],
          refIds: refIdsByEvent.get(event.id) || [],
        };
      });
      const nodeInputs = mergeNodeInputs(sessionId, [
        ...(latestCommand ? [{
          nodeType: 'goal',
          title: currentGoal,
          summary: currentGoal,
          sourceEventIds: [latestCommand.id],
          refIds: refIdsByEvent.get(latestCommand.id) || [],
        }] : []),
        ...eventNodeInputs.filter((node) => node.nodeType !== 'goal' && node.nodeType !== 'next-action'),
        ...(latestAssistant ? [{
          nodeType: 'next-action',
          title: nextAction,
          summary: nextAction,
          sourceEventIds: [latestAssistant.id],
          refIds: refIdsByEvent.get(latestAssistant.id) || [],
        }] : [{
          nodeType: 'next-action',
          title: nextAction,
          summary: nextAction,
          sourceEventIds: [],
          refIds: [],
        }]),
      ]);

      const sourceEventIds = events.map((event) => event.id);
      const nodes = nodeInputs.map((node) => store.upsertNode({
        id: node.id,
        sessionId,
        provider,
        projectName: effectiveProjectName,
        nodeType: node.nodeType,
        title: node.title,
        summary: node.summary,
        status: node.status || 'active',
        sourceEventIds: node.sourceEventIds,
        refIds: node.refIds,
      })).filter(Boolean);
      const mermaid = createMermaid({ nodes });
      const summary = [
        currentGoal ? `Goal: ${currentGoal}` : '',
        completedSteps.length ? `Completed: ${completedSteps.join('; ')}` : '',
        activeDecisions.length ? `Decisions: ${activeDecisions.join('; ')}` : '',
        openRisks.length ? `Risks: ${openRisks.join('; ')}` : '',
        nextAction ? `Next: ${nextAction}` : '',
      ].filter(Boolean).join('\n');

      return store.addCompaction({
        sessionId,
        provider,
        projectName: effectiveProjectName,
        mermaid,
        summary,
        currentGoal,
        completedSteps,
        activeDecisions,
        openRisks,
        nextAction,
        sourceEventStartId: events[0]?.id || '',
        sourceEventEndId: events[events.length - 1]?.id || '',
        sourceEventCount: events.length,
        tokenEstimate: estimateTokens(`${summary}\n${mermaid}`),
        refs: sourceEventIds.slice(-20),
      });
    } catch (error) {
      logger.warn?.('[Argus Brain] compaction failed:', error?.message || error);
      return null;
    }
  };

  return {
    compactSession,
    shouldCompact,
  };
}

export const brainCompactionService = createBrainCompactionService();
