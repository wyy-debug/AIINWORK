import crypto from 'node:crypto';

import { brainStore as defaultBrainStore } from './brain-store-service.js';

const sha256 = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const safeArray = (value) => (Array.isArray(value) ? value : []);

function packageCounts(data = {}) {
  return {
    events: safeArray(data.events).length,
    refs: safeArray(data.refs).length,
    nodes: safeArray(data.nodes).length,
    compactions: safeArray(data.compactions).length,
    atoms: safeArray(data.atoms).length,
    scenarios: safeArray(data.scenarios).length,
    retrievalRuns: safeArray(data.retrievalRuns).length,
  };
}

function listBrokenEdges(store, { sessionId = '', provider = 'claude', projectName = '' } = {}) {
  const refs = store.listRefs({ sessionId, provider, projectName, includePruned: true, limit: 5000 });
  const refIds = new Set(refs.map((ref) => ref.id));
  const atoms = store.listAtoms({ sessionId, provider, projectName, status: '', limit: 2000 });
  const nodes = projectName
    ? store.listProjectNodes({ projectName, provider, limit: 500 }).filter((node) => !sessionId || node.sessionId === sessionId)
    : [];
  const broken = [];
  for (const atom of atoms) {
    for (const refId of safeArray(atom.refIds)) {
      if (!refIds.has(refId)) {
        broken.push({ ownerType: 'atom', ownerId: atom.id, refId });
      }
    }
  }
  for (const node of nodes) {
    for (const refId of safeArray(node.refIds)) {
      if (!refIds.has(refId)) {
        broken.push({ ownerType: 'node', ownerId: node.id, refId });
      }
    }
  }
  return broken;
}

export function createBrainMaintenanceService({ store = defaultBrainStore } = {}) {
  const exportPackage = ({ sessionId = '', provider = 'claude', projectName = '' } = {}) => {
    const data = store.exportSession({ sessionId, provider });
    const manifest = {
      exportedAtMs: Date.now(),
      scope: sessionId ? 'session' : 'project',
      sessionId,
      projectName: projectName || data?.session?.projectName || '',
      provider,
      counts: packageCounts(data),
      integritySha256: '',
    };
    manifest.integritySha256 = sha256(data);
    return {
      schemaVersion: 2,
      manifest,
      data,
    };
  };

  const importPackage = ({ packageData = {}, overwrite = false } = {}) => {
    const data = packageData.data || packageData;
    const expected = packageData.manifest?.integritySha256 || '';
    const actual = sha256(data);
    if (expected && expected !== actual) {
      return { imported: false, integrityVerified: false, error: 'integrity-check-failed' };
    }
    const result = store.importSession({ packageData: data, overwrite });
    return {
      ...result,
      integrityVerified: Boolean(expected) ? expected === actual : true,
      schemaVersion: packageData.schemaVersion || data.version || 1,
    };
  };

  const previewLayerRetention = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    perSessionMaxEvents = 1000,
    rawRefsMaxSizeBytes = 5_000_000,
    maxAtoms = 1000,
    maxScenarios = 200,
    maxCompactions = 80,
  } = {}) => {
    const base = store.previewRetention({
      sessionId,
      provider,
      projectName,
      perSessionMaxEvents,
      rawRefsMaxSizeBytes,
      perProjectMaxCompactions: maxCompactions,
    });
    const atoms = store.listAtoms({ sessionId, provider, projectName, status: '', limit: 5000 });
    const scenarios = store.listScenarios({ sessionId, provider, projectName, limit: 5000 });
    const compactions = store.exportSession({ sessionId, provider })?.compactions || [];
    return {
      dryRun: true,
      layers: {
        events: {
          count: base.eventCount,
          wouldDeleteCount: base.wouldPruneEvents,
        },
        rawRefs: {
          bytes: base.rawBytes,
          wouldPruneBytes: base.wouldPruneRawBytes,
          wouldPruneCount: base.wouldPruneRawBytes > 0 ? Math.max(1, Math.ceil(base.wouldPruneRawBytes / Math.max(base.rawBytes / Math.max(base.eventCount, 1), 1))) : 0,
        },
        atoms: {
          count: atoms.length,
          wouldArchiveCount: Math.max(0, atoms.length - Math.max(Number(maxAtoms) || 1000, 1)),
        },
        scenarios: {
          count: scenarios.length,
          wouldArchiveCount: Math.max(0, scenarios.length - Math.max(Number(maxScenarios) || 200, 1)),
        },
        compactions: {
          count: compactions.length,
          wouldDeleteCount: Math.max(0, compactions.length - Math.max(Number(maxCompactions) || 80, 1)),
        },
      },
    };
  };

  const repairAndReport = ({ sessionId = '', provider = 'claude', projectName = '' } = {}) => {
    const brokenEdges = listBrokenEdges(store, { sessionId, provider, projectName });
    const repair = store.repairSession({ sessionId, provider });
    return {
      ...repair,
      brokenEdges,
      health: {
        status: brokenEdges.length ? 'warning' : 'ok',
        warnings: brokenEdges.length ? ['broken-ref-edges'] : [],
      },
    };
  };

  return {
    exportPackage,
    importPackage,
    previewLayerRetention,
    repairAndReport,
  };
}

export const brainMaintenanceService = createBrainMaintenanceService();
