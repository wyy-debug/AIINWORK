import express from 'express';

import { sessionAgentBindingsDb } from '../database/db.js';
import { getAgentConfig } from '../services/agent-config-service.js';
import { normalizeSessionAgentConfiguration } from '../services/session-agent-configuration-service.js';

const router = express.Router();

const SUPPORTED_PROVIDERS = new Set(['claude', 'cursor', 'codex', 'gemini']);

function normalizeProvider(value) {
  const provider = String(value || 'claude').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(provider) ? provider : 'claude';
}

function normalizeSessionId(value) {
  const sessionId = String(value || '').trim();
  if (!sessionId) {
    throw new Error('sessionId is required');
  }
  return sessionId;
}

function hasSessionAgentConfiguration(configuration) {
  return Boolean(
    configuration?.appBindings?.length
    || configuration?.skills?.length
    || configuration?.modelProfileId
    || configuration?.packageId
    || Object.keys(configuration?.setupAnswers || {}).length
    || configuration?.setupPresetId
    || Object.keys(configuration?.launchAnswers || {}).length
    || configuration?.launchPresetId
    || configuration?.resultPresetId
    || configuration?.selectedDependencies?.skills?.length
    || configuration?.selectedDependencies?.mcpServers?.length
    || configuration?.selectedDependencies?.modelProfiles?.length
  );
}

router.get('/:sessionId/agent', async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.sessionId);
    const provider = normalizeProvider(req.query.provider);
    const binding = sessionAgentBindingsDb.getBinding(sessionId, provider);
    const agentId = binding?.agentId || '';
    const agent = agentId ? await getAgentConfig(agentId) : null;
    if (agentId && (!agent || agent.status !== 'enabled')) {
      sessionAgentBindingsDb.deleteAgent(sessionId, provider);
      return res.json({ success: true, sessionId, provider, agentId: '', agent: null, configuration: null });
    }
    res.json({
      success: true,
      sessionId,
      provider,
      agentId: agent?.id || '',
      agent,
      configuration: binding?.configuration || null,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to read session Agent binding' });
  }
});

router.put('/:sessionId/agent', async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.sessionId);
    const provider = normalizeProvider(req.body?.provider || req.query.provider);
    const agentId = String(req.body?.agentId || '').trim();

    const configuration = normalizeSessionAgentConfiguration(req.body?.configuration || {
      appBindings: req.body?.appBindings,
      skills: req.body?.skills,
    });

    if (!agentId) {
      if (!hasSessionAgentConfiguration(configuration)) {
        sessionAgentBindingsDb.deleteAgent(sessionId, provider);
        return res.json({ success: true, sessionId, provider, agentId: '', agent: null, configuration: null });
      }
      sessionAgentBindingsDb.setAgent(sessionId, provider, '', configuration);
      return res.json({ success: true, sessionId, provider, agentId: '', agent: null, configuration });
    }

    const agent = await getAgentConfig(agentId);
    if (!agent || agent.status !== 'enabled') {
      return res.status(400).json({ error: 'Agent must exist and be enabled before it can be bound to a conversation' });
    }

    sessionAgentBindingsDb.setAgent(sessionId, provider, agent.id, configuration);
    res.json({ success: true, sessionId, provider, agentId: agent.id, agent, configuration });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update session Agent binding' });
  }
});

router.delete('/:sessionId/agent', async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.sessionId);
    const provider = normalizeProvider(req.query.provider || req.body?.provider);
    sessionAgentBindingsDb.deleteAgent(sessionId, provider);
    res.json({ success: true, sessionId, provider, agentId: '', agent: null, configuration: null });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to clear session Agent binding' });
  }
});

export default router;
