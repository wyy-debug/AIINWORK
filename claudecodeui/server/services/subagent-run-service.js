import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const DATA_DIR = process.env.MTL_CODE_UI_DATA_DIR || path.join(os.homedir(), '.mtl-code-ui');
const DEFAULT_RUNS_PATH = path.join(DATA_DIR, 'subagent-runs.json');
const TASK_PERMISSION_ACTIONS = new Set(['allow', 'ask', 'deny']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);

function nowIso(now) {
  return new Date(now()).toISOString();
}

function normalizeText(value, fallback = '', maxLength = 4000) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeAction(value, fallback = 'ask') {
  const action = normalizeText(value, '', 20).toLowerCase();
  return TASK_PERMISSION_ACTIONS.has(action) ? action : fallback;
}

function normalizePattern(pattern) {
  return normalizeText(pattern, '', 120).toLowerCase();
}

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesPattern(pattern, agentId) {
  const normalizedPattern = normalizePattern(pattern);
  if (!normalizedPattern) return false;
  return wildcardToRegex(normalizedPattern).test(normalizeText(agentId).toLowerCase());
}

export function resolveTaskPermission(permissionTask, agentId) {
  if (typeof permissionTask === 'string') {
    return normalizeAction(permissionTask);
  }
  if (!permissionTask || typeof permissionTask !== 'object' || Array.isArray(permissionTask)) {
    return 'ask';
  }

  let resolved = 'ask';
  for (const [pattern, action] of Object.entries(permissionTask)) {
    if (matchesPattern(pattern, agentId)) {
      resolved = normalizeAction(action, resolved);
    }
  }
  return resolved;
}

function createEvent(type, payload, now) {
  return {
    id: `subagent_event_${crypto.randomUUID()}`,
    type,
    payload: payload && typeof payload === 'object' ? payload : {},
    createdAt: now(),
  };
}

function normalizeRun(input, now) {
  const agent = input?.agent && typeof input.agent === 'object' ? input.agent : {};
  const timestamp = now();
  return {
    id: input?.id || `subagent_run_${crypto.randomUUID()}`,
    agentId: normalizeText(agent.id || input?.agentId, 'subagent', 120),
    agentName: normalizeText(agent.name || input?.agentName || agent.id, 'Subagent', 160),
    agentMode: normalizeText(agent.mode || input?.agentMode, 'subagent', 40),
    objective: normalizeText(input?.objective || input?.prompt || input?.message, '', 8000),
    projectPath: normalizeText(input?.projectPath, '', 1000),
    sessionId: normalizeText(input?.sessionId, '', 240),
    source: normalizeText(input?.source, 'manual', 40),
    status: normalizeText(input?.status, 'running', 40),
    result: normalizeText(input?.result, '', 12000),
    error: normalizeText(input?.error, '', 2000),
    createdAt: input?.createdAt || timestamp,
    updatedAt: input?.updatedAt || timestamp,
    events: Array.isArray(input?.events) ? input.events : [],
  };
}

export function createSubagentRunStore({
  dataPath = DEFAULT_RUNS_PATH,
  persist = true,
  now = () => Date.now(),
  executor = null,
} = {}) {
  let loaded = false;
  let runs = [];

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!persist) return;
    try {
      const raw = JSON.parse(await fs.readFile(dataPath, 'utf8'));
      runs = Array.isArray(raw.runs) ? raw.runs.map((run) => normalizeRun(run, now)) : [];
    } catch {
      runs = [];
    }
  }

  async function save() {
    if (!persist) return;
    await fs.mkdir(path.dirname(dataPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(dataPath, JSON.stringify({ schemaVersion: 1, updatedAt: nowIso(now), runs }, null, 2), {
      mode: 0o600,
    });
  }

  function listRuns({ status = '', agentId = '', limit = 50 } = {}) {
    const normalizedStatus = normalizeText(status).toLowerCase();
    const normalizedAgentId = normalizeText(agentId).toLowerCase();
    return runs
      .filter((run) => !normalizedStatus || run.status.toLowerCase() === normalizedStatus)
      .filter((run) => !normalizedAgentId || run.agentId.toLowerCase() === normalizedAgentId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
  }

  function getRun(runId) {
    const id = normalizeText(runId);
    return runs.find((run) => run.id === id) || null;
  }

  async function patchRun(runId, patch = {}, eventType = '') {
    await load();
    const run = getRun(runId);
    if (!run) return null;
    Object.assign(run, patch, { updatedAt: now() });
    if (eventType) {
      run.events.push(createEvent(eventType, patch, now));
    }
    await save();
    return run;
  }

  async function createRun(input = {}) {
    await load();
    const run = normalizeRun(input, now);
    run.events.push(createEvent('subagent_run_created', {
      agentId: run.agentId,
      source: run.source,
      objective: run.objective,
    }, now));
    runs.push(run);
    await save();

    if (typeof executor === 'function') {
      setTimeout(() => {
        void executor(run).then(
          async (result) => {
            if (TERMINAL_STATUSES.has(getRun(run.id)?.status)) return;
            await patchRun(run.id, {
              status: 'completed',
              result: normalizeText(result?.result || result?.content || result?.summary, 'Subagent completed.', 12000),
            }, 'subagent_run_completed');
          },
          async (error) => {
            if (TERMINAL_STATUSES.has(getRun(run.id)?.status)) return;
            await patchRun(run.id, {
              status: 'failed',
              error: error?.message || 'Subagent run failed.',
            }, 'subagent_run_failed');
          },
        );
      }, 0);
    }

    return run;
  }

  async function controlRun(runId, input = {}) {
    await load();
    const action = normalizeText(input.action, 'wait', 40).toLowerCase();
    if (action === 'stop') {
      return patchRun(runId, { status: 'stopped' }, 'subagent_run_stopped');
    }
    if (action === 'complete') {
      return patchRun(runId, { status: 'completed', result: normalizeText(input.result, '', 12000) }, 'subagent_run_completed');
    }
    return patchRun(runId, { lastControlAction: action }, 'subagent_run_controlled');
  }

  return {
    async ready() {
      await load();
      return this;
    },
    listRuns(query) {
      return listRuns(query);
    },
    getRun,
    createRun,
    controlRun,
  };
}

export const defaultSubagentRunStore = createSubagentRunStore();
