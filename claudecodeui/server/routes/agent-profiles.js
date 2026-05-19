import express from 'express';

import {
  deleteAgentConfig,
  getAgentConfig,
  listAgentConfigs,
  patchAgentConfig,
  upsertAgentConfig,
} from '../services/agent-config-service.js';
import { isBuiltInAgentProfileId } from '../services/agent-profile-service.js';
import { sessionAgentBindingsDb } from '../database/db.js';

const router = express.Router();

function isProfile(agent) {
  return Boolean(agent?.profileKind);
}

function sendProfileError(res, error, fallbackStatus = 400, fallbackMessage = 'Agent Profile request failed') {
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

router.get('/', async (_req, res) => {
  try {
    const agents = await listAgentConfigs({ includePaused: true });
    res.json({ success: true, profiles: agents.filter(isProfile) });
  } catch (error) {
    sendProfileError(res, error, 500, 'Failed to list Agent Profiles');
  }
});

router.get('/:profileId', async (req, res) => {
  try {
    const profile = await getAgentConfig(req.params.profileId);
    if (!isProfile(profile)) {
      return res.status(404).json({ success: false, error: 'Agent Profile not found' });
    }
    return res.json({ success: true, profile });
  } catch (error) {
    return sendProfileError(res, error, 500, 'Failed to read Agent Profile');
  }
});

router.post('/', async (req, res) => {
  try {
    if (isBuiltInAgentProfileId(req.body?.id)) {
      return res.status(400).json({ success: false, error: 'Built-in Agent Profiles are read-only' });
    }
    const profile = await upsertAgentConfig({
      ...(req.body || {}),
      profileKind: req.body?.profileKind || 'build',
    });
    res.status(201).json({ success: true, profile });
  } catch (error) {
    sendProfileError(res, error, 400, 'Failed to create Agent Profile');
  }
});

router.patch('/:profileId', async (req, res) => {
  try {
    if (isBuiltInAgentProfileId(req.params.profileId)) {
      return res.status(400).json({ success: false, error: 'Built-in Agent Profiles are read-only' });
    }
    const profile = await patchAgentConfig(req.params.profileId, req.body || {});
    if (!isProfile(profile)) {
      return res.status(404).json({ success: false, error: 'Agent Profile not found' });
    }
    return res.json({ success: true, profile });
  } catch (error) {
    return sendProfileError(res, error, 400, 'Failed to update Agent Profile');
  }
});

router.delete('/:profileId', async (req, res) => {
  try {
    if (isBuiltInAgentProfileId(req.params.profileId)) {
      return res.status(400).json({ success: false, error: 'Built-in Agent Profiles cannot be deleted' });
    }
    const profile = await getAgentConfig(req.params.profileId);
    if (!isProfile(profile)) {
      return res.status(404).json({ success: false, error: 'Agent Profile not found' });
    }
    const removed = await deleteAgentConfig(req.params.profileId);
    sessionAgentBindingsDb.deleteAgentFromAllSessions(removed.id);
    return res.json({ success: true, profile: removed });
  } catch (error) {
    return sendProfileError(res, error, 500, 'Failed to delete Agent Profile');
  }
});

export default router;
