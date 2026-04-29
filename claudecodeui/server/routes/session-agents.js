import express from 'express';

import { sessionAgentBindingsDb } from '../database/db.js';
import { getAgentConfig } from '../services/agent-config-service.js';

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

function normalizeString(value, fallback = '', maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function isImplementedAppBinding(app) {
  return String(app || '').trim().startsWith('MCP: ');
}

function normalizeAppBindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((binding) => {
      const item = binding && typeof binding === 'object' ? binding : {};
      const slot = normalizeString(item.slot, '', 80);
      const app = normalizeString(item.app, '', 120);
      if (!slot || !app) return null;
      if (!isImplementedAppBinding(app)) return null;
      const status = ['connected', 'optional', 'disabled'].includes(item.status)
        ? item.status
        : 'optional';
      return { slot, app, status };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeSkillNames(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((skill) => normalizeString(skill, '', 120))
    .filter(Boolean)
    .filter((skill) => {
      const key = skill.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function normalizeModelProfileId(value) {
  return normalizeString(value, '', 160)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSessionAgentConfiguration(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    appBindings: normalizeAppBindings(source.appBindings),
    skills: normalizeSkillNames(source.skills),
    modelProfileId: normalizeModelProfileId(source.modelProfileId),
  };
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
      if (configuration.appBindings.length === 0 && configuration.skills.length === 0 && !configuration.modelProfileId) {
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
