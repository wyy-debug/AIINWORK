import express from 'express';

import {
  createArtifact,
  createArtifactLink,
  deleteArtifact,
  getArtifact,
  listArtifacts,
} from '../services/artifact-service.js';

const router = express.Router();

const readMetadata = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

router.get('/', async (req, res) => {
  try {
    const artifacts = await listArtifacts({
      projectName: String(req.query.projectName || ''),
      sessionId: String(req.query.sessionId || ''),
      source: String(req.query.source || ''),
    });
    res.json({ success: true, artifacts });
  } catch (error) {
    console.error('Artifacts list error:', error);
    res.status(500).json({ error: error.message || 'Failed to list artifacts' });
  }
});

router.post('/', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      return res.status(400).json({ error: 'Artifact title is required' });
    }

    const result = await createArtifact({
      kind: typeof req.body?.kind === 'string' ? req.body.kind.trim() : 'note',
      title,
      projectName: req.body?.projectName || '',
      sessionId: req.body?.sessionId || '',
      content: typeof req.body?.content === 'string' ? req.body.content : '',
      metadata: readMetadata(req.body?.metadata),
    });
    res.json({
      success: true,
      artifact: result.artifact,
    });
  } catch (error) {
    console.error('Artifact create error:', error);
    res.status(500).json({ error: error.message || 'Failed to create artifact' });
  }
});

router.post('/:id/attach-to-session', async (req, res) => {
  try {
    const artifact = await getArtifact(req.params.id, { includeContent: true });
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const projectName = typeof req.body?.projectName === 'string' ? req.body.projectName.trim() : artifact.projectName || '';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    createArtifactLink({
      artifactId: artifact.id,
      sourceType: 'chat',
      sourceId: sessionId,
      sessionId,
      projectName,
    });
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
    const artifact = await getArtifact(req.params.id, { includeContent: true });
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.json({ success: true, artifact });
  } catch (error) {
    console.error('Artifact get error:', error);
    res.status(500).json({ error: error.message || 'Failed to load artifact' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteArtifact(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Artifact delete error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete artifact' });
  }
});

export default router;
