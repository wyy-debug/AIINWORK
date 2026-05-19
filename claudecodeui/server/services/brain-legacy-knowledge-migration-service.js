import crypto from 'node:crypto';

import { appConfigDb } from '../database/db.js';

import { listArtifacts as defaultListArtifacts } from './artifact-service.js';
import { brainStore as defaultStore } from './brain-store-service.js';

const LEGACY_CANDIDATES_KEY = 'obsidian_wiki_candidates';
const DEFAULT_SESSION_ID = 'legacy-knowledge';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeText = (value = '') => readString(value).replace(/\s+/g, ' ');

const safeArray = (value) => (Array.isArray(value) ? value : []);

const stableHash = (value) => crypto
  .createHash('sha256')
  .update(String(value || ''))
  .digest('hex')
  .slice(0, 16);

const parseJsonArray = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const defaultListLegacyCandidates = () => parseJsonArray(appConfigDb.get(LEGACY_CANDIDATES_KEY));

const isDiscarded = (entry = {}) => readString(entry.status).toLowerCase() === 'discarded';

const projectFor = (entry = {}, fallback = '') => readString(
  entry.projectName
  || entry.source?.projectName
  || entry.metadata?.projectName
  || entry.metadata?.project
  || fallback,
);

const candidateToEntry = (candidate = {}, { projectName = '' } = {}) => {
  const title = readString(candidate.title);
  const summary = normalizeText(candidate.summary || candidate.text || candidate.content).slice(0, 600);
  if (!title || !summary || isDiscarded(candidate)) {
    return null;
  }
  const sourceProject = projectFor(candidate, projectName);
  if (projectName && sourceProject && sourceProject !== projectName) {
    return null;
  }
  const sourceId = readString(candidate.id) || stableHash(`${title}:${summary}`);
  return {
    sourceType: 'wiki-candidate',
    sourceId,
    title,
    summary,
    projectName: sourceProject || projectName,
    stableKey: `legacy:wiki-candidate:${sourceId}`,
    confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : 0.8,
    tags: safeArray(candidate.tags).map(readString).filter(Boolean),
    sourceRefs: safeArray(candidate.sourceRefs),
    sourcePath: readString(candidate.targetPath || candidate.wikiPath || candidate.path),
    skipped: false,
  };
};

const artifactHasLegacyWikiMetadata = (artifact = {}) => {
  const metadata = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {};
  return Boolean(
    metadata.obsidianBridge
    || metadata.obsidianStatus
    || metadata.obsidianPath
    || metadata.wikiPath
    || metadata.obsidianArgusId
    || metadata.wikiStatus,
  );
};

const artifactToEntry = (artifact = {}, { projectName = '' } = {}) => {
  if (!artifactHasLegacyWikiMetadata(artifact)) {
    return null;
  }
  const title = readString(artifact.title);
  if (!title) {
    return null;
  }
  const metadata = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {};
  const sourceProject = projectFor(artifact, projectName);
  const summary = normalizeText(
    metadata.summary
    || metadata.routingReason
    || metadata.obsidianBridge?.summary
    || artifact.content
    || `${artifact.kind || 'Artifact'} captured from retired Obsidian/Wiki workflow.`,
  ).slice(0, 600);
  return {
    sourceType: 'artifact',
    sourceId: readString(artifact.id) || stableHash(`${title}:${summary}`),
    title,
    summary,
    projectName: sourceProject || projectName,
    stableKey: `legacy:artifact:${readString(artifact.id) || stableHash(`${title}:${summary}`)}`,
    confidence: 0.75,
    tags: safeArray(metadata.tags).map(readString).filter(Boolean),
    sourceRefs: [{ type: 'artifact', id: readString(artifact.id) }].filter((ref) => ref.id),
    sourcePath: readString(metadata.wikiPath || metadata.obsidianPath || metadata.obsidianBridge?.path || metadata.obsidianBridge?.wikiPath),
    skipped: false,
  };
};

export function createBrainLegacyKnowledgeMigrationService({
  store = defaultStore,
  listLegacyCandidates = defaultListLegacyCandidates,
  listArtifacts = defaultListArtifacts,
} = {}) {
  const buildPreview = async ({ projectName = '', provider = 'claude', sessionId = DEFAULT_SESSION_ID } = {}) => {
    const candidates = safeArray(await listLegacyCandidates({ projectName }));
    const artifacts = safeArray(await listArtifacts({ projectName }));
    const skipped = [];
    for (const candidate of candidates) {
      if (isDiscarded(candidate)) {
        skipped.push({ sourceType: 'wiki-candidate', sourceId: readString(candidate.id), reason: 'discarded' });
      }
    }
    for (const artifact of artifacts) {
      if (!artifactHasLegacyWikiMetadata(artifact)) {
        skipped.push({ sourceType: 'artifact', sourceId: readString(artifact.id), reason: 'no-legacy-wiki-metadata' });
      }
    }
    const entries = [
      ...candidates.map((candidate) => candidateToEntry(candidate, { projectName })),
      ...artifacts.map((artifact) => artifactToEntry(artifact, { projectName })),
    ].filter(Boolean);
    const existingKeys = new Set(store
      .listAtoms({ sessionId, provider, projectName, status: '', limit: 500 })
      .map((atom) => atom.stableKey));
    const entriesWithState = entries.map((entry) => ({
      ...entry,
      alreadyImported: existingKeys.has(entry.stableKey),
    }));
    return {
      dryRun: true,
      sessionId,
      provider,
      projectName,
      sources: {
        wikiCandidates: candidates.length,
        artifacts: artifacts.length,
      },
      entries: entriesWithState,
      skipped,
      importableCount: entriesWithState.filter((entry) => !entry.alreadyImported).length,
      alreadyImportedCount: entriesWithState.filter((entry) => entry.alreadyImported).length,
      skippedCount: skipped.length,
    };
  };

  const importKnowledge = async (options = {}) => {
    const preview = await buildPreview(options);
    const importedAtoms = [];
    for (const entry of preview.entries) {
      if (entry.alreadyImported) continue;
      const atom = store.upsertAtom({
        sessionId: preview.sessionId,
        provider: preview.provider,
        projectName: entry.projectName || preview.projectName,
        atomType: 'knowledge',
        title: entry.title,
        summary: entry.summary,
        stableKey: entry.stableKey,
        confidence: entry.confidence,
        entities: [
          ...entry.tags.map((tag) => ({ type: 'tag', value: tag })),
          entry.sourcePath ? { type: 'legacy-path', value: entry.sourcePath } : null,
          { type: 'legacy-source', value: entry.sourceType },
        ].filter(Boolean),
        sourceEventIds: [],
        refIds: [],
      });
      if (atom) {
        importedAtoms.push(atom);
      }
    }
    if (importedAtoms.length > 0) {
      const groupedProjects = [...new Set(importedAtoms.map((atom) => atom.projectName || preview.projectName).filter(Boolean))];
      for (const project of groupedProjects) {
        const projectAtoms = store.listAtoms({
          sessionId: preview.sessionId,
          provider: preview.provider,
          projectName: project,
          status: '',
          limit: 500,
        }).filter((atom) => atom.stableKey.startsWith('legacy:'));
        store.upsertProjectProfile({
          provider: preview.provider,
          projectName: project,
          profileType: 'legacy-knowledge',
          summary: `Imported ${projectAtoms.length} legacy knowledge items from retired Obsidian surfaces.`,
          content: {
            source: 'legacy-knowledge-migration',
            sourceSystems: ['obsidian'],
            atomCount: projectAtoms.length,
            atoms: projectAtoms.map((atom) => ({
              id: atom.id,
              title: atom.title,
              stableKey: atom.stableKey,
            })),
          },
          sourceAtomIds: projectAtoms.map((atom) => atom.id),
        });
      }
    }
    return {
      ...preview,
      dryRun: false,
      importedAtoms,
      importedCount: importedAtoms.length,
    };
  };

  return {
    preview: buildPreview,
    importKnowledge,
  };
}

export const brainLegacyKnowledgeMigrationService = createBrainLegacyKnowledgeMigrationService();
