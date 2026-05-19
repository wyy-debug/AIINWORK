import { brainStore as defaultBrainStore } from './brain-store-service.js';
import { createBrainSymbolicCanvasService } from './brain-symbolic-canvas-service.js';

const HIDDEN_PREVIEW = '[hidden: expand through safe evidence drill-down]';

const safeArray = (value) => (Array.isArray(value) ? value : []);

const compact = (value = '', max = 220) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const safeRef = (ref = {}) => ({
  id: ref.id,
  sessionId: ref.sessionId,
  refType: ref.refType,
  refId: ref.refId,
  label: ref.label,
  checkpointId: ref.checkpointId,
  artifactId: ref.artifactId,
  eventId: ref.eventId,
  sizeBytes: ref.sizeBytes,
  metadata: ref.metadata,
  contentPreview: HIDDEN_PREVIEW,
  sensitiveHidden: true,
  createdAtMs: ref.createdAtMs,
});

const safeAtom = (atom = {}) => ({
  id: atom.id,
  atomType: atom.atomType,
  title: atom.title,
  summary: compact(atom.summary),
  status: atom.status,
  stableKey: atom.stableKey,
  confidence: atom.confidence,
  pinned: atom.pinned,
  supersededById: atom.supersededById,
  conflictReason: atom.conflictReason,
  entities: safeArray(atom.entities),
  sourceEventIds: safeArray(atom.sourceEventIds),
  refIds: safeArray(atom.refIds),
  updatedAtMs: atom.updatedAtMs,
});

export function createBrainInspectorService({
  store = defaultBrainStore,
  symbolicCanvasService = createBrainSymbolicCanvasService({ store }),
} = {}) {
  const buildInspector = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
  } = {}) => {
    const diagnostics = store.getDiagnostics({ sessionId, provider, projectName });
    const effectiveProjectName = projectName || diagnostics.projectName || '';
    const refs = store.listRefs({ sessionId, provider, projectName: effectiveProjectName, includePruned: false, limit: 120 });
    const atoms = store.listAtoms({ sessionId, provider, projectName: effectiveProjectName, status: '', limit: 160 });
    const scenarios = store.listScenarios({ sessionId, provider, projectName: effectiveProjectName, limit: 40 });
    const projectProfile = effectiveProjectName ? store.getProjectProfile({ projectName: effectiveProjectName, provider }) : null;
    const retrievalRuns = store.listRetrievalRuns({ sessionId, provider, projectName: effectiveProjectName, limit: 10 });
    const canvas = symbolicCanvasService.buildCanvas({ sessionId, provider, projectName: effectiveProjectName });
    const hasMemory = Boolean(diagnostics.session) || atoms.length > 0 || refs.length > 0;
    return {
      enabled: true,
      status: hasMemory ? 'ready' : 'empty',
      actions: hasMemory
        ? ['Inspect recall hits', 'Select a canvas node', 'Use controls to correct memory']
        : ['Send a message with Brain enabled', 'Run a task to capture refs', 'Open Runtime Settings if Brain is disabled'],
      controls: ['pin', 'archive', 'mark-stale', 'merge', 'clear-session', 'clear-project', 'export-report'],
      layers: {
        rawRefs: refs.map(safeRef),
        atoms: atoms.map(safeAtom),
        scenarios,
        projectProfile,
        compactions: diagnostics.latestCompaction ? [diagnostics.latestCompaction] : [],
      },
      recallHits: safeArray(retrievalRuns[0]?.hits).map((hit) => ({
        id: hit.id,
        title: hit.title,
        score: hit.score,
        reasons: safeArray(hit.reasons),
      })),
      retrievalRuns,
      canvas,
      degraded: {
        isDegraded: retrievalRuns.some((run) => run.mode?.includes('degraded') || run.metrics?.degraded),
        warnings: retrievalRuns.flatMap((run) => safeArray(run.metrics?.warnings)),
      },
    };
  };

  const buildDisabledInspector = () => ({
    enabled: false,
    status: 'disabled',
    actions: ['Enable Argus Brain in Runtime Settings'],
    controls: [],
    layers: {
      rawRefs: [],
      atoms: [],
      scenarios: [],
      projectProfile: null,
      compactions: [],
    },
    recallHits: [],
    retrievalRuns: [],
    canvas: { mermaid: '', textFallback: 'Argus Brain is disabled.' },
    degraded: { isDegraded: true, warnings: ['brain-disabled'] },
  });

  const exportReport = (inspector = {}) => [
    '# Argus Brain Inspector Report',
    '',
    `Status: ${inspector.status || 'unknown'}`,
    `Raw refs: ${inspector.layers?.rawRefs?.length || 0}`,
    `Atoms: ${inspector.layers?.atoms?.length || 0}`,
    `Scenarios: ${inspector.layers?.scenarios?.length || 0}`,
    `Recall hits: ${inspector.recallHits?.length || 0}`,
    '',
    'Raw ref content is hidden unless expanded through safe evidence drill-down.',
  ].join('\n');

  return {
    buildDisabledInspector,
    buildInspector,
    exportReport,
  };
}

export const brainInspectorService = createBrainInspectorService();
