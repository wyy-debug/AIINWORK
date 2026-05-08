import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'ChatComposer.tsx');

test('ChatComposer goal controls use readable labels and budget text', async () => {
  const source = await readFile(sourcePath, 'utf8');

  expect(source).toContain('设置本会话 Goal');
  expect(source).toContain('Token 预算，可留空');
  expect(source).toContain('剩余 {activeGoalRemainingTokens}');
  expect(source).toContain('恢复 Goal');
  expect(source).toContain('设置本会话持久 Goal');
});
