import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

import express from 'express';

import { queryClaudeSDK } from '../claude-sdk.js';
import {
  addProjectManually,
  deleteProject,
  extractProjectDirectory,
} from '../projects.js';
import { db, sessionAgentBindingsDb, worktreeDispatchesDb } from '../database/db.js';
import { createArtifact } from '../services/artifact-service.js';
import {
  evaluateRuntimePermission,
  resolveRuntimeShell,
} from '../services/runtime-permission-service.js';

const router = express.Router();

function getWorktreeRoot() {
  return path.resolve(process.env.MTL_CODE_WORKTREE_ROOT || path.join(os.homedir(), '.mtl-code', 'worktrees'));
}

function normalizeString(value, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeStringArray(value, maxLength = 60) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item) => normalizeString(item, 160))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxLength);
}

function normalizeAppBindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((binding) => {
      const item = binding && typeof binding === 'object' ? binding : {};
      const slot = normalizeString(item.slot, 80);
      const app = normalizeString(item.app, 180);
      if (!slot || !app) return null;
      const status = ['connected', 'optional', 'disabled'].includes(item.status) ? item.status : 'optional';
      return { slot, app, status };
    })
    .filter(Boolean)
    .slice(0, 40);
}

export function resolveWorktreeSessionBinding({ body = {}, sourceBinding = null, provider = 'claude' } = {}) {
  const sourceConfiguration = sourceBinding?.configuration && typeof sourceBinding.configuration === 'object'
    ? sourceBinding.configuration
    : {};
  const explicitSkills = normalizeStringArray(body?.skills);
  const inheritedSkills = normalizeStringArray(sourceConfiguration.skills);
  const explicitAppBindings = normalizeAppBindings(body?.appBindings);
  const inheritedAppBindings = normalizeAppBindings(sourceConfiguration.appBindings);
  const explicitModelProfileId = normalizeString(body?.modelProfileId, 160);
  const inheritedModelProfileId = normalizeString(sourceConfiguration.modelProfileId, 160);
  const skills = explicitSkills.length > 0 ? explicitSkills : inheritedSkills;
  const appBindings = explicitAppBindings.length > 0 ? explicitAppBindings : inheritedAppBindings;
  const modelProfileId = explicitModelProfileId || inheritedModelProfileId;
  const agentId = normalizeString(body?.agentId, 120) || normalizeString(sourceBinding?.agentId, 120);
  const configuration = {
    appBindings,
    skills,
    ...(modelProfileId ? { modelProfileId } : {}),
  };

  return {
    provider: normalizeString(provider, 40) || 'claude',
    agentId,
    skills,
    appBindings,
    configuration,
  };
}

function slugify(value) {
  const normalized = normalizeString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'task';
}

function ensurePathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function runGit(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
      ...options,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      const error = new Error((stderr || stdout || `git ${args.join(' ')} failed`).trim());
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function getRepoRoot(projectPath) {
  const result = await runGit(['rev-parse', '--show-toplevel'], projectPath);
  return path.resolve(result.stdout.trim());
}

async function getCurrentBranchOrHead(repoRoot) {
  try {
    const result = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
    return result.stdout.trim() || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

async function getDirtyState(repoRoot) {
  const result = await runGit(['status', '--porcelain'], repoRoot);
  return {
    isDirty: result.stdout.trim().length > 0,
    status: result.stdout,
  };
}

function getProjectDisplayName(projectName, projectPath) {
  const base = normalizeString(path.basename(projectPath), 80);
  if (base) return base;
  return normalizeString(projectName, 80) || 'project';
}

function validateBranchName(branchName) {
  const value = normalizeString(branchName, 160);
  if (!value) {
    throw new Error('Branch name is required');
  }
  if (
    value.includes('..')
    || value.startsWith('/')
    || value.endsWith('/')
    || value.endsWith('.')
    || value.includes('\\')
    || value.includes(' ')
    || /[\x00-\x20~^:?*[\\]/.test(value)
    || value.includes('@{')
    || value.endsWith('.lock')
  ) {
    throw new Error('Invalid branch name');
  }
  return value;
}

async function removeProjectConfig(projectName) {
  if (!projectName) return;
  try {
    await deleteProject(projectName, true, false);
  } catch (error) {
    console.warn(`[Worktree] Failed to remove project config for ${projectName}:`, error.message);
  }
}

export async function createManagedWorktreeDispatch(parentProjectName, body = {}) {
  const parentProjectPath = path.resolve(await extractProjectDirectory(parentProjectName));

  let repoRoot;
  try {
    repoRoot = await getRepoRoot(parentProjectPath);
  } catch {
    const error = new Error('Project is not a Git repository');
    error.statusCode = 400;
    throw error;
  }

  const taskPrompt = normalizeString(body?.taskPrompt, 20000);
  const title = normalizeString(body?.title, 120) || taskPrompt.split(/\r?\n/)[0] || 'Worktree task';
  const requestedBaseRef = normalizeString(body?.baseRef, 200);
  const baseRef = requestedBaseRef || await getCurrentBranchOrHead(repoRoot);
  const baseCommitResult = await runGit(['rev-parse', baseRef], repoRoot);
  const baseCommit = baseCommitResult.stdout.trim();
  const parentDirty = await getDirtyState(repoRoot);

  const id = crypto.randomUUID();
  const worktreeRoot = getWorktreeRoot();
  await fs.mkdir(worktreeRoot, { recursive: true });

  const repoName = slugify(path.basename(repoRoot));
  const worktreeName = `${repoName}-${slugify(title)}-${id.slice(0, 8)}`;
  const worktreePath = path.join(worktreeRoot, worktreeName);
  if (!ensurePathInside(worktreeRoot, worktreePath)) {
    const error = new Error('Resolved worktree path is outside the configured worktree root');
    error.statusCode = 400;
    throw error;
  }

  await runGit(['worktree', 'add', '--detach', worktreePath, baseRef], repoRoot);

  const parentDisplayName = getProjectDisplayName(parentProjectName, parentProjectPath);
  const displayName = normalizeString(body?.displayName, 120) || `${parentDisplayName} - WT ${id.slice(0, 8)}`;
  const project = await addProjectManually(worktreePath, displayName);
  const provider = normalizeString(body?.provider, 40) || 'claude';
  const sourceSessionId = normalizeString(body?.sourceSessionId || body?.parentSessionId, 200);
  const sourceBinding = sourceSessionId
    ? sessionAgentBindingsDb.getBinding(sourceSessionId, provider)
    : null;
  const sessionBinding = resolveWorktreeSessionBinding({ body, sourceBinding, provider });
  const skills = sessionBinding.skills;
  const appBindings = sessionBinding.appBindings;
  const agentId = sessionBinding.agentId;

  let worktree = worktreeDispatchesDb.create({
    id,
    projectName: project.name,
    sessionId: null,
    provider,
    parentProjectName,
    parentProjectPath,
    worktreePath,
    baseRef,
    baseCommit,
    mode: 'managed',
    status: 'created',
    agentId,
    skills,
    appBindings,
    taskPrompt,
    displayName,
  });

  if (body?.sessionId) {
    const sessionId = normalizeString(body.sessionId, 200);
    worktree = worktreeDispatchesDb.updateSession(id, sessionId, provider);
    if (
      agentId
      || skills.length > 0
      || appBindings.length > 0
      || sessionBinding.configuration.modelProfileId
    ) {
      sessionAgentBindingsDb.setAgent(sessionId, provider, agentId, sessionBinding.configuration);
    }
  }

  return {
    worktree,
    project: { ...project, worktree },
    parentDirty,
    sessionBinding,
  };
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function readWorktreeSetupCommand(worktreePath) {
  const configPath = path.join(worktreePath, '.mtl-code', 'actions.json');
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const setup = parsed.actions?.setup || parsed.setup || {};
    if (typeof setup === 'string') return setup.trim();
    if (!setup || typeof setup !== 'object') return '';
    const platformKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    return String(setup.platforms?.[platformKey] || setup.command || '').trim();
  } catch {
    return '';
  }
}

function createBootstrapWriter() {
  let sessionId = '';
  return {
    userId: null,
    send(payload) {
      try {
        const message = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (message?.newSessionId) sessionId = message.newSessionId;
        if (message?.sessionId) sessionId = message.sessionId;
      } catch {
        // Ignore non-JSON output.
      }
    },
    setSessionId(value) {
      sessionId = value || sessionId;
    },
    getSessionId() {
      return sessionId || null;
    },
  };
}

async function bindArgusSessionForWorktree(worktree, prompt = '') {
  if (!worktree?.id || !worktree.worktreePath || !prompt.trim()) {
    return worktree;
  }
  worktreeDispatchesDb.updateStatus(worktree.id, 'running');
  const writer = createBootstrapWriter();
  await queryClaudeSDK(prompt, {
    cwd: worktree.worktreePath,
    projectPath: worktree.worktreePath,
    sessionSummary: worktree.displayName || prompt.slice(0, 80),
    permissionMode: 'bypassPermissions',
  }, writer);
  const sessionId = writer.getSessionId();
  let updated = worktreeDispatchesDb.updateStatus(worktree.id, 'done');
  if (sessionId) {
    updated = worktreeDispatchesDb.updateSession(worktree.id, sessionId, worktree.provider || 'claude');
  }
  return updated;
}

function persistActionRun(run) {
  db.prepare(`
    INSERT INTO action_runs (id, project_name, project_path, action_type, command, status, output, exit_code, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.projectName,
    run.projectPath,
    run.actionType,
    run.command,
    run.status,
    run.output || '',
    run.exitCode ?? null,
    run.startedAt,
    run.finishedAt || null,
  );
}

async function persistActionArtifact(run) {
  await createArtifact({
    kind: 'action-log',
    title: `worktree setup ${run.status}: ${run.command}`.slice(0, 240),
    projectName: run.projectName || '',
    content: run.output || '',
    metadata: {
      source: 'actions',
      runId: run.id,
      actionType: run.actionType,
      status: run.status,
      exitCode: run.exitCode ?? null,
      projectPath: run.projectPath,
    },
  });
}

router.post('/projects/:projectName/worktrees', async (req, res) => {
  try {
    const result = await createManagedWorktreeDispatch(req.params.projectName, req.body || {});
    if (req.body?.createNewSession || req.body?.startArgus) {
      result.worktree = await bindArgusSessionForWorktree(result.worktree, result.worktree.taskPrompt || req.body?.taskPrompt || '');
      if (result.worktree?.sessionId && result.sessionBinding) {
        const binding = result.sessionBinding;
        if (
          binding.agentId
          || binding.skills.length > 0
          || binding.appBindings.length > 0
          || binding.configuration.modelProfileId
        ) {
          sessionAgentBindingsDb.setAgent(result.worktree.sessionId, binding.provider, binding.agentId, binding.configuration);
        }
      }
      result.project = { ...result.project, worktree: result.worktree };
    }
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Worktree] Failed to create worktree:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create worktree' });
  }
});

router.post('/worktrees/:id/handoff', async (req, res) => {
  try {
    const worktree = worktreeDispatchesDb.getById(req.params.id);
    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }
    const direction = req.body?.direction === 'local-to-worktree' ? 'local-to-worktree' : 'worktree-to-local';
    const status = direction === 'worktree-to-local' ? 'ready-for-local-handoff' : 'ready-for-worktree-handoff';

    if (direction === 'worktree-to-local') {
      const parentDirty = await getDirtyState(worktree.parentProjectPath);
      if (parentDirty.isDirty && req.body?.allowDirtyParent !== true) {
        return res.status(409).json({
          error: 'Parent project has local changes. Commit, stash, or explicitly allow dirty handoff first.',
          dirtyStatus: parentDirty.status,
        });
      }
      if (req.body?.branchName && !worktree.branchName) {
        const branchName = validateBranchName(req.body.branchName);
        await runGit(['checkout', '-b', branchName], worktree.worktreePath);
        worktreeDispatchesDb.updateBranch(worktree.id, branchName);
      }
    }

    const updated = worktreeDispatchesDb.updateHandoff(worktree.id, status);
    res.json({ success: true, worktree: updated, direction });
  } catch (error) {
    console.error('[Worktree] Handoff failed:', error);
    res.status(500).json({ error: error.message || 'Failed to hand off worktree' });
  }
});

router.post('/worktrees/:id/run-setup', async (req, res) => {
  try {
    const worktree = worktreeDispatchesDb.getById(req.params.id);
    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }
    const command = String(req.body?.command || await readWorktreeSetupCommand(worktree.worktreePath) || '').trim();
    if (!command) {
      return res.status(400).json({ error: 'No setup command configured for this worktree' });
    }
    const permission = evaluateRuntimePermission({
      command,
      cwd: worktree.worktreePath,
      projectPath: worktree.worktreePath,
      operation: 'worktree-setup',
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
      return res.status(403).json({ error: permission.reason || 'Setup is not allowed by runtime permissions' });
    }

    const run = {
      id: createId('action'),
      projectName: worktree.projectName || worktree.displayName || worktree.id,
      projectPath: worktree.worktreePath,
      actionType: 'setup',
      command,
      status: 'running',
      output: '',
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    const launch = resolveRuntimeShell(command);
    const child = spawn(launch.shell, launch.args, {
      cwd: worktree.worktreePath,
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });
    child.stdout?.on('data', (chunk) => { run.output += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { run.output += chunk.toString(); });
    child.once('error', (error) => {
      run.status = 'failed';
      run.output += `\n${error.message}`;
    });
    const exitCode = await new Promise((resolve) => child.once('close', resolve));
    run.status = exitCode === 0 ? 'completed' : 'failed';
    run.exitCode = exitCode;
    run.finishedAt = new Date().toISOString();
    persistActionRun(run);
    await persistActionArtifact(run);
    worktreeDispatchesDb.updateActionRun(worktree.id, run.id, 'setup');
    res.json({ success: true, run });
  } catch (error) {
    console.error('[Worktree] Setup failed:', error);
    res.status(500).json({ error: error.message || 'Failed to run worktree setup' });
  }
});

router.get('/projects/:projectName/worktrees', async (req, res) => {
  try {
    const worktrees = worktreeDispatchesDb.listByParentProjectName(req.params.projectName);
    res.json({ worktrees });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list worktrees' });
  }
});

router.get('/worktrees/:id', async (req, res) => {
  try {
    const worktree = worktreeDispatchesDb.getById(req.params.id);
    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }
    res.json({ worktree });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to read worktree' });
  }
});

router.post('/worktrees/:id/session', async (req, res) => {
  try {
    const worktree = worktreeDispatchesDb.getById(req.params.id);
    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }
    const sessionId = normalizeString(req.body?.sessionId, 200);
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    const provider = normalizeString(req.body?.provider, 40) || worktree.provider || 'claude';
    const updated = worktreeDispatchesDb.updateSession(worktree.id, sessionId, provider);
    if (updated.agentId || updated.skills.length > 0) {
      sessionAgentBindingsDb.setAgent(sessionId, provider, updated.agentId, {
        appBindings: updated.appBindings,
        skills: updated.skills,
      });
    }
    res.json({ success: true, worktree: updated });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update worktree session' });
  }
});

router.post('/worktrees/:id/create-branch', async (req, res) => {
  try {
    const worktree = worktreeDispatchesDb.getById(req.params.id);
    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }
    if (!worktree.worktreePath || !ensurePathInside(getWorktreeRoot(), worktree.worktreePath)) {
      return res.status(400).json({ error: 'Managed worktree path is invalid' });
    }
    const defaultBranchName = `codex/${worktree.id.slice(0, 8)}`;
    const branchName = validateBranchName(req.body?.branchName || defaultBranchName);
    await fs.access(worktree.worktreePath);
    await runGit(['checkout', '-b', branchName], worktree.worktreePath);
    const updated = worktreeDispatchesDb.updateBranch(worktree.id, branchName);
    res.json({ success: true, branchName, worktree: updated });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create branch' });
  }
});

router.delete('/worktrees/:id', async (req, res) => {
  try {
    const worktree = worktreeDispatchesDb.getById(req.params.id);
    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }
    if (worktree.mode !== 'managed') {
      return res.status(400).json({ error: 'Only managed worktrees can be deleted from this UI' });
    }
    if (!ensurePathInside(getWorktreeRoot(), worktree.worktreePath)) {
      return res.status(400).json({ error: 'Managed worktree path is invalid' });
    }

    let worktreeExists = true;
    try {
      await fs.access(worktree.worktreePath);
    } catch {
      worktreeExists = false;
    }

    if (worktreeExists) {
      const dirty = await getDirtyState(worktree.worktreePath);
      if (dirty.isDirty && req.query.force !== 'true') {
        return res.status(409).json({
          error: 'Worktree has local changes. Create a branch or handle the changes before deleting it.',
          dirtyStatus: dirty.status,
        });
      }

      await runGit(['worktree', 'remove', worktree.worktreePath], worktree.parentProjectPath);
    }

    await removeProjectConfig(worktree.projectName);
    const updated = worktreeDispatchesDb.updateStatus(worktree.id, 'archived');
    res.json({ success: true, worktree: updated });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete worktree' });
  }
});

export default router;
