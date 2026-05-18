import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

export const CHECKPOINTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_path TEXT NOT NULL,
  phase TEXT NOT NULL,
  turn_id TEXT,
  before_checkpoint_id TEXT,
  profile_kind TEXT,
  permission_preset TEXT,
  branch TEXT,
  head_sha TEXT,
  is_git_repo INTEGER NOT NULL DEFAULT 0,
  rollback_available INTEGER NOT NULL DEFAULT 0,
  has_changes INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  diff TEXT,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const CHECKPOINTS_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session
  ON agent_checkpoints(session_id, provider, created_at);`;

export const CHECKPOINTS_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_project
  ON agent_checkpoints(project_path, created_at);`;

function runGit(args, { cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`Command failed: git ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

function validateProjectPath(projectPath) {
  const value = typeof projectPath === 'string' ? projectPath.trim() : '';
  if (!value || value.includes('\0')) {
    throw new Error('Invalid project path');
  }
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) {
    throw new Error('Invalid project path');
  }
  return resolved;
}

async function isInsideGitWorkTree(projectPath) {
  try {
    const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: projectPath });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function getCurrentBranch(projectPath) {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--short', 'HEAD'], { cwd: projectPath });
    return stdout.trim();
  } catch {
    try {
      const { stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath });
      return stdout.trim();
    } catch {
      return '';
    }
  }
}

async function getHeadSha(projectPath) {
  try {
    const { stdout } = await runGit(['rev-parse', 'HEAD'], { cwd: projectPath });
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function captureGitSnapshot(projectPath) {
  const resolvedProjectPath = validateProjectPath(projectPath);
  const isGitRepo = await isInsideGitWorkTree(resolvedProjectPath);

  if (!isGitRepo) {
    return {
      isGitRepo: false,
      rollbackAvailable: false,
      projectPath: resolvedProjectPath,
      branch: '',
      headSha: '',
      status: '',
      diff: '',
      hasChanges: false,
    };
  }

  const [{ stdout: status }, { stdout: diff }, branch, headSha] = await Promise.all([
    runGit(['status', '--porcelain=v1'], { cwd: resolvedProjectPath }),
    runGit(['diff', '--binary', 'HEAD', '--'], { cwd: resolvedProjectPath }),
    getCurrentBranch(resolvedProjectPath),
    getHeadSha(resolvedProjectPath),
  ]);

  return {
    isGitRepo: true,
    rollbackAvailable: true,
    projectPath: resolvedProjectPath,
    branch,
    headSha,
    status: status.trimEnd(),
    diff,
    hasChanges: Boolean(status.trim() || diff.trim()),
  };
}

export async function rollbackCheckpointPatch({ projectPath, patch, expectedCurrentPatch }) {
  const resolvedProjectPath = validateProjectPath(projectPath);
  const safePatch = typeof patch === 'string' ? patch : '';
  if (!safePatch.trim()) {
    return { success: false, reason: 'empty_patch' };
  }

  const currentSnapshot = await captureGitSnapshot(resolvedProjectPath);
  if (!currentSnapshot.isGitRepo) {
    return { success: false, reason: 'not_git_repository' };
  }

  if (typeof expectedCurrentPatch === 'string' && currentSnapshot.diff !== expectedCurrentPatch) {
    return { success: false, reason: 'workspace_changed' };
  }

  try {
    await runGit(['apply', '-R', '--check'], { cwd: resolvedProjectPath, input: safePatch });
    await runGit(['apply', '-R'], { cwd: resolvedProjectPath, input: safePatch });
    const snapshot = await captureGitSnapshot(resolvedProjectPath);
    return { success: true, snapshot };
  } catch (error) {
    return {
      success: false,
      reason: 'patch_rejected',
      error: error?.stderr || error?.message || 'Rollback patch rejected',
    };
  }
}

function ensureCheckpointSchema(database) {
  database.exec(CHECKPOINTS_TABLE_SQL);
  database.exec(CHECKPOINTS_SESSION_INDEX_SQL);
  database.exec(CHECKPOINTS_PROJECT_INDEX_SQL);
}

function parseMetadata(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function mapCheckpointRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    provider: row.provider,
    projectPath: row.project_path,
    phase: row.phase,
    turnId: row.turn_id || null,
    beforeCheckpointId: row.before_checkpoint_id || null,
    profileKind: row.profile_kind || null,
    permissionPreset: row.permission_preset || null,
    branch: row.branch || '',
    headSha: row.head_sha || '',
    isGitRepo: row.is_git_repo === 1,
    rollbackAvailable: row.rollback_available === 1,
    hasChanges: row.has_changes === 1,
    status: row.status || '',
    diff: row.diff || '',
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  };
}

function normalizeProvider(provider) {
  const value = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  return value || 'claude';
}

function normalizePhase(phase) {
  const value = typeof phase === 'string' ? phase.trim().toLowerCase() : '';
  return value === 'after' ? 'after' : 'before';
}

function normalizeOptionalText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function createId() {
  return `ckpt_${crypto.randomUUID()}`;
}

async function applyPatch(projectPath, patch, reverse = false) {
  const safePatch = typeof patch === 'string' ? patch : '';
  if (!safePatch.trim()) return;
  const args = reverse ? ['apply', '-R'] : ['apply'];
  await runGit([...args, '--check'], { cwd: projectPath, input: safePatch });
  await runGit(args, { cwd: projectPath, input: safePatch });
}

async function rollbackToCheckpointPair(afterCheckpoint, beforeCheckpoint) {
  const currentSnapshot = await captureGitSnapshot(afterCheckpoint.projectPath);
  if (!currentSnapshot.isGitRepo) {
    return { success: false, reason: 'not_git_repository' };
  }
  if (currentSnapshot.diff !== afterCheckpoint.diff) {
    return { success: false, reason: 'workspace_changed' };
  }

  try {
    await applyPatch(afterCheckpoint.projectPath, afterCheckpoint.diff, true);
    if (beforeCheckpoint?.diff?.trim()) {
      await applyPatch(afterCheckpoint.projectPath, beforeCheckpoint.diff, false);
    }
    return {
      success: true,
      snapshot: await captureGitSnapshot(afterCheckpoint.projectPath),
      restoredToCheckpointId: beforeCheckpoint?.id || null,
    };
  } catch (error) {
    return {
      success: false,
      reason: 'patch_rejected',
      error: error?.stderr || error?.message || 'Rollback patch rejected',
    };
  }
}

export function createCheckpointStore(database) {
  ensureCheckpointSchema(database);

  const getCheckpoint = (id) => mapCheckpointRow(
    database.prepare('SELECT * FROM agent_checkpoints WHERE id = ?').get(id),
  );

  return {
    async createCheckpoint({
      sessionId,
      provider = 'claude',
      projectPath,
      phase = 'before',
      turnId = null,
      beforeCheckpointId = null,
      runtimeContext = {},
      metadata = {},
    }) {
      const safeSessionId = normalizeOptionalText(sessionId);
      if (!safeSessionId) {
        throw new Error('sessionId is required to create a checkpoint');
      }

      const snapshot = await captureGitSnapshot(projectPath);
      const id = createId();
      const profileKind = normalizeOptionalText(runtimeContext?.profileKind);
      const permissionPreset = normalizeOptionalText(runtimeContext?.permissionPreset);
      database.prepare(`
        INSERT INTO agent_checkpoints (
          id,
          session_id,
          provider,
          project_path,
          phase,
          turn_id,
          before_checkpoint_id,
          profile_kind,
          permission_preset,
          branch,
          head_sha,
          is_git_repo,
          rollback_available,
          has_changes,
          status,
          diff,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        safeSessionId,
        normalizeProvider(provider),
        snapshot.projectPath,
        normalizePhase(phase),
        normalizeOptionalText(turnId),
        normalizeOptionalText(beforeCheckpointId),
        profileKind,
        permissionPreset,
        snapshot.branch,
        snapshot.headSha,
        snapshot.isGitRepo ? 1 : 0,
        snapshot.rollbackAvailable ? 1 : 0,
        snapshot.hasChanges ? 1 : 0,
        snapshot.status,
        snapshot.diff,
        JSON.stringify(metadata || {}),
      );
      return getCheckpoint(id);
    },

    getCheckpoint,

    getCheckpointDiff(id) {
      const checkpoint = getCheckpoint(id);
      return checkpoint ? checkpoint.diff : null;
    },

    deleteCheckpoint(id) {
      const result = database.prepare('DELETE FROM agent_checkpoints WHERE id = ?').run(id);
      return result.changes > 0;
    },

    listCheckpoints({ sessionId, projectPath, provider, limit = 100 } = {}) {
      const conditions = [];
      const values = [];
      if (sessionId) {
        conditions.push('session_id = ?');
        values.push(String(sessionId));
      }
      if (projectPath) {
        conditions.push('project_path = ?');
        values.push(validateProjectPath(projectPath));
      }
      if (provider) {
        conditions.push('provider = ?');
        values.push(normalizeProvider(provider));
      }
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = database.prepare(`
        SELECT * FROM agent_checkpoints
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(...values, safeLimit);
      return rows.map(mapCheckpointRow);
    },

    async rollbackCheckpoint(id) {
      const checkpoint = getCheckpoint(id);
      if (!checkpoint) {
        return { success: false, reason: 'not_found' };
      }
      if (!checkpoint.rollbackAvailable) {
        return { success: false, reason: checkpoint.isGitRepo ? 'rollback_unavailable' : 'not_git_repository' };
      }
      const beforeCheckpoint = checkpoint.beforeCheckpointId
        ? getCheckpoint(checkpoint.beforeCheckpointId)
        : null;

      if (checkpoint.phase === 'after' && beforeCheckpoint) {
        return rollbackToCheckpointPair(checkpoint, beforeCheckpoint);
      }

      return rollbackCheckpointPatch({
        projectPath: checkpoint.projectPath,
        patch: checkpoint.diff,
        expectedCurrentPatch: checkpoint.diff,
      });
    },
  };
}
