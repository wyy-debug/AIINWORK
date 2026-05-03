import crypto from 'crypto';
import { EventEmitter } from 'events';

import express from 'express';

import { appConfigDb } from '../database/db.js';

const router = express.Router();
const TOKEN_KEY = 'ide_bridge_token';
const bridgeEvents = new EventEmitter();
let bridgeState = {
  activeProject: null,
  activeSession: null,
  openFile: null,
  selection: null,
  context: '',
  updatedAt: null,
};

const getOrCreateToken = () => {
  let token = appConfigDb.get(TOKEN_KEY);
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    appConfigDb.set(TOKEN_KEY, token);
  }
  return token;
};

const readToken = (req) => {
  const header = String(req.get('authorization') || '');
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return String(req.query.token || req.body?.token || '').trim();
};

const requireBridgeToken = (req, res, next) => {
  const expected = getOrCreateToken();
  if (readToken(req) !== expected) {
    return res.status(401).json({ error: 'Invalid IDE bridge token' });
  }
  next();
};

const normalizePayload = (payload = {}) => ({
  activeProject: payload.activeProject || payload.project || null,
  activeSession: payload.activeSession || payload.session || null,
  openFile: payload.openFile || payload.file || null,
  selection: payload.selection || null,
  context: typeof payload.context === 'string' ? payload.context.slice(0, 200_000) : '',
  updatedAt: new Date().toISOString(),
});

router.get('/token', (_req, res) => {
  res.json({ success: true, token: getOrCreateToken() });
});

router.get('/state', (_req, res) => {
  res.json({ success: true, state: bridgeState });
});

router.get('/events', requireBridgeToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (state) => {
    res.write('event: state\n');
    res.write(`data: ${JSON.stringify({ state })}\n\n`);
  };
  send(bridgeState);
  bridgeEvents.on('state', send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    bridgeEvents.off('state', send);
  });
});

router.post('/context', requireBridgeToken, (req, res) => {
  bridgeState = normalizePayload(req.body || {});
  bridgeEvents.emit('state', bridgeState);
  res.json({ success: true, state: bridgeState });
});

router.post('/open-file', requireBridgeToken, (req, res) => {
  bridgeEvents.emit('open-file', req.body || {});
  res.json({ success: true });
});

export default router;
