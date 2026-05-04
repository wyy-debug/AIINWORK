/**
 * Session-keyed message store.
 *
 * Holds per-session state in a Map keyed by sessionId.
 * Session switch = change activeSessionId pointer. No clearing. Old data stays.
 * WebSocket handler = store.appendRealtime(msg.sessionId, msg). One line.
 * No localStorage for messages. Backend JSONL is the source of truth.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { LLMProvider } from '../types/app';
import { apiFetch } from '../utils/api';

// NormalizedMessage mirrors server/adapters/types.js.

export type MessageKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'stream_delta'
  | 'stream_end'
  | 'error'
  | 'complete'
  | 'status'
  | 'permission_request'
  | 'permission_cancelled'
  | 'session_created'
  | 'interactive_prompt'
  | 'task_notification'
  | 'context_compaction';

export interface NormalizedMessage {
  id: string;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;

  // kind-specific fields (flat for simplicity)
  role?: 'user' | 'assistant';
  content?: string;
  images?: string[];
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: { content: string; isError: boolean; toolUseResult?: unknown } | null;
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  contextBudget?: unknown;
  tokenBudget?: unknown;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  newSessionId?: string;
  status?: string;
  summary?: string;
  compactType?: 'full' | 'micro' | 'summary' | string;
  compactTrigger?: string;
  compactSummary?: string;
  compactMetadata?: unknown;
  microcompactMetadata?: unknown;
  preTokens?: number;
  tokensSaved?: number;
  compactedToolIds?: unknown;
  exitCode?: number;
  actualSessionId?: string;
  parentToolUseId?: string;
  subagentTools?: unknown[];
  subagentRuntime?: unknown;
  subagentRecord?: unknown;
  subagentSnapshot?: unknown;
  subagentEvents?: unknown;
  lastToolName?: string;
  taskId?: string;
  usage?: unknown;
  isFinal?: boolean;
  // Cursor-specific ordering
  sequence?: number;
  rowid?: number;
}

// Per-session slot.

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'error';

export interface SessionSlot {
  serverMessages: NormalizedMessage[];
  realtimeMessages: NormalizedMessage[];
  merged: NormalizedMessage[];
  /** @internal Cache-invalidation refs for computeMerged */
  _lastServerRef: NormalizedMessage[];
  _lastRealtimeRef: NormalizedMessage[];
  status: SessionStatus;
  errorMessage?: string;
  fetchedAt: number;
  total: number;
  hasMore: boolean;
  loadedCount: number;
  offset: number;
  tokenUsage: unknown;
  contextBudget: unknown;
}

const EMPTY: NormalizedMessage[] = [];

function createEmptySlot(): SessionSlot {
  return {
    serverMessages: EMPTY,
    realtimeMessages: EMPTY,
    merged: EMPTY,
    _lastServerRef: EMPTY,
    _lastRealtimeRef: EMPTY,
    status: 'idle',
    errorMessage: undefined,
    fetchedAt: 0,
    total: 0,
    hasMore: false,
    loadedCount: 0,
    offset: 0,
    tokenUsage: null,
    contextBudget: null,
  };
}

/**
 * Compute merged messages: server + realtime, deduped by id.
 * Server messages take priority (they're the persisted source of truth).
 * Realtime messages that aren't yet in server stay (in-flight streaming).
 */
function computeMerged(server: NormalizedMessage[], realtime: NormalizedMessage[]): NormalizedMessage[] {
  if (realtime.length === 0) return server;
  if (server.length === 0) return realtime;
  const serverIds = new Set(server.map(m => m.id));
  const extra = realtime.filter(m => !serverIds.has(m.id) && !hasServerEchoForOptimisticUser(server, m));
  if (extra.length === 0) return server;
  return [...server, ...extra];
}

/**
 * Recompute slot.merged only when the input arrays have actually changed
 * (by reference). Returns true if merged was recomputed.
 */
function recomputeMergedIfNeeded(slot: SessionSlot): boolean {
  if (slot.serverMessages === slot._lastServerRef && slot.realtimeMessages === slot._lastRealtimeRef) {
    return false;
  }
  slot._lastServerRef = slot.serverMessages;
  slot._lastRealtimeRef = slot.realtimeMessages;
  slot.merged = computeMerged(slot.serverMessages, slot.realtimeMessages);
  return true;
}

function mergeMessagesById(base: NormalizedMessage[], incoming: NormalizedMessage[]): NormalizedMessage[] {
  if (incoming.length === 0) return base;
  const seen = new Set(base.map((message) => message.id));
  const extra = incoming.filter((message) => !seen.has(message.id));
  return extra.length === 0 ? base : [...base, ...extra];
}

function prependUniqueMessages(incoming: NormalizedMessage[], existing: NormalizedMessage[]): NormalizedMessage[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((message) => message.id));
  const uniqueIncoming = incoming.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
  return uniqueIncoming.length === 0 ? existing : [...uniqueIncoming, ...existing];
}

function readNextOffset(data: any, fallbackOffset: number, fallbackPageCount: number): number {
  const explicitNextOffset = Number(data?.nextOffset);
  if (Number.isFinite(explicitNextOffset) && explicitNextOffset >= fallbackOffset) {
    return explicitNextOffset;
  }

  const responseOffset = Number(data?.offset);
  if (Number.isFinite(responseOffset) && responseOffset > fallbackOffset) {
    return responseOffset;
  }

  return fallbackOffset + fallbackPageCount;
}

function reassignSessionMessages(
  messages: NormalizedMessage[],
  fromSessionId: string,
  toSessionId: string,
): NormalizedMessage[] {
  if (messages.length === 0) return messages;
  const oldStreamId = `__streaming_${fromSessionId}`;
  const newStreamId = `__streaming_${toSessionId}`;

  return messages.map((message) => ({
    ...message,
    id: message.id === oldStreamId ? newStreamId : message.id,
    sessionId: toSessionId,
  }));
}

// Stale threshold.

const STALE_THRESHOLD_MS = 30_000;

const MAX_REALTIME_MESSAGES = 500;
const USER_ECHO_DEDUPE_WINDOW_MS = 5_000;

function normalizeUserContent(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return normalized.length > 0 ? normalized : null;
}

function timestampMs(message: NormalizedMessage): number | null {
  const value = new Date(message.timestamp).getTime();
  return Number.isFinite(value) ? value : null;
}

function isUserTextMessage(message: NormalizedMessage): boolean {
  return message.kind === 'text' && message.role === 'user' && Boolean(normalizeUserContent(message.content));
}

function isOptimisticUserMessage(message: NormalizedMessage): boolean {
  return isUserTextMessage(message)
    && (message.id.startsWith('client_user_') || message.id.startsWith('local_'));
}

function hasSameRecentUserContent(a: NormalizedMessage, b: NormalizedMessage): boolean {
  const aContent = normalizeUserContent(a.content);
  const bContent = normalizeUserContent(b.content);
  if (!aContent || !bContent || aContent !== bContent) return false;

  const aTimestamp = timestampMs(a);
  const bTimestamp = timestampMs(b);
  if (aTimestamp === null || bTimestamp === null) return false;

  return Math.abs(aTimestamp - bTimestamp) <= USER_ECHO_DEDUPE_WINDOW_MS;
}

function isControlMessage(message: NormalizedMessage): boolean {
  return message.kind === 'session_created'
    || message.kind === 'status'
    || message.kind === 'complete'
    || message.kind === 'permission_request'
    || message.kind === 'permission_cancelled'
    || message.kind === 'stream_end';
}

function findRecentOptimisticUserEcho(
  messages: NormalizedMessage[],
  incoming: NormalizedMessage,
): number {
  if (!isUserTextMessage(incoming)) return -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (
      (isOptimisticUserMessage(existing) || isOptimisticUserMessage(incoming))
      && isUserTextMessage(existing)
      && hasSameRecentUserContent(existing, incoming)
    ) {
      return index;
    }

    if (!isControlMessage(existing)) {
      return -1;
    }
  }

  return -1;
}

function hasServerEchoForOptimisticUser(
  server: NormalizedMessage[],
  realtimeMessage: NormalizedMessage,
): boolean {
  return isOptimisticUserMessage(realtimeMessage)
    && server.some((serverMessage) =>
      isUserTextMessage(serverMessage) && hasSameRecentUserContent(serverMessage, realtimeMessage)
    );
}

// Hook.

export function useSessionStore() {
  const storeRef = useRef(new Map<string, SessionSlot>());
  const activeSessionIdRef = useRef<string | null>(null);
  // Bump to force re-render only when the active session's data changes.
  const [, setTick] = useState(0);
  const notify = useCallback((sessionId: string) => {
    if (sessionId === activeSessionIdRef.current) {
      setTick(n => n + 1);
    }
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId;
  }, []);

  const getSlot = useCallback((sessionId: string): SessionSlot => {
    const store = storeRef.current;
    if (!store.has(sessionId)) {
      store.set(sessionId, createEmptySlot());
    }
    return store.get(sessionId)!;
  }, []);

  const has = useCallback((sessionId: string) => storeRef.current.has(sessionId), []);

  /**
   * Fetch messages from the unified endpoint and populate serverMessages.
   */
  const fetchFromServer = useCallback(async (
    sessionId: string,
    opts: {
      provider?: LLMProvider;
      projectName?: string;
      projectPath?: string;
      limit?: number | null;
      offset?: number;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    slot.status = 'loading';
    notify(sessionId);

    try {
      const params = new URLSearchParams();
      if (opts.provider) params.append('provider', opts.provider);
      if (opts.projectName) params.append('projectName', opts.projectName);
      if (opts.projectPath) params.append('projectPath', opts.projectPath);
      if (opts.limit !== null && opts.limit !== undefined) {
        params.append('limit', String(opts.limit));
        params.append('offset', String(opts.offset ?? 0));
      }

      const qs = params.toString();
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;
      const response = await apiFetch(url);

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          message = errorData?.error || errorData?.details || message;
        } catch {
          // Keep HTTP status fallback.
        }
        throw new Error(message);
      }

      const data = await response.json();
      const messages: NormalizedMessage[] = data.messages || [];
      const requestOffset = opts.offset ?? 0;
      const nextOffset = readNextOffset(data, requestOffset, messages.length);

      slot.serverMessages = messages;
      slot.total = data.total ?? messages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = nextOffset;
      slot.loadedCount = Math.min(slot.total || nextOffset, nextOffset);
      slot.fetchedAt = Date.now();
      slot.status = 'idle';
      slot.errorMessage = undefined;
      recomputeMergedIfNeeded(slot);
      if (data.tokenUsage) {
        slot.tokenUsage = data.tokenUsage;
        slot.contextBudget = data.tokenUsage?.contextBudget || data.tokenUsage;
      } else if (data.contextBudget) {
        slot.contextBudget = data.contextBudget;
      }

      notify(sessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetch failed for ${sessionId}:`, error);
      slot.status = 'error';
      slot.errorMessage = error instanceof Error ? error.message : 'Failed to load session messages';
      notify(sessionId);
      return slot;
    }
  }, [getSlot, notify]);

  /**
   * Load older (paginated) messages and prepend to serverMessages.
   */
  const fetchMore = useCallback(async (
    sessionId: string,
    opts: {
      provider?: LLMProvider;
      projectName?: string;
      projectPath?: string;
      limit?: number;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    if (!slot.hasMore) return slot;

    const params = new URLSearchParams();
    if (opts.provider) params.append('provider', opts.provider);
    if (opts.projectName) params.append('projectName', opts.projectName);
    if (opts.projectPath) params.append('projectPath', opts.projectPath);
    const limit = opts.limit ?? 20;
    params.append('limit', String(limit));
    params.append('offset', String(slot.offset));

    const qs = params.toString();
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;

    try {
      const response = await apiFetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const olderMessages: NormalizedMessage[] = data.messages || [];
      const previousOffset = slot.offset;
      const nextOffset = readNextOffset(data, previousOffset, olderMessages.length);

      // Prepend older messages (they're earlier in the conversation)
      slot.serverMessages = prependUniqueMessages(olderMessages, slot.serverMessages);
      slot.total = data.total ?? slot.total;
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = Math.max(previousOffset, nextOffset);
      slot.loadedCount = Math.min(slot.total || slot.offset, slot.offset);
      if (olderMessages.length === 0 || (slot.offset === previousOffset && slot.hasMore)) {
        slot.hasMore = false;
      }
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetchMore failed for ${sessionId}:`, error);
      return slot;
    }
  }, [getSlot, notify]);

  /**
   * Append a realtime (WebSocket) message to the correct session slot.
   * This works regardless of which session is actively viewed.
   */
  const appendRealtime = useCallback((sessionId: string, msg: NormalizedMessage) => {
    const slot = getSlot(sessionId);
    const existingIndex = slot.realtimeMessages.findIndex((message) => message.id === msg.id);
    const optimisticEchoIndex = existingIndex >= 0
      ? existingIndex
      : findRecentOptimisticUserEcho(slot.realtimeMessages, msg);

    let updated: NormalizedMessage[];
    if (optimisticEchoIndex >= 0) {
      updated = [...slot.realtimeMessages];
      updated[optimisticEchoIndex] = msg;
    } else {
      updated = [...slot.realtimeMessages, msg];
    }
    if (updated.length > MAX_REALTIME_MESSAGES) {
      updated = updated.slice(-MAX_REALTIME_MESSAGES);
    }
    slot.realtimeMessages = updated;
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Append multiple realtime messages at once (batch).
   */
  const appendRealtimeBatch = useCallback((sessionId: string, msgs: NormalizedMessage[]) => {
    if (msgs.length === 0) return;
    const slot = getSlot(sessionId);
    let updated = [...slot.realtimeMessages, ...msgs];
    if (updated.length > MAX_REALTIME_MESSAGES) {
      updated = updated.slice(-MAX_REALTIME_MESSAGES);
    }
    slot.realtimeMessages = updated;
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Move locally buffered messages from a temporary UI session to the real CLI session.
   */
  const replaceSessionId = useCallback((fromSessionId: string, toSessionId: string) => {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return;

    const store = storeRef.current;
    const fromSlot = store.get(fromSessionId);
    if (!fromSlot) return;

    const toSlot = getSlot(toSessionId);
    const movedServerMessages = reassignSessionMessages(fromSlot.serverMessages, fromSessionId, toSessionId);
    const movedRealtimeMessages = reassignSessionMessages(fromSlot.realtimeMessages, fromSessionId, toSessionId);

    toSlot.serverMessages = mergeMessagesById(toSlot.serverMessages, movedServerMessages);
    toSlot.realtimeMessages = mergeMessagesById(toSlot.realtimeMessages, movedRealtimeMessages);
    toSlot.total = Math.max(toSlot.total, toSlot.serverMessages.length);
    toSlot.hasMore = toSlot.hasMore || fromSlot.hasMore;
    toSlot.offset = Math.max(toSlot.offset, fromSlot.offset);
    toSlot.loadedCount = Math.max(toSlot.loadedCount, fromSlot.loadedCount, toSlot.offset);
    if (!toSlot.tokenUsage && fromSlot.tokenUsage) {
      toSlot.tokenUsage = fromSlot.tokenUsage;
    }
    if (!toSlot.contextBudget && fromSlot.contextBudget) {
      toSlot.contextBudget = fromSlot.contextBudget;
    }

    recomputeMergedIfNeeded(toSlot);
    store.delete(fromSessionId);

    if (activeSessionIdRef.current === fromSessionId) {
      activeSessionIdRef.current = toSessionId;
    }

    notify(toSessionId);
  }, [getSlot, notify]);

  /**
   * Re-fetch serverMessages from the unified endpoint (e.g., on projects_updated).
   */
  const refreshFromServer = useCallback(async (
    sessionId: string,
    opts: {
      provider?: LLMProvider;
      projectName?: string;
      projectPath?: string;
      limit?: number | null;
      offset?: number;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    try {
      const params = new URLSearchParams();
      if (opts.provider) params.append('provider', opts.provider);
      if (opts.projectName) params.append('projectName', opts.projectName);
      if (opts.projectPath) params.append('projectPath', opts.projectPath);
      if (opts.limit !== null && opts.limit !== undefined) {
        params.append('limit', String(opts.limit));
        params.append('offset', String(opts.offset ?? 0));
      }

      const qs = params.toString();
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;
      const response = await apiFetch(url);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      const messages: NormalizedMessage[] = data.messages || [];
      const requestOffset = opts.offset ?? 0;
      const nextOffset = opts.limit !== null && opts.limit !== undefined
        ? readNextOffset(data, requestOffset, messages.length)
        : messages.length;
      slot.serverMessages = messages;
      slot.total = data.total ?? slot.serverMessages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = nextOffset;
      slot.loadedCount = Math.min(slot.total || nextOffset, nextOffset);
      slot.fetchedAt = Date.now();
      if (data.tokenUsage) {
        slot.tokenUsage = data.tokenUsage;
        slot.contextBudget = data.tokenUsage?.contextBudget || data.tokenUsage;
      } else if (data.contextBudget) {
        slot.contextBudget = data.contextBudget;
      }
      // drop realtime messages that the server has caught up with to prevent unbounded growth.
      slot.realtimeMessages = [];
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    } catch (error) {
      console.error(`[SessionStore] refresh failed for ${sessionId}:`, error);
    }
  }, [getSlot, notify]);

  /**
   * Update session status.
   */
  const setStatus = useCallback((sessionId: string, status: SessionStatus) => {
    const slot = getSlot(sessionId);
    slot.status = status;
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Check if a session's data is stale (>30s old).
   */
  const isStale = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return true;
    return Date.now() - slot.fetchedAt > STALE_THRESHOLD_MS;
  }, []);

  /**
   * Update or create a streaming message (accumulated text so far).
   * Uses a well-known ID so subsequent calls replace the same message.
   */
  const updateStreaming = useCallback((sessionId: string, accumulatedText: string, msgProvider: LLMProvider) => {
    const slot = getSlot(sessionId);
    const streamId = `__streaming_${sessionId}`;
    const msg: NormalizedMessage = {
      id: streamId,
      sessionId,
      timestamp: new Date().toISOString(),
      provider: msgProvider,
      kind: 'stream_delta',
      content: accumulatedText,
    };
    const idx = slot.realtimeMessages.findIndex(m => m.id === streamId);
    if (idx >= 0) {
      slot.realtimeMessages = [...slot.realtimeMessages];
      slot.realtimeMessages[idx] = msg;
    } else {
      slot.realtimeMessages = [...slot.realtimeMessages, msg];
    }
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Finalize streaming: convert the streaming message to a regular text message.
   * The well-known streaming ID is replaced with a unique text message ID.
   */
  const finalizeStreaming = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return;
    const streamId = `__streaming_${sessionId}`;
    const idx = slot.realtimeMessages.findIndex(m => m.id === streamId);
    if (idx >= 0) {
      const stream = slot.realtimeMessages[idx];
      slot.realtimeMessages = [...slot.realtimeMessages];
      slot.realtimeMessages[idx] = {
        ...stream,
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: 'text',
        role: 'assistant',
      };
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);

  /**
   * Clear realtime messages for a session (e.g., after stream completes and server fetch catches up).
   */
  const clearRealtime = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (slot) {
      slot.realtimeMessages = [];
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);

  /**
   * Get merged messages for a session (for rendering).
   */
  const getMessages = useCallback((sessionId: string): NormalizedMessage[] => {
    return storeRef.current.get(sessionId)?.merged ?? [];
  }, []);

  /**
   * Get session slot (for status, pagination info, etc.).
   */
  const getSessionSlot = useCallback((sessionId: string): SessionSlot | undefined => {
    return storeRef.current.get(sessionId);
  }, []);

  return useMemo(() => ({
    getSlot,
    has,
    fetchFromServer,
    fetchMore,
    appendRealtime,
    appendRealtimeBatch,
    replaceSessionId,
    refreshFromServer,
    setActiveSession,
    setStatus,
    isStale,
    updateStreaming,
    finalizeStreaming,
    clearRealtime,
    getMessages,
    getSessionSlot,
  }), [
    getSlot, has, fetchFromServer, fetchMore,
    appendRealtime, appendRealtimeBatch, replaceSessionId, refreshFromServer,
    setActiveSession, setStatus, isStale, updateStreaming, finalizeStreaming,
    clearRealtime, getMessages, getSessionSlot,
  ]);
}

export type SessionStore = ReturnType<typeof useSessionStore>;
