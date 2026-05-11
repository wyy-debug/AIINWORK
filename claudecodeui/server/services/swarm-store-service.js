import crypto from 'crypto';

import { emitSwarmEvent } from './swarm-broadcast-service.js';

export const SWARM_DEFINITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_definitions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  manifest_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);`;

export const SWARM_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_runs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL,
  runtime_mode TEXT NOT NULL DEFAULT 'local-control-plane',
  runtime_status TEXT NOT NULL DEFAULT 'queued',
  coordinator_session_id TEXT,
  objective TEXT,
  session_id TEXT,
  project_path TEXT,
  template_json TEXT,
  launch_answers_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
);`;

export const SWARM_AGENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_agents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  role_index INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  status TEXT NOT NULL,
  task_id TEXT,
  thread_id TEXT,
  agent_template_id TEXT,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MESSAGES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_agent_id TEXT,
  to_agent_id TEXT,
  topic TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  ttl_ms INTEGER NOT NULL DEFAULT 300000,
  ack_policy TEXT NOT NULL DEFAULT 'at_least_once',
  retry_limit INTEGER NOT NULL DEFAULT 3,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER,
  delivery_mode TEXT,
  idempotency_key TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  error TEXT,
  delivered_to TEXT,
  acked_by TEXT,
  created_at_ms INTEGER NOT NULL,
  delivered_at_ms INTEGER,
  acked_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MESSAGES_RUN_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_messages_run ON swarm_messages(run_id, status, created_at_ms);`;
export const SWARM_MESSAGES_IDEMPOTENCY_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_messages_idempotency ON swarm_messages(run_id, idempotency_key);`;

export const SWARM_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT,
  message_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_EVENTS_RUN_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_events_run ON swarm_events(run_id, created_at_ms);`;

export const SWARM_DELIVERY_TRACE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_delivery_trace (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  payload_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES swarm_messages(id) ON DELETE CASCADE
);`;

export const SWARM_DELIVERY_TRACE_MESSAGE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_delivery_trace_message ON swarm_delivery_trace(message_id, created_at_ms);`;

export const SWARM_ARTIFACTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MEMORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_memory (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  promoteable INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MEMORY_RUN_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_memory_run ON swarm_memory(run_id, created_at_ms);`;

export const SWARM_SCHEMA_SQL = [
  SWARM_DEFINITIONS_TABLE_SQL,
  SWARM_RUNS_TABLE_SQL,
  SWARM_AGENTS_TABLE_SQL,
  SWARM_MESSAGES_TABLE_SQL,
  SWARM_MESSAGES_RUN_INDEX_SQL,
  SWARM_MESSAGES_IDEMPOTENCY_INDEX_SQL,
  SWARM_EVENTS_TABLE_SQL,
  SWARM_EVENTS_RUN_INDEX_SQL,
  SWARM_DELIVERY_TRACE_TABLE_SQL,
  SWARM_DELIVERY_TRACE_MESSAGE_INDEX_SQL,
  SWARM_ARTIFACTS_TABLE_SQL,
  SWARM_MEMORY_TABLE_SQL,
  SWARM_MEMORY_RUN_INDEX_SQL,
].join('\n');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowMs() {
  return Date.now();
}

function stringify(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    templateId: row.template_id,
    status: row.status,
    runtimeMode: row.runtime_mode || 'local-control-plane',
    runtimeStatus: row.runtime_status || row.status || 'queued',
    coordinatorSessionId: row.coordinator_session_id || '',
    objective: row.objective || '',
    sessionId: row.session_id || '',
    projectPath: row.project_path || '',
    template: parseJson(row.template_json, null),
    launchAnswers: parseJson(row.launch_answers_json, {}),
    createdAt: row.created_at_ms,
    updatedAt: row.updated_at_ms,
    completedAt: row.completed_at_ms || null,
  };
}

function mapAgent(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: row.id,
    runId: row.run_id,
    roleId: row.role_id,
    roleIndex: row.role_index,
    label: row.label || row.role_id,
    status: row.status,
    runtimeStatus: metadata.runtimeStatus || row.status,
    taskId: row.task_id || '',
    threadId: row.thread_id || '',
    agentTemplateId: row.agent_template_id || '',
    runtimeMode: metadata.runtimeMode || metadata.mode || '',
    lastControl: metadata.lastControl || null,
    lastWaitResult: metadata.lastWaitResult || null,
    transcriptSummary: metadata.transcriptSummary || '',
    lastSpawnError: metadata.lastSpawnError || metadata.spawnResult?.error || '',
    metadata,
    createdAt: row.created_at_ms,
    updatedAt: row.updated_at_ms,
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    fromAgentId: row.from_agent_id || '',
    toAgentId: row.to_agent_id || '',
    topic: row.topic || '',
    type: row.type,
    payload: parseJson(row.payload_json, {}),
    priority: row.priority,
    ttlMs: row.ttl_ms,
    ackPolicy: row.ack_policy,
    retryLimit: row.retry_limit,
    attempts: row.attempts,
    deliveryAttempts: row.attempts,
    nextAttemptAt: row.next_attempt_at_ms ?? null,
    deliveryMode: row.delivery_mode || '',
    idempotencyKey: row.idempotency_key || '',
    correlationId: row.correlation_id || '',
    causationId: row.causation_id || '',
    status: row.status,
    error: row.error || '',
    lastDeliveryError: row.error || '',
    deliveredTo: row.delivered_to || '',
    ackedBy: row.acked_by || '',
    createdAt: row.created_at_ms,
    deliveredAt: row.delivered_at_ms || null,
    ackedAt: row.acked_at_ms || null,
    updatedAt: row.updated_at_ms,
  };
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    agentId: row.agent_id || '',
    messageId: row.message_id || '',
    type: row.type,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at_ms,
  };
}

function mapDeliveryTrace(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    messageId: row.message_id,
    agentId: row.agent_id || '',
    status: row.status,
    error: row.error || '',
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at_ms,
  };
}

function mapMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    agentId: row.agent_id || '',
    scope: row.scope,
    title: row.title,
    content: row.content,
    promoteable: row.promoteable === 1,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at_ms,
  };
}

export function createSwarmStore(db, options = {}) {
  const now = typeof options.now === 'function' ? options.now : nowMs;

  return {
    initialize() {
      db.exec(SWARM_SCHEMA_SQL);
    },

    createDefinition(definition = {}) {
      const timestamp = now();
      const record = {
        id: definition.id || id('swarm_definition'),
        templateId: definition.templateId || definition.manifest?.id || definition.id || 'swarm-template',
        version: definition.version || definition.manifest?.version || '1.0.0',
        manifest: definition.manifest || {},
      };
      db.prepare(`
        INSERT INTO swarm_definitions (id, template_id, version, manifest_json, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          template_id = excluded.template_id,
          version = excluded.version,
          manifest_json = excluded.manifest_json,
          updated_at_ms = excluded.updated_at_ms
      `).run(record.id, record.templateId, record.version, stringify(record.manifest), timestamp, timestamp);
      return { ...record, createdAt: timestamp, updatedAt: timestamp };
    },

    createRun(run = {}) {
      const timestamp = now();
      const record = {
        id: run.id || id('swarm_run'),
        templateId: run.templateId || run.template?.id || 'swarm-template',
        status: run.status || 'queued',
        runtimeMode: run.runtimeMode || 'local-control-plane',
        runtimeStatus: run.runtimeStatus || run.status || 'queued',
        coordinatorSessionId: run.coordinatorSessionId || '',
        objective: run.objective || '',
        sessionId: run.sessionId || '',
        projectPath: run.projectPath || '',
        template: run.template || null,
        launchAnswers: run.launchAnswers || {},
      };
      db.prepare(`
        INSERT INTO swarm_runs (
          id, template_id, status, objective, session_id, project_path,
          runtime_mode, runtime_status, coordinator_session_id, template_json, launch_answers_json,
          created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.templateId,
        record.status,
        record.objective,
        record.sessionId || null,
        record.projectPath || null,
        record.runtimeMode,
        record.runtimeStatus,
        record.coordinatorSessionId || null,
        stringify(record.template),
        stringify(record.launchAnswers),
        timestamp,
        timestamp,
      );
      this.recordEvent(record.id, 'swarm_run_created', {
        templateId: record.templateId,
        status: record.status,
        runtimeStatus: record.runtimeStatus,
        objective: record.objective,
      });
      return this.getRun(record.id);
    },

    getRun(runId) {
      return mapRun(db.prepare('SELECT * FROM swarm_runs WHERE id = ?').get(runId));
    },

    updateRunStatus(runId, status, payload = {}) {
      const timestamp = now();
      const completedAt = ['completed', 'failed', 'cancelled'].includes(status) ? timestamp : null;
      const current = this.getRun(runId);
      const runtimeStatus = payload.runtimeStatus || status || current?.runtimeStatus || 'queued';
      db.prepare(`
        UPDATE swarm_runs
        SET status = ?, runtime_status = ?, updated_at_ms = ?, completed_at_ms = COALESCE(?, completed_at_ms)
        WHERE id = ?
      `).run(status, runtimeStatus, timestamp, completedAt, runId);
      this.recordEvent(runId, status === 'completed' ? 'swarm_run_completed' : status === 'failed' ? 'swarm_run_failed' : 'swarm_run_controlled', {
        status,
        runtimeStatus,
        ...payload,
      });
      return this.getRun(runId);
    },

    updateRunRuntime(runId, patch = {}) {
      const current = this.getRun(runId);
      if (!current) return null;
      const timestamp = now();
      const runtimeMode = patch.runtimeMode || current.runtimeMode || 'local-control-plane';
      const runtimeStatus = patch.runtimeStatus || current.runtimeStatus || current.status || 'queued';
      const coordinatorSessionId = patch.coordinatorSessionId !== undefined
        ? patch.coordinatorSessionId
        : current.coordinatorSessionId;
      db.prepare(`
        UPDATE swarm_runs
        SET runtime_mode = ?, runtime_status = ?, coordinator_session_id = ?, updated_at_ms = ?
        WHERE id = ?
      `).run(runtimeMode, runtimeStatus, coordinatorSessionId || null, timestamp, runId);
      return this.getRun(runId);
    },

    upsertAgent(agent = {}) {
      const timestamp = now();
      const record = {
        id: agent.id || id('swarm_agent'),
        runId: agent.runId,
        roleId: agent.roleId,
        roleIndex: Number.isFinite(Number(agent.roleIndex)) ? Number(agent.roleIndex) : 0,
        label: agent.label || agent.roleId,
        status: agent.status || 'queued',
        taskId: agent.taskId || '',
        threadId: agent.threadId || '',
        agentTemplateId: agent.agentTemplateId || '',
        metadata: agent.metadata || {},
      };
      db.prepare(`
        INSERT INTO swarm_agents (
          id, run_id, role_id, role_index, label, status, task_id, thread_id,
          agent_template_id, metadata_json, created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          task_id = excluded.task_id,
          thread_id = excluded.thread_id,
          metadata_json = excluded.metadata_json,
          updated_at_ms = excluded.updated_at_ms
      `).run(
        record.id,
        record.runId,
        record.roleId,
        record.roleIndex,
        record.label,
        record.status,
        record.taskId || null,
        record.threadId || null,
        record.agentTemplateId || null,
        stringify(record.metadata),
        timestamp,
        timestamp,
      );
      return this.getAgent(record.id);
    },

    getAgent(agentId) {
      return mapAgent(db.prepare('SELECT * FROM swarm_agents WHERE id = ?').get(agentId));
    },

    listAgents(runId) {
      return db.prepare('SELECT * FROM swarm_agents WHERE run_id = ? ORDER BY created_at_ms, role_index, id')
        .all(runId)
        .map(mapAgent);
    },

    listActiveRuns() {
      return db.prepare(`
        SELECT * FROM swarm_runs
        WHERE status = 'running'
        ORDER BY updated_at_ms DESC, created_at_ms DESC
      `).all().map(mapRun);
    },

    listRuns({ limit = 25, status = '', templateId = '' } = {}) {
      const max = Math.max(1, Math.min(100, Number(limit) || 25));
      const clauses = [];
      const params = [];
      if (status) {
        clauses.push('status = ?');
        params.push(status);
      }
      if (templateId) {
        clauses.push('template_id = ?');
        params.push(templateId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      return db.prepare(`
        SELECT * FROM swarm_runs
        ${where}
        ORDER BY updated_at_ms DESC, created_at_ms DESC
        LIMIT ?
      `).all(...params, max).map(mapRun);
    },

    createMessage(message = {}) {
      const timestamp = Number.isFinite(Number(message.createdAt)) ? Number(message.createdAt) : now();
      const record = {
        id: message.id || id('swarm_message'),
        runId: message.runId,
        fromAgentId: message.fromAgentId || '',
        toAgentId: message.toAgentId || '',
        topic: message.topic || '',
        type: message.type || 'message',
        payload: message.payload || {},
        priority: Number.isFinite(Number(message.priority)) ? Number(message.priority) : 0,
        ttlMs: Number.isFinite(Number(message.ttlMs)) ? Number(message.ttlMs) : 300000,
        ackPolicy: message.ackPolicy || 'at_least_once',
        retryLimit: Number.isFinite(Number(message.retryLimit)) ? Number(message.retryLimit) : 3,
        attempts: Number.isFinite(Number(message.attempts)) ? Number(message.attempts) : 0,
        nextAttemptAt: Number.isFinite(Number(message.nextAttemptAt)) ? Number(message.nextAttemptAt) : null,
        deliveryMode: message.deliveryMode || '',
        idempotencyKey: message.idempotencyKey || '',
        correlationId: message.correlationId || '',
        causationId: message.causationId || '',
        status: message.status || 'published',
      };
      db.prepare(`
        INSERT INTO swarm_messages (
          id, run_id, from_agent_id, to_agent_id, topic, type, payload_json,
          priority, ttl_ms, ack_policy, retry_limit, attempts, idempotency_key,
          next_attempt_at_ms, delivery_mode, correlation_id, causation_id, status,
          error, created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.runId,
        record.fromAgentId || null,
        record.toAgentId || null,
        record.topic || null,
        record.type,
        stringify(record.payload),
        record.priority,
        record.ttlMs,
        record.ackPolicy,
        record.retryLimit,
        record.attempts,
        record.idempotencyKey || null,
        record.nextAttemptAt,
        record.deliveryMode || null,
        record.correlationId || null,
        record.causationId || null,
        record.status,
        message.error || null,
        timestamp,
        timestamp,
      );
      return this.getMessage(record.id);
    },

    findMessageByIdempotencyKey(runId, idempotencyKey) {
      if (!idempotencyKey) return null;
      return mapMessage(db.prepare('SELECT * FROM swarm_messages WHERE run_id = ? AND idempotency_key = ? ORDER BY created_at_ms LIMIT 1')
        .get(runId, idempotencyKey));
    },

    getMessage(messageId) {
      return mapMessage(db.prepare('SELECT * FROM swarm_messages WHERE id = ?').get(messageId));
    },

    listMessages(runId) {
      return db.prepare('SELECT * FROM swarm_messages WHERE run_id = ? ORDER BY created_at_ms, id')
        .all(runId)
        .map(mapMessage);
    },

    listMessagesByStatus(runId, status) {
      return db.prepare('SELECT * FROM swarm_messages WHERE run_id = ? AND status = ? ORDER BY created_at_ms, id')
        .all(runId, status)
        .map(mapMessage);
    },

    updateMessage(messageId, patch = {}) {
      const current = this.getMessage(messageId);
      if (!current) return null;
      const next = {
        status: patch.status || current.status,
        attempts: Number.isFinite(Number(patch.attempts)) ? Number(patch.attempts) : current.attempts,
        error: patch.error !== undefined ? patch.error : current.error,
        nextAttemptAt: patch.nextAttemptAt !== undefined ? patch.nextAttemptAt : current.nextAttemptAt,
        deliveryMode: patch.deliveryMode !== undefined ? patch.deliveryMode : current.deliveryMode,
        deliveredTo: patch.deliveredTo !== undefined ? patch.deliveredTo : current.deliveredTo,
        ackedBy: patch.ackedBy !== undefined ? patch.ackedBy : current.ackedBy,
        deliveredAt: patch.deliveredAt !== undefined ? patch.deliveredAt : current.deliveredAt,
        ackedAt: patch.ackedAt !== undefined ? patch.ackedAt : current.ackedAt,
      };
      db.prepare(`
        UPDATE swarm_messages
        SET status = ?, attempts = ?, error = ?, next_attempt_at_ms = ?, delivery_mode = ?, delivered_to = ?, acked_by = ?,
          delivered_at_ms = ?, acked_at_ms = ?, updated_at_ms = ?
        WHERE id = ?
      `).run(
        next.status,
        next.attempts,
        next.error || null,
        next.nextAttemptAt || null,
        next.deliveryMode || null,
        next.deliveredTo || null,
        next.ackedBy || null,
        next.deliveredAt || null,
        next.ackedAt || null,
        now(),
        messageId,
      );
      return this.getMessage(messageId);
    },

    listDeliverableMessages(runId, timestamp = now()) {
      return db.prepare(`
        SELECT * FROM swarm_messages
        WHERE run_id = ?
          AND status IN ('published', 'retry_scheduled')
          AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?)
        ORDER BY priority DESC, created_at_ms, id
      `).all(runId, timestamp).map(mapMessage);
    },

    listExpirableMessages(runId, timestamp = now()) {
      return db.prepare(`
        SELECT * FROM swarm_messages
        WHERE run_id = ?
          AND status IN ('published', 'delivered')
          AND ttl_ms > 0
          AND created_at_ms + ttl_ms <= ?
        ORDER BY created_at_ms
      `).all(runId, timestamp).map(mapMessage);
    },

    recordEvent(runId, type, payload = {}, options = {}) {
      const timestamp = now();
      const event = {
        id: options.id || id('swarm_event'),
        runId,
        agentId: options.agentId || '',
        messageId: options.messageId || '',
        type,
        payload,
        createdAt: timestamp,
      };
      db.prepare(`
        INSERT INTO swarm_events (id, run_id, agent_id, message_id, type, payload_json, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.runId,
        event.agentId || null,
        event.messageId || null,
        event.type,
        stringify(event.payload),
        event.createdAt,
      );
      emitSwarmEvent(event);
      return event;
    },

    recordDeliveryTrace(entry = {}) {
      const timestamp = Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : now();
      const record = {
        id: entry.id || id('swarm_delivery_trace'),
        runId: entry.runId,
        messageId: entry.messageId,
        agentId: entry.agentId || '',
        status: entry.status || 'event',
        error: entry.error || '',
        payload: entry.payload || {},
        createdAt: timestamp,
      };
      db.prepare(`
        INSERT INTO swarm_delivery_trace (
          id, run_id, message_id, agent_id, status, error, payload_json, created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.runId,
        record.messageId,
        record.agentId || null,
        record.status,
        record.error || null,
        stringify(record.payload),
        record.createdAt,
      );
      return this.getDeliveryTrace(record.id);
    },

    getDeliveryTrace(traceId) {
      return mapDeliveryTrace(db.prepare('SELECT * FROM swarm_delivery_trace WHERE id = ?').get(traceId));
    },

    listDeliveryTrace(messageId, runId = '') {
      const scopedRunId = typeof runId === 'string' ? runId.trim() : '';
      if (scopedRunId) {
        return db.prepare('SELECT * FROM swarm_delivery_trace WHERE message_id = ? AND run_id = ? ORDER BY created_at_ms, rowid')
          .all(messageId, scopedRunId)
          .map(mapDeliveryTrace);
      }
      return db.prepare('SELECT * FROM swarm_delivery_trace WHERE message_id = ? ORDER BY created_at_ms, rowid')
        .all(messageId)
        .map(mapDeliveryTrace);
    },

    listEvents(runId) {
      return db.prepare('SELECT * FROM swarm_events WHERE run_id = ? ORDER BY created_at_ms, rowid')
        .all(runId)
        .map(mapEvent);
    },

    recordMemory(entry = {}) {
      const timestamp = now();
      const record = {
        id: entry.id || id('swarm_memory'),
        runId: entry.runId,
        agentId: entry.agentId || '',
        scope: entry.scope || 'facts',
        title: entry.title || entry.scope || 'Memory',
        content: String(entry.content || ''),
        promoteable: entry.promoteable !== false,
        metadata: entry.metadata || {},
      };
      db.prepare(`
        INSERT INTO swarm_memory (
          id, run_id, agent_id, scope, title, content, promoteable, metadata_json, created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.runId,
        record.agentId || null,
        record.scope,
        record.title,
        record.content,
        record.promoteable ? 1 : 0,
        stringify(record.metadata),
        timestamp,
      );
      this.recordEvent(record.runId, 'swarm_memory_recorded', {
        scope: record.scope,
        title: record.title,
      }, { agentId: record.agentId });
      return this.getMemory(record.id);
    },

    getMemory(memoryId, runId = '') {
      const scopedRunId = typeof runId === 'string' ? runId.trim() : '';
      if (scopedRunId) {
        return mapMemory(db.prepare('SELECT * FROM swarm_memory WHERE id = ? AND run_id = ?').get(memoryId, scopedRunId));
      }
      return mapMemory(db.prepare('SELECT * FROM swarm_memory WHERE id = ?').get(memoryId));
    },

    updateMemory(memoryId, patch = {}, runId = '') {
      const current = this.getMemory(memoryId, runId);
      if (!current) return null;
      const next = {
        scope: patch.scope || current.scope,
        title: patch.title !== undefined ? String(patch.title || '') : current.title,
        content: patch.content !== undefined ? String(patch.content || '') : current.content,
        promoteable: patch.promoteable !== undefined ? Boolean(patch.promoteable) : current.promoteable,
        metadata: patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : current.metadata,
      };
      db.prepare(`
        UPDATE swarm_memory
        SET scope = ?, title = ?, content = ?, promoteable = ?, metadata_json = ?
        WHERE id = ?
      `).run(
        next.scope,
        next.title,
        next.content,
        next.promoteable ? 1 : 0,
        stringify(next.metadata),
        memoryId,
      );
      const updated = this.getMemory(memoryId);
      if (updated) {
        this.recordEvent(updated.runId, 'swarm_memory_updated', {
          memoryId,
          scope: updated.scope,
          title: updated.title,
        }, { agentId: updated.agentId });
      }
      return updated;
    },

    deleteMemory(memoryId, runId = '') {
      const current = this.getMemory(memoryId, runId);
      if (!current) return { success: false, memoryId };
      db.prepare('DELETE FROM swarm_memory WHERE id = ?').run(memoryId);
      this.recordEvent(current.runId, 'swarm_memory_deleted', {
        memoryId,
        scope: current.scope,
        title: current.title,
      }, { agentId: current.agentId });
      return { success: true, memoryId };
    },

    listMemory(runId) {
      return db.prepare('SELECT * FROM swarm_memory WHERE run_id = ? ORDER BY created_at_ms, rowid')
        .all(runId)
        .map(mapMemory);
    },

    getRunSnapshot(runId) {
      const run = this.getRun(runId);
      if (!run) return null;
      return {
        ...run,
        topology: run.template?.topology || null,
        policies: run.template?.policies || null,
        agents: this.listAgents(runId),
        messages: this.listMessages(runId),
        events: this.listEvents(runId),
        memory: this.listMemory(runId),
      };
    },
  };
}
