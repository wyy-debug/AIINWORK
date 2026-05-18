import crypto from 'crypto';
import { spawn } from 'child_process';

import { db as defaultDb } from '../database/db.js';

const MAX_PATCH_BYTES = 2_000_000;

const createId = () => `checkpoint_${crypto.randomUUID()}`;

const safeJson = (value) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

function spawnGit(args, { cwd, input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      stdio: input === null ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`git ${args.join(' ')} failed`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    if (input !== null) {
      child.stdin.end(input);
    }
  });
}

const normalizePathForGit = (value) => String(value || '').replace(/\\/g, '/').replace(/^"+|"+$/g, '');

export function parsePorcelainStatus(statusOutput = '') {
  return statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const indexStatus = line[0] || ' ';
      const worktreeStatus = line[1] || ' ';
      const rawPath = normalizePathForGit(line.slice(3).split(' -> ').pop());
      const status = `${indexStatus}${worktreeStatus}`;
      return {
        path: rawPath,
        status,
        staged: status !== '??' && indexStatus !== ' ',
        unstaged: status === '??' || worktreeStatus !== ' ',
      };
    });
}

async function resolveRepositoryRoot(projectPath) {
  const { stdout } = await spawnGit(['rev-parse', '--show-toplevel'], { cwd: projectPath });
  return stdout.trim();
}

async function captureGitState(projectPath) {
  const repositoryRoot = await resolveRepositoryRoot(projectPath);
  const { stdout: branchOutput } = await spawnGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repositoryRoot });
  const { stdout: statusOutput } = await spawnGit(['status', '--porcelain'], { cwd: repositoryRoot });
  const files = parsePorcelainStatus(statusOutput);
  const { stdout: patchOutput } = await spawnGit(['diff', '--binary', 'HEAD', '--'], { cwd: repositoryRoot });
  const patch = patchOutput.length > MAX_PATCH_BYTES
    ? `${patchOutput.slice(0, MAX_PATCH_BYTES)}\n\n[checkpoint patch truncated]\n`
    : patchOutput;
  return {
    repositoryRoot,
    status: {
      branch: branchOutput.trim(),
      files,
      clean: files.length === 0,
    },
    patch,
    truncated: patchOutput.length > MAX_PATCH_BYTES,
  };
}

function rowToCheckpoint(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id || '',
    provider: row.provider || 'claude',
    projectName: row.project_name || '',
    projectPath: row.project_path || '',
    repositoryRoot: row.repository_root || '',
    profileKind: row.profile_kind || '',
    permissionPreset: row.permission_preset || '',
    permissionMode: row.permission_mode || '',
    beforeStatus: parseJson(row.before_status_json, null),
    afterStatus: parseJson(row.after_status_json, null),
    patch: row.patch || '',
    files: parseJson(row.files_json, []),
    toolCalls: parseJson(row.tool_calls_json, []),
    metadata: parseJson(row.metadata_json, {}),
    rollbackStatus: row.rollback_status || 'available',
    rollbackError: row.rollback_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

export function createSessionCheckpointService({
  db = defaultDb,
  captureState = captureGitState,
} = {}) {
  const getCheckpoint = (id) => rowToCheckpoint(
    db.prepare('SELECT * FROM session_checkpoints WHERE id = ?').get(id),
  );

  const listCheckpoints = ({ sessionId = '', provider = 'claude', projectName = '', limit = 50 } = {}) => {
    const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = db.prepare(`
      SELECT * FROM session_checkpoints
      WHERE (? = '' OR session_id = ?)
        AND (? = '' OR provider = ?)
        AND (? = '' OR project_name = ?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, sessionId, provider, provider, projectName, projectName, cappedLimit);
    return rows.map(rowToCheckpoint);
  };

  const startCheckpoint = async ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    projectPath = '',
    profileKind = '',
    permissionPreset = '',
    permissionMode = '',
    metadata = {},
  } = {}) => {
    const id = createId();
    let before = null;
    let repositoryRoot = '';
    let rollbackStatus = 'available';
    let rollbackError = '';

    try {
      if (projectPath) {
        before = await captureState(projectPath);
        repositoryRoot = before.repositoryRoot;
        if (!before.status.clean) {
          rollbackStatus = 'blocked_dirty_start';
          rollbackError = 'Checkpoint started with existing local changes; rollback is disabled to avoid overwriting unrelated work.';
        }
      } else {
        rollbackStatus = 'not_available';
        rollbackError = 'Project path is not available.';
      }
    } catch (error) {
      rollbackStatus = 'not_git';
      rollbackError = error?.stderr || error?.message || 'Project is not a git work tree.';
    }

    db.prepare(`
      INSERT INTO session_checkpoints (
        id, session_id, provider, project_name, project_path, repository_root,
        profile_kind, permission_preset, permission_mode, before_status_json,
        rollback_status, rollback_error, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId || null,
      provider || 'claude',
      projectName || null,
      projectPath || null,
      repositoryRoot || null,
      profileKind || null,
      permissionPreset || null,
      permissionMode || null,
      safeJson(before?.status || null),
      rollbackStatus,
      rollbackError || null,
      safeJson(metadata),
    );

    return getCheckpoint(id);
  };

  const completeCheckpoint = async (id, {
    toolCalls = [],
    metadata = {},
  } = {}) => {
    const checkpoint = getCheckpoint(id);
    if (!checkpoint) {
      return null;
    }

    let after = null;
    let patch = '';
    let files = [];
    let rollbackStatus = checkpoint.rollbackStatus;
    let rollbackError = checkpoint.rollbackError;

    try {
      if (checkpoint.projectPath && checkpoint.rollbackStatus !== 'not_git') {
        after = await captureState(checkpoint.projectPath);
        patch = after.patch;
        files = after.status.files;
        if (!patch.trim() && rollbackStatus === 'available') {
          rollbackStatus = 'empty';
        }
        if (after.truncated && rollbackStatus === 'available') {
          rollbackStatus = 'not_available';
          rollbackError = 'Patch was truncated and cannot be rolled back safely.';
        }
      }
    } catch (error) {
      rollbackStatus = 'not_git';
      rollbackError = error?.stderr || error?.message || 'Project is not a git work tree.';
    }

    db.prepare(`
      UPDATE session_checkpoints
      SET after_status_json = ?,
          patch = ?,
          files_json = ?,
          tool_calls_json = ?,
          metadata_json = ?,
          rollback_status = ?,
          rollback_error = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      safeJson(after?.status || null),
      patch || null,
      safeJson(files),
      safeJson(Array.isArray(toolCalls) ? toolCalls : []),
      safeJson({ ...(checkpoint.metadata || {}), ...(metadata || {}) }),
      rollbackStatus,
      rollbackError || null,
      id,
    );

    return getCheckpoint(id);
  };

  const rollbackCheckpoint = async (id) => {
    const checkpoint = getCheckpoint(id);
    if (!checkpoint) {
      const error = new Error('Checkpoint not found');
      error.statusCode = 404;
      throw error;
    }
    if (checkpoint.rollbackStatus !== 'available') {
      const error = new Error(checkpoint.rollbackError || `Checkpoint rollback is ${checkpoint.rollbackStatus}.`);
      error.statusCode = 409;
      throw error;
    }
    if (!checkpoint.repositoryRoot || !checkpoint.patch.trim()) {
      const error = new Error('Checkpoint has no rollback patch.');
      error.statusCode = 400;
      throw error;
    }

    const current = await captureState(checkpoint.repositoryRoot);
    if (current.patch !== checkpoint.patch) {
      db.prepare(`
        UPDATE session_checkpoints
        SET rollback_status = 'conflict', rollback_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run('Current worktree diff no longer matches the checkpoint patch.', id);
      const error = new Error('Current worktree diff no longer matches the checkpoint patch.');
      error.statusCode = 409;
      error.details = {
        currentFiles: current.status.files,
        checkpointFiles: checkpoint.files,
      };
      throw error;
    }

    await spawnGit(['apply', '-R', '--whitespace=nowarn', '-'], {
      cwd: checkpoint.repositoryRoot,
      input: checkpoint.patch,
    });
    db.prepare(`
      UPDATE session_checkpoints
      SET rollback_status = 'rolled_back', rollback_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
    return getCheckpoint(id);
  };

  return {
    completeCheckpoint,
    getCheckpoint,
    listCheckpoints,
    rollbackCheckpoint,
    startCheckpoint,
  };
}

export const sessionCheckpointService = createSessionCheckpointService();

export const startSessionCheckpoint = (...args) => sessionCheckpointService.startCheckpoint(...args);
export const completeSessionCheckpoint = (...args) => sessionCheckpointService.completeCheckpoint(...args);
export const getSessionCheckpoint = (...args) => sessionCheckpointService.getCheckpoint(...args);
export const listSessionCheckpoints = (...args) => sessionCheckpointService.listCheckpoints(...args);
export const rollbackSessionCheckpoint = (...args) => sessionCheckpointService.rollbackCheckpoint(...args);
