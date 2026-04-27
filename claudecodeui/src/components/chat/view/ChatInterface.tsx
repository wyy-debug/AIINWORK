import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import PermissionContext from '../../../contexts/PermissionContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps, Provider  } from '../types/types';
import type { LLMProvider } from '../../../types/app';
import type { AgentAppBinding, AgentConfig } from '../../../types/agent';
import { api } from '../../../utils/api';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useSessionStore } from '../../../stores/useSessionStore';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import AgentSessionSetupDialog from './subcomponents/AgentSessionSetupDialog';


type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

function normalizeAgentAppBindings(value: unknown): AgentAppBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((binding) => {
      const item = binding && typeof binding === 'object' ? binding as Partial<AgentAppBinding> : {};
      const slot = typeof item.slot === 'string' ? item.slot.trim() : '';
      const app = typeof item.app === 'string' ? item.app.trim() : '';
      if (!slot || !app) return null;
      const status = item.status === 'connected' || item.status === 'disabled' ? item.status : 'optional';
      return { slot, app, status };
    })
    .filter((binding): binding is AgentAppBinding => Boolean(binding));
}

function shouldConfigureAgent(agent: AgentConfig | null) {
  return Boolean(agent && agent.appBindings.length > 0);
}

function ChatInterface({
  selectedProject,
  selectedSession,
  quickStartAgentId,
  quickStartAgentRequestId,
  ws,
  sendMessage,
  latestMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  onShowAllTasks,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { t } = useTranslation('chat');

  const sessionStore = useSessionStore();
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const previousCurrentSessionIdRef = useRef<string | null>(null);
  const agentBindingLoadKeyRef = useRef('');
  const agentBindingPersistKeyRef = useRef('');
  const skipNextAgentBindingLoadKeyRef = useRef('');
  const lastQuickStartAgentRequestRef = useRef(0);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedAgentAppBindings, setSelectedAgentAppBindings] = useState<AgentAppBinding[]>([]);
  const [pendingAgentSetup, setPendingAgentSetup] = useState<AgentConfig | null>(null);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
    accumulatedStreamRef.current = '';
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAgents = async () => {
      try {
        const response = await api.agents(false);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load agents');
        }
        if (!cancelled) {
          setAgents(Array.isArray(data?.agents) ? data.agents : []);
        }
      } catch (error) {
        console.warn('Failed to load chat agents:', error);
        if (!cancelled) {
          setAgents([]);
        }
      }
    };

    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledAgents = useMemo(
    () => agents.filter((agent) => agent.status === 'enabled'),
    [agents],
  );
  const selectedAgent = useMemo(
    () => enabledAgents.find((agent) => agent.id === selectedAgentId) || null,
    [enabledAgents, selectedAgentId],
  );

  const selectAgentForConversation = useCallback((agentId: string) => {
    if (!agentId) {
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      return;
    }

    const agent = enabledAgents.find((entry) => entry.id === agentId) || null;
    if (!agent) {
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      return;
    }

    if (shouldConfigureAgent(agent)) {
      setPendingAgentSetup(agent);
      return;
    }

    setPendingAgentSetup(null);
    setSelectedAgentId(agent.id);
    setSelectedAgentAppBindings([]);
  }, [enabledAgents]);

  const confirmAgentSetup = useCallback((agent: AgentConfig, appBindings: AgentAppBinding[]) => {
    const normalizedBindings = normalizeAgentAppBindings(appBindings);
    setPendingAgentSetup(null);
    setSelectedAgentId(agent.id);
    setSelectedAgentAppBindings(normalizedBindings);
  }, []);

  useEffect(() => {
    if (!quickStartAgentId || !quickStartAgentRequestId) {
      return;
    }
    if (lastQuickStartAgentRequestRef.current === quickStartAgentRequestId) {
      return;
    }
    if (!enabledAgents.some((agent) => agent.id === quickStartAgentId)) {
      return;
    }

    const agent = enabledAgents.find((entry) => entry.id === quickStartAgentId) || null;
    if (!agent) {
      return;
    }
    if (shouldConfigureAgent(agent)) {
      setPendingAgentSetup(agent);
    } else {
      setPendingAgentSetup(null);
      setSelectedAgentId(agent.id);
      setSelectedAgentAppBindings([]);
    }
    lastQuickStartAgentRequestRef.current = quickStartAgentRequestId;
  }, [enabledAgents, quickStartAgentId, quickStartAgentRequestId]);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
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
    visibleMessages,
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
    handleScroll,
  } = useChatSessionState({
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
  });

  const activeConversationSessionId = useMemo(
    () => {
      const sessionId = selectedSession?.id || currentSessionId;
      return sessionId && !isTemporarySessionId(sessionId) ? sessionId : null;
    },
    [currentSessionId, selectedSession?.id],
  );

  useEffect(() => {
    const bindingKey = activeConversationSessionId ? `${provider}:${activeConversationSessionId}` : '';
    const previousSessionId = previousCurrentSessionIdRef.current;
    previousCurrentSessionIdRef.current = currentSessionId;

    if (
      isTemporarySessionId(previousSessionId)
      && activeConversationSessionId
      && !selectedSession?.id
      && selectedAgentId
    ) {
      skipNextAgentBindingLoadKeyRef.current = bindingKey;
      agentBindingPersistKeyRef.current = `${bindingKey}:${selectedAgentId}:${JSON.stringify({ appBindings: selectedAgentAppBindings })}`;
      void api.updateSessionAgent(activeConversationSessionId, selectedAgentId, provider, {
        appBindings: selectedAgentAppBindings,
      }).catch((error) => {
        console.warn('Failed to persist new conversation Agent binding:', error);
        agentBindingPersistKeyRef.current = '';
      });
    }
  }, [activeConversationSessionId, currentSessionId, provider, selectedAgentAppBindings, selectedAgentId, selectedSession?.id]);

  useEffect(() => {
    if (!selectedSession?.id && !currentSessionId) {
      const hasQuickStartAgent = Boolean(
        quickStartAgentId
        && quickStartAgentRequestId
        && lastQuickStartAgentRequestRef.current === quickStartAgentRequestId,
      );
      if (!hasQuickStartAgent) {
        setSelectedAgentId('');
        setSelectedAgentAppBindings([]);
      }
      return;
    }

    if (!activeConversationSessionId) {
      return;
    }

    const bindingKey = `${provider}:${activeConversationSessionId}`;
    if (skipNextAgentBindingLoadKeyRef.current === bindingKey) {
      skipNextAgentBindingLoadKeyRef.current = '';
      return;
    }

    let cancelled = false;
    agentBindingLoadKeyRef.current = bindingKey;

    const loadSessionAgent = async () => {
      try {
        const response = await api.sessionAgent(activeConversationSessionId, provider);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load conversation Agent binding');
        }
        if (cancelled || agentBindingLoadKeyRef.current !== bindingKey) {
          return;
        }
        const nextAgentId = typeof data?.agentId === 'string' ? data.agentId : '';
        const nextAppBindings = normalizeAgentAppBindings(data?.configuration?.appBindings || data?.agent?.appBindings);
        setSelectedAgentId(nextAgentId);
        setSelectedAgentAppBindings(nextAppBindings);
        agentBindingPersistKeyRef.current = `${bindingKey}:${nextAgentId}:${JSON.stringify({ appBindings: nextAppBindings })}`;
      } catch (error) {
        console.warn('Failed to load conversation Agent binding:', error);
        if (!cancelled && agentBindingLoadKeyRef.current === bindingKey) {
          setSelectedAgentId('');
          setSelectedAgentAppBindings([]);
          agentBindingPersistKeyRef.current = `${bindingKey}:`;
        }
      }
    };

    void loadSessionAgent();
    return () => {
      cancelled = true;
    };
  }, [activeConversationSessionId, currentSessionId, provider, quickStartAgentId, quickStartAgentRequestId, selectedSession?.id]);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }
    if (!enabledAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
    }
  }, [enabledAgents, selectedAgentId]);

  useEffect(() => {
    if (!activeConversationSessionId) {
      return;
    }

    const configuration = { appBindings: selectedAgentAppBindings };
    const bindingKey = `${provider}:${activeConversationSessionId}:${selectedAgentId}:${JSON.stringify(configuration)}`;
    if (agentBindingPersistKeyRef.current === bindingKey) {
      return;
    }
    agentBindingPersistKeyRef.current = bindingKey;

    const persistSessionAgent = selectedAgentId
      ? api.updateSessionAgent(activeConversationSessionId, selectedAgentId, provider, configuration)
      : api.clearSessionAgent(activeConversationSessionId, provider);

    void persistSessionAgent.catch((error) => {
      console.warn('Failed to persist conversation Agent binding:', error);
      agentBindingPersistKeyRef.current = '';
    });
  }, [activeConversationSessionId, provider, selectedAgentAppBindings, selectedAgentId]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    cursorModel,
    claudeModel,
    codexModel,
    geminiModel,
    agents: enabledAgents,
    selectedAgentId,
    selectedAgentAppBindings,
    isLoading,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionActive,
    onSessionProcessing,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    addMessage,
    clearMessages,
    rewindMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
  });

  // On WebSocket reconnect, re-fetch the current session's messages from the server
  // so missed streaming events are shown. Also reset isLoading.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    const providerVal = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    await sessionStore.refreshFromServer(selectedSession.id, {
      provider: (selectedSession.__provider || providerVal) as LLMProvider,
      projectName: selectedProject.name,
      projectPath: selectedProject.fullPath || selectedProject.path || '',
    });
    setIsLoading(false);
    setCanAbortSession(false);
  }, [selectedProject, selectedSession, sessionStore, setIsLoading, setCanAbortSession]);

  useChatRealtimeHandlers({
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    accumulatedStreamRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    onWebSocketReconnect: handleWebSocketReconnect,
    sessionStore,
  });

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  if (!selectedProject) {
    const selectedProviderLabel =
      provider === 'cursor'
        ? t('messageTypes.cursor')
        : provider === 'codex'
          ? t('messageTypes.codex')
          : provider === 'gemini'
            ? t('messageTypes.gemini')
            : t('messageTypes.claude');

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full flex-col">
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
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
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={chatMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          selectedAgentName={selectedAgent?.shortName || selectedAgent?.name || ''}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus}
          isLoading={isLoading}
          onAbortSession={handleAbortSession}
          provider={provider}
          agents={enabledAgents}
          selectedAgentId={selectedAgentId}
          onSelectedAgentIdChange={selectAgentForConversation}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          thinkingMode={thinkingMode}
          setThinkingMode={setThinkingMode}
          tokenBudget={tokenBudget}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', {
            provider:
              provider === 'cursor'
                ? t('messageTypes.cursor')
                : provider === 'codex'
                  ? t('messageTypes.codex')
                  : provider === 'gemini'
                    ? t('messageTypes.gemini')
                    : t('messageTypes.claude'),
          })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
        />
      </div>

      {pendingAgentSetup && (
        <AgentSessionSetupDialog
          agent={pendingAgentSetup}
          initialBindings={selectedAgentId === pendingAgentSetup.id ? selectedAgentAppBindings : pendingAgentSetup.appBindings}
          isLoading={isLoading}
          onCancel={() => setPendingAgentSetup(null)}
          onConfirm={(bindings) => confirmAgentSetup(pendingAgentSetup, bindings)}
        />
      )}

      <QuickSettingsPanel />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
