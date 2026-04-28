import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import PermissionContext from '../../../contexts/PermissionContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { AgentRuntimeDiagnostics, ChatInterfaceProps, Provider  } from '../types/types';
import type { LLMProvider } from '../../../types/app';
import type { AgentAppBinding, AgentConfig, InstalledSkill } from '../../../types/agent';
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

type ConversationAgentChoiceState = 'pending' | 'default' | 'agent';

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

function normalizeSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((skill) => (typeof skill === 'string' ? skill.trim() : ''))
    .filter(Boolean)
    .filter((skill) => {
      const key = skill.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 60);
}

function shouldConfigureAgent(agent: AgentConfig | null) {
  return Boolean(agent && agent.appBindings.length > 0);
}

function ChatInterface({
  selectedProject,
  selectedSession,
  isConversationSpace = false,
  quickStartAgentId,
  quickStartAgentRequestId,
  newConversationRequestId,
  newProjectSessionRequestId,
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
  const agentBindingHydratedKeyRef = useRef('');
  const skipNextAgentBindingLoadKeyRef = useRef('');
  const worktreeDefaultsKeyRef = useRef('');
  const worktreeSessionPersistKeyRef = useRef('');
  const worktreePromptPrefillKeyRef = useRef('');
  const projectSkillBindingLoadKeyRef = useRef('');
  const projectSkillBindingPersistKeyRef = useRef('');
  const projectSkillBindingHydratedKeyRef = useRef('');
  const lastQuickStartAgentRequestRef = useRef(0);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedAgentAppBindings, setSelectedAgentAppBindings] = useState<AgentAppBinding[]>([]);
  const [selectedSessionSkillNames, setSelectedSessionSkillNames] = useState<string[]>([]);
  const [selectedProjectSkillNames, setSelectedProjectSkillNames] = useState<string[]>([]);
  const [pendingAgentSetup, setPendingAgentSetup] = useState<AgentConfig | null>(null);
  const [agentRuntimeDiagnostics, setAgentRuntimeDiagnostics] = useState<AgentRuntimeDiagnostics | null>(null);
  const [agentChoiceState, setAgentChoiceState] = useState<ConversationAgentChoiceState>(
    selectedSession ? 'default' : 'pending',
  );

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
    accumulatedStreamRef.current = '';
  }, []);

  const workspacePath = selectedProject?.fullPath || selectedProject?.path || '';
  const worktreeMeta = selectedProject?.worktree || null;
  const isWorktreeProject = Boolean(!isConversationSpace && worktreeMeta?.id);
  const agentBindingEnabled = isConversationSpace || isWorktreeProject;
  const projectSkillBindingEnabled = Boolean(selectedProject && !agentBindingEnabled);

  useEffect(() => {
    if (!selectedProject) {
      setInstalledSkills([]);
      return undefined;
    }

    let cancelled = false;
    const loadInstalledSkills = async () => {
      try {
        const response = await api.installedAgentSkills(workspacePath);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load installed skills');
        }
        if (!cancelled) {
          setInstalledSkills(Array.isArray(data?.skills) ? data.skills : []);
        }
      } catch (error) {
        console.warn('Failed to load installed skills:', error);
        if (!cancelled) {
          setInstalledSkills([]);
        }
      }
    };

    void loadInstalledSkills();
    return () => {
      cancelled = true;
    };
  }, [selectedProject, workspacePath]);

  useEffect(() => {
    if (!agentBindingEnabled || !selectedProject) {
      setAgents([]);
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      setAgentChoiceState('default');
      return undefined;
    }

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
  }, [agentBindingEnabled, selectedProject]);

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
      setAgentChoiceState('default');
      return;
    }

    const agent = enabledAgents.find((entry) => entry.id === agentId) || null;
    if (!agent) {
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      setAgentChoiceState('pending');
      return;
    }

    if (shouldConfigureAgent(agent)) {
      setPendingAgentSetup(agent);
      return;
    }

    setPendingAgentSetup(null);
    setSelectedAgentId(agent.id);
    setSelectedAgentAppBindings([]);
    setAgentChoiceState('agent');
  }, [enabledAgents]);

  const useDefaultConversationAgent = useCallback(() => {
    setPendingAgentSetup(null);
    setSelectedAgentId('');
    setSelectedAgentAppBindings([]);
    setAgentChoiceState('default');
  }, []);

  const confirmAgentSetup = useCallback((agent: AgentConfig, appBindings: AgentAppBinding[]) => {
    const normalizedBindings = normalizeAgentAppBindings(appBindings);
    setPendingAgentSetup(null);
    setSelectedAgentId(agent.id);
    setSelectedAgentAppBindings(normalizedBindings);
    setAgentChoiceState('agent');
  }, []);

  useEffect(() => {
    if (!isConversationSpace) {
      return;
    }
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
      setAgentChoiceState('agent');
    }
    lastQuickStartAgentRequestRef.current = quickStartAgentRequestId;
  }, [enabledAgents, isConversationSpace, quickStartAgentId, quickStartAgentRequestId]);

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
    const requestId = isConversationSpace ? newConversationRequestId : newProjectSessionRequestId;
    if (!requestId || selectedSession?.id || currentSessionId) {
      return;
    }
    if (isWorktreeProject) {
      const nextAgentId = typeof worktreeMeta?.agentId === 'string' ? worktreeMeta.agentId : '';
      const nextAppBindings = normalizeAgentAppBindings(worktreeMeta?.appBindings);
      const nextSkills = normalizeSkillNames(worktreeMeta?.skills);
      setPendingAgentSetup(null);
      setSelectedAgentId(nextAgentId);
      setSelectedAgentAppBindings(nextAppBindings);
      setSelectedSessionSkillNames(nextSkills);
      setSelectedProjectSkillNames([]);
      setAgentChoiceState(nextAgentId ? 'agent' : 'default');
      setAgentRuntimeDiagnostics(null);
      return;
    }
    setPendingAgentSetup(null);
    setSelectedAgentId('');
    setSelectedAgentAppBindings([]);
    setSelectedSessionSkillNames([]);
    setSelectedProjectSkillNames([]);
    setAgentChoiceState(isConversationSpace ? 'pending' : 'default');
    setAgentRuntimeDiagnostics(null);
  }, [
    currentSessionId,
    isConversationSpace,
    isWorktreeProject,
    newConversationRequestId,
    newProjectSessionRequestId,
    selectedSession?.id,
    worktreeMeta?.agentId,
    worktreeMeta?.appBindings,
    worktreeMeta?.skills,
  ]);

  useEffect(() => {
    if (agentBindingEnabled) {
      return;
    }
    setSelectedProjectSkillNames([]);
  }, [agentBindingEnabled, selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    if (!isWorktreeProject || selectedSession?.id || currentSessionId || !worktreeMeta?.id) {
      return;
    }
    const nextAgentId = typeof worktreeMeta.agentId === 'string' ? worktreeMeta.agentId : '';
    const nextAppBindings = normalizeAgentAppBindings(worktreeMeta.appBindings);
    const nextSkills = normalizeSkillNames(worktreeMeta.skills);
    const defaultsKey = `${worktreeMeta.id}:${nextAgentId}:${JSON.stringify({ nextAppBindings, nextSkills })}`;
    if (worktreeDefaultsKeyRef.current === defaultsKey) {
      return;
    }
    worktreeDefaultsKeyRef.current = defaultsKey;
    setPendingAgentSetup(null);
    setSelectedAgentId(nextAgentId);
    setSelectedAgentAppBindings(nextAppBindings);
    setSelectedSessionSkillNames(nextSkills);
    setSelectedProjectSkillNames([]);
    setAgentChoiceState(nextAgentId ? 'agent' : 'default');
  }, [
    currentSessionId,
    isWorktreeProject,
    selectedSession?.id,
    worktreeMeta?.agentId,
    worktreeMeta?.appBindings,
    worktreeMeta?.id,
    worktreeMeta?.skills,
  ]);

  useEffect(() => {
    setAgentRuntimeDiagnostics(null);
  }, [isConversationSpace, selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    if (!agentBindingEnabled) {
      return;
    }

    const bindingKey = activeConversationSessionId ? `${provider}:${activeConversationSessionId}` : '';
    const previousSessionId = previousCurrentSessionIdRef.current;
    previousCurrentSessionIdRef.current = currentSessionId;

    if (
      isTemporarySessionId(previousSessionId)
      && activeConversationSessionId
      && !selectedSession?.id
      && (selectedAgentId || selectedSessionSkillNames.length > 0)
    ) {
      skipNextAgentBindingLoadKeyRef.current = bindingKey;
      agentBindingHydratedKeyRef.current = bindingKey;
      agentBindingPersistKeyRef.current = `${bindingKey}:${selectedAgentId}:${JSON.stringify({ appBindings: selectedAgentAppBindings, skills: selectedSessionSkillNames })}`;
      void api.updateSessionAgent(activeConversationSessionId, selectedAgentId, provider, {
        appBindings: selectedAgentAppBindings,
        skills: selectedSessionSkillNames,
      }).catch((error) => {
        console.warn('Failed to persist new conversation Agent binding:', error);
        agentBindingPersistKeyRef.current = '';
      });
    }
  }, [activeConversationSessionId, agentBindingEnabled, currentSessionId, provider, selectedAgentAppBindings, selectedAgentId, selectedSession?.id, selectedSessionSkillNames]);

  useEffect(() => {
    if (!agentBindingEnabled) {
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      setAgentChoiceState('default');
      return;
    }

    if (!selectedSession?.id && !currentSessionId) {
      if (isWorktreeProject) {
        return;
      }
      const hasQuickStartAgent = Boolean(
        quickStartAgentId
        && quickStartAgentRequestId
        && lastQuickStartAgentRequestRef.current === quickStartAgentRequestId,
      );
      if (!hasQuickStartAgent && !selectedAgentId && selectedSessionSkillNames.length === 0) {
        setSelectedAgentId('');
        setSelectedAgentAppBindings([]);
        setSelectedSessionSkillNames([]);
        if (agentChoiceState === 'agent') {
          setAgentChoiceState(isConversationSpace ? 'pending' : 'default');
        }
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
        const nextSkills = normalizeSkillNames(data?.configuration?.skills);
        setSelectedAgentId(nextAgentId);
        setSelectedAgentAppBindings(nextAppBindings);
        setSelectedSessionSkillNames(nextSkills);
        setAgentChoiceState(nextAgentId ? 'agent' : 'default');
        agentBindingHydratedKeyRef.current = bindingKey;
        agentBindingPersistKeyRef.current = `${bindingKey}:${nextAgentId}:${JSON.stringify({ appBindings: nextAppBindings, skills: nextSkills })}`;
      } catch (error) {
        console.warn('Failed to load conversation Agent binding:', error);
        if (!cancelled && agentBindingLoadKeyRef.current === bindingKey) {
          setSelectedAgentId('');
          setSelectedAgentAppBindings([]);
          setSelectedSessionSkillNames([]);
          setAgentChoiceState('default');
          agentBindingHydratedKeyRef.current = bindingKey;
          agentBindingPersistKeyRef.current = `${bindingKey}:`;
        }
      }
    };

    void loadSessionAgent();
    return () => {
      cancelled = true;
    };
  }, [activeConversationSessionId, agentBindingEnabled, agentChoiceState, currentSessionId, isConversationSpace, isWorktreeProject, provider, quickStartAgentId, quickStartAgentRequestId, selectedAgentId, selectedSession?.id, selectedSessionSkillNames.length]);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }
    if (agentBindingEnabled && agents.length === 0) {
      return;
    }
    if (!enabledAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      setAgentChoiceState(isConversationSpace ? 'pending' : 'default');
    }
  }, [agentBindingEnabled, agents.length, enabledAgents, isConversationSpace, selectedAgentId]);

  useEffect(() => {
    if (!agentBindingEnabled) {
      return;
    }
    if (!activeConversationSessionId) {
      return;
    }

    const configuration = { appBindings: selectedAgentAppBindings, skills: selectedSessionSkillNames };
    const bindingKey = `${provider}:${activeConversationSessionId}:${selectedAgentId}:${JSON.stringify(configuration)}`;
    if (agentBindingPersistKeyRef.current === bindingKey) {
      return;
    }
    const hydratedKey = `${provider}:${activeConversationSessionId}`;
    if (!selectedAgentId && selectedSessionSkillNames.length === 0 && agentBindingHydratedKeyRef.current !== hydratedKey) {
      return;
    }
    agentBindingPersistKeyRef.current = bindingKey;

    const persistSessionAgent = selectedAgentId || selectedSessionSkillNames.length > 0
      ? api.updateSessionAgent(activeConversationSessionId, selectedAgentId, provider, configuration)
      : api.clearSessionAgent(activeConversationSessionId, provider);

    void persistSessionAgent.catch((error) => {
      console.warn('Failed to persist conversation Agent binding:', error);
      agentBindingPersistKeyRef.current = '';
    });
  }, [activeConversationSessionId, agentBindingEnabled, provider, selectedAgentAppBindings, selectedAgentId, selectedSessionSkillNames]);

  const toggleSessionSkill = useCallback((skillName: string) => {
    const normalized = skillName.trim();
    if (!normalized) return;
    const updateSkills = (previous: string[]) => {
      const exists = previous.some((name) => name.toLowerCase() === normalized.toLowerCase());
      return exists
        ? previous.filter((name) => name.toLowerCase() !== normalized.toLowerCase())
        : [...previous, normalized].slice(0, 60);
    };
    if (agentBindingEnabled) {
      setSelectedSessionSkillNames(updateSkills);
    } else {
      setSelectedProjectSkillNames(updateSkills);
    }
  }, [agentBindingEnabled]);

  const activeSkillNames = agentBindingEnabled ? selectedSessionSkillNames : selectedProjectSkillNames;

  useEffect(() => {
    if (!projectSkillBindingEnabled || !activeConversationSessionId) {
      return undefined;
    }

    const bindingKey = `${provider}:${activeConversationSessionId}:project-skills`;
    let cancelled = false;
    projectSkillBindingLoadKeyRef.current = bindingKey;

    const loadProjectSkillBinding = async () => {
      try {
        const response = await api.sessionAgent(activeConversationSessionId, provider);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load project Skill binding');
        }
        if (cancelled || projectSkillBindingLoadKeyRef.current !== bindingKey) {
          return;
        }

        const nextSkills = normalizeSkillNames(data?.configuration?.skills);
        setSelectedProjectSkillNames(nextSkills);
        projectSkillBindingHydratedKeyRef.current = bindingKey;
        projectSkillBindingPersistKeyRef.current = `${bindingKey}:${JSON.stringify(nextSkills)}`;
      } catch (error) {
        console.warn('Failed to load project Skill binding:', error);
        if (!cancelled && projectSkillBindingLoadKeyRef.current === bindingKey) {
          setSelectedProjectSkillNames([]);
          projectSkillBindingHydratedKeyRef.current = bindingKey;
          projectSkillBindingPersistKeyRef.current = `${bindingKey}:[]`;
        }
      }
    };

    void loadProjectSkillBinding();
    return () => {
      cancelled = true;
    };
  }, [activeConversationSessionId, projectSkillBindingEnabled, provider]);

  useEffect(() => {
    if (!projectSkillBindingEnabled || !activeConversationSessionId) {
      return;
    }

    const hydratedKey = `${provider}:${activeConversationSessionId}:project-skills`;
    if (selectedProjectSkillNames.length === 0 && projectSkillBindingHydratedKeyRef.current !== hydratedKey) {
      return;
    }

    const persistKey = `${hydratedKey}:${JSON.stringify(selectedProjectSkillNames)}`;
    if (projectSkillBindingPersistKeyRef.current === persistKey) {
      return;
    }
    projectSkillBindingPersistKeyRef.current = persistKey;

    const persistProjectSkills = selectedProjectSkillNames.length > 0
      ? api.updateSessionAgent(activeConversationSessionId, '', provider, {
        appBindings: [],
        skills: selectedProjectSkillNames,
      })
      : api.clearSessionAgent(activeConversationSessionId, provider);

    void persistProjectSkills.catch((error) => {
      console.warn('Failed to persist project Skill binding:', error);
      projectSkillBindingPersistKeyRef.current = '';
    });
  }, [activeConversationSessionId, projectSkillBindingEnabled, provider, selectedProjectSkillNames]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
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
    agents: agentBindingEnabled ? enabledAgents : [],
    selectedAgentId: agentBindingEnabled ? selectedAgentId : '',
    selectedAgentAppBindings: agentBindingEnabled ? selectedAgentAppBindings : [],
    selectedSkillNames: activeSkillNames,
    allowSessionAgentBinding: agentBindingEnabled || activeSkillNames.length > 0,
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

  useEffect(() => {
    if (!isWorktreeProject || !worktreeMeta?.id || !activeConversationSessionId) {
      return;
    }
    const bindingKey = `${worktreeMeta.id}:${provider}:${activeConversationSessionId}`;
    if (worktreeSessionPersistKeyRef.current === bindingKey) {
      return;
    }
    worktreeSessionPersistKeyRef.current = bindingKey;
    void api.updateWorktreeSession(worktreeMeta.id, activeConversationSessionId, provider).catch((error) => {
      console.warn('Failed to persist worktree session link:', error);
      worktreeSessionPersistKeyRef.current = '';
    });
  }, [activeConversationSessionId, isWorktreeProject, provider, worktreeMeta?.id]);

  useEffect(() => {
    if (!isWorktreeProject || selectedSession?.id || currentSessionId || !worktreeMeta?.id) {
      return;
    }
    const prompt = typeof worktreeMeta.taskPrompt === 'string' ? worktreeMeta.taskPrompt.trim() : '';
    if (!prompt || input.trim()) {
      return;
    }
    const promptKey = `${worktreeMeta.id}:${prompt}`;
    if (worktreePromptPrefillKeyRef.current === promptKey) {
      return;
    }
    worktreePromptPrefillKeyRef.current = promptKey;
    setInput(prompt);
  }, [currentSessionId, input, isWorktreeProject, selectedSession?.id, setInput, worktreeMeta?.id, worktreeMeta?.taskPrompt]);

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
    setAgentRuntimeDiagnostics,
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
          isConversationSpace={isConversationSpace}
          agents={agentBindingEnabled ? enabledAgents : []}
          selectedAgentName={agentBindingEnabled ? selectedAgent?.shortName || selectedAgent?.name || '' : ''}
          agentChoiceState={agentChoiceState}
          onUseDefaultAgent={useDefaultConversationAgent}
          onSelectConversationAgent={selectAgentForConversation}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus}
          isLoading={isLoading}
          onAbortSession={handleAbortSession}
          provider={provider}
          agents={agentBindingEnabled ? enabledAgents : []}
          selectedAgentId={agentBindingEnabled ? selectedAgentId : ''}
          selectedAgentAppBindings={agentBindingEnabled ? selectedAgentAppBindings : []}
          onSelectedAgentIdChange={selectAgentForConversation}
          installedSkills={installedSkills}
          selectedSkillNames={activeSkillNames}
          onToggleSkillName={toggleSessionSkill}
          onClearSkillNames={() => {
            if (agentBindingEnabled) {
              setSelectedSessionSkillNames([]);
            } else {
              setSelectedProjectSkillNames([]);
            }
          }}
          showRuntimeDiagnostics={agentBindingEnabled || activeSkillNames.length > 0}
          agentRuntimeDiagnostics={agentRuntimeDiagnostics}
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

      {agentBindingEnabled && pendingAgentSetup && (
        <AgentSessionSetupDialog
          agent={pendingAgentSetup}
          initialBindings={selectedAgentId === pendingAgentSetup.id ? selectedAgentAppBindings : pendingAgentSetup.appBindings}
          workspacePath={workspacePath}
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
