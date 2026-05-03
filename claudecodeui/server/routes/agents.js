import express from 'express';

import {
  deleteAgentConfig,
  getAgentConfig,
  listAgentConfigs,
  patchAgentConfig,
  upsertAgentConfig,
} from '../services/agent-config-service.js';
import { listInstalledSkills } from '../services/agent-skill-service.js';
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
    sessionAgentBindingsDb.deleteAgentFromAllSessions(agent.id);
    res.json({ success: true, agent });
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({ error: error.message || 'Failed to delete agent' });
  }
});

export default router;
