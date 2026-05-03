import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import express from 'express';

import { db } from '../database/db.js';

const router = express.Router();
const ARTIFACTS_DIR = path.resolve(process.env.APP_DATA_DIR || process.cwd(), 'artifacts');
const MAX_INLINE_CONTENT = 2_000_000;

const createId = () => `artifact_${crypto.randomUUID()}`;

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

const resolveManagedArtifactPath = (filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return '';
  }

  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(ARTIFACTS_DIR, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return '';
  }
  return resolvedPath;
};

const mapArtifact = (row, includeContent = false) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  projectName: row.project_name || '',
  sessionId: row.session_id || '',
  content: includeContent ? row.content || '' : undefined,
  filePath: resolveManagedArtifactPath(row.file_path) || '',
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const createArtifactLink = ({ artifactId, sourceType, sourceId = '', sessionId = '', projectName = '' }) => {
  if (!artifactId || !sourceType) {
    return;
  }
  db.prepare(`
    INSERT INTO artifact_links (id, artifact_id, source_type, source_id, session_id, project_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(createId(), artifactId, sourceType, sourceId || null, sessionId || null, projectName || null);
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

const persistLargeContent = async (artifactId, content) => {
  if (!content || content.length <= MAX_INLINE_CONTENT) {
    return { content, filePath: null };
  }

  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  const filePath = path.join(ARTIFACTS_DIR, `${artifactId}.txt`);
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

router.get('/', async (req, res) => {
  try {
    const projectName = String(req.query.projectName || '');
    const sessionId = String(req.query.sessionId || '');
    const source = String(req.query.source || '');
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
    res.json({ success: true, artifacts: rows.map((row) => mapArtifact(row)) });
  } catch (error) {
    console.error('Artifacts list error:', error);
    res.status(500).json({ error: error.message || 'Failed to list artifacts' });
  }
});

router.post('/', async (req, res) => {
  try {
    const kind = typeof req.body?.kind === 'string' ? req.body.kind.trim() : 'note';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      return res.status(400).json({ error: 'Artifact title is required' });
    }

    const id = createId();
    const rawContent = typeof req.body?.content === 'string' ? req.body.content : '';
    const stored = await persistLargeContent(id, rawContent);
    db.prepare(`
      INSERT INTO artifacts (id, kind, title, project_name, session_id, content, file_path, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      kind,
      title,
      req.body?.projectName || null,
      req.body?.sessionId || null,
      stored.content || null,
      stored.filePath || null,
      safeJson(req.body?.metadata),
    );
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const sourceType = typeof metadata.source === 'string' && metadata.source ? metadata.source : kind;
    createArtifactLink({
      artifactId: id,
      sourceType,
      sourceId: typeof metadata.runId === 'string' ? metadata.runId : typeof metadata.sourceId === 'string' ? metadata.sourceId : '',
      sessionId: req.body?.sessionId || '',
      projectName: req.body?.projectName || '',
    });
    res.json({
      success: true,
      artifact: mapArtifact(db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id), true),
    });
  } catch (error) {
    console.error('Artifact create error:', error);
    res.status(500).json({ error: error.message || 'Failed to create artifact' });
  }
});

router.post('/:id/attach-to-session', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const projectName = typeof req.body?.projectName === 'string' ? req.body.projectName.trim() : row.project_name || '';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    createArtifactLink({
      artifactId: row.id,
      sourceType: 'chat',
      sourceId: sessionId,
      sessionId,
      projectName,
    });
    const artifact = await hydrateArtifactContent(mapArtifact(row, true));
    const summary = [
      `Artifact: ${artifact.title}`,
      `Kind: ${artifact.kind}`,
      artifact.content ? artifact.content.slice(0, 4000) : artifact.filePath ? `File: ${artifact.filePath}` : '',
    ].filter(Boolean).join('\n');
    res.json({ success: true, context: summary, artifact });
  } catch (error) {
    console.error('Artifact attach error:', error);
    res.status(500).json({ error: error.message || 'Failed to attach artifact' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    const artifact = await hydrateArtifactContent(mapArtifact(row, true));
    res.json({ success: true, artifact });
  } catch (error) {
    console.error('Artifact get error:', error);
    res.status(500).json({ error: error.message || 'Failed to load artifact' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    db.prepare('DELETE FROM artifacts WHERE id = ?').run(req.params.id);
    const managedPath = resolveManagedArtifactPath(row.file_path);
    if (managedPath) {
      await fs.unlink(managedPath).catch(() => undefined);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Artifact delete error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete artifact' });
  }
});

export default router;
