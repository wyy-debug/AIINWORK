import { describe, expect, it } from 'vitest';

import { eventToneClass } from './AgentRuntimeTimelinePanel';

describe('AgentRuntimeTimelinePanel', () => {
  it('uses warning styling for blocked permission events', () => {
    expect(eventToneClass({ status: 'blocked', severity: 'warning' })).toContain('amber');
  });

  it('uses danger styling for failed tool events', () => {
    expect(eventToneClass({ status: 'error', severity: 'error' })).toContain('red');
  });
});
