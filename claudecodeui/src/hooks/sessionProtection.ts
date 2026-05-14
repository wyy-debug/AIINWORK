export type SessionProtectionState = {
  activeSessions: Set<string>;
  processingSessions: Set<string>;
};

const isTemporarySessionId = (sessionId: string) => sessionId.startsWith('new-session-');

const addToSet = (sessions: Set<string>, sessionId?: string | null) => {
  if (!sessionId) {
    return sessions;
  }
  return new Set([...sessions, sessionId]);
};

const removeFromSet = (sessions: Set<string>, sessionId?: string | null) => {
  if (!sessionId || !sessions.has(sessionId)) {
    return sessions;
  }
  const next = new Set(sessions);
  next.delete(sessionId);
  return next;
};

const replaceTemporarySessionEntries = (
  sessions: Set<string>,
  realSessionId: string,
  options: { alwaysAddRealSession?: boolean } = {},
) => {
  let hadTemporarySession = false;
  const next = new Set<string>();

  for (const sessionId of sessions) {
    if (isTemporarySessionId(sessionId)) {
      hadTemporarySession = true;
      continue;
    }
    next.add(sessionId);
  }

  if (options.alwaysAddRealSession || hadTemporarySession) {
    next.add(realSessionId);
  }

  return next;
};

export function createEmptySessionProtectionState(): SessionProtectionState {
  return {
    activeSessions: new Set(),
    processingSessions: new Set(),
  };
}

export function markSessionAsActiveState(
  state: SessionProtectionState,
  sessionId?: string | null,
): SessionProtectionState {
  if (!sessionId) {
    return state;
  }

  return {
    ...state,
    activeSessions: addToSet(state.activeSessions, sessionId),
  };
}

export function markSessionAsInactiveState(
  state: SessionProtectionState,
  sessionId?: string | null,
): SessionProtectionState {
  if (!sessionId) {
    return state;
  }

  return {
    activeSessions: removeFromSet(state.activeSessions, sessionId),
    processingSessions: removeFromSet(state.processingSessions, sessionId),
  };
}

export function markSessionAsProcessingState(
  state: SessionProtectionState,
  sessionId?: string | null,
): SessionProtectionState {
  if (!sessionId) {
    return state;
  }

  return {
    ...state,
    processingSessions: addToSet(state.processingSessions, sessionId),
  };
}

export function markSessionAsNotProcessingState(
  state: SessionProtectionState,
  sessionId?: string | null,
): SessionProtectionState {
  if (!sessionId) {
    return state;
  }

  return {
    ...state,
    processingSessions: removeFromSet(state.processingSessions, sessionId),
  };
}

export function replaceTemporarySessionState(
  state: SessionProtectionState,
  realSessionId?: string | null,
): SessionProtectionState {
  if (!realSessionId) {
    return state;
  }

  return {
    activeSessions: replaceTemporarySessionEntries(state.activeSessions, realSessionId, {
      alwaysAddRealSession: true,
    }),
    processingSessions: replaceTemporarySessionEntries(state.processingSessions, realSessionId),
  };
}
