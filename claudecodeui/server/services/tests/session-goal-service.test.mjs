import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
