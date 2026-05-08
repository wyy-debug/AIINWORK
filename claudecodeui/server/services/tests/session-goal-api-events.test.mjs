import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('session goal REST mutations return and broadcast ordered goal events', async () => {
  const source = await readFile(join(repoRoot, 'index.js'), 'utf8');

  expect(source).toContain('thread_goal_updated');
  expect(source).toContain('thread_goal_cleared');
  expect(source).toContain('broadcastGoalEvent');
  expect(source).toContain('startGoalEventPoller');
  expect(source).toContain("event: 'thread_goal_updated'");
  expect(source).toContain("event: 'thread_goal_cleared'");
});

test('Claude normalizer forwards runtime thread goal system events', async () => {
  const source = await readFile(join(repoRoot, 'modules/providers/list/claude/claude-sessions.provider.ts'), 'utf8');

  expect(source).toContain("raw.subtype === 'thread_goal_updated'");
  expect(source).toContain("raw.subtype === 'thread_goal_cleared'");
  expect(source).toContain("raw.subtype === 'thread_goal_lifecycle'");
  expect(source).toContain('eventId');
  expect(source).toContain('lifecycleType');
});
