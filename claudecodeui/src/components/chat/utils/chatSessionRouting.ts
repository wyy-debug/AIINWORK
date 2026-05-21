export type ChatSendSessionRoutingInput = {
  selectedSessionId?: string | null;
  currentSessionId?: string | null;
  storedCursorSessionId?: string | null;
  oneShotSourceSessionId?: string | null;
  createTemporarySessionId?: () => string;
};

export type ChatSendSessionRouting = {
  effectiveSessionId: string | null;
  backendSessionId: string | null;
  sessionToActivate: string;
  blockedByMissingProgrammaticSource: boolean;
};

export type CreatedSessionPromotionInput = {
  selectedSessionId?: string | null;
  currentSessionId?: string | null;
  pendingViewSessionId?: string | null;
  newSessionId?: string | null;
};

export const isTemporaryChatSessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

export const toConcreteChatSessionId = (sessionId: string | null | undefined) => {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  return normalized && !isTemporaryChatSessionId(normalized) ? normalized : null;
};

const normalizeSessionId = (sessionId: string | null | undefined) => {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  return normalized || null;
};

export function resolveChatSendSessionRouting({
  selectedSessionId,
  currentSessionId,
  storedCursorSessionId,
  oneShotSourceSessionId,
  createTemporarySessionId = () => `new-session-${Date.now()}`,
}: ChatSendSessionRoutingInput): ChatSendSessionRouting {
  const concreteProgrammaticSessionId = toConcreteChatSessionId(oneShotSourceSessionId);
  const selectedConcreteSessionId = toConcreteChatSessionId(selectedSessionId);
  const currentConcreteSessionId = toConcreteChatSessionId(currentSessionId);
  const storedConcreteSessionId = toConcreteChatSessionId(storedCursorSessionId);
  const fallbackConcreteSessionId =
    selectedConcreteSessionId || currentConcreteSessionId || storedConcreteSessionId;

  if (oneShotSourceSessionId && !concreteProgrammaticSessionId && !fallbackConcreteSessionId) {
    return {
      effectiveSessionId: null,
      backendSessionId: null,
      sessionToActivate: '',
      blockedByMissingProgrammaticSource: true,
    };
  }

  const effectiveSessionId =
    concreteProgrammaticSessionId
    || fallbackConcreteSessionId
    || normalizeSessionId(selectedSessionId)
    || normalizeSessionId(currentSessionId)
    || normalizeSessionId(storedCursorSessionId);

  const sessionToActivate = effectiveSessionId || createTemporarySessionId();

  return {
    effectiveSessionId,
    backendSessionId: toConcreteChatSessionId(effectiveSessionId),
    sessionToActivate,
    blockedByMissingProgrammaticSource: false,
  };
}

export function shouldPromoteCreatedSessionToActiveView({
  selectedSessionId,
  currentSessionId,
  pendingViewSessionId,
  newSessionId,
}: CreatedSessionPromotionInput) {
  if (!normalizeSessionId(newSessionId)) {
    return false;
  }

  if (isTemporaryChatSessionId(currentSessionId)) {
    return true;
  }

  if (isTemporaryChatSessionId(pendingViewSessionId)) {
    return true;
  }

  if (toConcreteChatSessionId(selectedSessionId) || toConcreteChatSessionId(currentSessionId)) {
    return false;
  }

  return false;
}
