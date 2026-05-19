import crypto from 'node:crypto';

import { brainStore as defaultBrainStore } from './brain-store-service.js';

export const CANONICAL_SYMBOLIC_NODE_TYPES = [
  'goal',
  'step',
  'decision',
  'risk',
  'blocker',
  'file',
  'checkpoint',
  'artifact',
  'lesson',
  'next-action',
];

const TYPE_ALIASES = new Map([
  ['next_action', 'next-action'],
  ['next action', 'next-action'],
  ['todo', 'next-action'],
  ['issue', 'blocker'],
  ['error', 'risk'],
]);

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const compactText = (value = '', max = 180) => {
  const text = readString(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const normalizeMeaning = (value = '') => readString(value)
  .toLowerCase()
  .replace(/\s+/g, ' ');

export const canonicalSymbolicNodeType = (nodeType = 'step') => {
  const clean = readString(nodeType).toLowerCase();
  const aliased = TYPE_ALIASES.get(clean) || clean;
  return CANONICAL_SYMBOLIC_NODE_TYPES.includes(aliased) ? aliased : 'step';
};

export const createStableSymbolicNodeId = ({
  sessionId = '',
  nodeType = 'step',
  meaning = '',
} = {}) => {
  const type = canonicalSymbolicNodeType(nodeType);
  const normalized = normalizeMeaning(meaning);
  const hash = crypto
    .createHash('sha1')
    .update(`${readString(sessionId)}:${type}:${normalized}`)
    .digest('hex')
    .slice(0, 10);
  return `brain_${type}_${hash}`;
};

const intersect = (left = [], right = []) => {
  const rightSet = new Set(Array.isArray(right) ? right : []);
  return (Array.isArray(left) ? left : []).some((item) => rightSet.has(item));
};

const escapeMermaidLabel = (value = '') => compactText(value, 90).replace(/"/g, '\\"');

const buildOpenTargets = (refs = []) => refs.flatMap((ref) => {
  const targets = [];
  if (ref.checkpointId) {
    targets.push({ kind: 'checkpoint', id: ref.checkpointId, label: ref.label || ref.refId || ref.id });
  }
  if (ref.artifactId) {
    targets.push({ kind: 'artifact', id: ref.artifactId, label: ref.label || ref.refId || ref.id });
  }
  if (ref.refType === 'file' && ref.refId) {
    targets.push({ kind: 'file', id: ref.refId, label: ref.label || ref.refId });
  }
  const metadataPath = readString(ref.metadata?.path || ref.metadata?.filePath);
  if (metadataPath) {
    targets.push({ kind: 'file', id: metadataPath, label: ref.label || metadataPath });
  }
  return targets;
});

const dedupeTargets = (targets = []) => {
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.kind}:${target.id}`;
    if (!target.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const formatEvidenceCopy = ({ node, events = [], refs = [], atoms = [] } = {}) => {
  if (!node) return '';
  const lines = [
    `Node: ${node.id}`,
    `Type: ${node.nodeType}`,
    `Title: ${node.title}`,
    node.summary ? `Summary: ${node.summary}` : '',
    atoms.length ? `Atoms: ${atoms.map((atom) => `${atom.id} ${atom.title}`).join('; ')}` : '',
    events.length ? 'Events:' : '',
    ...events.map((event) => `- ${event.id} ${event.eventType}: ${compactText(event.title || event.content, 220)}`),
    refs.length ? 'Raw refs:' : '',
    ...refs.map((ref) => [
      `- ${ref.id} ${ref.refType}${ref.refId ? `:${ref.refId}` : ''} ${ref.label || ''}`.trim(),
      ref.content ? `  ${ref.content}` : '',
    ].filter(Boolean).join('\n')),
  ].filter(Boolean);
  return lines.join('\n');
};

export function createBrainSymbolicCanvasService({ store = defaultBrainStore } = {}) {
  const buildCanvas = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    limit = 40,
  } = {}) => {
    const diagnostics = store.getDiagnostics({ sessionId, provider, projectName });
    const atoms = Array.isArray(diagnostics.atoms) ? diagnostics.atoms : [];
    const visibleNodes = (Array.isArray(diagnostics.nodes) ? diagnostics.nodes : [])
      .slice(0, Math.max(Number(limit) || 40, 1))
      .map((node) => {
        const atomIds = atoms
          .filter((atom) => (
            intersect(atom.sourceEventIds, node.sourceEventIds)
            || intersect(atom.refIds, node.refIds)
          ))
          .map((atom) => atom.id);
        return {
          id: node.id,
          nodeType: canonicalSymbolicNodeType(node.nodeType),
          title: node.title,
          summary: node.summary,
          status: node.status,
          sourceEventIds: Array.isArray(node.sourceEventIds) ? node.sourceEventIds : [],
          refIds: Array.isArray(node.refIds) ? node.refIds : [],
          atomIds,
        };
      });

    const edges = [];
    for (let index = 1; index < visibleNodes.length; index += 1) {
      edges.push({ from: visibleNodes[index - 1].id, to: visibleNodes[index].id, kind: 'sequence' });
    }
    for (const node of visibleNodes) {
      for (const refId of node.refIds) {
        edges.push({ from: node.id, to: refId, kind: 'evidence-ref' });
      }
      for (const atomId of node.atomIds) {
        edges.push({ from: node.id, to: atomId, kind: 'atom' });
      }
    }

    const mermaidLines = ['flowchart TD'];
    if (visibleNodes.length === 0) {
      mermaidLines.push('  empty["No symbolic memory nodes yet"]');
    } else {
      for (const node of visibleNodes) {
        mermaidLines.push(`  ${node.id}["${escapeMermaidLabel(node.title || node.summary || node.nodeType)}"]`);
        mermaidLines.push(`  click ${node.id} call brainInspectNode("${node.id}") "Inspect node evidence"`);
      }
      for (const edge of edges.filter((edge) => edge.kind === 'sequence')) {
        mermaidLines.push(`  ${edge.from} --> ${edge.to}`);
      }
    }

    const textFallback = visibleNodes.length
      ? visibleNodes.map((node, index) => [
        `${index + 1}. ${node.id} [${node.nodeType}] ${compactText(node.title || node.summary || node.nodeType, 140)}`,
        `   evidence refs: ${node.refIds.length}; atoms: ${node.atomIds.length}; source events: ${node.sourceEventIds.length}`,
      ].join('\n')).join('\n')
      : 'No symbolic memory nodes yet.';

    return {
      sessionId,
      provider: provider || 'claude',
      projectName: projectName || diagnostics.projectName || '',
      nodes: visibleNodes,
      edges,
      mermaid: mermaidLines.join('\n'),
      textFallback,
      source: {
        latestCompactionId: diagnostics.latestCompaction?.id || '',
        nodeCount: visibleNodes.length,
        atomCount: atoms.length,
      },
    };
  };

  const getNodeEvidence = ({
    sessionId = '',
    provider = 'claude',
    nodeId = '',
  } = {}) => {
    const detail = store.getNodeDetail({
      sessionId,
      provider,
      nodeId,
      includeRefContent: true,
    });
    if (!detail) {
      return null;
    }
    const openTargets = dedupeTargets(buildOpenTargets(detail.refs));
    return {
      ...detail,
      openTargets,
      copyEvidence: formatEvidenceCopy(detail),
    };
  };

  return {
    buildCanvas,
    getNodeEvidence,
  };
}

export const brainSymbolicCanvasService = createBrainSymbolicCanvasService();
