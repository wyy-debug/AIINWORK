import express from 'express';

import { buildSessionTimeline } from '../services/session-timeline-service.js';
import { defaultWorkflowStudioStore } from '../services/workflow-studio-service.js';

const router = express.Router();

router.get('/:sessionId', async (req, res) => {
  try {
    const projectPath = String(req.query.projectPath || '');
    const timeline = buildSessionTimeline({
      sessionId: req.params.sessionId,
      provider: String(req.query.provider || 'claude'),
      projectName: String(req.query.projectName || req.query.project || ''),
    });
    await defaultWorkflowStudioStore.ready();
    const workflowEvents = defaultWorkflowStudioStore.listTimelineEvents({
      sessionId: req.params.sessionId,
      projectPath,
      limit: 200,
    });
    for (const item of workflowEvents) {
      timeline.events.push({
        id: item.id || `${item.runId}:${item.type}`,
        type: 'workflow',
        title: item.title || item.type || 'Workflow event',
        timestamp: item.timestamp || item.createdAt,
        severity: item.severity || (item.status === 'failed' ? 'error' : item.status === 'blocked' ? 'warning' : 'info'),
        payload: {
          workflowId: item.workflowId,
          workflowName: item.workflowName,
          runId: item.runId,
          nodeId: item.nodeId,
          eventType: item.type,
          status: item.status,
        },
      });
    }
    timeline.events.sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
    res.json({ success: true, timeline });
  } catch (error) {
    console.error('Session timeline error:', error);
    res.status(500).json({ error: error.message || 'Failed to build session timeline' });
  }
});

export default router;
