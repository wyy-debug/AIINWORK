import crypto from 'crypto';
import { EventEmitter } from 'events';

import express from 'express';

import { queryClaudeSDK } from '../claude-sdk.js';
import { db, worktreeDispatchesDb } from '../database/db.js';
import { createManagedWorktreeDispatch } from './worktrees.js';

const router = express.Router();
const SCHEDULER_INTERVAL_MS = 60_000;
const TARGET_MODES = ['triage-only', 'local-argus', 'worktree-argus'];
const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];

let schedulerStarted = false;
let runnerActive = false;
const runQueue = [];
const runningRuns = new Map();
const automationEvents = new EventEmitter();

const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const toIso = (value = new Date()) => value.toISOString();

const parseJson = (value) => {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const mapAutomation = (row) => ({
  id: row.id,
  name: row.name,
  projectName: row.project_name || '',
  projectPath: row.project_path || '',
  prompt: row.prompt || '',
  targetMode: TARGET_MODES.includes(row.target_mode) ? row.target_mode : 'triage-only',
  scheduleType: row.schedule_type || 'manual',
  intervalMinutes: row.interval_minutes || null,
  enabled: row.enabled === 1,
  lastRunAt: row.last_run_at || null,
  nextRunAt: row.next_run_at || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapRun = (row) => ({
  id: row.id,
  automationId: row.automation_id,
  status: RUN_STATUSES.includes(row.status) ? row.status : 'queued',
  triggerType: row.trigger_type || 'manual',
  sessionId: row.session_id || null,
  worktreeId: row.worktree_id || null,
  metadata: parseJson(row.metadata_json),
  startedAt: row.started_at,
  finishedAt: row.finished_at || null,
  output: row.output || '',
  error: row.error || '',
});

const normalizeAutomationInput = (body = {}) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : '';
  const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
  const targetMode = TARGET_MODES.includes(body.targetMode) ? body.targetMode : 'triage-only';
  const scheduleType = body.scheduleType === 'interval' ? 'interval' : 'manual';
  const intervalMinutes = Number.parseInt(String(body.intervalMinutes ?? ''), 10);
  return {
    name,
    prompt,
    targetMode,
    projectName,
    projectPath,
    scheduleType,
    intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : null,
    enabled: body.enabled !== false,
  };
};

const computeNextRunAt = (automation, from = new Date()) => {
  if (!automation.enabled || automation.scheduleType !== 'interval' || !automation.intervalMinutes) {
    return null;
  }
  return new Date(from.getTime() + automation.intervalMinutes * 60_000).toISOString();
};

const insertRunEvent = (runId, eventType, payload = {}) => {
  const event = {
    id: createId('automation_event'),
    runId,
    type: eventType,
    payload,
    createdAt: toIso(),
  };
  try {
    db.prepare(`
      INSERT INTO automation_run_events (id, run_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.id, runId, eventType, JSON.stringify(payload || {}), event.createdAt);
  } catch (error) {
    console.warn('[Automations] Failed to persist run event:', error.message);
  }
  automationEvents.emit(runId, event);
  return event;
};

const updateRun = (runId, patch = {}) => {
  const existing = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(runId);
  if (!existing) return null;
  const next = {
    status: patch.status ?? existing.status,
    sessionId: patch.sessionId ?? existing.session_id,
    worktreeId: patch.worktreeId ?? existing.worktree_id,
    metadata: patch.metadata ?? parseJson(existing.metadata_json),
    output: patch.output ?? existing.output,
    error: patch.error ?? existing.error,
    finishedAt: Object.prototype.hasOwnProperty.call(patch, 'finishedAt') ? patch.finishedAt : existing.finished_at,
  };
  db.prepare(`
    UPDATE automation_runs
    SET status = ?, session_id = ?, worktree_id = ?, metadata_json = ?, output = ?, error = ?, finished_at = ?
    WHERE id = ?
  `).run(
    next.status,
    next.sessionId || null,
    next.worktreeId || null,
    JSON.stringify(next.metadata || {}),
    next.output || '',
    next.error || null,
    next.finishedAt || null,
    runId,
  );
  return mapRun(db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(runId));
};

const appendOutput = (runId, text) => {
  if (!text) return;
  const row = db.prepare('SELECT output FROM automation_runs WHERE id = ?').get(runId);
  const output = `${row?.output || ''}${text}`.slice(-1_000_000);
  updateRun(runId, { output });
  insertRunEvent(runId, 'output', { text });
};

const createTriageItem = ({ sourceId, title, body }) => {
  const id = createId('triage');
  db.prepare(`
    INSERT INTO triage_items (id, source_type, source_id, title, body, status)
    VALUES (?, 'automation', ?, ?, ?, 'open')
  `).run(id, sourceId || null, title, body || '');
  return id;
};

const createArtifactLink = ({ artifactId, sourceType, sourceId, sessionId, projectName }) => {
  db.prepare(`
    INSERT INTO artifact_links (id, artifact_id, source_type, source_id, session_id, project_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    createId('artifact_link'),
    artifactId,
    sourceType,
    sourceId || null,
    sessionId || null,
    projectName || null,
  );
};

const createAutomationArtifact = ({ automation, run, metadata = {} }) => {
  const artifactId = createId('artifact');
  db.prepare(`
    INSERT INTO artifacts (id, kind, title, project_name, session_id, content, metadata_json)
    VALUES (?, 'automation-run', ?, ?, ?, ?, ?)
  `).run(
    artifactId,
    `${automation.name} ${run.status}`.slice(0, 240),
    automation.projectName || null,
    run.sessionId || metadata.sessionId || null,
    run.output || run.error || '',
    JSON.stringify({
      source: 'automation',
      automationId: automation.id,
      runId: run.id,
      targetMode: automation.targetMode,
      ...metadata,
    }),
  );
  createArtifactLink({
    artifactId,
    sourceType: 'automation',
    sourceId: run.id,
    sessionId: run.sessionId || metadata.sessionId || '',
    projectName: automation.projectName || '',
  });
  return artifactId;
};

const createAutomationWriter = (runId) => {
  const messages = [];
  let sessionId = '';

  const normalizeMessage = (payload) => {
    if (typeof payload !== 'string') return payload;
    try {
      return JSON.parse(payload);
    } catch {
      return { kind: 'text', content: payload };
    }
  };

  const extractText = (message) => {
    if (!message || typeof message !== 'object') return '';
    if (typeof message.content === 'string') return message.content;
    if (typeof message.text === 'string') return message.text;
    if (typeof message.message === 'string') return message.message;
    if (message.kind === 'tool_use' && message.name) return `[tool] ${message.name}`;
    if (message.kind === 'complete') return '[complete]';
    return '';
  };

  return {
    userId: null,
    send(payload) {
      const message = normalizeMessage(payload);
      if (!message) return;
      messages.push(message);
      if (message.newSessionId) sessionId = message.newSessionId;
      if (message.sessionId) sessionId = message.sessionId;
      const text = extractText(message);
      if (text) appendOutput(runId, `${text}\n`);
    },
    setSessionId(value) {
      sessionId = value || sessionId;
    },
    getSessionId() {
      return sessionId || null;
    },
    getError() {
      const errorMessage = messages.find((message) => message?.kind === 'error');
      return errorMessage ? extractText(errorMessage) : '';
    },
    getOutput() {
      return messages.map(extractText).filter(Boolean).join('\n').trim();
    },
  };
};

const runArgusAutomation = async (automation, runId) => {
  if (!automation.prompt?.trim()) {
    throw new Error('Automation prompt is required for Argus target modes');
  }
  if (!automation.projectPath?.trim()) {
    throw new Error('Automation project path is required for Argus target modes');
  }

  let projectPath = automation.projectPath;
  let worktree = null;
  let project = null;

  if (automation.targetMode === 'worktree-argus') {
    const created = await createManagedWorktreeDispatch(automation.projectName, {
      taskPrompt: automation.prompt,
      displayName: `${automation.name} automation`,
      provider: 'claude',
    });
    worktree = created.worktree;
    project = created.project;
    projectPath = worktree.worktreePath;
    updateRun(runId, {
      worktreeId: worktree.id,
      metadata: { worktreePath: worktree.worktreePath, projectName: project.name },
    });
    insertRunEvent(runId, 'worktree', { worktreeId: worktree.id, projectName: project.name, worktreePath: worktree.worktreePath });
  }

  const writer = createAutomationWriter(runId);
  await queryClaudeSDK(automation.prompt, {
    cwd: projectPath,
    projectPath,
    sessionSummary: automation.name,
    permissionMode: 'bypassPermissions',
  }, writer);

  const error = writer.getError();
  if (error) throw new Error(error);

  const sessionId = writer.getSessionId();
  if (worktree?.id && sessionId) {
    worktree = worktreeDispatchesDb.updateSession(worktree.id, sessionId, 'claude');
  }

  return {
    output: writer.getOutput() || 'Argus completed without textual output.',
    sessionId,
    worktree,
    project,
  };
};

const executeRun = async ({ runId, automation, trigger }) => {
  const controller = { cancelled: false };
  runningRuns.set(runId, controller);
  updateRun(runId, {
    status: 'running',
    metadata: { trigger },
  });
  insertRunEvent(runId, 'status', { status: 'running', trigger });

  let status = 'completed';
  let output = '';
  let error = '';
  let metadata = { trigger };

  try {
    if (automation.targetMode === 'triage-only') {
      output = [
        `Trigger: ${trigger}`,
        'Target: triage-only',
        automation.projectName ? `Project: ${automation.projectName}` : '',
        automation.prompt ? `Prompt: ${automation.prompt}` : 'No prompt configured.',
        '',
        'Recorded locally. Open the Triage inbox to hand this note to an Argus session.',
      ].filter(Boolean).join('\n');
      appendOutput(runId, `${output}\n`);
    } else {
      const argusResult = await runArgusAutomation(automation, runId);
      output = [
        `Trigger: ${trigger}`,
        `Target: ${automation.targetMode}`,
        argusResult.sessionId ? `Session: ${argusResult.sessionId}` : '',
        argusResult.worktree?.worktreePath ? `Worktree: ${argusResult.worktree.worktreePath}` : '',
        '',
        argusResult.output,
      ].filter(Boolean).join('\n');
      metadata = {
        ...metadata,
        sessionId: argusResult.sessionId,
        worktreeId: argusResult.worktree?.id || null,
        worktreePath: argusResult.worktree?.worktreePath || null,
        projectName: argusResult.project?.name || automation.projectName,
      };
    }

    if (controller.cancelled) {
      status = 'cancelled';
    }
  } catch (runError) {
    status = controller.cancelled ? 'cancelled' : 'failed';
    error = runError instanceof Error ? runError.message : 'Automation failed';
    output = [
      `Trigger: ${trigger}`,
      `Target: ${automation.targetMode}`,
      '',
      error,
    ].filter(Boolean).join('\n');
    appendOutput(runId, `${error}\n`);
  } finally {
    runningRuns.delete(runId);
  }

  const run = updateRun(runId, {
    status,
    output,
    error,
    sessionId: metadata.sessionId || null,
    worktreeId: metadata.worktreeId || null,
    metadata,
    finishedAt: toIso(),
  });
  insertRunEvent(runId, 'status', { status, error, metadata });

  db.prepare(`
    UPDATE automation_definitions
    SET last_run_at = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(toIso(), computeNextRunAt(automation), automation.id);

  createTriageItem({
    sourceId: runId,
    title: `${automation.name} ${status}`,
    body: output,
  });
  createAutomationArtifact({ automation, run, metadata });
};

const drainQueue = () => {
  if (runnerActive) return;
  runnerActive = true;
  queueMicrotask(async () => {
    try {
      while (runQueue.length > 0) {
        const item = runQueue.shift();
        const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(item.runId);
        if (!row || row.status === 'cancelled') continue;
        await executeRun(item);
      }
    } finally {
      runnerActive = false;
      if (runQueue.length > 0) drainQueue();
    }
  });
};

const enqueueAutomationRun = (automation, trigger = 'manual') => {
  const runId = createId('automation_run');
  const startedAt = toIso();
  db.prepare(`
    INSERT INTO automation_runs (id, automation_id, status, trigger_type, started_at, metadata_json)
    VALUES (?, ?, 'queued', ?, ?, ?)
  `).run(runId, automation.id, trigger, startedAt, JSON.stringify({ trigger }));
  insertRunEvent(runId, 'status', { status: 'queued', trigger });
  runQueue.push({ runId, automation, trigger });
  drainQueue();
  return db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(runId);
};

const runDueAutomations = async () => {
  const rows = db.prepare(`
    SELECT * FROM automation_definitions
    WHERE enabled = 1
      AND schedule_type = 'interval'
      AND next_run_at IS NOT NULL
      AND datetime(next_run_at) <= datetime('now')
    ORDER BY next_run_at ASC
    LIMIT 10
  `).all();

  for (const row of rows) {
    const automation = mapAutomation(row);
    enqueueAutomationRun(automation, 'interval');
    db.prepare(`
      UPDATE automation_definitions
      SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(computeNextRunAt(automation), automation.id);
  }
};

export const startAutomationScheduler = () => {
  if (schedulerStarted) return;
  schedulerStarted = true;
  void runDueAutomations();
  setInterval(() => {
    void runDueAutomations();
  }, SCHEDULER_INTERVAL_MS).unref?.();
};

router.get('/runs', async (req, res) => {
  try {
    const automationId = String(req.query.automationId || '');
    const rows = automationId
      ? db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT 100').all(automationId)
      : db.prepare('SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT 100').all();
    res.json({ success: true, runs: rows.map(mapRun) });
  } catch (error) {
    console.error('Automation runs error:', error);
    res.status(500).json({ error: error.message || 'Failed to load automation runs' });
  }
});

router.get('/runs/:runId/events', async (req, res) => {
  const runId = req.params.runId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event) => {
    res.write(`event: ${event.type || 'message'}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const rows = db.prepare(`
      SELECT * FROM automation_run_events
      WHERE run_id = ?
      ORDER BY created_at ASC
      LIMIT 500
    `).all(runId);
    rows.forEach((row) => {
      send({
        id: row.id,
        runId: row.run_id,
        type: row.event_type,
        payload: parseJson(row.payload_json),
        createdAt: row.created_at,
      });
    });
  } catch (error) {
    send({ id: createId('automation_event'), runId, type: 'error', payload: { error: error.message }, createdAt: toIso() });
  }

  const listener = (event) => send(event);
  automationEvents.on(runId, listener);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    automationEvents.off(runId, listener);
  });
});

router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(req.params.runId);
    if (!row) return res.status(404).json({ error: 'Automation run not found' });

    const running = runningRuns.get(req.params.runId);
    if (running) running.cancelled = true;

    const queuedIndex = runQueue.findIndex((item) => item.runId === req.params.runId);
    if (queuedIndex >= 0) runQueue.splice(queuedIndex, 1);

    const run = updateRun(req.params.runId, {
      status: 'cancelled',
      finishedAt: toIso(),
      error: row.status === 'running' ? 'Cancellation requested. Argus will stop after the active call returns.' : '',
    });
    insertRunEvent(req.params.runId, 'status', { status: 'cancelled' });
    res.json({ success: true, run });
  } catch (error) {
    console.error('Automation cancel error:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel automation run' });
  }
});

router.post('/runs/:runId/retry', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(req.params.runId);
    if (!row) return res.status(404).json({ error: 'Automation run not found' });
    const automationRow = db.prepare('SELECT * FROM automation_definitions WHERE id = ?').get(row.automation_id);
    if (!automationRow) return res.status(404).json({ error: 'Automation not found' });
    const run = enqueueAutomationRun(mapAutomation(automationRow), 'retry');
    res.json({ success: true, run: mapRun(run) });
  } catch (error) {
    console.error('Automation retry error:', error);
    res.status(500).json({ error: error.message || 'Failed to retry automation run' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM automation_definitions ORDER BY created_at DESC').all();
    res.json({ success: true, automations: rows.map(mapAutomation) });
  } catch (error) {
    console.error('Automations list error:', error);
    res.status(500).json({ error: error.message || 'Failed to load automations' });
  }
});

router.post('/', async (req, res) => {
  try {
    const input = normalizeAutomationInput(req.body);
    if (!input.name) return res.status(400).json({ error: 'Automation name is required' });
    const automation = { id: createId('automation'), ...input };
    db.prepare(`
      INSERT INTO automation_definitions (
        id, name, project_name, project_path, prompt, target_mode, schedule_type, interval_minutes,
        enabled, next_run_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      automation.id,
      automation.name,
      automation.projectName || null,
      automation.projectPath || null,
      automation.prompt || null,
      automation.targetMode,
      automation.scheduleType,
      automation.intervalMinutes,
      automation.enabled ? 1 : 0,
      computeNextRunAt(automation),
    );
    res.json({ success: true, automation: mapAutomation(db.prepare('SELECT * FROM automation_definitions WHERE id = ?').get(automation.id)) });
  } catch (error) {
    console.error('Automation create error:', error);
    res.status(500).json({ error: error.message || 'Failed to create automation' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM automation_definitions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Automation not found' });
    const input = normalizeAutomationInput({ ...mapAutomation(existing), ...req.body });
    db.prepare(`
      UPDATE automation_definitions
      SET name = ?, project_name = ?, project_path = ?, prompt = ?, target_mode = ?, schedule_type = ?,
          interval_minutes = ?, enabled = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      input.name || existing.name,
      input.projectName || null,
      input.projectPath || null,
      input.prompt || null,
      input.targetMode,
      input.scheduleType,
      input.intervalMinutes,
      input.enabled ? 1 : 0,
      computeNextRunAt(input),
      req.params.id,
    );
    res.json({ success: true, automation: mapAutomation(db.prepare('SELECT * FROM automation_definitions WHERE id = ?').get(req.params.id)) });
  } catch (error) {
    console.error('Automation update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update automation' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const changes = db.prepare('DELETE FROM automation_definitions WHERE id = ?').run(req.params.id).changes;
    if (!changes) return res.status(404).json({ error: 'Automation not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Automation delete error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete automation' });
  }
});

router.post('/:id/run', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM automation_definitions WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Automation not found' });
    const run = enqueueAutomationRun(mapAutomation(row), 'manual');
    res.json({ success: true, run: mapRun(run) });
  } catch (error) {
    console.error('Automation run error:', error);
    res.status(500).json({ error: error.message || 'Failed to run automation' });
  }
});

export default router;
