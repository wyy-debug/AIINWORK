import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import express from 'express';

import {
  deleteAgentConfig,
  getAgentConfig,
  listAgentConfigs,
  patchAgentConfig,
  upsertAgentConfig,
} from '../services/agent-config-service.js';
import { listInstalledSkills } from '../services/agent-skill-service.js';
import {
  deleteAgentKnowledge,
  deleteAgentKnowledgeSource,
  listAgentKnowledgeSources,
  parseRelativePaths,
  reindexAgentKnowledgeSource,
  saveAgentKnowledgeFiles,
} from '../services/agent-rag-service.js';
import { sessionAgentBindingsDb } from '../database/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const includePaused = req.query.includePaused !== 'false';
    const agents = await listAgentConfigs({ includePaused });
    res.json({ success: true, agents });
  } catch (error) {
    console.error('Error listing agents:', error);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

router.get('/skills/installed', async (req, res) => {
  try {
    const result = await listInstalledSkills({
      workspacePath: typeof req.query.workspacePath === 'string' ? req.query.workspacePath : '',
    });
    res.json(result);
  } catch (error) {
    console.error('Error listing installed skills:', error);
    res.status(500).json({ error: error.message || 'Failed to list installed skills' });
  }
});

router.get('/:agentId', async (req, res) => {
  try {
    const agent = await getAgentConfig(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ success: true, agent });
  } catch (error) {
    console.error('Error reading agent:', error);
    res.status(500).json({ error: 'Failed to read agent' });
  }
});

router.post('/', async (req, res) => {
  try {
    const agent = await upsertAgentConfig(req.body || {});
    res.status(201).json({ success: true, agent });
  } catch (error) {
    console.error('Error creating agent:', error);
    res.status(400).json({ error: error.message || 'Failed to create agent' });
  }
});

router.post('/:agentId/knowledge/upload', async (req, res) => {
  let uploadedFiles = [];
  try {
    const agent = await getAgentConfig(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const multer = (await import('multer')).default;
    const uploadDir = path.join(os.tmpdir(), 'mtl-code-agent-knowledge');
    await fs.mkdir(uploadDir, { recursive: true });

    const upload = multer({
      storage: multer.diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) => {
          const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${suffix}-${file.originalname.replace(/[^\w.-]+/g, '_')}`);
        },
      }),
      limits: {
        files: 100,
        fileSize: 10 * 1024 * 1024,
      },
    });

    upload.array('files', 100)(req, res, async (uploadError) => {
      try {
        if (uploadError) {
          return res.status(400).json({ error: uploadError.message || 'Failed to upload knowledge files' });
        }

        uploadedFiles = Array.isArray(req.files) ? req.files : [];
        if (uploadedFiles.length === 0) {
          return res.status(400).json({ error: 'No knowledge files provided' });
        }

        const mode = req.body?.mode === 'folder' ? 'folder' : 'file';
        const relativePaths = parseRelativePaths(req.body?.relativePaths);
        const sources = await saveAgentKnowledgeFiles(req.params.agentId, uploadedFiles, {
          mode,
          relativePaths,
        });

        const existing = await getAgentConfig(req.params.agentId);
        const existingSources = Array.isArray(existing?.knowledgeSources) ? existing.knowledgeSources : [];
        const incomingIds = new Set(sources.map((source) => source.id));
        const nextAgent = await patchAgentConfig(req.params.agentId, {
          knowledgeSources: [
            ...sources,
            ...existingSources.filter((source) => !incomingIds.has(source.id)),
          ].slice(0, 80),
        });

        return res.json({ success: true, sources, agent: nextAgent });
      } catch (error) {
        await Promise.all(uploadedFiles.map((file) => fs.unlink(file.path).catch(() => {})));
        console.error('Error uploading agent knowledge:', error);
        return res.status(400).json({ error: error.message || 'Failed to upload agent knowledge' });
      }
    });
  } catch (error) {
    await Promise.all(uploadedFiles.map((file) => fs.unlink(file.path).catch(() => {})));
    console.error('Error preparing agent knowledge upload:', error);
    res.status(500).json({ error: 'Failed to prepare agent knowledge upload' });
  }
});

router.get('/:agentId/knowledge', async (req, res) => {
  try {
    const agent = await getAgentConfig(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const sources = await listAgentKnowledgeSources(agent.id, agent.knowledgeSources);
    res.json({ success: true, sources, agent });
  } catch (error) {
    console.error('Error listing agent knowledge:', error);
    res.status(500).json({ error: 'Failed to list agent knowledge' });
  }
});

router.post('/:agentId/knowledge/:sourceId/reindex', async (req, res) => {
  try {
    const agent = await getAgentConfig(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const source = agent.knowledgeSources.find((entry) => entry.id === req.params.sourceId);
    if (!source) {
      return res.status(404).json({ error: 'Knowledge source not found' });
    }
    const nextSource = await reindexAgentKnowledgeSource(agent.id, source);
    const nextAgent = await patchAgentConfig(agent.id, {
      knowledgeSources: agent.knowledgeSources.map((entry) => (
        entry.id === source.id ? nextSource : entry
      )),
    });
    res.json({ success: true, source: nextSource, agent: nextAgent });
  } catch (error) {
    console.error('Error reindexing agent knowledge:', error);
    res.status(400).json({ error: error.message || 'Failed to reindex agent knowledge' });
  }
});

router.delete('/:agentId/knowledge/:sourceId', async (req, res) => {
  try {
    const agent = await getAgentConfig(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const source = agent.knowledgeSources.find((entry) => entry.id === req.params.sourceId);
    if (!source) {
      return res.status(404).json({ error: 'Knowledge source not found' });
    }
    await deleteAgentKnowledgeSource(agent.id, source);
    const nextAgent = await patchAgentConfig(agent.id, {
      knowledgeSources: agent.knowledgeSources.filter((entry) => entry.id !== source.id),
    });
    res.json({ success: true, sourceId: source.id, agent: nextAgent });
  } catch (error) {
    console.error('Error deleting agent knowledge:', error);
    res.status(400).json({ error: error.message || 'Failed to delete agent knowledge' });
  }
});

router.put('/:agentId', async (req, res) => {
  try {
    const agent = await patchAgentConfig(req.params.agentId, req.body || {});
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ success: true, agent });
  } catch (error) {
    console.error('Error updating agent:', error);
    res.status(400).json({ error: error.message || 'Failed to update agent' });
  }
});

router.patch('/:agentId', async (req, res) => {
  try {
    const agent = await patchAgentConfig(req.params.agentId, req.body || {});
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ success: true, agent });
  } catch (error) {
    console.error('Error patching agent:', error);
    res.status(400).json({ error: error.message || 'Failed to patch agent' });
  }
});

router.delete('/:agentId', async (req, res) => {
  try {
    const agent = await deleteAgentConfig(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    await deleteAgentKnowledge(agent.id).catch(() => {});
    sessionAgentBindingsDb.deleteAgentFromAllSessions(agent.id);
    res.json({ success: true, agent });
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({ error: error.message || 'Failed to delete agent' });
  }
});

export default router;
