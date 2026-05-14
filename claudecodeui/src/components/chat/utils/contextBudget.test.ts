import { describe, expect, it } from 'vitest';

import { normalizeContextBudget } from './contextBudget';

describe('normalizeContextBudget', () => {
  it('treats legacy flat usage as cumulative-only data', () => {
    const budget = normalizeContextBudget({
      used: 257_100,
      total: 200_000,
    });

    expect(budget).not.toBeNull();
    expect(budget?.window.source).toBe('legacy');
    expect(budget?.current.used).toBe(0);
    expect(budget?.current.percent).toBe(0);
    expect(budget?.cumulative.used).toBe(257_100);
    expect(budget?.cumulative.total).toBe(200_000);
  });
});
