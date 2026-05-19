import { db as defaultDb } from '../database/db.js';

const safeJson = (value, fallback = {}) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const redactValue = (key, value) => {
  if (/prompt|token|secret|password|key|authorization/i.test(key)) {
    return '[redacted]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue('', item));
  }
  if (value && typeof value === 'object') {
    return redactPayload(value);
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}...[truncated]`;
  }
  return value;
};

const redactPayload = (payload = {}) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const redacted = {};
  for (const [key, value] of Object.entries(source)) {
    redacted[key] = redactValue(key, value);
  }
  return redacted;
};

const listBrainEvents = (db, { sessionId, provider }) => {
  try {
    return db.prepare(`
      SELECT * FROM brain_events
      WHERE session_id = ? AND (? = '' OR provider = ?)
      ORDER BY created_at_ms ASC
      LIMIT 200
    `).all(sessionId, provider, provider);
  } catch (error) {
    if (/no such table: brain_events/i.test(error?.message || '')) {
      return [];
    }
    throw error;
  }
};

function event(id, type, title, timestamp, payload = {}, severity = 'info') {
  return {
    id,
    type,
    title,
    timestamp,
    severity,
    payload: redactPayload(payload),
  };
}

export function createSessionTimelineService({ db = defaultDb } = {}) {
  const buildTimeline = ({ sessionId, provider = 'claude', projectName = '' } = {}) => {
    const events = [];
    if (!sessionId) {
      return { sessionId: '', provider, events };
    }

    const checkpoints = db.prepare(`
      SELECT * FROM session_checkpoints
      WHERE session_id = ? AND (? = '' OR provider = ?)
      ORDER BY created_at ASC
      LIMIT 200
    `).all(sessionId, provider, provider);
    for (const checkpoint of checkpoints) {
      const files = safeJson(checkpoint.files_json, []);
      events.push(event(
        checkpoint.id,
        'checkpoint',
        files.length > 0 ? `Checkpoint captured ${files.length} changed file(s)` : 'Checkpoint captured',
        checkpoint.completed_at || checkpoint.created_at,
        {
          checkpointId: checkpoint.id,
          profileKind: checkpoint.profile_kind,
          permissionPreset: checkpoint.permission_preset,
          permissionMode: checkpoint.permission_mode,
          rollbackStatus: checkpoint.rollback_status,
          files,
        },
        checkpoint.rollback_status === 'conflict' ? 'warning' : 'info',
      ));

      const toolCalls = safeJson(checkpoint.tool_calls_json, []);
      for (const toolCall of toolCalls.slice(0, 100)) {
        events.push(event(
          `${checkpoint.id}:tool:${toolCall.toolId || toolCall.name || events.length}`,
          toolCall.kind === 'permission_request' ? 'permission_blocked' : 'tool',
          toolCall.kind === 'permission_request'
            ? `Permission requested for ${toolCall.toolName || 'tool'}`
            : `Tool ${toolCall.toolName || toolCall.name || 'used'}`,
          checkpoint.completed_at || checkpoint.created_at,
          toolCall,
          toolCall.kind === 'permission_request' || toolCall.isError ? 'warning' : 'info',
        ));
      }
    }

    const artifacts = db.prepare(`
      SELECT a.*
      FROM artifacts a
      LEFT JOIN artifact_links l ON l.artifact_id = a.id
      WHERE a.session_id = ?
        OR l.session_id = ?
        OR (? != '' AND a.project_name = ? AND json_extract(COALESCE(a.metadata_json, '{}'), '$.source') IN ('review-flow', 'recipe'))
      ORDER BY a.created_at ASC
      LIMIT 200
    `).all(sessionId, sessionId, projectName, projectName);
    for (const artifact of artifacts) {
      events.push(event(
        artifact.id,
        'artifact',
        `Artifact: ${artifact.title}`,
        artifact.created_at,
        {
          artifactId: artifact.id,
          kind: artifact.kind,
          projectName: artifact.project_name,
          metadata: safeJson(artifact.metadata_json, {}),
        },
      ));
    }

    const brainEvents = listBrainEvents(db, { sessionId, provider });
    for (const brainEvent of brainEvents) {
      events.push(event(
        brainEvent.id,
        'brain',
        `Brain ${brainEvent.event_type}`,
        new Date(Number(brainEvent.created_at_ms || Date.now())).toISOString(),
        {
          eventType: brainEvent.event_type,
          checkpointId: brainEvent.checkpoint_id,
          artifactId: brainEvent.artifact_id,
          title: brainEvent.title,
          payload: safeJson(brainEvent.payload_json, {}),
        },
      ));
    }

    events.sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
    return { sessionId, provider, events };
  };

  return { buildTimeline };
}

export const sessionTimelineService = createSessionTimelineService();
export const buildSessionTimeline = (...args) => sessionTimelineService.buildTimeline(...args);
