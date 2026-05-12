import { describe, expect, it } from 'vitest';

import { SAMPLE_SWARM_ROLES, SAMPLE_SWARM_TOPOLOGY } from '../constants/sampleSwarmManifest';

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
});
