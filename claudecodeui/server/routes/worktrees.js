import express from 'express';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

import {
  addProjectManually,
  deleteProject,
  extractProjectDirectory,
} from '../projects.js';
import { sessionAgentBindingsDb, worktreeDispatchesDb } from '../database/db.js';

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

router.post('/projects/:projectName/worktrees', async (req, res) => {
  try {
    const parentProjectName = req.params.projectName;
    const parentProjectPath = path.resolve(await extractProjectDirectory(parentProjectName));

    let repoRoot;
    try {
      repoRoot = await getRepoRoot(parentProjectPath);
    } catch {
      return res.status(400).json({ error: 'Project is not a Git repository' });
    }

    const taskPrompt = normalizeString(req.body?.taskPrompt, 20000);
    const title = normalizeString(req.body?.title, 120) || taskPrompt.split(/\r?\n/)[0] || 'Worktree task';
    const requestedBaseRef = normalizeString(req.body?.baseRef, 200);
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
      return res.status(400).json({ error: 'Resolved worktree path is outside the configured worktree root' });
    }

    await runGit(['worktree', 'add', '--detach', worktreePath, baseRef], repoRoot);

    const parentDisplayName = getProjectDisplayName(parentProjectName, parentProjectPath);
    const displayName = normalizeString(req.body?.displayName, 120) || `${parentDisplayName} - WT ${id.slice(0, 8)}`;
    const project = await addProjectManually(worktreePath, displayName);
    const skills = normalizeStringArray(req.body?.skills);
    const appBindings = normalizeAppBindings(req.body?.appBindings);
    const agentId = normalizeString(req.body?.agentId, 120);
    const provider = normalizeString(req.body?.provider, 40) || 'claude';

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

    if (req.body?.sessionId) {
      const sessionId = normalizeString(req.body.sessionId, 200);
      worktree = worktreeDispatchesDb.updateSession(id, sessionId, provider);
      if (agentId || skills.length > 0) {
        sessionAgentBindingsDb.setAgent(sessionId, provider, agentId, { appBindings, skills });
      }
    }

    res.json({
      success: true,
      worktree,
      project: { ...project, worktree },
      parentDirty,
    });
  } catch (error) {
    console.error('[Worktree] Failed to create worktree:', error);
    res.status(500).json({ error: error.message || 'Failed to create worktree' });
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
