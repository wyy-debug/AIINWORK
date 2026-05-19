import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { db as defaultDb } from '../database/db.js';
import { extractProjectDirectory as defaultExtractProjectDirectory } from '../projects.js';

const DEFAULT_ARTIFACTS_DIR = path.resolve(process.env.APP_DATA_DIR || process.cwd(), 'artifacts');
const MAX_INLINE_CONTENT = 2_000_000;

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

export const createArtifactService = ({
  db = defaultDb,
  artifactsDir = DEFAULT_ARTIFACTS_DIR,
  createId = defaultCreateId,
  extractProjectDirectory = defaultExtractProjectDirectory,
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
    if (!artifact || artifact.content || !artifact.filePath) {
      return artifact;
    }
    const content = await fs.readFile(artifact.filePath, 'utf8').catch(() => '');
    return { ...artifact, content };
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

  const createArtifact = async ({
    kind = 'note',
    title = '',
    projectName = '',
    sessionId = '',
    content = '',
    metadata = {},
  } = {}, {
    link = true,
  } = {}) => {
    const cleanKind = readString(kind) || 'note';
    const cleanTitle = readString(title);
    if (!cleanTitle) {
      throw new Error('Artifact title is required');
    }

    const id = createId('artifact');
    const sourceMetadata = metadata && typeof metadata === 'object' ? metadata : {};
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
      safeJson(sourceMetadata),
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

    return {
      artifact: await getArtifact(id, { includeContent: true }),
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
    getArtifact,
    hydrateArtifactContent,
    listArtifacts,
    mapArtifact,
    resolveProjectRoot,
    updateArtifactMetadata,
  };
};

export const artifactService = createArtifactService();

export const createArtifact = (...args) => artifactService.createArtifact(...args);
export const createArtifactLink = (...args) => artifactService.createArtifactLink(...args);
export const deleteArtifact = (...args) => artifactService.deleteArtifact(...args);
export const getArtifact = (...args) => artifactService.getArtifact(...args);
export const listArtifacts = (...args) => artifactService.listArtifacts(...args);
export const updateArtifactMetadata = (...args) => artifactService.updateArtifactMetadata(...args);
