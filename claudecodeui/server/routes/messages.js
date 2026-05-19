/**
 * Unified messages endpoint.
 *
 * GET /api/sessions/:sessionId/messages?provider=claude&projectName=foo&limit=50&offset=0
 *
 * Replaces the four provider-specific session message endpoints with a single route
 * that delegates to the appropriate adapter via the provider registry.
 *
 * @module routes/messages
 */

import express from 'express';
import { sessionsService } from '../modules/providers/services/sessions.service.js';
import { db } from '../database/db.js';
import { createCheckpointStore } from '../services/checkpoint-service.js';
import { aggregateAgentRuntimeTimeline } from '../services/agent-runtime-timeline-service.js';
import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();
const checkpointStore = createCheckpointStore(db);

/**
 * GET /api/sessions/:sessionId/messages
 *
 * Auth: authenticateToken applied at mount level in index.js
 *
 * Query params:
 *   provider    - 'claude' | 'cursor' | 'codex' | 'gemini' (default: 'claude')
 *   projectName - required for claude provider
 *   projectPath - required for cursor provider (absolute path used for cwdId hash)
 *   limit       - page size (omit or null for all)
 *   offset      - pagination offset (default: 0)
 */
router.get('/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const provider = String(req.query.provider || 'claude').trim().toLowerCase();
    const projectName = req.query.projectName || '';
    const projectPath = req.query.projectPath || '';
    const limitParam = req.query.limit;
    const limit = limitParam !== undefined && limitParam !== null && limitParam !== ''
      ? parseInt(limitParam, 10)
      : null;
    const offset = parseInt(req.query.offset || '0', 10);

    const availableProviders = sessionsService.listProviderIds();
    if (!availableProviders.includes(provider)) {
      const available = availableProviders.join(', ');
      return res.status(400).json({ error: `Unknown provider: ${provider}. Available: ${available}` });
    }

    const result = await sessionsService.fetchHistory(provider, sessionId, {
      projectName,
      projectPath,
      limit,
      offset,
    });

    return res.json(result);
  } catch (error) {
    console.error('Error fetching unified messages:', error);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * GET /api/sessions/:sessionId/timeline
 *
 * Aggregates normalized messages and checkpoints into a product-level runtime
 * timeline. Payload details are redacted by the aggregator before returning.
 */
router.get('/:sessionId/timeline', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const provider = String(req.query.provider || 'claude').trim().toLowerCase();
    const projectName = req.query.projectName || '';
    const projectPath = req.query.projectPath || '';

    const availableProviders = sessionsService.listProviderIds();
    if (!availableProviders.includes(provider)) {
      const available = availableProviders.join(', ');
      return res.status(400).json({ error: `Unknown provider: ${provider}. Available: ${available}` });
    }

    const history = await sessionsService.fetchHistory(provider, sessionId, {
      projectName,
      projectPath,
      limit: null,
      offset: 0,
    });
    const checkpoints = checkpointStore.listCheckpoints({
      sessionId,
      provider,
      projectPath,
      limit: 200,
    });
    await defaultWorkflowStudioStore.ready();
    const workflowEvents = defaultWorkflowStudioStore.listTimelineEvents({
      sessionId,
      projectPath,
      limit: 200,
    });
    const timeline = aggregateAgentRuntimeTimeline({
      sessionId,
      provider,
      messages: Array.isArray(history?.messages) ? history.messages : [],
      checkpoints,
      workflowEvents,
    });

    return res.json({ success: true, timeline });
  } catch (error) {
    console.error('Error fetching runtime timeline:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch runtime timeline' });
  }
});

/**
 * GET /api/sessions/:sessionId/compaction-summary
 *
 * Query params:
 *   provider    - currently 'claude'
 *   projectName - Claude project folder name
 *   projectPath - provider-specific workspace path when needed
 *   messageId   - context_compaction message id
 */
router.get('/:sessionId/compaction-summary', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const provider = String(req.query.provider || 'claude').trim().toLowerCase();
    const projectName = req.query.projectName || '';
    const projectPath = req.query.projectPath || '';
    const messageId = req.query.messageId || '';

    const availableProviders = sessionsService.listProviderIds();
    if (!availableProviders.includes(provider)) {
      const available = availableProviders.join(', ');
      return res.status(400).json({ error: `Unknown provider: ${provider}. Available: ${available}` });
    }
    if (!String(messageId || '').trim()) {
      return res.status(400).json({ error: 'messageId is required' });
    }

    const result = await sessionsService.fetchCompactionSummary(provider, sessionId, {
      projectName,
      projectPath,
      messageId: String(messageId),
    });

    if (!result.found) {
      return res.status(404).json({ error: 'Compaction summary not found' });
    }

    return res.json(result);
  } catch (error) {
    console.error('Error fetching compaction summary:', error);
    return res.status(500).json({ error: 'Failed to fetch compaction summary' });
  }
});

export default router;
