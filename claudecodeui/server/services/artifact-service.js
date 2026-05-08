import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { db as defaultDb } from '../database/db.js';
import { extractProjectDirectory as defaultExtractProjectDirectory } from '../projects.js';

import {
  createKnowledgeDocumentFromArtifact as defaultCreateKnowledgeDocumentFromArtifact,
  isKnowledgeArtifact,
} from './knowledge-document-service.js';
import { createMemoryCandidates as defaultCreateMemoryCandidates } from './obsidian-memory-service.js';
import { readObsidianBridgeConfig as defaultReadObsidianBridgeConfig } from './obsidian-bridge-service.js';

const DEFAULT_ARTIFACTS_DIR = path.resolve(process.env.APP_DATA_DIR || process.cwd(), 'artifacts');
const MAX_INLINE_CONTENT = 2_000_000;
const VALID_OBSIDIAN_MODES = new Set(['project-knowledge', 'second-brain', 'ai-memory']);

const defaultCreateId = (prefix = 'artifact') => `${prefix}_${crypto.randomUUID()}`;

const safeJson = (value) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

const parseJson = (value) => {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const resolveManagedArtifactPath = (filePath, artifactsDir = DEFAULT_ARTIFACTS_DIR) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return '';
  }

  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(artifactsDir, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return '';
  }
  return resolvedPath;
};

const sourceFilterSql = (source) => {
  if (!source) return { clause: '', params: [] };
  return {
    clause: ` AND (
      json_extract(COALESCE(metadata_json, '{}'), '$.source') = ?
      OR kind = ?
      OR kind LIKE ?
    )`,
    params: [source, source, `${source}-%`],
  };
};

const obsidianStatusFromDestination = (destination = '') => {
  if (destination === 'obsidian') return 'synced';
  if (destination === 'fallback') return 'fallback';
  if (destination === 'error') return 'failed';
  return 'not_sent';
};

const normalizeObsidianModes = (value, fallback = 'project-knowledge') => {
  const candidates = Array.isArray(value) ? value : [value];
  const modes = [];
  for (const mode of [fallback, ...candidates]) {
    const cleanMode = readString(mode);
    if (VALID_OBSIDIAN_MODES.has(cleanMode) && !modes.includes(cleanMode)) {
      modes.push(cleanMode);
    }
  }
  return modes.length > 0 ? modes : ['project-knowledge'];
};

const modesFromRoutingScores = (routingScores = {}) => {
  if (!routingScores || typeof routingScores !== 'object' || Array.isArray(routingScores)) {
    return [];
  }
  return Object.entries(routingScores)
    .filter(([mode, score]) => VALID_OBSIDIAN_MODES.has(mode) && Number(score) > 0)
    .map(([mode]) => mode);
};

const modesFromArtifactMetadata = (metadata = {}, fallback = 'project-knowledge') => {
  if (Array.isArray(metadata.obsidianModes) && metadata.obsidianModes.length > 0) return metadata.obsidianModes;
  if (Array.isArray(metadata.routingModes) && metadata.routingModes.length > 0) return metadata.routingModes;
  const scoredModes = modesFromRoutingScores(metadata.routingScores);
  if (scoredModes.length > 0) {
    return normalizeObsidianModes(scoredModes, metadata.obsidianMode || metadata.routingMode || scoredModes[0]);
  }
  return metadata.obsidianMode || metadata.routingMode || fallback;
};

const artifactArgusId = (artifactId, mode, multiMode = false) => {
  if (!artifactId) return '';
  return multiMode ? `artifact:${artifactId}:${mode}` : `artifact:${artifactId}`;
};

const summarizeObsidianExport = (result, { mode, automatic, argusId = '' }) => ({
  destination: result.destination,
  path: result.path || '',
  fallbackPath: result.fallbackPath || '',
  error: result.error || '',
  errorCode: result.errorCode || '',
  mode,
  automatic,
  argusId,
  updatedAt: new Date().toISOString(),
});

const buildObsidianMetadataPatch = (obsidianBridge, artifactId) => ({
  obsidianBridge,
  obsidianStatus: obsidianStatusFromDestination(obsidianBridge.destination),
  obsidianMode: obsidianBridge.mode || '',
  obsidianPath: obsidianBridge.path || '',
  obsidianFallbackPath: obsidianBridge.fallbackPath || '',
  obsidianArgusId: obsidianBridge.argusId || (artifactId ? `artifact:${artifactId}` : ''),
  obsidianLastError: obsidianBridge.error || '',
  obsidianSyncedAt: obsidianBridge.destination === 'obsidian' ? obsidianBridge.updatedAt : '',
});

const buildObsidianMultiMetadataPatch = (obsidianBridges = [], artifactId = '') => {
  const targets = obsidianBridges.filter(Boolean);
  const primary = targets[0] || {
    destination: 'not_sent',
    mode: '',
    path: '',
    fallbackPath: '',
    error: '',
    updatedAt: new Date().toISOString(),
  };
  const pathByMode = {};
  const fallbackPathByMode = {};
  const argusIdByMode = {};
  for (const target of targets) {
    if (target.path) pathByMode[target.mode] = target.path;
    if (target.fallbackPath) fallbackPathByMode[target.mode] = target.fallbackPath;
    if (target.argusId) argusIdByMode[target.mode] = target.argusId;
  }
  return {
    ...buildObsidianMetadataPatch({
      ...primary,
      targets,
    }, artifactId),
    obsidianBridges: targets,
    obsidianModes: targets.map((target) => target.mode),
    obsidianPaths: pathByMode,
    obsidianFallbackPaths: fallbackPathByMode,
    obsidianArgusIds: argusIdByMode,
  };
};

export const createArtifactService = ({
  db = defaultDb,
  artifactsDir = DEFAULT_ARTIFACTS_DIR,
  createId = defaultCreateId,
  extractProjectDirectory = defaultExtractProjectDirectory,
  createKnowledgeDocumentFromArtifact = defaultCreateKnowledgeDocumentFromArtifact,
  createMemoryCandidates = defaultCreateMemoryCandidates,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
} = {}) => {
  const mapArtifact = (row, includeContent = false) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    projectName: row.project_name || '',
    sessionId: row.session_id || '',
    content: includeContent ? row.content || '' : undefined,
    filePath: resolveManagedArtifactPath(row.file_path, artifactsDir) || '',
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const persistLargeContent = async (artifactId, content) => {
    if (!content || content.length <= MAX_INLINE_CONTENT) {
      return { content, filePath: null };
    }

    await fs.mkdir(artifactsDir, { recursive: true });
    const filePath = path.join(artifactsDir, `${artifactId}.txt`);
    await fs.writeFile(filePath, content, 'utf8');
    return { content: '', filePath };
  };

  const hydrateArtifactContent = async (artifact) => {
    if (!artifact.content && artifact.filePath) {
      try {
        artifact.content = await fs.readFile(artifact.filePath, 'utf8');
      } catch {
        artifact.content = '';
      }
    }
    return artifact;
  };

  const getArtifact = async (artifactId, { includeContent = false } = {}) => {
    const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId);
    if (!row) {
      return null;
    }
    const artifact = mapArtifact(row, includeContent);
    return includeContent ? hydrateArtifactContent(artifact) : artifact;
  };

  const listArtifacts = async ({ projectName = '', sessionId = '', source = '' } = {}) => {
    const sourceSql = sourceFilterSql(source);
    const rows = projectName || sessionId || source
      ? db.prepare(`
          SELECT * FROM artifacts
          WHERE (? = '' OR project_name = ?)
            AND (? = '' OR session_id = ?)
            ${sourceSql.clause}
          ORDER BY created_at DESC
          LIMIT 100
        `).all(projectName, projectName, sessionId, sessionId, ...sourceSql.params)
      : db.prepare('SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 100').all();
    return rows.map((row) => mapArtifact(row));
  };

  const createArtifactLink = ({ artifactId, sourceType, sourceId = '', sessionId = '', projectName = '' }) => {
    if (!artifactId || !sourceType) {
      return;
    }
    db.prepare(`
      INSERT INTO artifact_links (id, artifact_id, source_type, source_id, session_id, project_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(createId('artifact_link'), artifactId, sourceType, sourceId || null, sessionId || null, projectName || null);
  };

  const updateArtifactMetadata = (artifactId, patch = {}) => {
    const row = db.prepare('SELECT metadata_json FROM artifacts WHERE id = ?').get(artifactId);
    const metadata = parseJson(row?.metadata_json);
    const nextMetadata = {
      ...metadata,
      ...patch,
    };
    db.prepare('UPDATE artifacts SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(safeJson(nextMetadata), artifactId);
    return nextMetadata;
  };

  const resolveProjectRoot = async (projectName = '') => {
    if (!projectName) {
      return '';
    }
    try {
      return await extractProjectDirectory(projectName);
    } catch {
      return '';
    }
  };

  const exportArtifactToObsidian = async (artifact, {
    mode = '',
    automatic = false,
    updateMetadata = true,
    multiMode = false,
  } = {}) => {
    const targetMode = mode || artifact?.metadata?.obsidianMode || 'project-knowledge';
    const projectRoot = await resolveProjectRoot(artifact.projectName);
    const argusId = artifactArgusId(artifact.id, targetMode, multiMode);
    const result = await createKnowledgeDocumentFromArtifact(artifact, {
      mode: targetMode,
      projectRoot,
      argusId,
    });
    const obsidianBridge = summarizeObsidianExport(result, {
      mode: targetMode,
      automatic,
      argusId,
    });
    if (updateMetadata) {
      updateArtifactMetadata(artifact.id, buildObsidianMetadataPatch(obsidianBridge, artifact.id));
    }
    return obsidianBridge;
  };

  const exportArtifactToObsidianModes = async (artifact, {
    modes = [],
    automatic = false,
  } = {}) => {
    const sourceModes = Array.isArray(modes) && modes.length === 0
      ? modesFromArtifactMetadata(artifact?.metadata, artifact?.metadata?.obsidianMode || 'project-knowledge')
      : modes;
    const firstMode = Array.isArray(sourceModes) ? sourceModes[0] : sourceModes;
    const targetModes = normalizeObsidianModes(
      sourceModes,
      firstMode || artifact?.metadata?.obsidianMode || 'project-knowledge',
    );
    const multiMode = targetModes.length > 1;
    const obsidianBridges = [];
    for (const targetMode of targetModes) {
      try {
        obsidianBridges.push(await exportArtifactToObsidian(artifact, {
          mode: targetMode,
          automatic,
          updateMetadata: false,
          multiMode,
        }));
      } catch (error) {
        obsidianBridges.push({
          destination: 'error',
          path: '',
          fallbackPath: '',
          error: error?.message || 'Failed to export artifact to Obsidian.',
          errorCode: error?.code || 'OBSIDIAN_EXPORT_FAILED',
          mode: targetMode,
          automatic,
          argusId: artifactArgusId(artifact.id, targetMode, multiMode),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    const primaryBridge = {
      ...obsidianBridges[0],
      targets: obsidianBridges,
    };
    updateArtifactMetadata(artifact.id, buildObsidianMultiMetadataPatch(obsidianBridges, artifact.id));
    return primaryBridge;
  };

  const maybeAutoExportArtifact = async (artifact) => {
    const bridgeConfig = readObsidianBridgeConfig();
    if (!bridgeConfig.enabled || !bridgeConfig.autoExportKnowledgeArtifacts || !isKnowledgeArtifact(artifact)) {
      return null;
    }
    const targetMode = artifact?.metadata?.obsidianMode || bridgeConfig.defaultMode || 'project-knowledge';
    const targetModes = normalizeObsidianModes(
      artifact?.metadata?.obsidianModes || artifact?.metadata?.routingModes || targetMode,
      targetMode,
    );
    try {
      return await exportArtifactToObsidianModes(artifact, {
        modes: targetModes,
        automatic: true,
      });
    } catch (error) {
      const obsidianBridge = {
        destination: 'error',
        path: '',
        fallbackPath: '',
        error: error?.message || 'Failed to export artifact to Obsidian.',
        errorCode: error?.code || 'OBSIDIAN_EXPORT_FAILED',
        mode: targetMode,
        automatic: true,
        argusId: artifactArgusId(artifact.id, targetMode, targetModes.length > 1),
        updatedAt: new Date().toISOString(),
      };
      updateArtifactMetadata(artifact.id, buildObsidianMetadataPatch(obsidianBridge, artifact.id));
      return obsidianBridge;
    }
  };

  const createArtifact = async ({
    kind = 'note',
    title = '',
    projectName = '',
    sessionId = '',
    content = '',
    metadata = {},
  } = {}, {
    autoExport = true,
    link = true,
  } = {}) => {
    const cleanKind = readString(kind) || 'note';
    const cleanTitle = readString(title);
    if (!cleanTitle) {
      throw new Error('Artifact title is required');
    }

    const id = createId('artifact');
    const sourceMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    const initialMetadata = {
      ...sourceMetadata,
      obsidianStatus: sourceMetadata.obsidianStatus || 'not_sent',
    };
    const stored = await persistLargeContent(id, typeof content === 'string' ? content : '');
    db.prepare(`
      INSERT INTO artifacts (id, kind, title, project_name, session_id, content, file_path, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanKind,
      cleanTitle,
      projectName || null,
      sessionId || null,
      stored.content || null,
      stored.filePath || null,
      safeJson(initialMetadata),
    );

    if (link) {
      const sourceType = readString(sourceMetadata.source) || cleanKind;
      createArtifactLink({
        artifactId: id,
        sourceType,
        sourceId: readString(sourceMetadata.runId) || readString(sourceMetadata.sourceId),
        sessionId,
        projectName,
      });
    }

    let artifact = await getArtifact(id, { includeContent: true });
    if (isKnowledgeArtifact(artifact)) {
      try {
        createMemoryCandidates({
          text: artifact.content || '',
          source: {
            artifactId: artifact.id,
            projectName: artifact.projectName,
            title: artifact.title,
            kind: artifact.kind,
          },
        });
      } catch (error) {
        console.warn('[artifact-service] Failed to create AI Memory candidates:', error?.message || error);
      }
    }
    const obsidianBridge = autoExport ? await maybeAutoExportArtifact(artifact) : null;
    artifact = await getArtifact(id, { includeContent: true });
    return {
      artifact,
      obsidianBridge,
    };
  };

  const deleteArtifact = async (artifactId) => {
    const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId);
    if (!row) {
      return false;
    }
    db.prepare('DELETE FROM artifacts WHERE id = ?').run(artifactId);
    const managedPath = resolveManagedArtifactPath(row.file_path, artifactsDir);
    if (managedPath) {
      await fs.unlink(managedPath).catch(() => undefined);
    }
    return true;
  };

  return {
    createArtifact,
    createArtifactLink,
    deleteArtifact,
    exportArtifactToObsidian,
    exportArtifactToObsidianModes,
    getArtifact,
    hydrateArtifactContent,
    listArtifacts,
    mapArtifact,
    maybeAutoExportArtifact,
    updateArtifactMetadata,
  };
};

export const artifactService = createArtifactService();

export const createArtifact = (...args) => artifactService.createArtifact(...args);
export const createArtifactLink = (...args) => artifactService.createArtifactLink(...args);
export const deleteArtifact = (...args) => artifactService.deleteArtifact(...args);
export const exportArtifactToObsidian = (...args) => artifactService.exportArtifactToObsidian(...args);
export const exportArtifactToObsidianModes = (...args) => artifactService.exportArtifactToObsidianModes(...args);
export const getArtifact = (...args) => artifactService.getArtifact(...args);
export const listArtifacts = (...args) => artifactService.listArtifacts(...args);
export const updateArtifactMetadata = (...args) => artifactService.updateArtifactMetadata(...args);
