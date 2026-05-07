import crypto from 'crypto';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import express from 'express';

import { db } from '../database/db.js';
import { extractProjectDirectory } from '../projects.js';
import { createArtifact } from '../services/artifact-service.js';
import {
  evaluateRuntimePermission,
  resolveRuntimeShell,
} from '../services/runtime-permission-service.js';

const router = express.Router();
const runningActions = new Map();
const actionEvents = new EventEmitter();
const CONFIG_DIR_NAME = '.mtl-code';
const PROJECT_CONFIG_NAME = 'actions.json';
const USER_CONFIG_PATH = path.join(os.homedir(), '.mtl-code-ui', PROJECT_CONFIG_NAME);
const MAX_LOG_CHARS = 1_000_000;

const ACTION_TYPES = ['setup', 'run', 'test', 'build'];

const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const trimLog = (value) => {
  if (!value) return '';
  return value.length > MAX_LOG_CHARS ? value.slice(value.length - MAX_LOG_CHARS) : value;
};

const normalizeCommand = (value) => {
  if (typeof value === 'string') {
    return { command: value.trim(), enabled: Boolean(value.trim()) };
  }
  if (!value || typeof value !== 'object') {
    return { command: '', enabled: false };
  }
  const platformKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const platformCommand = value.platforms && typeof value.platforms === 'object'
    ? value.platforms[platformKey]
    : '';
  const command = typeof platformCommand === 'string' && platformCommand.trim()
    ? platformCommand.trim()
    : typeof value.command === 'string' ? value.command.trim() : '';
  return {
    command,
    enabled: value.enabled !== false && Boolean(command),
    name: typeof value.name === 'string' ? value.name.trim().slice(0, 80) : '',
    icon: typeof value.icon === 'string' ? value.icon.trim().slice(0, 40) : '',
    platforms: value.platforms && typeof value.platforms === 'object'
      ? {
        windows: typeof value.platforms.windows === 'string' ? value.platforms.windows.trim() : '',
        mac: typeof value.platforms.mac === 'string' ? value.platforms.mac.trim() : '',
        linux: typeof value.platforms.linux === 'string' ? value.platforms.linux.trim() : '',
      }
      : undefined,
  };
};

const normalizeConfig = (value = {}) => {
  const config = {};
  for (const type of ACTION_TYPES) {
    config[type] = normalizeCommand(value[type]);
  }
  return config;
};

const readJsonFile = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const resolveProjectPath = async (projectName, projectPath = '') => {
  const resolved = projectPath || await extractProjectDirectory(projectName);
  if (!resolved || typeof resolved !== 'string') {
    throw new Error('Project path is required');
  }
  return path.resolve(resolved);
};

const getProjectConfigPath = (projectPath) => (
  path.join(projectPath, CONFIG_DIR_NAME, PROJECT_CONFIG_NAME)
);

const detectDefaultConfig = async (projectPath) => {
  const packageJson = await readJsonFile(path.join(projectPath, 'package.json'));
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
  return normalizeConfig({
    setup: { command: packageJson ? 'npm install' : '', enabled: Boolean(packageJson) },
    run: { command: scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : '', enabled: Boolean(scripts.dev || scripts.start) },
    test: { command: scripts.test ? 'npm test' : '', enabled: Boolean(scripts.test) },
    build: { command: scripts.build ? 'npm run build' : '', enabled: Boolean(scripts.build) },
  });
};

const detectPackageScripts = async (projectPath) => {
  const packageJson = await readJsonFile(path.join(projectPath, 'package.json'));
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
  return Object.entries(scripts)
    .filter((entry) => typeof entry[1] === 'string' && entry[1].trim())
    .map(([name, script]) => ({
      name,
      command: `npm run ${name}`,
      script: String(script),
    }))
    .sort((left, right) => {
      const rank = ['dev', 'start', 'test', 'build', 'lint'].indexOf(left.name) - ['dev', 'start', 'test', 'build', 'lint'].indexOf(right.name);
      if (rank !== 0 && ['dev', 'start', 'test', 'build', 'lint'].includes(left.name) && ['dev', 'start', 'test', 'build', 'lint'].includes(right.name)) {
        return rank;
      }
      if (['dev', 'start', 'test', 'build', 'lint'].includes(left.name)) return -1;
      if (['dev', 'start', 'test', 'build', 'lint'].includes(right.name)) return 1;
      return left.name.localeCompare(right.name);
    });
};

const readActionConfig = async (projectPath) => {
  const projectConfigPath = getProjectConfigPath(projectPath);
  const projectConfig = await readJsonFile(projectConfigPath);
  if (projectConfig) {
    return { source: 'project', filePath: projectConfigPath, actions: normalizeConfig(projectConfig.actions || projectConfig) };
  }

  const userConfig = await readJsonFile(USER_CONFIG_PATH);
  if (userConfig) {
    return { source: 'user', filePath: USER_CONFIG_PATH, actions: normalizeConfig(userConfig.actions || userConfig) };
  }

  return { source: 'detected', filePath: projectConfigPath, actions: await detectDefaultConfig(projectPath) };
};

const persistRun = (run) => {
  db.prepare(`
    INSERT INTO action_runs (id, project_name, project_path, action_type, command, status, output, exit_code, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      output = excluded.output,
      exit_code = excluded.exit_code,
      finished_at = excluded.finished_at
  `).run(
    run.id,
    run.projectName,
    run.projectPath,
    run.actionType,
    run.command,
    run.status,
    trimLog(run.output),
    run.exitCode ?? null,
    run.startedAt || null,
    run.finishedAt || null,
  );
};

const persistRunEvent = (runId, eventType, payload = {}) => {
  const event = {
    id: createId('action_event'),
    runId,
    type: eventType,
    payload,
    createdAt: new Date().toISOString(),
  };
  try {
    db.prepare(`
      INSERT INTO action_run_events (id, run_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.id, runId, eventType, JSON.stringify(payload || {}), event.createdAt);
  } catch (error) {
    console.warn('[Actions] Failed to persist run event:', error.message);
  }
  actionEvents.emit(runId, event);
  return event;
};

const persistActionArtifact = async (run) => {
  if (!run?.id || run.artifactStored) {
    return;
  }
  run.artifactStored = true;
  const title = `${ACTION_TYPES.includes(run.actionType) ? run.actionType : 'action'} ${run.status}: ${run.command}`;
  await createArtifact({
    kind: 'action-log',
    title: title.slice(0, 240),
    projectName: run.projectName || '',
    sessionId: run.sessionId || '',
    content: trimLog(run.output || ''),
    metadata: {
      source: 'actions',
      runId: run.id,
      actionType: run.actionType,
      command: run.command,
      status: run.status,
      exitCode: run.exitCode ?? null,
      projectPath: run.projectPath,
    },
  });
};

router.get('/config', async (req, res) => {
  try {
    const projectName = String(req.query.project || '');
    const projectPath = await resolveProjectPath(projectName, String(req.query.projectPath || ''));
    const config = await readActionConfig(projectPath);
    const detectedScripts = await detectPackageScripts(projectPath);
    res.json({ success: true, projectName, projectPath, detectedScripts, ...config });
  } catch (error) {
    console.error('Project actions config error:', error);
    res.status(500).json({ error: error.message || 'Failed to read project actions' });
  }
});

router.put('/config', async (req, res) => {
  try {
    const projectName = String(req.body?.project || '');
    const projectPath = await resolveProjectPath(projectName, String(req.body?.projectPath || ''));
    const configPath = getProjectConfigPath(projectPath);
    const actions = normalizeConfig(req.body?.actions || {});
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify({ version: 1, actions }, null, 2)}\n`, 'utf8');
    res.json({ success: true, source: 'project', filePath: configPath, actions });
  } catch (error) {
    console.error('Project actions save error:', error);
    res.status(500).json({ error: error.message || 'Failed to save project actions' });
  }
});

router.post('/run', async (req, res) => {
  try {
    const projectName = String(req.body?.project || '');
    const actionType = String(req.body?.actionType || '').toLowerCase();
    if (!ACTION_TYPES.includes(actionType)) {
      return res.status(400).json({ error: 'Unsupported action type' });
    }

    const projectPath = await resolveProjectPath(projectName, String(req.body?.projectPath || ''));
    const config = await readActionConfig(projectPath);
    const action = normalizeCommand(req.body?.command ? { command: req.body.command } : config.actions[actionType]);
    if (!action.command) {
      return res.status(400).json({ error: `No command configured for ${actionType}` });
    }

    const permission = evaluateRuntimePermission({
      command: action.command,
      cwd: projectPath,
      projectPath,
      operation: `project-action:${actionType}`,
      confirmationId: req.body?.confirmationId || '',
    });
    if (permission.requiresConfirmation) {
      return res.json({
        success: true,
        requiresConfirmation: true,
        confirmationId: permission.confirmationId,
        reason: permission.reason,
      });
    }
    if (!permission.allowed) {
      return res.status(403).json({ error: permission.reason || 'Action is not allowed by runtime permissions' });
    }

	    const run = {
      id: createId('action'),
      projectName,
      projectPath,
      actionType,
      command: action.command,
      status: 'running',
      output: '',
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      sessionId: req.body?.sessionId || null,
	    };
	    persistRun(run);
      persistRunEvent(run.id, 'status', { status: run.status, startedAt: run.startedAt });

	    const launch = resolveRuntimeShell(action.command);
    const child = spawn(launch.shell, launch.args, {
      cwd: projectPath,
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });
    const runningEntry = { child, run, stopped: false };
    runningActions.set(run.id, runningEntry);

	    const appendOutput = (chunk) => {
        const text = chunk.toString();
	      run.output = trimLog(`${run.output}${text}`);
	      persistRun(run);
        persistRunEvent(run.id, 'output', { text, status: run.status });
	    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
	    child.once('error', (error) => {
	      run.status = 'failed';
	      run.output = trimLog(`${run.output}\n${error.message}`);
	      run.finishedAt = new Date().toISOString();
	      persistRun(run);
        persistRunEvent(run.id, 'status', { status: run.status, error: error.message, finishedAt: run.finishedAt });
	      void persistActionArtifact(run);
	      runningActions.delete(run.id);
	    });
	    child.once('close', (code, signal) => {
        const wasStopped = runningEntry.stopped || run.status === 'stopped';
	      run.status = wasStopped ? 'stopped' : code === 0 ? 'completed' : 'failed';
	      run.exitCode = code;
	      run.finishedAt = new Date().toISOString();
	      persistRun(run);
        persistRunEvent(run.id, 'status', { status: run.status, exitCode: code, signal: signal || null, finishedAt: run.finishedAt });
	      void persistActionArtifact(run);
	      runningActions.delete(run.id);
	    });

    res.json({ success: true, run: { ...run, pid: child.pid } });
  } catch (error) {
    console.error('Project action run error:', error);
    res.status(500).json({ error: error.message || 'Failed to run project action' });
  }
});

router.post('/:runId/stop', async (req, res) => {
  const runId = req.params.runId;
  const entry = runningActions.get(runId);
  if (!entry) {
    return res.status(404).json({ error: 'Running action not found' });
  }

  entry.stopped = true;
	entry.run.status = 'stopped';
	entry.run.finishedAt = new Date().toISOString();
	persistRun(entry.run);
  persistRunEvent(runId, 'status', { status: 'stopped', finishedAt: entry.run.finishedAt });
	entry.child.kill('SIGTERM');
  res.json({ success: true });
});

router.get('/:runId/events', async (req, res) => {
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
      SELECT * FROM action_run_events
      WHERE run_id = ?
      ORDER BY created_at ASC
      LIMIT 500
    `).all(runId);
    rows.forEach((row) => {
      send({
        id: row.id,
        runId: row.run_id,
        type: row.event_type,
        payload: JSON.parse(row.payload_json || '{}'),
        createdAt: row.created_at,
      });
    });
  } catch (error) {
    send({ id: createId('action_event'), runId, type: 'error', payload: { error: error.message }, createdAt: new Date().toISOString() });
  }

  const listener = (event) => send(event);
  actionEvents.on(runId, listener);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    actionEvents.off(runId, listener);
  });
});

router.get('/:runId/logs', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM action_runs WHERE id = ?').get(req.params.runId);
    if (!row) {
      return res.status(404).json({ error: 'Action run not found' });
    }
    res.json({
      success: true,
      run: {
        id: row.id,
        projectName: row.project_name,
        projectPath: row.project_path,
        actionType: row.action_type,
        command: row.command,
        status: row.status,
        output: row.output || '',
        exitCode: row.exit_code,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      },
    });
  } catch (error) {
    console.error('Project action logs error:', error);
    res.status(500).json({ error: error.message || 'Failed to read action logs' });
  }
});

router.get('/runs/list', async (req, res) => {
  try {
    const projectName = String(req.query.project || '');
    const rows = db.prepare(`
      SELECT * FROM action_runs
      WHERE project_name = ?
      ORDER BY started_at DESC
      LIMIT 50
    `).all(projectName);
    res.json({
      success: true,
      runs: rows.map((row) => ({
        id: row.id,
        projectName: row.project_name,
        actionType: row.action_type,
        command: row.command,
        status: row.status,
        output: row.output || '',
        exitCode: row.exit_code,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      })),
    });
  } catch (error) {
    console.error('Project action runs error:', error);
    res.status(500).json({ error: error.message || 'Failed to list action runs' });
  }
});

export default router;
