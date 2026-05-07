import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import {
  clearSessionGoal,
  getSessionGoal,
  pauseSessionGoal,
  replaceSessionGoal,
  resumeSessionGoal,
  setSessionGoalStorePathForTests,
} from '../session-goal-service.js';

test('session goal service creates, reads, pauses, resumes, and clears goals', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  try {
    setSessionGoalStorePathForTests(join(tempDir, 'thread-goals.json'));

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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('session goal service validates objective and budget', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'argus-session-goals-'));
  try {
    setSessionGoalStorePathForTests(join(tempDir, 'thread-goals.json'));

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
