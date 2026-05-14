import { expect, test } from 'vitest';

import {
  buildContextBudgetFromFlatUsage,
  CONTEXT_BUDGET_WINDOW_SOURCES,
} from '../context-budget-service.js';

test('buildContextBudgetFromFlatUsage preserves cumulative-only usage without inventing current context', async () => {
  const budget = await buildContextBudgetFromFlatUsage({
    currentBreakdown: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    cumulativeBreakdown: { input: 298_400, output: 0, cacheRead: 0, cacheCreation: 0 },
    total: 1_000_000,
    modelProfileId: 'gpt5-prod',
    windowSource: CONTEXT_BUDGET_WINDOW_SOURCES.CUMULATIVE_ONLY,
  });

  expect(budget.current.used).toBe(0);
  expect(budget.current.percent).toBe(0);
  expect(budget.cumulative.used).toBe(298_400);
  expect(budget.window.tokens).toBe(1_000_000);
  expect(budget.window.source).toBe(CONTEXT_BUDGET_WINDOW_SOURCES.CUMULATIVE_ONLY);
});
