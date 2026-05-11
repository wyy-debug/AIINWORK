import express from 'express';

import { db } from '../database/db.js';
import { createSwarmStore } from '../services/swarm-store-service.js';
import { createSwarmMessageBus } from '../services/swarm-message-bus-service.js';
import { createSwarmOrchestrator } from '../services/swarm-orchestrator-service.js';
import { normalizeSwarmTemplateManifest } from '../services/swarm-template-manifest-service.js';

let defaultOrchestrator = null;
let defaultOrchestratorPromise = null;

async function createDefaultOrchestrator() {
  if (defaultOrchestrator) return defaultOrchestrator;
  if (!defaultOrchestratorPromise) {
    defaultOrchestratorPromise = (async () => {
      const [
        { queryClaudeSDK, sendClaudeSDKGuidance, sendClaudeSDKTaskControl },
        { createSwarmRuntimeAdapter },
      ] = await Promise.all([
        import('../claude-sdk.js'),
        import('../services/swarm-runtime-adapter-service.js'),
      ]);
      const store = createSwarmStore(db);
      store.initialize();
      const bus = createSwarmMessageBus({ store });
      const runtimeAdapter = createSwarmRuntimeAdapter({
        queryClaudeSDK,
        sendClaudeSDKGuidance,
        sendClaudeSDKTaskControl,
      });
      defaultOrchestrator = createSwarmOrchestrator({ store, bus, runtimeAdapter });
      if (typeof defaultOrchestrator.startDeliveryWorker === 'function') {
        defaultOrchestrator.startDeliveryWorker();
      }
      return defaultOrchestrator;
    })().finally(() => {
      defaultOrchestratorPromise = null;
    });
  }
  return defaultOrchestratorPromise;
}

function normalizePermissionMode(value) {
  const mode = typeof value === 'string' ? value.trim() : '';
  return ['default', 'acceptEdits', 'plan'].includes(mode) ? mode : '';
}

function normalizeToolsSettings(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    allowedTools: Array.isArray(value.allowedTools)
      ? value.allowedTools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim())
      : [],
    disallowedTools: Array.isArray(value.disallowedTools)
      ? value.disallowedTools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim())
      : [],
    skipPermissions: false,
    permissionMode: normalizePermissionMode(value.permissionMode),
  };
}

function normalizeRuntimeSnapshot(value) {
  if (!value || typeof value !== 'object') {
    return { permissionMode: '', toolsSettings: null, skipPermissions: false };
  }
  return {
    permissionMode: normalizePermissionMode(value.permissionMode),
    toolsSettings: normalizeToolsSettings(value.toolsSettings),
    skipPermissions: false,
  };
}

export function createSwarmsRouter({ orchestrator = null, orchestratorFactory = null } = {}) {
  const router = express.Router();
  let resolvedOrchestrator = orchestrator;
  let resolvingOrchestrator = null;
  const getOrchestrator = async () => {
    if (resolvedOrchestrator) return resolvedOrchestrator;
    if (!resolvingOrchestrator) {
      const factory = typeof orchestratorFactory === 'function' ? orchestratorFactory : createDefaultOrchestrator;
      resolvingOrchestrator = Promise.resolve(factory()).then((value) => {
        resolvedOrchestrator = value;
        return value;
      }).finally(() => {
        resolvingOrchestrator = null;
      });
    }
    return resolvingOrchestrator;
  };

  router.post('/templates/validate', (req, res) => {
    try {
      const manifest = normalizeSwarmTemplateManifest(req.body?.manifest || req.body || {});
      res.json({ success: true, manifest });
    } catch (error) {
      res.status(400).json({ error: 'Failed to validate swarm template', details: error.message });
    }
  });

  router.post('/runs', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const template = req.body?.template || req.body?.manifest;
      const runtimeSnapshot = normalizeRuntimeSnapshot(req.body?.runtimeSnapshot);
      const run = await activeOrchestrator.startRun({
        template,
        objective: req.body?.objective || '',
        sessionId: req.body?.sessionId || '',
        projectPath: req.body?.projectPath || '',
        launchAnswers: req.body?.launchAnswers || {},
        runtimeMode: req.body?.runtimeMode || 'coordinator-subagents',
        permissionMode: runtimeSnapshot.permissionMode,
        toolsSettings: runtimeSnapshot.toolsSettings,
        skipPermissions: runtimeSnapshot.skipPermissions,
        background: true,
      });
      res.json({ success: true, run });
    } catch (error) {
      res.status(400).json({ error: 'Failed to start swarm run', details: error.message });
    }
  });

  router.get('/runs', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const runs = activeOrchestrator.listRunSummaries({
        limit: Number(req.query.limit) || 25,
        status: req.query.status || '',
        templateId: req.query.templateId || '',
      });
      return res.json({ runs });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to list swarm runs', details: error.message });
    }
  });

  router.get('/runs/:runId', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const snapshot = activeOrchestrator.getRunSnapshot(req.params.runId);
      if (!snapshot) {
        return res.status(404).json({ error: 'Swarm run not found' });
      }
      return res.json({ run: snapshot });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to read swarm run', details: error.message });
    }
  });

  router.get('/runs/:runId/events', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      res.json({ events: activeOrchestrator.listEvents(req.params.runId) });
    } catch (error) {
      res.status(400).json({ error: 'Failed to read swarm events', details: error.message });
    }
  });

  router.get('/runs/:runId/messages/:messageId/trace', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const trace = activeOrchestrator.listMessageTrace({
        runId: req.params.runId,
        messageId: req.params.messageId,
      });
      return res.json({ trace });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to read swarm message trace', details: error.message });
    }
  });

  router.post('/runs/:runId/messages/replay', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const messages = activeOrchestrator.replayMessages({
        runId: req.params.runId,
        statusFilter: req.body?.statusFilter || 'dead_lettered',
        messageIds: Array.isArray(req.body?.messageIds) ? req.body.messageIds : [],
      });
      if (typeof activeOrchestrator.processDeliveryQueue === 'function') {
        setTimeout(() => {
          void activeOrchestrator.processDeliveryQueue(req.params.runId).catch((error) => {
            console.warn('[Swarm] Replay delivery failed:', error?.message || error);
          });
        }, 0);
      }
      return res.json({ success: true, messages });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to replay swarm messages', details: error.message });
    }
  });

  router.post('/runs/:runId/messages', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const message = await activeOrchestrator.sendMessage({
        ...req.body,
        runId: req.params.runId,
      });
      if (typeof activeOrchestrator.processDeliveryQueue === 'function') {
        setTimeout(() => {
          void activeOrchestrator.processDeliveryQueue(req.params.runId).catch((error) => {
            console.warn('[Swarm] Message delivery failed:', error?.message || error);
          });
        }, 0);
      }
      res.json({ success: true, message });
    } catch (error) {
      res.status(400).json({ error: 'Failed to publish swarm message', details: error.message });
    }
  });

  router.get('/runs/:runId/memory', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      return res.json({ memory: activeOrchestrator.listMemory(req.params.runId) });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to read swarm memory', details: error.message });
    }
  });

  router.post('/runs/:runId/memory', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const memory = activeOrchestrator.recordMemory({
        runId: req.params.runId,
        agentId: req.body?.agentId || '',
        scope: req.body?.scope || 'facts',
        title: req.body?.title || req.body?.scope || 'Memory',
        content: req.body?.content || '',
        promoteable: req.body?.promoteable !== false,
        metadata: req.body?.metadata || {},
      });
      return res.json({ success: true, memory });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to record swarm memory', details: error.message });
    }
  });

  router.patch('/runs/:runId/memory/:memoryId', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const memory = activeOrchestrator.updateMemory({
        runId: req.params.runId,
        memoryId: req.params.memoryId,
        patch: req.body || {},
      });
      if (!memory) return res.status(404).json({ error: 'Swarm memory not found' });
      return res.json({ success: true, memory });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to update swarm memory', details: error.message });
    }
  });

  router.delete('/runs/:runId/memory/:memoryId', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const result = activeOrchestrator.deleteMemory({
        runId: req.params.runId,
        memoryId: req.params.memoryId,
      });
      return res.json({ success: result.success !== false, ...result });
    } catch (error) {
      return res.status(400).json({ error: 'Failed to delete swarm memory', details: error.message });
    }
  });

  router.post('/runs/:runId/control', async (req, res) => {
    try {
      const activeOrchestrator = await getOrchestrator();
      const result = await activeOrchestrator.controlRun({
        runId: req.params.runId,
        action: req.body?.action,
        agentId: req.body?.agentId,
        messageId: req.body?.messageId,
        content: req.body?.content,
        objective: req.body?.objective,
      });
      if (
        ['retry-message', 'replay-dead-letter'].includes(req.body?.action)
        && typeof activeOrchestrator.processDeliveryQueue === 'function'
      ) {
        setTimeout(() => {
          void activeOrchestrator.processDeliveryQueue(req.params.runId).catch((error) => {
            console.warn('[Swarm] Retry delivery failed:', error?.message || error);
          });
        }, 0);
      }
      res.json({ success: result.success !== false, result });
    } catch (error) {
      res.status(400).json({ error: 'Failed to control swarm run', details: error.message });
    }
  });

  return router;
}

export default createSwarmsRouter();
