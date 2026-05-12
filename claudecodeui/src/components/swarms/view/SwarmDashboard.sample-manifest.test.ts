import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SAMPLE_SWARM_ROLES, SAMPLE_SWARM_TOPOLOGY } from '../constants/sampleSwarmManifest';

import SwarmDashboard from './SwarmDashboard';

describe('SwarmDashboard sample manifest', () => {
  it('keeps topology edges aligned with declared roles', () => {
    const roleIds = new Set(SAMPLE_SWARM_ROLES.map((role) => role.id));

    expect(roleIds).toEqual(new Set(['queen', 'security-reviewer', 'test-writer', 'summarizer']));
    expect(roleIds.has(SAMPLE_SWARM_TOPOLOGY.coordinatorRoleId || '')).toBe(true);
    for (const edge of SAMPLE_SWARM_TOPOLOGY.edges) {
      expect(roleIds.has(edge.from)).toBe(true);
      expect(roleIds.has(edge.to)).toBe(true);
    }
  });

  it('does not prefill the page with test business values before a run starts', () => {
    const html = renderToStaticMarkup(React.createElement(SwarmDashboard, {
      selectedProject: {
        name: 'AIINWORK',
        displayName: 'AIINWORK',
        fullPath: 'E:\\AIINWORK',
        path: 'E:\\AIINWORK',
      },
    }));

    expect(html).not.toContain('支付接口排查');
    expect(html).not.toContain('请排查支付接口超时问题，并优化系统稳定性。');
    expect(html).not.toContain('请同步当前执行进展。');
    expect(html).not.toContain('payment-timeout');
  });
});
