import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'ChatInterface.tsx');

test('ChatInterface refreshes goal state from websocket goal events for the active session', async () => {
  const source = await readFile(sourcePath, 'utf8');

  expect(source).toContain('thread_goal_updated');
  expect(source).toContain('thread_goal_cleared');
  expect(source).toContain('activeConversationSessionId');
  expect(source).toContain('setSessionGoal(msg.goal || null)');
  expect(source).toContain('setSessionGoal(null)');
});

test('ChatInterface queues a new conversation goal until a real session id exists', async () => {
  const source = await readFile(sourcePath, 'utf8');

  expect(source).toContain('const [draftSessionGoal, setDraftSessionGoal]');
  expect(source).toContain('setDraftSessionGoal({ objective: objective.trim(), tokenBudget: normalizedTokenBudget });');
  expect(source).toContain('if (!activeConversationSessionId || !draftSessionGoal)');
  expect(source).toContain('api.setSessionGoal(activeConversationSessionId, {');
});
