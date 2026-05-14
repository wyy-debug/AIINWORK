import { useCallback, useState } from 'react';

import {
  createEmptySessionProtectionState,
  markSessionAsActiveState,
  markSessionAsInactiveState,
  markSessionAsNotProcessingState,
  markSessionAsProcessingState,
  replaceTemporarySessionState,
} from './sessionProtection';

export function useSessionProtection() {
  const [state, setState] = useState(createEmptySessionProtectionState);

  const markSessionAsActive = useCallback((sessionId?: string | null) => {
    setState((prev) => markSessionAsActiveState(prev, sessionId));
  }, []);

  const markSessionAsInactive = useCallback((sessionId?: string | null) => {
    setState((prev) => markSessionAsInactiveState(prev, sessionId));
  }, []);

  const markSessionAsProcessing = useCallback((sessionId?: string | null) => {
    setState((prev) => markSessionAsProcessingState(prev, sessionId));
  }, []);

  const markSessionAsNotProcessing = useCallback((sessionId?: string | null) => {
    setState((prev) => markSessionAsNotProcessingState(prev, sessionId));
  }, []);

  const replaceTemporarySession = useCallback((realSessionId?: string | null) => {
    setState((prev) => replaceTemporarySessionState(prev, realSessionId));
  }, []);

  return {
    activeSessions: state.activeSessions,
    processingSessions: state.processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  };
}
