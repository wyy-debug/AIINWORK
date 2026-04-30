import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { ChatMessage } from '../../types/types';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { AgentConfig } from '../../../../types/agent';
import { getIntrinsicMessageKey } from '../../utils/messageKeys';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../../shared/view/ui';

import MessageComponent from './MessageComponent';
import ProviderSelectionEmptyState from './ProviderSelectionEmptyState';

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (provider: LLMProvider) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  isSessionRunning?: boolean;
  loadEarlierMessages: () => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  isConversationSpace?: boolean;
  agents?: AgentConfig[];
  selectedAgentName?: string;
  agentChoiceState?: 'pending' | 'default' | 'agent';
  onUseDefaultAgent?: () => void;
  onSelectConversationAgent?: (agentId: string) => void;
  selectedModelProfileId?: string;
  onModelProfileChange?: (profileId: string) => void;
}

type ProcessTraceGroupProps = {
  messages: ChatMessage[];
  active: boolean;
  groupKey: string;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  provider: LLMProvider;
  getMessageKey: (message: ChatMessage) => string;
};

const parseTimestamp = (value: ChatMessage['timestamp']) => {
  const time = new Date(value || Date.now()).getTime();
  return Number.isFinite(time) ? time : Date.now();
};

const formatElapsed = (milliseconds: number) => {
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

const isProcessMessage = (message: ChatMessage) =>
  Boolean(message.isThinking || message.isToolUse);

const isUserMessage = (message: ChatMessage) => message.type === 'user';

const hasVisibleAssistantText = (message: ChatMessage) =>
  message.type === 'assistant' &&
  !message.isThinking &&
  !message.isToolUse &&
  !message.isTaskNotification &&
  !message.isInteractivePrompt &&
  !message.isContextCompaction &&
  !message.isStreaming &&
  Boolean(String(message.content || '').trim());

function ProcessTraceGroup({
  messages,
  active,
  groupKey,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
  getMessageKey,
}: ProcessTraceGroupProps) {
  const [open, setOpen] = useState(active);
  const wasActiveRef = useRef(active);

  useEffect(() => {
    if (active) {
      setOpen(true);
    } else if (wasActiveRef.current) {
      setOpen(false);
    }
    wasActiveRef.current = active;
  }, [active]);

  const elapsed = useMemo(() => {
    if (messages.length === 0) return '1s';
    const start = parseTimestamp(messages[0].timestamp);
    const lastMessage = messages[messages.length - 1];
    const resultTimestamp = lastMessage.toolResult?.timestamp;
    const end = active
      ? Date.now()
      : parseTimestamp(resultTimestamp || lastMessage.timestamp);
    return formatElapsed(end - start);
  }, [active, messages]);

  const summaryParts = useMemo(() => {
    let toolCount = 0;
    let thinkingCount = 0;

    for (const message of messages) {
      if (message.isToolUse) toolCount += 1;
      if (message.isThinking) thinkingCount += 1;
    }

    return [
      thinkingCount > 0 ? `${thinkingCount} 段思考` : null,
      toolCount > 0 ? `${toolCount} 个工具` : null,
    ].filter(Boolean);
  }, [messages]);

  const shouldRenderDetails = open || active;

  return (
    <div className="chat-message assistant px-3 sm:px-0">
      <Collapsible open={open} onOpenChange={setOpen} className="not-prose">
        <div className="flex items-center gap-3 py-1">
          <CollapsibleTrigger className="group/process inline-flex min-w-0 items-center gap-2 rounded-full px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 group-data-[state=open]/process:bg-primary" />
            <span className="font-medium">{active ? '处理中' : '已处理'}</span>
            <span>{elapsed}</span>
            {summaryParts.length > 0 && (
              <span className="hidden text-muted-foreground/70 sm:inline">
                {summaryParts.join(' · ')}
              </span>
            )}
            <svg
              className="h-3.5 w-3.5 flex-shrink-0 transition-transform group-data-[state=open]/process:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </CollapsibleTrigger>
          <div className="h-px min-w-0 flex-1 bg-border/70" />
        </div>

        <CollapsibleContent>
          {shouldRenderDetails && (
            <div className="mt-1 space-y-3 border-l border-border/70 pl-3">
              {messages.map((message, index) => (
                <MessageComponent
                  key={`${groupKey}-${getMessageKey(message)}`}
                  message={message}
                  prevMessage={index > 0 ? messages[index - 1] : null}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  onGrantToolPermission={onGrantToolPermission}
                  autoExpandTools={Boolean(autoExpandTools && active)}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  selectedProject={selectedProject}
                  provider={provider}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  geminiModel,
  setGeminiModel,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  visibleMessageCount,
  visibleMessages,
  isSessionRunning = false,
  loadEarlierMessages,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  isConversationSpace,
  agents,
  selectedAgentName,
  agentChoiceState,
  onUseDefaultAgent,
  onSelectConversationAgent,
  selectedModelProfileId,
  onModelProfileChange,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const messageKeyMapRef = useRef<WeakMap<ChatMessage, string>>(new WeakMap());
  const allocatedKeysRef = useRef<Set<string>>(new Set());
  const generatedMessageKeyCounterRef = useRef(0);

  // Keep keys stable across prepends so existing MessageComponent instances retain local state.
  const getMessageKey = useCallback((message: ChatMessage) => {
    const existingKey = messageKeyMapRef.current.get(message);
    if (existingKey) {
      return existingKey;
    }

    const intrinsicKey = getIntrinsicMessageKey(message);
    let candidateKey = intrinsicKey;

    if (!candidateKey || allocatedKeysRef.current.has(candidateKey)) {
      do {
        generatedMessageKeyCounterRef.current += 1;
        candidateKey = intrinsicKey
          ? `${intrinsicKey}-${generatedMessageKeyCounterRef.current}`
          : `message-generated-${generatedMessageKeyCounterRef.current}`;
      } while (allocatedKeysRef.current.has(candidateKey));
    }

    allocatedKeysRef.current.add(candidateKey);
    messageKeyMapRef.current.set(message, candidateKey);
    return candidateKey;
  }, []);

  const renderedMessageItems = useMemo(() => {
    type RenderedMessageItem =
      | { type: 'message'; message: ChatMessage; prevMessage: ChatMessage | null }
      | { type: 'process'; messages: ChatMessage[]; active: boolean; key: string };

    const items: RenderedMessageItem[] = [];

    const pushMessage = (message: ChatMessage, originalIndex: number) => {
      items.push({
        type: 'message',
        message,
        prevMessage: originalIndex > 0 ? visibleMessages[originalIndex - 1] : null,
      });
    };

    const pushAssistantSegment = (segment: ChatMessage[], segmentStartIndex: number, isTailSegment: boolean) => {
      const lastProcessIndex = segment.reduce(
        (lastIndex, message, index) => isProcessMessage(message) ? index : lastIndex,
        -1,
      );

      if (lastProcessIndex < 0) {
        segment.forEach((message, index) => pushMessage(message, segmentStartIndex + index));
        return;
      }

      const hasAnswerAfterProcess = segment
        .slice(lastProcessIndex + 1)
        .some(hasVisibleAssistantText);
      const active = Boolean(isSessionRunning && isTailSegment && !hasAnswerAfterProcess);
      const traceEndIndex = active ? segment.length : lastProcessIndex + 1;
      const traceMessages = segment.slice(0, traceEndIndex);
      const finalMessages = segment.slice(traceEndIndex);

      if (traceMessages.length > 0) {
        const firstKey = getMessageKey(traceMessages[0]);
        const lastKey = getMessageKey(traceMessages[traceMessages.length - 1]);
        items.push({
          type: 'process',
          messages: traceMessages,
          active,
          key: `process-${segmentStartIndex}-${firstKey}-${lastKey}`,
        });
      }

      finalMessages.forEach((message, index) => {
        pushMessage(message, segmentStartIndex + traceEndIndex + index);
      });
    };

    for (let index = 0; index < visibleMessages.length; index += 1) {
      const message = visibleMessages[index];

      if (isUserMessage(message)) {
        pushMessage(message, index);
        continue;
      }

      const segmentStartIndex = index;
      const segment: ChatMessage[] = [];

      while (index < visibleMessages.length && !isUserMessage(visibleMessages[index])) {
        segment.push(visibleMessages[index]);
        index += 1;
      }
      index -= 1;

      pushAssistantSegment(segment, segmentStartIndex, index === visibleMessages.length - 1);
    }

    return items;
  }, [getMessageKey, isSessionRunning, visibleMessages]);

  return (
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      className="relative flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-0 py-3 sm:space-y-4 sm:p-4"
    >
      {isLoadingSessionMessages && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
          <div className="flex items-center justify-center space-x-2">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={setProvider}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isConversationSpace={isConversationSpace}
          agents={agents}
          selectedAgentName={selectedAgentName}
          agentChoiceState={agentChoiceState}
          onUseDefaultAgent={onUseDefaultAgent}
          onSelectConversationAgent={onSelectConversationAgent}
          selectedModelProfileId={selectedModelProfileId}
          onModelProfileChange={onModelProfileChange}
          hasConversationContext={Boolean(selectedSession || currentSessionId)}
        />
      ) : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="py-3 text-center text-gray-500 dark:text-gray-400">
              <div className="flex items-center justify-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* Indicator showing there are more messages to load (hide when all loaded) */}
          {hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {totalMessages > 0 && (
                <span>
                  {t('session.messages.showingOf', { shown: sessionMessagesCount, total: totalMessages })}{' '}
                  <span className="text-xs">{t('session.messages.scrollToLoad')}</span>
                </span>
              )}
            </div>
          )}

          {/* Floating "Load all messages" overlay */}
          {(showLoadAllOverlay || isLoadingAllMessages || loadAllJustFinished) && (
            <div className="pointer-events-none sticky top-2 z-20 flex justify-center">
              {loadAllJustFinished ? (
                <div className="flex items-center space-x-2 rounded-full bg-green-600 px-4 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-green-500">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{t('session.messages.allLoaded')}</span>
                </div>
              ) : (
                <button
                  className="pointer-events-auto flex items-center space-x-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-medium text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-blue-700 disabled:cursor-wait disabled:opacity-75 dark:bg-blue-500 dark:hover:bg-blue-600"
                  onClick={loadAllMessages}
                  disabled={isLoadingAllMessages}
                >
                  {isLoadingAllMessages && (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  )}
                  <span>
                    {isLoadingAllMessages
                      ? t('session.messages.loadingAll')
                      : <>{t('session.messages.loadAll')} {totalMessages > 0 && `(${totalMessages})`}</>
                    }
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Performance warning when all messages are loaded */}
          {allMessagesLoaded && (
            <div className="border-b border-amber-200 bg-amber-50 py-1.5 text-center text-xs text-amber-600 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
              {t('session.messages.perfWarning')}
            </div>
          )}

          {/* Legacy message count indicator (for non-paginated view) */}
          {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t('session.messages.showingLast', { count: visibleMessageCount, total: chatMessages.length })} |
              <button className="ml-1 text-blue-600 underline hover:text-blue-700" onClick={loadEarlierMessages}>
                {t('session.messages.loadEarlier')}
              </button>
              {' | '}
              <button
                className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                onClick={loadAllMessages}
              >
                {t('session.messages.loadAll')}
              </button>
            </div>
          )}

          {renderedMessageItems.map((item) => {
            if (item.type === 'process') {
              return (
                <ProcessTraceGroup
                  key={item.key}
                  groupKey={item.key}
                  messages={item.messages}
                  active={item.active}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  onGrantToolPermission={onGrantToolPermission}
                  autoExpandTools={autoExpandTools}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  selectedProject={selectedProject}
                  provider={provider}
                  getMessageKey={getMessageKey}
                />
              );
            }

            return (
              <MessageComponent
                key={getMessageKey(item.message)}
                message={item.message}
                prevMessage={item.prevMessage}
                createDiff={createDiff}
                onFileOpen={onFileOpen}
                onShowSettings={onShowSettings}
                onGrantToolPermission={onGrantToolPermission}
                autoExpandTools={Boolean(autoExpandTools && isSessionRunning)}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                selectedProject={selectedProject}
                provider={provider}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

