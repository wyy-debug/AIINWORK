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

  it('treats cumulative_only envelopes as backend-authoritative but not current-context data', () => {
    const budget = normalizeContextBudget({
      contextBudget: {
        current: {
          used: 0,
          total: 1_000_000,
          percent: 0,
          breakdown: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
        cumulative: {
          used: 298_400,
          total: 1_000_000,
          percent: 29.84,
          breakdown: { input: 298_400, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
        window: {
          tokens: 1_000_000,
          model: 'gpt-5',
          modelProfileId: 'gpt5-prod',
          source: 'cumulative_only',
        },
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    expect(budget?.window.tokens).toBe(1_000_000);
    expect(budget?.window.source).toBe('cumulative_only');
    expect(budget?.current.used).toBe(0);
    expect(budget?.cumulative.used).toBe(298_400);
  });
});
