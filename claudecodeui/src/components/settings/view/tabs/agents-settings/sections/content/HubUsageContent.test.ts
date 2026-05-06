import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HubUsageSummaryCards, HubUsageTable } from './HubUsageContent';

describe('HubUsageContent presentation', () => {
  it('renders daily token totals, call counts, IP, user, and MCP usage', () => {
    const report = {
      summary: {
        totalTokens: 200,
        callCount: 2,
        mcpCallCount: 1,
        uniqueIps: 1,
        uniqueUsers: 1,
      },
      users: [
        {
          date: '2026-05-06',
          ipAddress: '203.0.113.10',
          userId: 7,
          username: 'alice',
          providers: ['claude'],
          totalTokens: 200,
          callCount: 2,
          mcpCallCount: 1,
          usedMcp: true,
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(HubUsageSummaryCards, { summary: report.summary }),
        React.createElement(HubUsageTable, { rows: report.users }),
      ),
    );

    expect(html).toContain('200');
    expect(html).toContain('2');
    expect(html).toContain('203.0.113.10');
    expect(html).toContain('alice');
    expect(html).toContain('MCP');
  });
});
