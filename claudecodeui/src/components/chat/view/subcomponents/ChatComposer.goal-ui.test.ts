import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'ChatComposer.tsx');

test('ChatComposer keeps the session Goal button clickable while assistant output is loading', async () => {
  const source = await readFile(sourcePath, 'utf8');
  const goalButtonBlock = source.slice(
    source.indexOf('content: goalsEnabled'),
    source.indexOf('<TargetIcon />'),
  );

  expect(goalButtonBlock).toContain('disabled={!goalsEnabled}');
  expect(goalButtonBlock).not.toContain('disabled={isLoading || !goalsEnabled}');
});

test('ChatComposer opens an inline Goal editor instead of relying on native prompts', async () => {
  const source = await readFile(sourcePath, 'utf8');

  expect(source).toContain('isGoalEditorOpen');
  expect(source).toContain('goalObjectiveDraft');
  expect(source).toContain('goalBudgetDraft');
  expect(source).not.toContain('window.prompt');
  expect(source).toContain('剩余 {activeGoalRemainingTokens}');
  expect(source).toContain('恢复 Goal');
  expect(source).toContain('设置本会话持久 Goal');
});
