import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { apiFetch } from '../../../utils/api';
import type { ChatMessage, Provider } from '../types/types';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import { createCachedDiffCalculator, type DiffCalculator } from '../utils/messageTransforms';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import {
  captureViewportAnchor,
  getRestoredScrollTop,
  shouldAutoFillHistory,
  shouldPreserveViewport,
  type ScrollAnchorBox,
  type ScrollRestoreState,
} from '../utils/chatScrollRestore';

import { normalizedToChatMessages } from './useChatMessages';

const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;
const SCROLL_RESTORE_ATTEMPTS = 16;
const AUTO_FILL_MAX_PAGES_PER_SESSION = 1;
const EMPTY_STORE_MESSAGES: NormalizedMessage[] = [];

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  processingSessions?: Set<string>;
  resetStreamingState: () => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  sessionStore: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Helper: Convert a ChatMessage to a NormalizedMessage for the store */
/* ------------------------------------------------------------------ */

function chatMessageToNormalized(
  msg: ChatMessage,
  sessionId: string,
  provider: LLMProvider,
): NormalizedMessage | null {
  const providedId = typeof msg.id === 'string' && msg.id.trim()
    ? msg.id.trim()
    : null;
  const id = providedId || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ts = msg.timestamp instanceof Date
    ? msg.timestamp.toISOString()
    : typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : String(msg.timestamp);
  const base = { id, sessionId, timestamp: ts, provider };

  if (msg.isToolUse) {
    return {
      ...base,
      kind: 'tool_use',
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      toolId: msg.toolId || id,
    } as NormalizedMessage;
  }
  if (msg.isThinking) {
    return { ...base, kind: 'thinking', content: msg.content || '' } as NormalizedMessage;
  }
  if (msg.isInteractivePrompt) {
    return { ...base, kind: 'interactive_prompt', content: msg.content || '' } as NormalizedMessage;
  }
  if ((msg as any).isTaskNotification) {
    return {
      ...base,
      kind: 'task_notification',
      status: (msg as any).taskStatus || 'completed',
      summary: msg.content || '',
    } as NormalizedMessage;
  }
  if (msg.type === 'error') {
    return { ...base, kind: 'error', content: msg.content || '' } as NormalizedMessage;
  }
  return {
    ...base,
    kind: 'text',
    role: msg.type === 'user' ? 'user' : 'assistant',
    content: msg.content || '',
  } as NormalizedMessage;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  autoScrollToBottom,
  externalMessageUpdate,
  processingSessions,
  resetStreamingState,
  pendingViewSessionRef,
  sessionStore,
}: UseChatSessionStateArgs) {
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState('');
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [loadedMessageCount, setLoadedMessageCount] = useState(0);
  const [claudeStatus, setClaudeStatus] = useState<{ text: string; tokens: number; can_interrupt: boolean } | null>(null);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [viewHiddenCount, setViewHiddenCount] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [searchTarget, setSearchTarget] = useState<{ timestamp?: string; uuid?: string; snippet?: string } | null>(null);
  const searchScrollActiveRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef<ScrollRestoreState>({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topIntentLoadFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const autoFillFrameRef = useRef<number | null>(null);
  const autoFillSessionKeyRef = useRef<string | null>(null);
  const autoFillPagesRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const lastLoadedSessionKeyRef = useRef<string | null>(null);
  const suppressTopLoadUntilRef = useRef(0);
  const [scrollRestoreVersion, setScrollRestoreVersion] = useState(0);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  const getScrollAnchorBoxes = useCallback((container: HTMLDivElement): ScrollAnchorBox[] => {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-message-key]'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          key: element.dataset.messageKey || '',
          top: rect.top,
          bottom: rect.bottom,
        };
      })
      .filter((element) => Boolean(element.key));
  }, []);

  const captureScrollRestoreState = useCallback((
    container: HTMLDivElement,
    fallbackMode: ScrollRestoreState['fallbackMode'] = 'height-diff',
  ): ScrollRestoreState => {
    const containerRect = container.getBoundingClientRect();
    const anchor = captureViewportAnchor({
      containerTop: containerRect.top,
      elements: getScrollAnchorBoxes(container),
    });

    return {
      height: container.scrollHeight,
      top: container.scrollTop,
      anchorKey: anchor.anchorKey,
      anchorOffset: anchor.anchorOffset,
      attemptsLeft: SCROLL_RESTORE_ATTEMPTS,
      fallbackMode,
    };
  }, [getScrollAnchorBoxes]);

  const updateScrollPositionSnapshot = useCallback((container: HTMLDivElement) => {
    scrollPositionRef.current = captureScrollRestoreState(container, 'top');
  }, [captureScrollRestoreState]);

  const restoreScrollPosition = useCallback((state: ScrollRestoreState) => {
    const container = scrollContainerRef.current;
    if (!container) return false;

    const containerRect = container.getBoundingClientRect();
    container.scrollTop = getRestoredScrollTop({
      state,
      current: {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
        containerTop: containerRect.top,
        anchors: getScrollAnchorBoxes(container),
      },
    });
    return true;
  }, [getScrollAnchorBoxes]);

  const queueScrollRestore = useCallback((state: ScrollRestoreState) => {
    pendingScrollRestoreRef.current = {
      ...state,
      attemptsLeft: state.attemptsLeft ?? SCROLL_RESTORE_ATTEMPTS,
    };
    suppressTopLoadUntilRef.current = Date.now() + 1200;
    setScrollRestoreVersion((version) => version + 1);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Derive chatMessages from the store                              */
  /* ---------------------------------------------------------------- */

  const activeSessionId = selectedSession?.id || currentSessionId || null;
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);

  // Tell the store which session we're viewing so it only re-renders for this one
  const prevActiveForStoreRef = useRef<string | null>(null);
  if (activeSessionId !== prevActiveForStoreRef.current) {
    prevActiveForStoreRef.current = activeSessionId;
    sessionStore.setActiveSession(activeSessionId);
  }

  // When a real session ID arrives and we have a pending user message, flush it to the store
  const prevActiveSessionRef = useRef<string | null>(null);
  if (activeSessionId && activeSessionId !== prevActiveSessionRef.current && pendingUserMessage) {
    const prov = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(pendingUserMessage, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }
    setPendingUserMessage(null);
  }
  prevActiveSessionRef.current = activeSessionId;

  const storeMessages = activeSessionId ? sessionStore.getMessages(activeSessionId) : EMPTY_STORE_MESSAGES;

  // Reset viewHiddenCount when store messages change
  const prevStoreLenRef = useRef(0);
  if (storeMessages.length !== prevStoreLenRef.current) {
    prevStoreLenRef.current = storeMessages.length;
    if (viewHiddenCount > 0) setViewHiddenCount(0);
  }

  const chatMessages = useMemo(() => {
    const all = normalizedToChatMessages(storeMessages);
    // Show pending user message when no session data exists yet (new session, pre-backend-response)
    if (pendingUserMessage && all.length === 0) {
      return [pendingUserMessage];
    }
    if (viewHiddenCount > 0 && viewHiddenCount < all.length) return all.slice(0, -viewHiddenCount);
    return all;
  }, [storeMessages, viewHiddenCount, pendingUserMessage]);

  /* ---------------------------------------------------------------- */
  /*  addMessage / clearMessages / rewindMessages                     */
  /* ---------------------------------------------------------------- */

  const addMessage = useCallback((msg: ChatMessage) => {
    if (!activeSessionId) {
      // No session yet - show as pending until the backend creates one
      setPendingUserMessage(msg);
      return;
    }
    const prov = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(msg, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }
  }, [activeSessionId, sessionStore]);

  const clearMessages = useCallback(() => {
    if (!activeSessionId) return;
    sessionStore.clearRealtime(activeSessionId);
  }, [activeSessionId, sessionStore]);

  const rewindMessages = useCallback((count: number) => setViewHiddenCount(count), []);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) return false;
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) return false;

      const sessionProvider = selectedSession.__provider || 'claude';
      if (sessionProvider === 'cursor') return false;

      isLoadingMoreRef.current = true;
      setIsLoadingMoreMessages(true);
      setIsUserScrolledUp(true);
      const restoreState = captureScrollRestoreState(container);
      const previousSlot = sessionStore.getSessionSlot(selectedSession.id);
      const previousLoadedCount = previousSlot?.loadedCount ?? previousSlot?.offset ?? 0;
      const previousServerCount = previousSlot?.serverMessages.length ?? 0;

      try {
        const slot = await sessionStore.fetchMore(selectedSession.id, {
          provider: sessionProvider as LLMProvider,
          projectName: selectedProject.name,
          projectPath: selectedProject.fullPath || selectedProject.path || '',
          limit: MESSAGES_PER_PAGE,
        });
        const nextLoadedCount = slot?.loadedCount ?? slot?.offset ?? previousLoadedCount;
        const nextServerCount = slot?.serverMessages.length ?? previousServerCount;
        const didAdvance = nextLoadedCount > previousLoadedCount || nextServerCount > previousServerCount;
        if (!slot || !didAdvance) {
          setIsLoadingMoreMessages(false);
          setHasMoreMessages(Boolean(slot?.hasMore));
          return false;
        }

        queueScrollRestore(restoreState);
        setHasMoreMessages(slot.hasMore);
        setTotalMessages(slot.total);
        setLoadedMessageCount(nextLoadedCount);
        setVisibleMessageCount((prev) => Math.max(prev, slot.merged.length));
        return true;
      } catch (error) {
        console.error('Error loading older messages:', error);
        setIsLoadingMoreMessages(false);
        return false;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [captureScrollRestoreState, hasMoreMessages, isLoadingMoreMessages, queueScrollRestore, selectedProject, selectedSession, sessionStore],
  );

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (initialScrollTimerRef.current) {
      clearTimeout(initialScrollTimerRef.current);
      initialScrollTimerRef.current = null;
    }
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const latestContainer = scrollContainerRef.current;
      if (!latestContainer) return;

      updateScrollPositionSnapshot(latestContainer);
      if (Date.now() < suppressTopLoadUntilRef.current) return;

      const nearBottom = isNearBottom();
      setIsUserScrolledUp(!nearBottom);

      if (!allMessagesLoadedRef.current) {
        const scrolledNearTop = latestContainer.scrollTop < 100;
        if (!scrolledNearTop) {
          topLoadLockRef.current = false;
          return;
        }
        if (topLoadLockRef.current) {
          if (latestContainer.scrollTop > 20) topLoadLockRef.current = false;
          return;
        }
        void loadOlderMessages(latestContainer).then((didLoad) => {
          if (didLoad) topLoadLockRef.current = true;
        });
      }
    });
  }, [isNearBottom, loadOlderMessages, updateScrollPositionSnapshot]);

  const requestTopIntentLoad = useCallback((container: HTMLDivElement) => {
    if (!container || container.scrollTop > 2) return;
    if (!hasMoreMessages || allMessagesLoadedRef.current) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;
    if (Date.now() < suppressTopLoadUntilRef.current) return;
    if (topIntentLoadFrameRef.current !== null) return;

    topIntentLoadFrameRef.current = window.requestAnimationFrame(() => {
      topIntentLoadFrameRef.current = null;
      const latestContainer = scrollContainerRef.current;
      if (!latestContainer || latestContainer.scrollTop > 2) return;
      void loadOlderMessages(latestContainer);
    });
  }, [hasMoreMessages, isLoadingMoreMessages, loadOlderMessages]);

  const loadMoreHistoryMessages = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    void loadOlderMessages(container);
  }, [loadOlderMessages]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) return;
    const state = pendingScrollRestoreRef.current;

    const restore = () => {
      if (pendingScrollRestoreRef.current !== state) return;
      restoreScrollPosition(state);
      if (scrollContainerRef.current) {
        updateScrollPositionSnapshot(scrollContainerRef.current);
      }
      state.attemptsLeft = (state.attemptsLeft || 1) - 1;

      if (state.attemptsLeft > 0) {
        window.requestAnimationFrame(restore);
        return;
      }

      pendingScrollRestoreRef.current = null;
      setIsLoadingMoreMessages(false);
    };

    restore();
  }, [chatMessages.length, restoreScrollPosition, scrollRestoreVersion, updateScrollPositionSnapshot]);

  // Reset scroll/pagination state on session change
  useEffect(() => {
    if (!searchScrollActiveRef.current) {
      pendingInitialScrollRef.current = true;
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    if (initialScrollTimerRef.current) {
      clearTimeout(initialScrollTimerRef.current);
      initialScrollTimerRef.current = null;
    }
    if (topIntentLoadFrameRef.current !== null) {
      window.cancelAnimationFrame(topIntentLoadFrameRef.current);
      topIntentLoadFrameRef.current = null;
    }
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    if (autoFillFrameRef.current !== null) {
      window.cancelAnimationFrame(autoFillFrameRef.current);
      autoFillFrameRef.current = null;
    }
    autoFillSessionKeyRef.current = null;
    autoFillPagesRef.current = 0;
    touchStartYRef.current = null;
    setIsUserScrolledUp(false);
    setIsLoadingMoreMessages(false);
  }, [selectedProject?.name, selectedSession?.id]);

  // Initial scroll to bottom
  useEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) return;
    if (chatMessages.length === 0) { pendingInitialScrollRef.current = false; return; }
    pendingInitialScrollRef.current = false;
    if (!searchScrollActiveRef.current) {
      if (initialScrollTimerRef.current) clearTimeout(initialScrollTimerRef.current);
      const initialSessionId = activeSessionId;
      initialScrollTimerRef.current = setTimeout(() => {
        initialScrollTimerRef.current = null;
        if (initialSessionId !== (selectedSession?.id || currentSessionId || null)) return;
        if (searchScrollActiveRef.current || isUserScrolledUp) return;
        scrollToBottom();
      }, 200);
    }
    return () => {
      if (initialScrollTimerRef.current) {
        clearTimeout(initialScrollTimerRef.current);
        initialScrollTimerRef.current = null;
      }
    };
  }, [activeSessionId, chatMessages.length, currentSessionId, isLoadingSessionMessages, isUserScrolledUp, scrollToBottom, selectedSession?.id]);

  // Main session loading effect - store-based
  useEffect(() => {
    if (!selectedSession || !selectedProject) {
      resetStreamingState();
      pendingViewSessionRef.current = null;
      setClaudeStatus(null);
      setCanAbortSession(false);
      setIsLoading(false);
      setCurrentSessionId(null);
      sessionStorage.removeItem('cursorSessionId');
      messagesOffsetRef.current = 0;
      setHasMoreMessages(false);
      setTotalMessages(0);
      setLoadedMessageCount(0);
      setTokenBudget(null);
      setSessionLoadError('');
      lastLoadedSessionKeyRef.current = null;
      return;
    }

    const provider = (selectedSession.__provider || localStorage.getItem('selected-provider') as Provider) || 'claude';
    const sessionKey = `${selectedSession.id}:${selectedProject.name}:${provider}`;

    // Skip if already loaded and fresh
    if (lastLoadedSessionKeyRef.current === sessionKey && sessionStore.has(selectedSession.id) && !sessionStore.isStale(selectedSession.id)) {
      return;
    }

    const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;
    if (sessionChanged) {
      resetStreamingState();
      pendingViewSessionRef.current = null;
      setClaudeStatus(null);
      setCanAbortSession(false);
    }

    // Reset pagination/scroll state
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setTotalMessages(0);
    setLoadedMessageCount(0);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    setViewHiddenCount(0);
    if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);

    if (sessionChanged) {
      setTokenBudget(null);
      setIsLoading(false);
    }

    setCurrentSessionId(selectedSession.id);
    setSessionLoadError('');
    if (provider === 'cursor') {
      sessionStorage.setItem('cursorSessionId', selectedSession.id);
    }

    // Check session status
    if (ws) {
      sendMessage({ type: 'check-session-status', sessionId: selectedSession.id, provider });
    }

    lastLoadedSessionKeyRef.current = sessionKey;

    // Fetch from server -> store updates -> chatMessages re-derives automatically
    setIsLoadingSessionMessages(true);
    sessionStore.fetchFromServer(selectedSession.id, {
      provider: (selectedSession.__provider || provider) as LLMProvider,
      projectName: selectedProject.name,
      projectPath: selectedProject.fullPath || selectedProject.path || '',
      limit: MESSAGES_PER_PAGE,
      offset: 0,
    }).then(slot => {
      if (slot) {
        setHasMoreMessages(slot.hasMore);
        setTotalMessages(slot.total);
        setLoadedMessageCount(slot.loadedCount || slot.offset || slot.serverMessages.length);
        setVisibleMessageCount((prev) => Math.max(prev, slot.merged.length, INITIAL_VISIBLE_MESSAGES));
        if (slot.tokenUsage) setTokenBudget(slot.tokenUsage as Record<string, unknown>);
        if (slot.status === 'error') {
          setSessionLoadError(slot.errorMessage || 'Failed to load session messages');
        }
      }
      setIsLoadingSessionMessages(false);
    }).catch(() => {
      setSessionLoadError('Failed to load session messages');
      setIsLoadingSessionMessages(false);
    });
  }, [
    currentSessionId,
    pendingViewSessionRef,
    resetStreamingState,
    selectedProject,
    selectedSession,
    sendMessage,
    ws,
    sessionStore,
  ]);

  // External message update (e.g. WebSocket reconnect, background refresh)
  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) return;

    const reloadExternalMessages = async () => {
      try {
        const provider = (localStorage.getItem('selected-provider') as Provider) || 'claude';

        // Skip store refresh during active streaming
        if (!isLoading) {
          const container = scrollContainerRef.current;
          const wasNearBottom = isNearBottom();
          const restoreState = container && !wasNearBottom
            ? captureScrollRestoreState(container, 'top')
            : null;
          suppressTopLoadUntilRef.current = Date.now() + 1200;

          await sessionStore.refreshFromServer(selectedSession.id, {
            provider: (selectedSession.__provider || provider) as LLMProvider,
            projectName: selectedProject.name,
            projectPath: selectedProject.fullPath || selectedProject.path || '',
            limit: allMessagesLoadedRef.current ? null : Math.max(visibleMessageCount, MESSAGES_PER_PAGE),
            offset: 0,
          });

          if (restoreState) {
            queueScrollRestore(restoreState);
          } else if (Boolean(autoScrollToBottom) && wasNearBottom) {
            setTimeout(() => scrollToBottom(), 50);
          }
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [
    autoScrollToBottom,
    captureScrollRestoreState,
    externalMessageUpdate,
    isNearBottom,
    queueScrollRestore,
    scrollToBottom,
    selectedProject,
    selectedSession,
    sessionStore,
    isLoading,
    visibleMessageCount,
  ]);

  // Search navigation target
  useEffect(() => {
    const session = selectedSession as Record<string, unknown> | null;
    const targetSnippet = session?.__searchTargetSnippet;
    const targetTimestamp = session?.__searchTargetTimestamp;
    if (typeof targetSnippet === 'string' && targetSnippet) {
      searchScrollActiveRef.current = true;
      setSearchTarget({
        snippet: targetSnippet,
        timestamp: typeof targetTimestamp === 'string' ? targetTimestamp : undefined,
      });
    }
  }, [selectedSession]);

  useEffect(() => {
    if (selectedSession?.id) pendingViewSessionRef.current = null;
  }, [pendingViewSessionRef, selectedSession?.id]);

  // Scroll to search target
  useEffect(() => {
    if (!searchTarget || chatMessages.length === 0 || isLoadingSessionMessages) return;

    const target = searchTarget;
    setSearchTarget(null);

    const scrollToTarget = async () => {
      if (!allMessagesLoadedRef.current && selectedSession && selectedProject) {
        const sessionProvider = selectedSession.__provider || 'claude';
        if (sessionProvider !== 'cursor') {
          try {
            // Load all messages into the store for search navigation
            const slot = await sessionStore.fetchFromServer(selectedSession.id, {
              provider: sessionProvider as LLMProvider,
              projectName: selectedProject.name,
              projectPath: selectedProject.fullPath || selectedProject.path || '',
              limit: null,
              offset: 0,
            });
            if (slot) {
              setHasMoreMessages(false);
              setTotalMessages(slot.total);
              setLoadedMessageCount(slot.total);
              messagesOffsetRef.current = slot.total;
              setVisibleMessageCount(Infinity);
              setAllMessagesLoaded(true);
              allMessagesLoadedRef.current = true;
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          } catch {
            // Fall through and scroll in current messages
          }
        }
      }
      setVisibleMessageCount(Infinity);

      const findAndScroll = (retriesLeft: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let targetElement: Element | null = null;

        if (target.snippet) {
          const cleanSnippet = target.snippet.replace(/^\.{3}/, '').replace(/\.{3}$/, '').trim();
          const searchPhrase = cleanSnippet.slice(0, 80).toLowerCase().trim();
          if (searchPhrase.length >= 10) {
            const messageElements = container.querySelectorAll('.chat-message');
            for (const el of messageElements) {
              const text = (el.textContent || '').toLowerCase();
              if (text.includes(searchPhrase)) { targetElement = el; break; }
            }
          }
        }

        if (!targetElement && target.timestamp) {
          const targetDate = new Date(target.timestamp).getTime();
          const messageElements = container.querySelectorAll('[data-message-timestamp]');
          let closestDiff = Infinity;
          for (const el of messageElements) {
            const ts = el.getAttribute('data-message-timestamp');
            if (!ts) continue;
            const diff = Math.abs(new Date(ts).getTime() - targetDate);
            if (diff < closestDiff) { closestDiff = diff; targetElement = el; }
          }
        }

        if (targetElement) {
          targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
          targetElement.classList.add('search-highlight-flash');
          setTimeout(() => targetElement?.classList.remove('search-highlight-flash'), 4000);
          searchScrollActiveRef.current = false;
        } else if (retriesLeft > 0) {
          setTimeout(() => findAndScroll(retriesLeft - 1), 200);
        } else {
          searchScrollActiveRef.current = false;
        }
      };

      setTimeout(() => findAndScroll(15), 150);
    };

    scrollToTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isLoadingSessionMessages, searchTarget]);

  // Token usage fetch for Claude
  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || selectedSession.id.startsWith('new-session-')) {
      setTokenBudget(null);
      return;
    }
    const sessionProvider = selectedSession.__provider || 'claude';
    if (sessionProvider !== 'claude') return;

    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage`;
        const response = await apiFetch(url);
        if (response.ok) {
          setTokenBudget(await response.json());
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    fetchInitialTokenUsage();
  }, [selectedProject, selectedSession?.id, selectedSession?.__provider]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) return chatMessages;
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useLayoutEffect(() => {
    if (!scrollContainerRef.current || chatMessages.length === 0) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;
    if (searchScrollActiveRef.current) return;

    const container = scrollContainerRef.current;
    const preserveViewport = shouldPreserveViewport({
      isUserScrolledUp,
      isNearBottom: isNearBottom(),
    });

    if (preserveViewport) {
      restoreScrollPosition(scrollPositionRef.current);
      updateScrollPositionSnapshot(container);
      return;
    }

    if (autoScrollToBottom) {
      scrollToBottom();
    }
    updateScrollPositionSnapshot(container);
  }, [autoScrollToBottom, chatMessages, isLoadingMoreMessages, isNearBottom, isUserScrolledUp, restoreScrollPosition, scrollToBottom, updateScrollPositionSnapshot]);

  const preserveScrollForLayoutChange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (shouldPreserveViewport({ isUserScrolledUp, isNearBottom: isNearBottom() })) {
      queueScrollRestore(captureScrollRestoreState(container, 'top'));
      return;
    }

    if (autoScrollToBottom) {
      window.requestAnimationFrame(scrollToBottom);
    }
  }, [autoScrollToBottom, captureScrollRestoreState, isNearBottom, isUserScrolledUp, queueScrollRestore, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [handleScroll]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        requestTopIntentLoad(container);
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY === null || currentY === undefined) return;
      if (currentY - startY > 24) {
        requestTopIntentLoad(container);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      if (topIntentLoadFrameRef.current !== null) {
        window.cancelAnimationFrame(topIntentLoadFrameRef.current);
        topIntentLoadFrameRef.current = null;
      }
    };
  }, [requestTopIntentLoad]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !hasMoreMessages || allMessagesLoadedRef.current) return;
    if (isLoadingMoreMessages || isLoadingMoreRef.current || pendingScrollRestoreRef.current) return;
    if (isLoadingSessionMessages || searchScrollActiveRef.current) return;

    const sessionKey = selectedSession?.id || currentSessionId || null;
    if (!sessionKey) return;
    if (autoFillSessionKeyRef.current !== sessionKey) {
      autoFillSessionKeyRef.current = sessionKey;
      autoFillPagesRef.current = 0;
    }

    if (autoFillFrameRef.current !== null) {
      window.cancelAnimationFrame(autoFillFrameRef.current);
    }

    autoFillFrameRef.current = window.requestAnimationFrame(() => {
      autoFillFrameRef.current = null;
      const latestContainer = scrollContainerRef.current;
      if (!latestContainer || !hasMoreMessages || isLoadingMoreRef.current) return;
      if (shouldAutoFillHistory({
        hasMoreMessages,
        allMessagesLoaded: allMessagesLoadedRef.current,
        isLoadingMoreMessages: isLoadingMoreRef.current || isLoadingMoreMessages,
        isSessionLoading: isLoadingSessionMessages,
        hasPendingRestore: Boolean(pendingScrollRestoreRef.current),
        searchScrollActive: searchScrollActiveRef.current,
        pagesLoadedForSession: autoFillPagesRef.current,
        maxPagesPerSession: AUTO_FILL_MAX_PAGES_PER_SESSION,
        scrollHeight: latestContainer.scrollHeight,
        clientHeight: latestContainer.clientHeight,
      })) {
        autoFillPagesRef.current += 1;
        void loadOlderMessages(latestContainer);
      }
    });

    return () => {
      if (autoFillFrameRef.current !== null) {
        window.cancelAnimationFrame(autoFillFrameRef.current);
        autoFillFrameRef.current = null;
      }
    };
  }, [chatMessages.length, currentSessionId, hasMoreMessages, isLoadingMoreMessages, isLoadingSessionMessages, loadOlderMessages, selectedSession?.id, visibleMessages.length]);

  useEffect(() => {
    const activeViewSessionId = selectedSession?.id || currentSessionId;
    if (!activeViewSessionId || !processingSessions) return;
    const shouldBeProcessing = processingSessions.has(activeViewSessionId);
    if (shouldBeProcessing && !isLoading) {
      setIsLoading(true);
      setCanAbortSession(true);
    }
  }, [currentSessionId, isLoading, processingSessions, selectedSession?.id]);

  // "Load all" overlay
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => setShowLoadAllOverlay(false), 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => { if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current); };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async () => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    const sessionProvider = selectedSession.__provider || 'claude';
    if (sessionProvider === 'cursor') {
      setVisibleMessageCount(Infinity);
      setLoadedMessageCount((previous) => Math.max(previous, chatMessages.length));
      setAllMessagesLoaded(true);
      allMessagesLoadedRef.current = true;
      setLoadAllJustFinished(true);
      if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
      loadAllFinishedTimerRef.current = setTimeout(() => { setLoadAllJustFinished(false); setShowLoadAllOverlay(false); }, 1000);
      return;
    }

    const requestSessionId = selectedSession.id;
    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);

    const container = scrollContainerRef.current;
    const restoreState = container ? captureScrollRestoreState(container) : null;

    try {
      const slot = await sessionStore.fetchFromServer(requestSessionId, {
        provider: sessionProvider as LLMProvider,
        projectName: selectedProject.name,
        projectPath: selectedProject.fullPath || selectedProject.path || '',
        limit: null,
        offset: 0,
      });

      if (currentSessionId !== requestSessionId) return;

      if (slot) {
        if (restoreState) {
          queueScrollRestore(restoreState);
        }

        setHasMoreMessages(false);
        setTotalMessages(slot.total);
        setLoadedMessageCount(slot.total);
        messagesOffsetRef.current = slot.total;
        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => { setLoadAllJustFinished(false); setShowLoadAllOverlay(false); }, 1000);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [captureScrollRestoreState, chatMessages.length, currentSessionId, isLoadingAllMessages, queueScrollRestore, selectedProject, selectedSession, sessionStore]);

  const loadEarlierMessages = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      queueScrollRestore(captureScrollRestoreState(container));
      setIsLoadingMoreMessages(true);
      setIsUserScrolledUp(true);
    }
    setVisibleMessageCount((prev) => prev + 100);
  }, [captureScrollRestoreState, queueScrollRestore]);

  return {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    sessionLoadError,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    loadedMessageCount,
    visibleMessages,
    loadMoreHistoryMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    preserveScrollForLayoutChange,
    isNearBottom,
    handleScroll,
  };
}
