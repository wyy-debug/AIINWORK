import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

const DEFAULT_STORE_FILE = 'thread-goals.db';
const DEFAULT_LEGACY_STORE_FILE = 'thread-goals.json';
const VALID_SESSION_ID = /^[a-zA-Z0-9._-]+$/;
const VALID_STORED_STATUSES = new Set(['active', 'paused', 'complete', 'budget_limited']);
const VALID_USER_STATUSES = new Set(['active', 'paused', 'complete']);

let testStorePath = null;
let testLegacyStorePath = null;
const migratedLegacyStores = new Set();

function getMtlCodeHomeDir() {
  return process.env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
}

function getGoalStorePath() {
  return testStorePath || path.join(getMtlCodeHomeDir(), DEFAULT_STORE_FILE);
}

function getLegacyGoalStorePath() {
  return testLegacyStorePath || path.join(getMtlCodeHomeDir(), DEFAULT_LEGACY_STORE_FILE);
}

export function setSessionGoalStorePathForTests(filePath) {
  testStorePath = filePath;
  migratedLegacyStores.delete(filePath);
}

export function setSessionGoalLegacyStorePathForTests(filePath) {
  testLegacyStorePath = filePath;
  if (testStorePath) {
    migratedLegacyStores.delete(testStorePath);
  }
}

function validateSessionId(sessionId) {
  const normalized = String(sessionId || '').trim();
  if (!normalized || !VALID_SESSION_ID.test(normalized)) {
    throw new Error('Invalid sessionId');
  }
  return normalized;
}

function normalizeObjective(objective) {
  const normalized = String(objective || '').trim();
  if (!normalized) {
    throw new Error('Goal objective is required.');
  }
  if (normalized.length > 4000) {
    throw new Error('Goal objective must be 4000 characters or fewer.');
  }
  return normalized;
}

function normalizeTokenBudget(tokenBudget) {
  if (tokenBudget === undefined || tokenBudget === null || tokenBudget === '') {
    return null;
  }
  const parsed = Number(tokenBudget);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Goal token budget must be a positive integer.');
  }
  return parsed;
}

function normalizeStoredStatus(status, fallback = 'active') {
  const normalized = String(status || fallback).trim().toLowerCase();
  if (!VALID_STORED_STATUSES.has(normalized)) {
    return fallback;
  }
  return normalized;
}

function normalizeUserStatus(status, fallback = 'active') {
  const normalized = String(status || fallback).trim().toLowerCase();
  if (!VALID_USER_STATUSES.has(normalized)) {
    throw new Error('Goal status must be active, paused, or complete.');
  }
  return normalized;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function rowToGoal(row) {
  if (!row) {
    return null;
  }
  return {
    threadId: row.thread_id,
    goalId: row.goal_id,
    objective: row.objective,
    status: row.status,
    tokenBudget: row.token_budget,
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function rowToEvent(row) {
  if (!row) {
    return null;
  }
  return {
    eventId: row.event_id,
    threadId: row.thread_id,
    goalId: row.goal_id,
    eventType: row.event_type,
    lifecycleType: row.lifecycle_type,
    goal: rowToGoal(parseJsonObject(row.goal_json)),
    payload: parseJsonObject(row.payload_json),
    createdAtMs: row.created_at_ms,
  };
}

function goalToRow(goal) {
  return {
    thread_id: goal.threadId,
    goal_id: goal.goalId,
    objective: goal.objective,
    status: goal.status,
    token_budget: goal.tokenBudget,
    tokens_used: goal.tokensUsed,
    time_used_seconds: goal.timeUsedSeconds,
    created_at_ms: goal.createdAtMs,
    updated_at_ms: goal.updatedAtMs,
  };
}

function openGoalDb() {
  const dbPath = getGoalStorePath();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.prepare(`
    CREATE TABLE IF NOT EXISTS thread_goals (
      thread_id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'complete', 'budget_limited')),
      token_budget INTEGER,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      time_used_seconds INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS thread_goal_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      goal_id TEXT,
      event_type TEXT NOT NULL CHECK (event_type IN ('thread_goal_updated', 'thread_goal_cleared', 'thread_goal_lifecycle')),
      lifecycle_type TEXT,
      goal_json TEXT,
      payload_json TEXT,
      created_at_ms INTEGER NOT NULL
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_thread_goal_events_event_id ON thread_goal_events(event_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_thread_goal_events_thread_id ON thread_goal_events(thread_id)').run();
  migrateLegacyGoals(db, dbPath);
  return db;
}

function appendGoalEvent(db, {
  threadId,
  goalId = null,
  eventType,
  lifecycleType = null,
  goal = null,
  payload = null,
}) {
  const createdAtMs = Date.now();
  const result = db.prepare(`
    INSERT INTO thread_goal_events (
      thread_id,
      goal_id,
      event_type,
      lifecycle_type,
      goal_json,
      payload_json,
      created_at_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    threadId,
    goalId || goal?.goalId || null,
    eventType,
    lifecycleType,
    goal ? JSON.stringify(goalToRow(goal)) : null,
    payload ? JSON.stringify(payload) : null,
    createdAtMs,
  );
  return {
    eventId: Number(result.lastInsertRowid),
    threadId,
    goalId: goalId || goal?.goalId || null,
    eventType,
    lifecycleType,
    goal,
    payload,
    createdAtMs,
  };
}

function readLegacyGoals() {
  const legacyPath = getLegacyGoalStorePath();
  if (!existsSync(legacyPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(legacyPath, 'utf8'));
    const goals = parsed?.goals && typeof parsed.goals === 'object' && !Array.isArray(parsed.goals)
      ? parsed.goals
      : {};
    return Object.entries(goals).map(([threadId, rawGoal]) => {
      const goal = rawGoal && typeof rawGoal === 'object' ? rawGoal : {};
      const timestamp = Date.now();
      return {
        threadId: validateSessionId(goal.threadId || threadId),
        goalId: String(goal.goalId || randomUUID()),
        objective: normalizeObjective(goal.objective),
        status: normalizeStoredStatus(goal.status),
        tokenBudget: normalizeTokenBudget(goal.tokenBudget),
        tokensUsed: normalizeNonNegativeInteger(goal.tokensUsed),
        timeUsedSeconds: normalizeNonNegativeInteger(goal.timeUsedSeconds),
        createdAtMs: normalizeNonNegativeInteger(goal.createdAtMs, timestamp),
        updatedAtMs: normalizeNonNegativeInteger(goal.updatedAtMs, timestamp),
      };
    });
  } catch (error) {
    console.warn('[session-goal-service] Failed to import legacy thread-goals.json:', error);
    return [];
  }
}

function migrateLegacyGoals(db, dbPath) {
  if (migratedLegacyStores.has(dbPath)) {
    return;
  }
  migratedLegacyStores.add(dbPath);

  const legacyGoals = readLegacyGoals();
  if (legacyGoals.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO thread_goals (
      thread_id,
      goal_id,
      objective,
      status,
      token_budget,
      tokens_used,
      time_used_seconds,
      created_at_ms,
      updated_at_ms
    )
    VALUES (
      @thread_id,
      @goal_id,
      @objective,
      @status,
      @token_budget,
      @tokens_used,
      @time_used_seconds,
      @created_at_ms,
      @updated_at_ms
    )
  `);
  const transaction = db.transaction((goals) => {
    for (const goal of goals) {
      insert.run(goalToRow(goal));
    }
  });
  transaction(legacyGoals);
}

function createGoal(sessionId, input) {
  const timestamp = Date.now();
  return {
    threadId: sessionId,
    goalId: randomUUID(),
    objective: normalizeObjective(input.objective),
    status: normalizeUserStatus(input.status, 'active'),
    tokenBudget: normalizeTokenBudget(input.tokenBudget),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAtMs: timestamp,
    updatedAtMs: timestamp,
  };
}

function assertExpectedGoal(current, expectedGoalId) {
  if (expectedGoalId && current?.goalId !== expectedGoalId) {
    throw new Error('Stale goal update: expected goal id does not match the current goal.');
  }
}

export async function getSessionGoal(sessionId) {
  const safeSessionId = validateSessionId(sessionId);
  const db = openGoalDb();
  try {
    return rowToGoal(db.prepare('SELECT * FROM thread_goals WHERE thread_id = ?').get(safeSessionId));
  } finally {
    db.close();
  }
}

export async function replaceSessionGoal(sessionId, input) {
  const safeSessionId = validateSessionId(sessionId);
  const goal = createGoal(safeSessionId, input || {});
  const db = openGoalDb();
  try {
    db.prepare(`
      INSERT INTO thread_goals (
        thread_id,
        goal_id,
        objective,
        status,
        token_budget,
        tokens_used,
        time_used_seconds,
        created_at_ms,
        updated_at_ms
      )
      VALUES (
        @thread_id,
        @goal_id,
        @objective,
        @status,
        @token_budget,
        @tokens_used,
        @time_used_seconds,
        @created_at_ms,
        @updated_at_ms
      )
      ON CONFLICT(thread_id) DO UPDATE SET
        goal_id = excluded.goal_id,
        objective = excluded.objective,
        status = excluded.status,
        token_budget = excluded.token_budget,
        tokens_used = excluded.tokens_used,
        time_used_seconds = excluded.time_used_seconds,
        created_at_ms = excluded.created_at_ms,
        updated_at_ms = excluded.updated_at_ms
    `).run(goalToRow(goal));
    appendGoalEvent(db, {
      threadId: safeSessionId,
      eventType: 'thread_goal_updated',
      goal,
    });
    return goal;
  } finally {
    db.close();
  }
}

async function updateSessionGoalStatus(sessionId, status, options = {}) {
  const safeSessionId = validateSessionId(sessionId);
  const db = openGoalDb();
  try {
    const current = rowToGoal(db.prepare('SELECT * FROM thread_goals WHERE thread_id = ?').get(safeSessionId));
    if (!current) {
      throw new Error('No goal exists for this session.');
    }
    assertExpectedGoal(current, options.expectedGoalId);
    const nextStatus = status === 'active' ? 'active' : normalizeUserStatus(status);
    const updatedAtMs = Date.now();
    db.prepare('UPDATE thread_goals SET status = ?, updated_at_ms = ? WHERE thread_id = ?').run(
      nextStatus,
      updatedAtMs,
      safeSessionId,
    );
    const updated = {
      ...current,
      status: nextStatus,
      updatedAtMs,
    };
    appendGoalEvent(db, {
      threadId: safeSessionId,
      eventType: 'thread_goal_updated',
      goal: updated,
    });
    return updated;
  } finally {
    db.close();
  }
}

export async function pauseSessionGoal(sessionId, options) {
  return updateSessionGoalStatus(sessionId, 'paused', options);
}

export async function resumeSessionGoal(sessionId, options) {
  return updateSessionGoalStatus(sessionId, 'active', options);
}

export async function completeSessionGoal(sessionId, options) {
  return updateSessionGoalStatus(sessionId, 'complete', options);
}

export async function clearSessionGoal(sessionId, options = {}) {
  const safeSessionId = validateSessionId(sessionId);
  const db = openGoalDb();
  try {
    const current = rowToGoal(db.prepare('SELECT * FROM thread_goals WHERE thread_id = ?').get(safeSessionId));
    assertExpectedGoal(current, options.expectedGoalId);
    db.prepare('DELETE FROM thread_goals WHERE thread_id = ?').run(safeSessionId);
    appendGoalEvent(db, {
      threadId: safeSessionId,
      goalId: current?.goalId || null,
      eventType: 'thread_goal_cleared',
      goal: null,
    });
  } finally {
    db.close();
  }
}

export async function listSessionGoalEventsAfter(eventId, limit = 100) {
  const db = openGoalDb();
  try {
    const rows = db.prepare(`
      SELECT *
      FROM thread_goal_events
      WHERE event_id > ?
      ORDER BY event_id ASC
      LIMIT ?
    `).all(
      Math.max(0, Math.floor(Number(eventId) || 0)),
      Math.max(1, Math.floor(Number(limit) || 100)),
    );
    return rows.map(rowToEvent).filter(Boolean);
  } finally {
    db.close();
  }
}

export async function getLatestSessionGoalEvent(sessionId) {
  const safeSessionId = validateSessionId(sessionId);
  const db = openGoalDb();
  try {
    return rowToEvent(db.prepare(`
      SELECT *
      FROM thread_goal_events
      WHERE thread_id = ?
      ORDER BY event_id DESC
      LIMIT 1
    `).get(safeSessionId));
  } finally {
    db.close();
  }
}
