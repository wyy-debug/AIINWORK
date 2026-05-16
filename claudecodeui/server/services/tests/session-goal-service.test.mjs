import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import {
  clearSessionGoal,
  getSessionGoal,
  listSessionGoalEventsAfter,
  pauseSessionGoal,
  replaceSessionGoal,
  resumeSessionGoal,
  setSessionGoalLegacyStorePathForTests,
  setSessionGoalStorePathForTests,
} from '../session-goal-service.js';

const holdSqliteWriteLock = (dbPath, holdMs = 120) => new Promise((resolve, reject) => {
  const worker = new Worker(`
    const { parentPort, workerData } = await import('node:worker_threads');
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(workerData.dbPath);
    if (workerData.useWal) {
      db.pragma('journal_mode = WAL');
    }
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
    if (workerData.touchSchema) {
      db.exec('CREATE TABLE IF NOT EXISTS thread_goal_lock_probe (id INTEGER PRIMARY KEY)');
      db.prepare('INSERT INTO thread_goal_lock_probe DEFAULT VALUES').run();
    }
    parentPort.postMessage('locked');
    setTimeout(() => {
      try {
        db.exec('COMMIT');
        db.close();
        parentPort.postMessage('released');
      } catch (error) {
        parentPort.postMessage({ error: error.message });
      }
    }, workerData.holdMs);
  `, {
    eval: true,
    type: 'module',
    workerData: {
      dbPath,
      holdMs,
      touchSchema: true,
      useWal: true,
    },
  });
  let settled = false;
  worker.on('message', (message) => {
    if (message === 'locked' && !settled) {
      settled = true;
      resolve(worker);
    } else if (message?.error && !settled) {
      settled = true;
      reject(new Error(message.error));
    }
  });
  worker.on('error', (error) => {
    if (!settled) {
      settled = true;
      reject(error);
    }
  });
  worker.on('exit', (code) => {
    if (!settled && code !== 0) {
      settled = true;
      reject(new Error(`SQLite lock worker exited with code ${code}`));
    }
  });
});

const createMinimalGoalEventsDb = (dbPath) => {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE thread_goal_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        goal_id TEXT,
        event_type TEXT NOT NULL,
        lifecycle_type TEXT,
        goal_json TEXT,
        payload_json TEXT,
        created_at_ms INTEGER NOT NULL
      );
      INSERT INTO thread_goal_events(thread_id, event_type, created_at_ms)
      VALUES ('session-locked', 'thread_goal_cleared', 1);
    `);
  } finally {
    db.close();
  }
};

test('session goal service creates, reads, pauses, resumes, and clears goals', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  try {
    const dbPath = join(tempDir, 'thread-goals.db');
    setSessionGoalStorePathForTests(dbPath);

    const created = await replaceSessionGoal('session-1', {
      objective: 'Keep working until the migration is done',
      tokenBudget: 2000,
    });
    expect(created.status).toBe('active');
    expect(created.objective).toBe('Keep working until the migration is done');
    expect(created.tokenBudget).toBe(2000);

    expect((await getSessionGoal('session-1')).goalId).toBe(created.goalId);
    expect((await pauseSessionGoal('session-1')).status).toBe('paused');
    expect((await resumeSessionGoal('session-1')).status).toBe('active');

    await clearSessionGoal('session-1');
    expect(await getSessionGoal('session-1')).toBeNull();

    const db = new Database(dbPath, { readonly: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_goals'").get();
      expect(table?.name).toBe('thread_goals');
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('session goal service validates objective and budget', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  try {
    setSessionGoalStorePathForTests(join(tempDir, 'thread-goals.db'));

    await expect(
      () => replaceSessionGoal('session-1', { objective: '   ' }),
    ).rejects.toThrow(/objective/i);
    await expect(
      () => replaceSessionGoal('session-1', {
        objective: 'Budget validation',
        tokenBudget: 0,
      }),
    ).rejects.toThrow(/token budget/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('session goal service imports legacy JSON once when SQLite is empty', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  try {
    const dbPath = join(tempDir, 'thread-goals.db');
    const legacyPath = join(tempDir, 'thread-goals.json');
    setSessionGoalStorePathForTests(dbPath);
    setSessionGoalLegacyStorePathForTests(legacyPath);

    await writeFile(
      legacyPath,
      JSON.stringify({
        version: 1,
        goals: {
          'session-legacy': {
            threadId: 'session-legacy',
            goalId: 'legacy-goal',
            objective: 'Finish from old JSON',
            status: 'paused',
            tokenBudget: 1234,
            tokensUsed: 99,
            timeUsedSeconds: 8,
            createdAtMs: 10,
            updatedAtMs: 20,
          },
        },
      }),
      'utf8',
    );

    const imported = await getSessionGoal('session-legacy');
    expect(imported).toMatchObject({
      goalId: 'legacy-goal',
      objective: 'Finish from old JSON',
      status: 'paused',
      tokenBudget: 1234,
      tokensUsed: 99,
      timeUsedSeconds: 8,
    });

    const replaced = await replaceSessionGoal('session-legacy', {
      objective: 'SQLite is source of truth',
    });
    await writeFile(
      legacyPath,
      JSON.stringify({
        version: 1,
        goals: {
          'session-legacy': {
            threadId: 'session-legacy',
            goalId: 'stale-legacy-goal',
            objective: 'Do not resurrect this',
            status: 'active',
          },
        },
      }),
      'utf8',
    );

    expect((await getSessionGoal('session-legacy')).goalId).toBe(replaced.goalId);
    expect((await getSessionGoal('session-legacy')).objective).toBe('SQLite is source of truth');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('session goal service rejects stale expectedGoalId updates without mutating current goal', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  try {
    setSessionGoalStorePathForTests(join(tempDir, 'thread-goals.db'));

    const created = await replaceSessionGoal('session-1', {
      objective: 'CAS protected goal',
    });

    await expect(
      () => pauseSessionGoal('session-1', { expectedGoalId: 'older-goal' }),
    ).rejects.toThrow(/stale|expected goal/i);

    expect(await getSessionGoal('session-1')).toMatchObject({
      goalId: created.goalId,
      status: 'active',
    });

    expect((await pauseSessionGoal('session-1', { expectedGoalId: created.goalId })).status).toBe('paused');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('session goal service records ordered mutation events for pollers', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  try {
    const dbPath = join(tempDir, 'thread-goals.db');
    setSessionGoalStorePathForTests(dbPath);

    const created = await replaceSessionGoal('session-events', {
      objective: 'Broadcast this',
    });
    await pauseSessionGoal('session-events', { expectedGoalId: created.goalId });
    await clearSessionGoal('session-events');

    const events = await listSessionGoalEventsAfter(0);
    expect(events.map((event) => event.eventType)).toEqual([
      'thread_goal_updated',
      'thread_goal_updated',
      'thread_goal_cleared',
    ]);
    expect(events[0].eventId).toBeLessThan(events[1].eventId);
    expect(events[1].eventId).toBeLessThan(events[2].eventId);
    expect(events[0].goal.goalId).toBe(created.goalId);
    expect(events[2].goal).toBeNull();

    const db = new Database(dbPath, { readonly: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_goal_events'").get();
      expect(table?.name).toBe('thread_goal_events');
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('session goal event polling fails fast instead of blocking on long SQLite writer locks', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  let worker = null;
  try {
    const dbPath = join(tempDir, 'thread-goals.db');
    createMinimalGoalEventsDb(dbPath);
    setSessionGoalStorePathForTests(dbPath);

    worker = await holdSqliteWriteLock(dbPath, 10_000);
    const startedAt = Date.now();

    await expect(listSessionGoalEventsAfter(0)).rejects.toThrow(/database is locked/i);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  } finally {
    if (worker) {
      await worker.terminate();
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
