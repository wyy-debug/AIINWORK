import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { readJsonConfig, writeJsonConfig } from '../shared/utils.js';

const DEFAULT_STORE_FILE = 'thread-goals.json';
const GOAL_STORE_VERSION = 1;
const VALID_SESSION_ID = /^[a-zA-Z0-9._-]+$/;
const VALID_USER_STATUSES = new Set(['active', 'paused', 'complete']);

let testStorePath = null;

function getMtlCodeHomeDir() {
  return process.env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
}

function getGoalStorePath() {
  return testStorePath || path.join(getMtlCodeHomeDir(), DEFAULT_STORE_FILE);
}

export function setSessionGoalStorePathForTests(filePath) {
  testStorePath = filePath;
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

function normalizeStatus(status, fallback = 'active') {
  const normalized = String(status || fallback).trim().toLowerCase();
  if (!VALID_USER_STATUSES.has(normalized)) {
    throw new Error('Goal status must be active, paused, or complete.');
  }
  return normalized;
}

async function readStore() {
  const store = await readJsonConfig(getGoalStorePath());
  return {
    version: GOAL_STORE_VERSION,
    goals: store.goals && typeof store.goals === 'object' && !Array.isArray(store.goals)
      ? store.goals
      : {},
  };
}

async function writeStore(store) {
  await writeJsonConfig(getGoalStorePath(), {
    version: GOAL_STORE_VERSION,
    goals: store.goals || {},
  });
}

function createGoal(sessionId, input) {
  const timestamp = Date.now();
  return {
    threadId: sessionId,
    goalId: randomUUID(),
    objective: normalizeObjective(input.objective),
    status: normalizeStatus(input.status, 'active'),
    tokenBudget: normalizeTokenBudget(input.tokenBudget),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAtMs: timestamp,
    updatedAtMs: timestamp,
  };
}

export async function getSessionGoal(sessionId) {
  const safeSessionId = validateSessionId(sessionId);
  const store = await readStore();
  return store.goals[safeSessionId] || null;
}

export async function replaceSessionGoal(sessionId, input) {
  const safeSessionId = validateSessionId(sessionId);
  const store = await readStore();
  const goal = createGoal(safeSessionId, input || {});
  store.goals[safeSessionId] = goal;
  await writeStore(store);
  return goal;
}

async function updateSessionGoalStatus(sessionId, status) {
  const safeSessionId = validateSessionId(sessionId);
  const store = await readStore();
  const current = store.goals[safeSessionId];
  if (!current) {
    throw new Error('No goal exists for this session.');
  }
  store.goals[safeSessionId] = {
    ...current,
    status: normalizeStatus(status),
    updatedAtMs: Date.now(),
  };
  await writeStore(store);
  return store.goals[safeSessionId];
}

export async function pauseSessionGoal(sessionId) {
  return updateSessionGoalStatus(sessionId, 'paused');
}

export async function resumeSessionGoal(sessionId) {
  return updateSessionGoalStatus(sessionId, 'active');
}

export async function completeSessionGoal(sessionId) {
  return updateSessionGoalStatus(sessionId, 'complete');
}

export async function clearSessionGoal(sessionId) {
  const safeSessionId = validateSessionId(sessionId);
  const store = await readStore();
  delete store.goals[safeSessionId];
  await writeStore(store);
}
