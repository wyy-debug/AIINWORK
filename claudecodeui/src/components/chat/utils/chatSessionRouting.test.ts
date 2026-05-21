import { describe, expect, it } from 'vitest';

import {
  resolveChatSendSessionRouting,
  shouldPromoteCreatedSessionToActiveView,
} from './chatSessionRouting';

describe('chat session routing', () => {
  it('keeps an existing selected conversation as the send target even if currentSessionId is stale', () => {
    const routing = resolveChatSendSessionRouting({
      selectedSessionId: 'selected-conversation',
      currentSessionId: 'stale-conversation',
      storedCursorSessionId: null,
      oneShotSourceSessionId: null,
      createTemporarySessionId: () => 'new-session-should-not-be-used',
    });

    expect(routing.blockedByMissingProgrammaticSource).toBe(false);
    expect(routing.effectiveSessionId).toBe('selected-conversation');
    expect(routing.backendSessionId).toBe('selected-conversation');
    expect(routing.sessionToActivate).toBe('selected-conversation');
  });

  it('does not navigate an existing conversation when an unrelated session_created event arrives', () => {
    expect(shouldPromoteCreatedSessionToActiveView({
      selectedSessionId: 'selected-conversation',
      currentSessionId: 'selected-conversation',
      pendingViewSessionId: null,
      newSessionId: 'new-unrelated-conversation',
    })).toBe(false);
  });

  it('promotes session_created only for the local temporary conversation being created', () => {
    expect(shouldPromoteCreatedSessionToActiveView({
      selectedSessionId: null,
      currentSessionId: 'new-session-123',
      pendingViewSessionId: 'new-session-123',
      newSessionId: 'real-session-123',
    })).toBe(true);
  });
});
