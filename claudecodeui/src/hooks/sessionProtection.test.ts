import { describe, expect, it } from 'vitest';

import {
  createEmptySessionProtectionState,
  markSessionAsActiveState,
  markSessionAsInactiveState,
  markSessionAsProcessingState,
  replaceTemporarySessionState,
} from './sessionProtection';

describe('sessionProtection state helpers', () => {
  it('migrates temporary processing state to the real session id', () => {
    let state = createEmptySessionProtectionState();
    state = markSessionAsActiveState(state, 'new-session-123');
    state = markSessionAsProcessingState(state, 'new-session-123');
    state = markSessionAsProcessingState(state, 'existing-session');

    const next = replaceTemporarySessionState(state, 'real-session-456');

    expect(Array.from(next.activeSessions)).toEqual(['real-session-456']);
    expect(Array.from(next.processingSessions)).toEqual([
      'existing-session',
      'real-session-456',
    ]);
    expect(next.processingSessions.has('new-session-123')).toBe(false);
  });

  it('clears processing state when a session becomes inactive', () => {
    let state = createEmptySessionProtectionState();
    state = markSessionAsActiveState(state, 'session-1');
    state = markSessionAsProcessingState(state, 'session-1');

    const next = markSessionAsInactiveState(state, 'session-1');

    expect(next.activeSessions.has('session-1')).toBe(false);
    expect(next.processingSessions.has('session-1')).toBe(false);
  });
});
