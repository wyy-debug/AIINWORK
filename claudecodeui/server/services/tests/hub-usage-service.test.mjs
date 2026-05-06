import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  createHubUsageStore,
  extractTokenBreakdownFromContextBudget,
  normalizeIpAddress,
} from '../hub-usage-service.js';

test('hub usage store aggregates daily token usage by IP and user', () => {
  const db = new Database(':memory:');
  const store = createHubUsageStore(db);
  store.ensureSchema();

  store.recordUsage({
    userId: 7,
    ipAddress: '::ffff:203.0.113.10',
    provider: 'claude',
    sessionId: 'session-a',
    inputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 10,
    cacheCreationTokens: 5,
    usedMcp: true,
    timestamp: '2026-05-06T10:15:00.000Z',
  });
  store.recordUsage({
    userId: 7,
    ipAddress: '203.0.113.10',
    provider: 'claude',
    sessionId: 'session-b',
    inputTokens: 20,
    outputTokens: 25,
    usedMcp: false,
    timestamp: '2026-05-06T18:30:00.000Z',
  });
  store.recordUsage({
    userId: 8,
    ipAddress: '198.51.100.20',
    provider: 'codex',
    sessionId: 'session-c',
    inputTokens: 11,
    outputTokens: 9,
    usedMcp: false,
    timestamp: '2026-05-07T01:00:00.000Z',
  });

  const report = store.getDailyUsage({
    from: '2026-05-06',
    to: '2026-05-06',
  });

  assert.deepEqual(report.summary, {
    totalTokens: 200,
    inputTokens: 120,
    outputTokens: 65,
    cacheReadTokens: 10,
    cacheCreationTokens: 5,
    callCount: 2,
    mcpCallCount: 1,
    uniqueIps: 1,
    uniqueUsers: 1,
  });
  assert.deepEqual(report.daily, [
    {
      date: '2026-05-06',
      totalTokens: 200,
      inputTokens: 120,
      outputTokens: 65,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      callCount: 2,
      mcpCallCount: 1,
      uniqueIps: 1,
      uniqueUsers: 1,
    },
  ]);
  assert.deepEqual(report.users, [
    {
      date: '2026-05-06',
      ipAddress: '203.0.113.10',
      userId: 7,
      username: null,
      providers: ['claude'],
      totalTokens: 200,
      inputTokens: 120,
      outputTokens: 65,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      callCount: 2,
      mcpCallCount: 1,
      usedMcp: true,
    },
  ]);
});

test('hub usage helpers normalize IPs and extract billable token breakdowns', () => {
  assert.equal(normalizeIpAddress('::ffff:127.0.0.1'), '127.0.0.1');
  assert.deepEqual(
    extractTokenBreakdownFromContextBudget({
      current: {
        breakdown: {
          input: 15,
          output: 6,
          cacheRead: 4,
          cacheCreation: 3,
        },
      },
    }),
    {
      inputTokens: 15,
      outputTokens: 6,
      cacheReadTokens: 4,
      cacheCreationTokens: 3,
      totalTokens: 28,
    },
  );
});
