import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { SESSION_CHECKPOINTS_TABLE_SQL } from '../../database/schema.js';
import { createSessionCheckpointService } from '../session-checkpoint-service.js';

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `git ${args.join(' ')} failed`));
    });
  });
}

describe('session checkpoint service', () => {
  const dbs = [];
  const roots = [];

  afterEach(async () => {
    while (dbs.length) dbs.pop().close();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createGitProject() {
    const root = await mkdtemp(join(tmpdir(), 'argus-checkpoint-'));
    roots.push(root);
    await git(['init'], root);
    await git(['config', 'user.email', 'test@example.com'], root);
    await git(['config', 'user.name', 'Test User'], root);
    await writeFile(join(root, 'README.md'), 'hello\n', 'utf8');
    await git(['add', 'README.md'], root);
    await git(['commit', '-m', 'initial'], root);
    return root;
  }

  function createService() {
    const db = new Database(':memory:');
    dbs.push(db);
    db.exec(SESSION_CHECKPOINTS_TABLE_SQL);
    return createSessionCheckpointService({ db });
  }

  it('captures before and after state and safely rolls back by reversing the stored patch', async () => {
    const root = await createGitProject();
    const service = createService();

    const checkpoint = await service.startCheckpoint({
      sessionId: 'session-1',
      provider: 'claude',
      projectName: 'App',
      projectPath: root,
      profileKind: 'build',
      permissionPreset: 'auto-edit',
      permissionMode: 'acceptEdits',
    });
    await writeFile(join(root, 'README.md'), 'hello\nchanged\n', 'utf8');
    const completed = await service.completeCheckpoint(checkpoint.id, {
      toolCalls: [{ kind: 'tool_use', toolName: 'Edit', filePath: 'README.md' }],
    });

    expect(completed.rollbackStatus).toBe('available');
    expect(completed.patch).toContain('changed');
    expect(completed.files.map((file) => file.path)).toContain('README.md');

    const rolledBack = await service.rollbackCheckpoint(checkpoint.id);
    expect(rolledBack.rollbackStatus).toBe('rolled_back');
    const restored = await readFile(join(root, 'README.md'), 'utf8');
    expect(restored.replace(/\r\n/g, '\n')).toBe('hello\n');
  });

  it('blocks rollback when a checkpoint starts from a dirty worktree', async () => {
    const root = await createGitProject();
    const service = createService();

    await writeFile(join(root, 'README.md'), 'dirty before start\n', 'utf8');
    const checkpoint = await service.startCheckpoint({ sessionId: 'session-2', projectPath: root });

    expect(checkpoint.rollbackStatus).toBe('blocked_dirty_start');
    await expect(service.rollbackCheckpoint(checkpoint.id)).rejects.toThrow(/existing local changes|blocked_dirty_start/i);
  });
});
