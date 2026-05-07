import express from 'express';

import {
  assertLoopbackIngress,
  handleObsidianIngress,
  ObsidianBridgeIngressError,
} from '../services/obsidian-bridge-ingress-service.js';
import { readObsidianBridgeConfig } from '../services/obsidian-bridge-service.js';
import { createMemoryCandidates } from '../services/obsidian-memory-service.js';

const router = express.Router();

const bearerToken = (headers = {}) => {
  const authorization = headers.authorization || headers.Authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
};

const assertAnyVaultToken = (headers = {}) => {
  const config = readObsidianBridgeConfig({ includeToken: true });
  const token = bearerToken(headers);
  const accepted = (config.vaults || []).some((vault) => vault.token && vault.token === token);
  if (!accepted) {
    throw new ObsidianBridgeIngressError('Unauthorized Obsidian ingress request.', {
      code: 'OBSIDIAN_INGRESS_UNAUTHORIZED',
      statusCode: 401,
    });
  }
};

const broadcastToWebSockets = (req, message) => {
  const wss = req.app?.locals?.wss;
  if (!wss?.clients) {
    return;
  }
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
};

const handleError = (res, error) => {
  if (error instanceof ObsidianBridgeIngressError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
  console.error('[obsidian-bridge-ingress] Request failed:', error);
  return res.status(500).json({
    success: false,
    error: error?.message || 'Obsidian ingress failed.',
  });
};

const handleIngressRoute = async (req, res, actionOverride = '') => {
  try {
    assertLoopbackIngress(req);
    assertAnyVaultToken(req.headers);
    const payload = {
      ...(req.body || {}),
      action: actionOverride || req.body?.action,
    };
    const result = await handleObsidianIngress(payload, {
      broadcast: (message) => broadcastToWebSockets(req, message),
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
};

router.post('/import', async (req, res) => {
  await handleIngressRoute(req, res, req.body?.action || 'send-note');
});

router.post('/ask', async (req, res) => {
  await handleIngressRoute(req, res, 'ask-note');
});

router.post('/memory-candidates', async (req, res) => {
  try {
    assertLoopbackIngress(req);
    assertAnyVaultToken(req.headers);
    const note = req.body?.note || {};
    const text = note.selection || note.content || req.body?.text || '';
    const candidates = createMemoryCandidates({
      text,
      source: note,
    });
    const inbox = await handleObsidianIngress({
      ...(req.body || {}),
      action: 'create-memory',
      note,
    }, {
      broadcast: (message) => broadcastToWebSockets(req, {
        ...message,
        memoryCandidates: candidates.candidates,
      }),
    });
    res.json({
      ...inbox,
      memoryCandidates: candidates.candidates,
    });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
