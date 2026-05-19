import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

import {
  captureGitSnapshot,
  createCheckpointStore,
  rollbackCheckpointPatch,
} from '../checkpoint-service.js';

async function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
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
      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function createRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-checkpoint-'));
  await run('git', ['init'], root);
  await run('git', ['config', 'core.autocrlf', 'false'], root);
  await run('git', ['config', 'user.email', 'test@example.com'], root);
  await run('git', ['config', 'user.name', 'Test User'], root);
  await fs.writeFile(path.join(root, 'note.txt'), 'before\n', 'utf8');
  await run('git', ['add', 'note.txt'], root);
  await run('git', ['commit', '-m', 'initial'], root);
  return root;
}

describe('checkpoint service', () => {
  let tempDirs = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('captures a git snapshot with status and binary-safe diff', async () => {
    const repo = await createRepo();
    tempDirs.push(repo);
    await fs.writeFile(path.join(repo, 'note.txt'), 'before\nafter\n', 'utf8');

    const snapshot = await captureGitSnapshot(repo);

    expect(snapshot.isGitRepo).toBe(true);
    expect(snapshot.rollbackAvailable).toBe(true);
    expect(snapshot.hasChanges).toBe(true);
    expect(snapshot.branch).toBeTruthy();
    expect(snapshot.status).toContain('M note.txt');
    expect(snapshot.diff).toContain('+after');
  });

  it('rolls back a checkpoint patch only when the current diff matches the checkpoint', async () => {
    const repo = await createRepo();
    tempDirs.push(repo);
    const filePath = path.join(repo, 'note.txt');
    await fs.writeFile(filePath, 'before\nafter\n', 'utf8');
    const snapshot = await captureGitSnapshot(repo);

    const result = await rollbackCheckpointPatch({
      projectPath: repo,
      patch: snapshot.diff,
      expectedCurrentPatch: snapshot.diff,
    });

    expect(result.success).toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe('before\n');
    expect((await captureGitSnapshot(repo)).hasChanges).toBe(false);
  }, 30000);

  it('refuses rollback when the workspace moved past the checkpoint diff', async () => {
    const repo = await createRepo();
    tempDirs.push(repo);
    const filePath = path.join(repo, 'note.txt');
    await fs.writeFile(filePath, 'before\nafter\n', 'utf8');
    const snapshot = await captureGitSnapshot(repo);
    await fs.writeFile(filePath, 'before\nafter\nlater\n', 'utf8');

    const result = await rollbackCheckpointPatch({
      projectPath: repo,
      patch: snapshot.diff,
      expectedCurrentPatch: snapshot.diff,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('workspace_changed');
    expect(await fs.readFile(filePath, 'utf8')).toBe('before\nafter\nlater\n');
  });

  it('marks non-git project snapshots as non-rollbackable', async () => {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-checkpoint-no-git-'));
    tempDirs.push(project);
    await fs.writeFile(path.join(project, 'plain.txt'), 'hello\n', 'utf8');

    const snapshot = await captureGitSnapshot(project);

    expect(snapshot.isGitRepo).toBe(false);
    expect(snapshot.rollbackAvailable).toBe(false);
    expect(snapshot.hasChanges).toBe(false);
    expect(snapshot.diff).toBe('');
  });

  it('persists before and after checkpoints with runtime metadata', async () => {
    const repo = await createRepo();
    tempDirs.push(repo);
    const database = new Database(':memory:');
    const store = createCheckpointStore(database);
    const turnId = 'turn-1';

    const before = await store.createCheckpoint({
      sessionId: 'session-1',
      provider: 'codex',
      projectPath: repo,
      phase: 'before',
      turnId,
      runtimeContext: {
        profileKind: 'build',
        permissionPreset: 'auto-edit',
      },
      metadata: { commandType: 'codex-command' },
    });
    await fs.writeFile(path.join(repo, 'note.txt'), 'before\nafter\n', 'utf8');
    const after = await store.createCheckpoint({
      sessionId: 'session-1',
      provider: 'codex',
      projectPath: repo,
      phase: 'after',
      turnId,
      beforeCheckpointId: before.id,
      runtimeContext: {
        profileKind: 'build',
        permissionPreset: 'auto-edit',
      },
      metadata: { commandType: 'codex-command' },
    });

    expect(after.beforeCheckpointId).toBe(before.id);
    expect(after.profileKind).toBe('build');
    expect(after.permissionPreset).toBe('auto-edit');
    expect(after.diff).toContain('+after');
    expect(store.listCheckpoints({ sessionId: 'session-1', projectPath: repo })).toHaveLength(2);
    database.close();
  });

  it('rolls back an after checkpoint to the matching before checkpoint state', async () => {
    const repo = await createRepo();
    tempDirs.push(repo);
    const filePath = path.join(repo, 'note.txt');
    const database = new Database(':memory:');
    const store = createCheckpointStore(database);

    await fs.writeFile(filePath, 'before\nuser-change\n', 'utf8');
    const before = await store.createCheckpoint({
      sessionId: 'session-1',
      provider: 'codex',
      projectPath: repo,
      phase: 'before',
      turnId: 'turn-rollback',
    });
    await fs.writeFile(filePath, 'before\nuser-change\nagent-change\n', 'utf8');
    const after = await store.createCheckpoint({
      sessionId: 'session-1',
      provider: 'codex',
      projectPath: repo,
      phase: 'after',
      turnId: 'turn-rollback',
      beforeCheckpointId: before.id,
    });

    const result = await store.rollbackCheckpoint(after.id);

    expect(result.success).toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe('before\nuser-change\n');
    database.close();
  }, 30000);

  it('discards checkpoint records without changing workspace files', async () => {
    const repo = await createRepo();
    tempDirs.push(repo);
    const filePath = path.join(repo, 'note.txt');
    const database = new Database(':memory:');
    const store = createCheckpointStore(database);
    await fs.writeFile(filePath, 'before\nafter\n', 'utf8');

    const checkpoint = await store.createCheckpoint({
      sessionId: 'session-1',
      provider: 'codex',
      projectPath: repo,
      phase: 'after',
      turnId: 'turn-discard',
    });

    expect(store.deleteCheckpoint(checkpoint.id)).toBe(true);
    expect(store.getCheckpoint(checkpoint.id)).toBeNull();
    expect(await fs.readFile(filePath, 'utf8')).toBe('before\nafter\n');
    database.close();
  });
});
