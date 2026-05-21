import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import { notifyAgentCompletion } from '../../../utils/nativeNotifications';
import {
  isTemporaryChatSessionId as isTemporarySessionId,
  shouldPromoteCreatedSessionToActiveView,
} from '../utils/chatSessionRouting';
import { emitChatRoutingDebug } from '../utils/chatRoutingDebug';
import type {
  AgentRuntimeDiagnostics,
  PendingPermissionRequest,
  PromptInjectionDebugPayload,
} from '../types/types';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type LatestChatMessage = {
  type?: string;
  kind?: string;
  data?: any;
  message?: any;
  delta?: string;
  sessionId?: string;
  session_id?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: any;
  toolId?: string;
  result?: any;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  event?: string;
  status?: any;
  isNewSession?: boolean;
  resultText?: string;
  isError?: boolean;
  success?: boolean;
  reason?: string;
  provider?: string;
  content?: string;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  contextBudget?: unknown;
  tokenBudget?: unknown;
  agentRuntime?: AgentRuntimeDiagnostics;
  promptInjection?: PromptInjectionDebugPayload;
  newSessionId?: string;
  aborted?: boolean;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  sendMessage: (message: unknown) => void;
  provider: LLMProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setAgentRuntimeDiagnostics?: Dispatch<SetStateAction<AgentRuntimeDiagnostics | null>>;
  setPromptInjectionDebug?: Dispatch<SetStateAction<PromptInjectionDebugPayload | null>>;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
  onWebSocketReconnect?: () => void;
  sessionStore: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatRealtimeHandlers({
  latestMessage,
  sendMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setTokenBudget,
  setAgentRuntimeDiagnostics,
  setPromptInjectionDebug,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  streamBufferRef,
  accumulatedStreamRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  onNavigateToSession,
  onWebSocketReconnect,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);
  const projectRefreshTimerRef = useRef<number | null>(null);
  const sessionStreamBuffersRef = useRef(new Map<string, string>());
  const sessionStreamTimersRef = useRef(new Map<string, number>());
  const temporarySessionAliasesRef = useRef(new Map<string, string>());
  const getPersistedStreamingContent = useCallback((sessionId: string) => {
    const slot = sessionStore.getSessionSlot(sessionId);
    if (!slot) return '';
    const streamMessage = slot.realtimeMessages.find((message) => message.id === `__streaming_${sessionId}`);
    return typeof streamMessage?.content === 'string' ? streamMessage.content : '';
  }, [sessionStore]);

  const scheduleProjectsRefresh = useCallback((delay = 400) => {
    if (projectRefreshTimerRef.current) {
      window.clearTimeout(projectRefreshTimerRef.current);
    }

    projectRefreshTimerRef.current = window.setTimeout(() => {
      projectRefreshTimerRef.current = null;
      window.refreshProjects?.();
    }, delay);
  }, []);

  useEffect(() => {
    return () => {
      if (projectRefreshTimerRef.current) {
        window.clearTimeout(projectRefreshTimerRef.current);
        projectRefreshTimerRef.current = null;
      }
      for (const timer of sessionStreamTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      sessionStreamTimersRef.current.clear();
      sessionStreamBuffersRef.current.clear();
      temporarySessionAliasesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!latestMessage) return;
    if (lastProcessedMessageRef.current === latestMessage) return;
    lastProcessedMessageRef.current = latestMessage;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;

    /* ---------------------------------------------------------------- */
    /*  Legacy messages (no `kind` field) — handle and return           */
    /* ---------------------------------------------------------------- */

    const msg = latestMessage as any;

    if (!msg.kind) {
      const messageType = String(msg.type || '');

      switch (messageType) {
        case 'websocket-reconnected':
          onWebSocketReconnect?.();
          return;

        case 'pending-permissions-response': {
          const permSessionId = msg.sessionId;
          const isCurrentPermSession =
            permSessionId === currentSessionId || (selectedSession && permSessionId === selectedSession.id);
          if (permSessionId && !isCurrentPermSession) return;
          setPendingPermissionRequests(msg.data || []);
          return;
        }

        case 'session-status': {
          const statusSessionId = msg.sessionId;
          if (!statusSessionId) return;

          const status = msg.status;
          if (status) {
            const statusInfo = {
              text: status.text || 'Working...',
              tokens: status.tokens || 0,
              can_interrupt: status.can_interrupt !== undefined ? status.can_interrupt : true,
            };
            setClaudeStatus(statusInfo);
            setIsLoading(true);
            setCanAbortSession(statusInfo.can_interrupt);
            return;
          }

          // Legacy isProcessing format from check-session-status
          const isCurrentSession =
            statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);

          if (msg.isProcessing) {
            onSessionProcessing?.(statusSessionId);
            if (isCurrentSession) { setIsLoading(true); setCanAbortSession(true); }
            return;
          }
          onSessionInactive?.(statusSessionId);
          onSessionNotProcessing?.(statusSessionId);
          if (isCurrentSession) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
          }
          return;
        }

        default:
          // Unknown legacy message type — ignore
          return;
      }
    }

    /* ---------------------------------------------------------------- */
    /*  NormalizedMessage handling (has `kind` field)                    */
    /* ---------------------------------------------------------------- */

    const sid = msg.sessionId || activeViewSessionId;
    const messageProvider = (msg.provider || provider) as LLMProvider;
    const remapTemporarySessionId = (sessionId: string | null | undefined) =>
      sessionId ? (temporarySessionAliasesRef.current.get(sessionId) || sessionId) : sessionId;

    const clearSessionStreamTimer = (sessionId: string) => {
      const timer = sessionStreamTimersRef.current.get(sessionId);
      if (!timer) return;
      window.clearTimeout(timer);
      sessionStreamTimersRef.current.delete(sessionId);
    };

    const getAccumulatedSessionStream = (sessionId: string) => (
      sessionStreamBuffersRef.current.get(sessionId) ?? getPersistedStreamingContent(sessionId)
    );

    const flushSessionStream = (sessionId: string) => {
      const accumulated = getAccumulatedSessionStream(sessionId);
      if (accumulated) {
        sessionStreamBuffersRef.current.set(sessionId, accumulated);
        sessionStore.updateStreaming(sessionId, accumulated, messageProvider);
      }
    };

    const finalizeSessionStream = (sessionId: string) => {
      clearSessionStreamTimer(sessionId);
      const accumulated = getAccumulatedSessionStream(sessionId);
      if (accumulated) {
        sessionStreamBuffersRef.current.set(sessionId, accumulated);
        sessionStore.updateStreaming(sessionId, accumulated, messageProvider);
        sessionStore.finalizeStreaming(sessionId);
      }
      sessionStreamBuffersRef.current.delete(sessionId);
      if (sessionId === activeViewSessionId) {
        accumulatedStreamRef.current = '';
        streamBufferRef.current = '';
      }
    };

    if (msg.kind === 'status' && msg.text === 'agent_runtime_debug') {
      if (
        sid
        && activeViewSessionId
        && sid !== activeViewSessionId
        && !isTemporarySessionId(activeViewSessionId)
      ) {
        return;
      }
      const runtime = msg.agentRuntime && typeof msg.agentRuntime === 'object'
        ? msg.agentRuntime as AgentRuntimeDiagnostics
        : null;
      setAgentRuntimeDiagnostics?.(runtime ? {
        ...runtime,
        sessionId: sid || runtime.sessionId || null,
        receivedAt: new Date().toLocaleString(),
      } : null);
      return;
    }

    if (msg.kind === 'status' && msg.text === 'prompt_injection_debug') {
      const promptDebugSessionId = remapTemporarySessionId(sid);
      if (
        promptDebugSessionId
        && activeViewSessionId
        && promptDebugSessionId !== activeViewSessionId
        && !isTemporarySessionId(activeViewSessionId)
      ) {
        return;
      }
      const promptInjection = msg.promptInjection && typeof msg.promptInjection === 'object'
        ? msg.promptInjection as PromptInjectionDebugPayload
        : null;
      setPromptInjectionDebug?.(promptInjection ? {
        ...promptInjection,
        sessionId: promptDebugSessionId || promptInjection.sessionId || null,
        receivedAt: new Date().toLocaleString(),
      } : null);
      return;
    }

    // --- Streaming: buffer for performance ---
    if (msg.kind === 'stream_delta') {
      const text = msg.content || '';
      if (!text) return;
      if (!sid) {
        streamBufferRef.current += text;
        accumulatedStreamRef.current += text;
        return;
      }
      const accumulated = `${getAccumulatedSessionStream(sid)}${text}`;
      sessionStreamBuffersRef.current.set(sid, accumulated);
      if (sid === activeViewSessionId) {
        streamBufferRef.current += text;
        accumulatedStreamRef.current = accumulated;
      }
      if (!sessionStreamTimersRef.current.has(sid)) {
        const timer = window.setTimeout(() => {
          sessionStreamTimersRef.current.delete(sid);
          flushSessionStream(sid);
        }, 100);
        sessionStreamTimersRef.current.set(sid, timer);
      }
      return;
    }

    if (msg.kind === 'stream_end') {
      if (sid) {
        finalizeSessionStream(sid);
      } else {
        accumulatedStreamRef.current = '';
        streamBufferRef.current = '';
      }
      return;
    }

    // --- All other messages: route to store ---
    if (sid) {
      sessionStore.appendRealtime(sid, msg as NormalizedMessage);
    }

    // --- UI side effects for specific kinds ---
    switch (msg.kind) {
      case 'session_created': {
        const newSessionId = msg.newSessionId;
        if (!newSessionId) break;
        const temporarySessionId = isTemporarySessionId(currentSessionId)
          ? currentSessionId
          : pendingViewSessionRef.current?.sessionId;
        const shouldPromoteCreatedSession = shouldPromoteCreatedSessionToActiveView({
          selectedSessionId: selectedSession?.id || null,
          currentSessionId,
          pendingViewSessionId: pendingViewSessionRef.current?.sessionId || null,
          newSessionId,
        });
        emitChatRoutingDebug(sendMessage, 'client.realtime.session_created', {
          provider,
          messageProvider,
          newSessionId,
          sid,
          selectedProjectName: selectedProject?.name || null,
          selectedProjectPath: selectedProject?.fullPath || selectedProject?.path || '',
          selectedSessionId: selectedSession?.id || null,
          currentSessionId,
          pendingViewSessionId: pendingViewSessionRef.current?.sessionId || null,
          temporarySessionId,
          shouldPromoteCreatedSession,
        });

        if (
          shouldPromoteCreatedSession
          && temporarySessionId
          && isTemporarySessionId(temporarySessionId)
          && temporarySessionId !== newSessionId
        ) {
          sessionStore.replaceSessionId(temporarySessionId, newSessionId);
          temporarySessionAliasesRef.current.set(temporarySessionId, newSessionId);
          setPromptInjectionDebug?.((previous) => {
            if (previous && previous.sessionId === temporarySessionId) {
              return {
                ...previous,
                sessionId: newSessionId,
                receivedAt: new Date().toLocaleString(),
              };
            }
            return previous;
          });
        }

        if (shouldPromoteCreatedSession) {
          sessionStorage.setItem('pendingSessionId', newSessionId);
          if (
            pendingViewSessionRef.current
            && (!pendingViewSessionRef.current.sessionId || pendingViewSessionRef.current.sessionId === temporarySessionId)
          ) {
            pendingViewSessionRef.current.sessionId = newSessionId;
          }
          setCurrentSessionId(newSessionId);
          onReplaceTemporarySession?.(newSessionId);
          setPendingPermissionRequests((prev) =>
            prev.map((r) => (r.sessionId ? r : { ...r, sessionId: newSessionId })),
          );
          onNavigateToSession?.(newSessionId);
        }
        scheduleProjectsRefresh(350);
        break;
      }

      case 'complete': {
        // Flush any remaining streaming state
        if (sid) {
          finalizeSessionStream(sid);
        } else {
          accumulatedStreamRef.current = '';
          streamBufferRef.current = '';
        }

        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPendingPermissionRequests([]);
        onSessionInactive?.(sid);
        onSessionNotProcessing?.(sid);

        // Handle aborted case
        if (msg.aborted) {
          // Abort was requested — the complete event confirms it
          // No special UI action needed beyond clearing loading state above
          // The backend already sent any abort-related messages
          break;
        }

        void notifyAgentCompletion({
          provider: msg.provider || provider,
          projectName: selectedProject?.displayName || selectedProject?.name || null,
          sessionName: selectedSession?.title || selectedSession?.name || selectedSession?.summary || null,
          sessionId: sid || currentSessionId || null,
          exitCode: typeof msg.exitCode === 'number' ? msg.exitCode : null,
          aborted: Boolean(msg.aborted),
        });

        // Clear pending session
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        emitChatRoutingDebug(sendMessage, 'client.realtime.complete', {
          provider,
          messageProvider,
          sid,
          selectedProjectName: selectedProject?.name || null,
          selectedProjectPath: selectedProject?.fullPath || selectedProject?.path || '',
          selectedSessionId: selectedSession?.id || null,
          currentSessionId,
          pendingViewSessionId: pendingViewSessionRef.current?.sessionId || null,
          pendingSessionId,
          actualSessionId: msg.actualSessionId || null,
          exitCode: typeof msg.exitCode === 'number' ? msg.exitCode : null,
          aborted: Boolean(msg.aborted),
        });
        if (pendingSessionId && msg.exitCode === 0) {
          const actualId = msg.actualSessionId
            || (isTemporarySessionId(currentSessionId) ? sid : currentSessionId)
            || sid
            || pendingSessionId;
          if (actualId && currentSessionId !== actualId) {
            setCurrentSessionId(actualId);
          }
          if (msg.actualSessionId && msg.actualSessionId !== currentSessionId) {
            onNavigateToSession?.(actualId);
          }
          scheduleProjectsRefresh(250);
          window.setTimeout(() => {
            if (sessionStorage.getItem('pendingSessionId') === pendingSessionId) {
              sessionStorage.removeItem('pendingSessionId');
            }
          }, 1500);
        }
        break;
      }

      case 'error': {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        onSessionInactive?.(sid);
        onSessionNotProcessing?.(sid);
        break;
      }

      case 'permission_request': {
        if (!msg.requestId) break;
        setPendingPermissionRequests((prev) => {
          if (prev.some((r: PendingPermissionRequest) => r.requestId === msg.requestId)) return prev;
          return [...prev, {
            requestId: msg.requestId,
            toolName: msg.toolName || 'UnknownTool',
            input: msg.input,
            context: msg.context,
            sessionId: sid || null,
            receivedAt: new Date(),
          }];
        });
        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({ text: 'Waiting for permission', tokens: 0, can_interrupt: true });
        break;
      }

      case 'permission_cancelled': {
        if (msg.requestId) {
          setPendingPermissionRequests((prev) => prev.filter((r: PendingPermissionRequest) => r.requestId !== msg.requestId));
        }
        break;
      }

      case 'status': {
        if (msg.text === 'token_budget' && (msg.contextBudget || msg.tokenBudget)) {
          setTokenBudget({
            ...(msg.tokenBudget && typeof msg.tokenBudget === 'object' ? msg.tokenBudget as Record<string, unknown> : {}),
            contextBudget: msg.contextBudget || msg.tokenBudget,
          });
        } else if (msg.text) {
          setClaudeStatus({
            text: msg.text,
            tokens: msg.tokens || 0,
            can_interrupt: msg.canInterrupt !== undefined ? msg.canInterrupt : true,
          });
          setIsLoading(true);
          setCanAbortSession(msg.canInterrupt !== false);
        }
        break;
      }

      // text, tool_use, tool_result, thinking, interactive_prompt, task_notification
      // → already routed to store above, no UI side effects needed
      default:
        break;
    }
  }, [
    latestMessage,
    sendMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setAgentRuntimeDiagnostics,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    accumulatedStreamRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    onWebSocketReconnect,
    scheduleProjectsRefresh,
    sessionStore,
    getPersistedStreamingContent,
  ]);
}
