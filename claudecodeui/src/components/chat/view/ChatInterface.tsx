import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import PermissionContext from '../../../contexts/PermissionContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type {
  AgentRuntimeDiagnostics,
  ChatInterfaceProps,
  PermissionMode,
  PromptInjectionDebugPayload,
  Provider,
} from '../types/types';
import type { LLMProvider } from '../../../types/app';
import type { AgentAppBinding, AgentConfig, InstalledSkill, RepositorySkillItem } from '../../../types/agent';
import { api } from '../../../utils/api';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { getClaudeSettings } from '../utils/chatStorage';
import {
  ARGUS_DEBUG_SETTINGS_CHANGED_EVENT,
  ARGUS_PROMPT_INJECTION_DEBUG_EVENT,
  ARGUS_WEBSOCKET_MESSAGE_EVENT,
  getArgusDebugSettings,
} from '../utils/debugSettings';
import {
  clearStoredConversationDraft,
  CONVERSATION_DRAFT_EVENT,
  getConversationDraftFromEvent,
  readStoredConversationDraft,
  shouldApplyConversationDraft,
  type ConversationDraftPayload,
} from '../utils/conversationDraft';
import { summarizeSubagentActivity } from '../utils/subagentActivity';
import { buildSubagentControlRequest, type SubagentControlAction } from '../utils/subagentControlRequest';
import { buildSubagentStopRequest } from '../utils/subagentStopRequest';
import { hasDialogInteraction, type DialogAnswers } from '../utils/agentTemplateDialogs';
import {
  DEFAULT_AGENT_PROFILE_KIND,
  getAgentProfile,
  normalizeAgentProfileKind,
} from '../../../../shared/agentProfiles.js';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import PromptInjectionDebugPanel from './subcomponents/PromptInjectionDebugPanel';
import CheckpointPanel from './subcomponents/CheckpointPanel';
import AgentRuntimeTimelinePanel from './subcomponents/AgentRuntimeTimelinePanel';
import AgentSessionSetupDialog from './subcomponents/AgentSessionSetupDialog';
import AgentLaunchDialog from './subcomponents/AgentLaunchDialog';


type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type ConversationAgentChoiceState = 'pending' | 'default' | 'agent';

type SessionGoal = {
  threadId: string;
  goalId: string;
  objective: string;
  status: 'active' | 'paused' | 'budget_limited' | 'complete';
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
};

type DraftSessionGoal = {
  objective: string;
  tokenBudget: number | null;
};

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const INTERACTIVE_PERMISSION_TOOLS = new Set([
  'AskUserQuestion',
  'request_user_input',
  'ExitPlanMode',
  'exit_plan_mode',
]);
const MAX_RUNTIME_DIAGNOSTICS_CACHE_SIZE = 100;
const MAX_PROMPT_INJECTION_DEBUG_CACHE_SIZE = 100;
const SUBAGENT_UI_HARD_DISABLED = true;
const runtimeDiagnosticsBySessionCache = new Map<string, AgentRuntimeDiagnostics>();
const promptInjectionDebugBySessionCache = new Map<string, PromptInjectionDebugPayload>();

function cacheRuntimeDiagnostics(sessionKey: string, diagnostics: AgentRuntimeDiagnostics) {
  if (!sessionKey) return;
  runtimeDiagnosticsBySessionCache.set(sessionKey, diagnostics);
  if (runtimeDiagnosticsBySessionCache.size <= MAX_RUNTIME_DIAGNOSTICS_CACHE_SIZE) {
    return;
  }
  const oldestKey = runtimeDiagnosticsBySessionCache.keys().next().value;
  if (oldestKey) {
    runtimeDiagnosticsBySessionCache.delete(oldestKey);
  }
}

function cachePromptInjectionDebug(sessionKey: string, payload: PromptInjectionDebugPayload) {
  if (!sessionKey) return;
  promptInjectionDebugBySessionCache.set(sessionKey, payload);
  if (promptInjectionDebugBySessionCache.size <= MAX_PROMPT_INJECTION_DEBUG_CACHE_SIZE) {
    return;
  }
  const oldestKey = promptInjectionDebugBySessionCache.keys().next().value;
  if (oldestKey) {
    promptInjectionDebugBySessionCache.delete(oldestKey);
  }
}

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

function normalizeModelProfileId(value: unknown): string {
  return (typeof value === 'string' ? value.trim() : '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const createClientControlMessageId = () =>
  `client_control_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function readResponseError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return data?.details || data?.error || data?.message || fallback;
  } catch {
    return fallback;
  }
}

function shouldConfigureAgent(agent: AgentConfig | null) {
  return Boolean(agent && (agent.appBindings.length > 0 || hasDialogInteraction(agent.templateDialogs?.setup)));
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
  sessionStore,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { t } = useTranslation('chat');
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
  const appliedConversationDraftKeyRef = useRef('');
  const previousProjectSkillCurrentSessionIdRef = useRef<string | null>(null);
  const projectSkillBindingLoadKeyRef = useRef('');
  const projectSkillBindingPersistKeyRef = useRef('');
  const projectSkillBindingHydratedKeyRef = useRef('');
  const draftSessionGoalPersistKeyRef = useRef('');
  const lastQuickStartAgentRequestRef = useRef(0);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [repositorySkills, setRepositorySkills] = useState<RepositorySkillItem[]>([]);
  const [repositorySkillsLoading, setRepositorySkillsLoading] = useState(false);
  const [repositorySkillsError, setRepositorySkillsError] = useState<string | null>(null);
  const [installingRepositorySkillKey, setInstallingRepositorySkillKey] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const selectedAgentIdRef = useRef('');
  const [selectedAgentAppBindings, setSelectedAgentAppBindings] = useState<AgentAppBinding[]>([]);
  const [selectedAgentSetupAnswers, setSelectedAgentSetupAnswers] = useState<DialogAnswers>({});
  const [selectedAgentSetupPresetId, setSelectedAgentSetupPresetId] = useState('');
  const [selectedSessionSkillNames, setSelectedSessionSkillNames] = useState<string[]>([]);
  const [selectedProjectSkillNames, setSelectedProjectSkillNames] = useState<string[]>([]);
  const selectedSessionSkillNamesRef = useRef<string[]>([]);
  const selectedProjectSkillNamesRef = useRef<string[]>([]);
  const [defaultModelProfileId, setDefaultModelProfileId] = useState('');
  const [selectedModelProfileId, setSelectedModelProfileId] = useState('');
  const selectedModelProfileIdRef = useRef('');
  const [selectedAgentProfileKind, setSelectedAgentProfileKind] = useState(DEFAULT_AGENT_PROFILE_KIND);
  const selectedAgentProfileKindRef = useRef(DEFAULT_AGENT_PROFILE_KIND);
  const [subagentsEnabled, setSubagentsEnabled] = useState(false);
  const [goalsEnabled, setGoalsEnabled] = useState(false);
  const [sessionGoal, setSessionGoal] = useState<SessionGoal | null>(null);
  const [draftSessionGoal, setDraftSessionGoal] = useState<DraftSessionGoal | null>(null);
  const [pendingAgentSetup, setPendingAgentSetup] = useState<AgentConfig | null>(null);
  const [agentRuntimeDiagnostics, setAgentRuntimeDiagnostics] = useState<AgentRuntimeDiagnostics | null>(null);
  const [promptInjectionDebug, setPromptInjectionDebug] = useState<PromptInjectionDebugPayload | null>(null);
  const [argusDebugSettings, setArgusDebugSettings] = useState(() => getArgusDebugSettings());
  const [claudeSettingsVersion, setClaudeSettingsVersion] = useState(0);
  const [isPromptDebugCollapsed, setIsPromptDebugCollapsed] = useState(false);
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
  const showPromptInjectionPanel = argusDebugSettings.showPromptInjectionPanel;

  useEffect(() => {
    const reloadDebugSettings = () => setArgusDebugSettings(getArgusDebugSettings());
    window.addEventListener(ARGUS_DEBUG_SETTINGS_CHANGED_EVENT, reloadDebugSettings);
    window.addEventListener('storage', reloadDebugSettings);
    return () => {
      window.removeEventListener(ARGUS_DEBUG_SETTINGS_CHANGED_EVENT, reloadDebugSettings);
      window.removeEventListener('storage', reloadDebugSettings);
    };
  }, []);

  useEffect(() => {
    const markClaudeSettingsChanged = () => setClaudeSettingsVersion((version) => version + 1);
    window.addEventListener('claudeSettingsChanged', markClaudeSettingsChanged);
    window.addEventListener('storage', markClaudeSettingsChanged);
    return () => {
      window.removeEventListener('claudeSettingsChanged', markClaudeSettingsChanged);
      window.removeEventListener('storage', markClaudeSettingsChanged);
    };
  }, []);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    selectedSessionSkillNamesRef.current = selectedSessionSkillNames;
  }, [selectedSessionSkillNames]);

  useEffect(() => {
    selectedProjectSkillNamesRef.current = selectedProjectSkillNames;
  }, [selectedProjectSkillNames]);

  useEffect(() => {
    selectedModelProfileIdRef.current = selectedModelProfileId;
  }, [selectedModelProfileId]);

  useEffect(() => {
    selectedAgentProfileKindRef.current = selectedAgentProfileKind;
  }, [selectedAgentProfileKind]);

  const loadInstalledSkills = useCallback(async () => {
    if (!selectedProject && !isConversationSpace) {
      setInstalledSkills([]);
      return;
    }

    try {
      const response = await api.installedAgentSkills(workspacePath);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load installed skills');
      }
      setInstalledSkills(Array.isArray(data?.skills) ? data.skills : []);
    } catch (error) {
      console.warn('Failed to load installed skills:', error);
      setInstalledSkills([]);
    }
  }, [isConversationSpace, selectedProject, workspacePath]);

  useEffect(() => {
    let cancelled = false;
    void loadInstalledSkills().catch((error) => {
      if (!cancelled) {
        console.warn('Failed to load installed skills:', error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadInstalledSkills]);

  useEffect(() => {
    if (!selectedProject && !isConversationSpace) {
      setRepositorySkills([]);
      setRepositorySkillsLoading(false);
      setRepositorySkillsError(null);
      return undefined;
    }

    let cancelled = false;
    const loadRepositorySkills = async () => {
      setRepositorySkillsLoading(true);
      setRepositorySkillsError(null);
      try {
        const response = await api.agentRepositoryCatalog();
        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Failed to load Hub skills'));
        }
        const data = await response.json();
        const skills = Array.isArray(data?.items)
          ? data.items
            .filter((item: any) => item?.kind === 'skill' && item?.repoId && item?.id && item?.name)
            .map((item: any): RepositorySkillItem => ({
              id: String(item.id),
              repoId: String(item.repoId),
              repoName: typeof item.repoName === 'string' ? item.repoName : '',
              name: String(item.name),
              title: String(item.title || item.name),
              description: typeof item.description === 'string' ? item.description : '',
              author: typeof item.author === 'string' ? item.author : '',
              version: typeof item.version === 'string' ? item.version : '',
              tags: Array.isArray(item.tags) ? item.tags.filter((tag: unknown) => typeof tag === 'string') : [],
              downloads: Number(item.downloads || 0),
              likes: Number(item.likes || 0),
              sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : null,
            }))
          : [];
        if (!cancelled) {
          setRepositorySkills(skills);
          const catalogErrors = Array.isArray(data?.errors) ? data.errors : [];
          setRepositorySkillsError(
            catalogErrors.length > 0
              ? catalogErrors.map((entry: any) => `${entry.repoName || entry.repoId}: ${entry.error}`).join('; ')
              : null,
          );
        }
      } catch (error) {
        console.warn('Failed to load Hub skills:', error);
        if (!cancelled) {
          setRepositorySkills([]);
          setRepositorySkillsError(error instanceof Error ? error.message : 'Failed to load Hub skills');
        }
      } finally {
        if (!cancelled) {
          setRepositorySkillsLoading(false);
        }
      }
    };

    void loadRepositorySkills();
    return () => {
      cancelled = true;
    };
  }, [isConversationSpace, selectedProject]);

  useEffect(() => {
    if (!agentBindingEnabled || !selectedProject) {
      setAgents([]);
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      setSelectedAgentSetupAnswers({});
      setSelectedAgentSetupPresetId('');
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
      setSelectedAgentSetupAnswers({});
      setSelectedAgentSetupPresetId('');
      setAgentChoiceState('default');
      return;
    }

    const agent = enabledAgents.find((entry) => entry.id === agentId) || null;
    if (!agent) {
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      setSelectedAgentSetupAnswers({});
      setSelectedAgentSetupPresetId('');
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
    setSelectedAgentSetupAnswers({});
    setSelectedAgentSetupPresetId('');
    setAgentChoiceState('agent');
  }, [enabledAgents]);

  const useDefaultConversationAgent = useCallback(() => {
    setPendingAgentSetup(null);
    setSelectedAgentId('');
    setSelectedAgentAppBindings([]);
    setSelectedAgentSetupAnswers({});
    setSelectedAgentSetupPresetId('');
    setAgentChoiceState('default');
  }, []);

  const confirmAgentSetup = useCallback((agent: AgentConfig, appBindings: AgentAppBinding[], setupAnswers: DialogAnswers = {}, setupPresetId = '') => {
    const normalizedBindings = normalizeAgentAppBindings(appBindings);
    setPendingAgentSetup(null);
    setSelectedAgentId(agent.id);
    setSelectedAgentAppBindings(normalizedBindings);
    setSelectedAgentSetupAnswers(setupAnswers);
    setSelectedAgentSetupPresetId(setupPresetId);
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
      setSelectedAgentSetupAnswers({});
      setSelectedAgentSetupPresetId('');
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
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const handleAgentProfileChange = useCallback((profileKind: string) => {
    const normalized = normalizeAgentProfileKind(profileKind, DEFAULT_AGENT_PROFILE_KIND);
    setSelectedAgentProfileKind(normalized);
    selectedAgentProfileKindRef.current = normalized;

    const profile = getAgentProfile(normalized, DEFAULT_AGENT_PROFILE_KIND);
    const preset = profile?.permissionPreset;
    if (
      preset === 'default'
      || preset === 'acceptEdits'
      || preset === 'bypassPermissions'
      || preset === 'plan'
    ) {
      setPermissionMode(preset as PermissionMode);
    }
  }, [setPermissionMode]);

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

  const displayedSessionGoal = useMemo<SessionGoal | null>(() => {
    if (sessionGoal) {
      return sessionGoal;
    }
    if (!draftSessionGoal) {
      return null;
    }
    return {
      threadId: 'draft',
      goalId: 'draft',
      objective: draftSessionGoal.objective,
      status: 'active',
      tokenBudget: draftSessionGoal.tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
    };
  }, [draftSessionGoal, sessionGoal]);

  const subagentActivity = useMemo(
    () => (SUBAGENT_UI_HARD_DISABLED ? null : summarizeSubagentActivity(chatMessages)),
    [chatMessages],
  );

  const syncPermissionDecisionToSessionStore = useCallback((
    requestIds: string[],
    decision: { allow?: boolean; updatedInput?: unknown },
  ) => {
    if (!decision?.allow || !decision.updatedInput) {
      return;
    }

    for (const requestId of requestIds) {
      const request = pendingPermissionRequests.find((entry) => entry.requestId === requestId);
      if (!request) {
        continue;
      }

      const context = request.context && typeof request.context === 'object'
        ? request.context as Record<string, unknown>
        : {};
      const toolId = typeof context.tool_use_id === 'string'
        ? context.tool_use_id
        : typeof context.toolUseId === 'string'
          ? context.toolUseId
          : typeof context.toolUseID === 'string'
            ? context.toolUseID
            : '';
      const sessionId = request.sessionId || currentSessionId || selectedSession?.id || '';
      if (!sessionId) {
        continue;
      }

      sessionStore.updateToolUseInput(sessionId, {
        toolId,
        toolName: request.toolName,
        originalInput: request.input,
        updatedInput: decision.updatedInput,
      });
    }
  }, [currentSessionId, pendingPermissionRequests, selectedSession?.id, sessionStore]);

  const handleStopSubagents = useCallback((taskIds?: string[]) => {
    if (!subagentActivity) {
      return;
    }
    const sessionId = activeConversationSessionId
      || selectedSession?.id
      || currentSessionId
      || pendingViewSessionRef.current?.sessionId
      || null;
    if (!sessionId || isTemporarySessionId(sessionId)) {
      return;
    }

    const stopRequest = buildSubagentStopRequest({
      taskIds,
      activity: subagentActivity,
      sessionId,
      provider,
    });
    if (!stopRequest) {
      return;
    }

    sendMessage(stopRequest);
  }, [
    activeConversationSessionId,
    currentSessionId,
    pendingViewSessionRef,
    provider,
    selectedSession?.id,
    sendMessage,
    subagentActivity,
  ]);

  const setCachedAgentRuntimeDiagnostics = useCallback<React.Dispatch<React.SetStateAction<AgentRuntimeDiagnostics | null>>>(
    (valueOrUpdater) => {
      setAgentRuntimeDiagnostics((previous) => {
        const next = typeof valueOrUpdater === 'function'
          ? valueOrUpdater(previous)
          : valueOrUpdater;

        if (next) {
          const sessionKey = String(
            next.sessionId
            || selectedSession?.id
            || currentSessionId
            || pendingViewSessionRef.current?.sessionId
            || '',
          );
          const nextWithSession = sessionKey && !next.sessionId
            ? { ...next, sessionId: sessionKey }
            : next;
          if (sessionKey) {
            cacheRuntimeDiagnostics(sessionKey, nextWithSession);
          }
          return nextWithSession;
        }

        return next;
      });
    },
    [currentSessionId, selectedSession?.id],
  );

  const setCachedPromptInjectionDebug = useCallback<React.Dispatch<React.SetStateAction<PromptInjectionDebugPayload | null>>>(
    (valueOrUpdater) => {
      setPromptInjectionDebug((previous) => {
        const next = typeof valueOrUpdater === 'function'
          ? valueOrUpdater(previous)
          : valueOrUpdater;

        if (next) {
          const sessionKey = String(
            next.sessionId
            || selectedSession?.id
            || currentSessionId
            || pendingViewSessionRef.current?.sessionId
            || '',
          );
          const nextWithSession = sessionKey && !next.sessionId
            ? { ...next, sessionId: sessionKey }
            : next;
          if (sessionKey) {
            cachePromptInjectionDebug(sessionKey, nextWithSession);
          }
          return nextWithSession;
        }

        return next;
      });
    },
    [currentSessionId, selectedSession?.id],
  );

  const applyPromptInjectionDebugPayload = useCallback((
    payload: PromptInjectionDebugPayload | null,
    fallbackSessionId: string | null = null,
  ) => {
    if (!payload) {
      setCachedPromptInjectionDebug(null);
      return;
    }

    setCachedPromptInjectionDebug({
      ...payload,
      sessionId: fallbackSessionId || payload.sessionId || null,
      receivedAt: payload.receivedAt || new Date().toLocaleString(),
    });
  }, [setCachedPromptInjectionDebug]);

  useEffect(() => {
    const handlePromptInjectionDebugEvent = (event: Event) => {
      const payload = (event as CustomEvent<PromptInjectionDebugPayload | null>).detail || null;
      const sid = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
      const activeViewSessionId = selectedSession?.id
        || currentSessionId
        || pendingViewSessionRef.current?.sessionId
        || '';
      if (
        sid
        && activeViewSessionId
        && sid !== activeViewSessionId
        && !isTemporarySessionId(activeViewSessionId)
      ) {
        return;
      }
      applyPromptInjectionDebugPayload(payload);
    };

    const handleWebSocketMessageEvent = (event: Event) => {
      const msg = (event as CustomEvent<{
        kind?: string;
        text?: string;
        sessionId?: string | null;
        promptInjection?: PromptInjectionDebugPayload | null;
      }>).detail;
      if (!msg || msg.kind !== 'status' || msg.text !== 'prompt_injection_debug') {
        return;
      }

      const sid = typeof msg.sessionId === 'string' ? msg.sessionId : null;
      const activeViewSessionId = selectedSession?.id
        || currentSessionId
        || pendingViewSessionRef.current?.sessionId
        || '';
      if (
        sid
        && activeViewSessionId
        && sid !== activeViewSessionId
        && !isTemporarySessionId(activeViewSessionId)
      ) {
        return;
      }

      const payload = msg.promptInjection && typeof msg.promptInjection === 'object'
        ? msg.promptInjection
        : null;
      applyPromptInjectionDebugPayload(payload, sid);
    };

    window.addEventListener(ARGUS_PROMPT_INJECTION_DEBUG_EVENT, handlePromptInjectionDebugEvent);
    window.addEventListener(ARGUS_WEBSOCKET_MESSAGE_EVENT, handleWebSocketMessageEvent);
    return () => {
      window.removeEventListener(ARGUS_PROMPT_INJECTION_DEBUG_EVENT, handlePromptInjectionDebugEvent);
      window.removeEventListener(ARGUS_WEBSOCKET_MESSAGE_EVENT, handleWebSocketMessageEvent);
    };
  }, [applyPromptInjectionDebugPayload, currentSessionId, selectedSession?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadDefaultModelProfile = async () => {
      try {
        const response = await api.get('/settings/mtl-code-model');
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load model profile settings');
        }
        const profiles = Array.isArray(data?.config?.profiles) ? data.config.profiles : [];
        const nextProfileId = normalizeModelProfileId(data?.config?.activeProfileId || profiles[0]?.id || '');
        if (cancelled) {
          return;
        }
        setDefaultModelProfileId(nextProfileId);
        setSubagentsEnabled(Boolean(data?.config?.subagents?.enabled));
        setGoalsEnabled(Boolean(data?.config?.goals?.enabled));
        if (!activeConversationSessionId) {
          setSelectedModelProfileId(nextProfileId);
        } else {
          setSelectedModelProfileId((previous) => previous || nextProfileId);
        }
      } catch (error) {
        console.warn('Failed to load default model profile:', error);
      }
    };

    void loadDefaultModelProfile();
    window.addEventListener('mtlCodeModelSettingsChanged', loadDefaultModelProfile);
    return () => {
      cancelled = true;
      window.removeEventListener('mtlCodeModelSettingsChanged', loadDefaultModelProfile);
    };
  }, [activeConversationSessionId]);

  const loadSessionGoal = useCallback(async () => {
    if (!activeConversationSessionId) {
      setSessionGoal(null);
      return;
    }
    try {
      const response = await api.sessionGoal(activeConversationSessionId);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load session goal');
      }
      setSessionGoal(data?.goal || null);
    } catch (error) {
      console.warn('Failed to load session goal:', error);
      setSessionGoal(null);
    }
  }, [activeConversationSessionId]);

  useEffect(() => {
    void loadSessionGoal();
  }, [loadSessionGoal]);

  useEffect(() => {
    if (!activeConversationSessionId || !draftSessionGoal) {
      return undefined;
    }

    const persistKey = `${activeConversationSessionId}:${draftSessionGoal.objective}:${draftSessionGoal.tokenBudget ?? ''}`;
    if (draftSessionGoalPersistKeyRef.current === persistKey) {
      return undefined;
    }
    draftSessionGoalPersistKeyRef.current = persistKey;

    let cancelled = false;
    const persistDraftGoal = async () => {
      try {
        const response = await api.setSessionGoal(activeConversationSessionId, {
          objective: draftSessionGoal.objective,
          tokenBudget: draftSessionGoal.tokenBudget,
          status: 'active',
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to set session goal');
        }
        if (!cancelled) {
          setSessionGoal(data?.goal || null);
          setDraftSessionGoal(null);
        }
      } catch (error) {
        console.warn('Failed to persist draft session goal:', error);
        if (!cancelled) {
          draftSessionGoalPersistKeyRef.current = '';
        }
      }
    };

    void persistDraftGoal();
    return () => {
      cancelled = true;
    };
  }, [activeConversationSessionId, draftSessionGoal]);

  useEffect(() => {
    if (!latestMessage || !activeConversationSessionId) {
      return;
    }
    const msg = latestMessage as {
      type?: string;
      event?: string;
      sessionId?: string;
      goal?: SessionGoal | null;
    };
    const eventType = msg.type || msg.event || '';
    if (msg.sessionId !== activeConversationSessionId) {
      return;
    }
    if (eventType === 'thread_goal_updated') {
      setSessionGoal(msg.goal || null);
      return;
    }
    if (eventType === 'thread_goal_cleared') {
      setSessionGoal(null);
    }
  }, [activeConversationSessionId, latestMessage]);

  const handleSetSessionGoal = useCallback(async (objective: string, tokenBudget?: number | null) => {
    const normalizedTokenBudget = typeof tokenBudget === 'number' && Number.isFinite(tokenBudget) && tokenBudget > 0
      ? tokenBudget
      : null;
    if (!objective.trim()) {
      return;
    }
    if (!activeConversationSessionId) {
      setDraftSessionGoal({ objective: objective.trim(), tokenBudget: normalizedTokenBudget });
      setSessionGoal(null);
      return;
    }
    setDraftSessionGoal(null);
    const response = await api.setSessionGoal(activeConversationSessionId, {
      objective: objective.trim(),
      tokenBudget: normalizedTokenBudget,
      status: 'active',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to set session goal');
    }
    setSessionGoal(data?.goal || null);
  }, [activeConversationSessionId]);

  const handleSessionGoalAction = useCallback(async (action: 'pause' | 'resume' | 'complete') => {
    if (!activeConversationSessionId) {
      if (action === 'complete') {
        setDraftSessionGoal(null);
      }
      return;
    }
    const response = await api.setSessionGoal(activeConversationSessionId, { action });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `Failed to ${action} session goal`);
    }
    setSessionGoal(data?.goal || null);
  }, [activeConversationSessionId]);

  const handleClearSessionGoal = useCallback(async () => {
    if (!activeConversationSessionId) {
      setDraftSessionGoal(null);
      return;
    }
    const response = await api.clearSessionGoal(activeConversationSessionId);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || 'Failed to clear session goal');
    }
    setSessionGoal(null);
    setDraftSessionGoal(null);
  }, [activeConversationSessionId]);

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
      setSelectedAgentSetupAnswers({});
      setSelectedAgentSetupPresetId('');
      setSelectedSessionSkillNames(nextSkills);
      setSelectedProjectSkillNames([]);
      setSelectedModelProfileId(defaultModelProfileId);
      setSelectedAgentProfileKind(DEFAULT_AGENT_PROFILE_KIND);
      setAgentChoiceState(nextAgentId ? 'agent' : 'default');
      setAgentRuntimeDiagnostics(null);
      setPromptInjectionDebug(null);
      return;
    }
    setPendingAgentSetup(null);
    setSelectedAgentId('');
    setSelectedAgentAppBindings([]);
    setSelectedAgentSetupAnswers({});
    setSelectedAgentSetupPresetId('');
    setSelectedSessionSkillNames([]);
    setSelectedProjectSkillNames([]);
    setSelectedModelProfileId(defaultModelProfileId);
    setSelectedAgentProfileKind(DEFAULT_AGENT_PROFILE_KIND);
    setAgentChoiceState(isConversationSpace ? 'pending' : 'default');
    setAgentRuntimeDiagnostics(null);
    setPromptInjectionDebug(null);
  }, [
    currentSessionId,
    isConversationSpace,
    isWorktreeProject,
    defaultModelProfileId,
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
  }, [agentBindingEnabled, selectedProject?.name]);

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
    setSelectedAgentSetupAnswers({});
    setSelectedAgentSetupPresetId('');
    setSelectedSessionSkillNames(nextSkills);
    setSelectedProjectSkillNames([]);
    setSelectedModelProfileId(defaultModelProfileId);
    setSelectedAgentProfileKind(DEFAULT_AGENT_PROFILE_KIND);
    setAgentChoiceState(nextAgentId ? 'agent' : 'default');
  }, [
    currentSessionId,
    defaultModelProfileId,
    isWorktreeProject,
    selectedSession?.id,
    worktreeMeta?.agentId,
    worktreeMeta?.appBindings,
    worktreeMeta?.id,
    worktreeMeta?.skills,
  ]);

  useEffect(() => {
    const sessionKey = selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || '';
    if (!sessionKey) {
      setAgentRuntimeDiagnostics(null);
      return;
    }

    const cached = runtimeDiagnosticsBySessionCache.get(sessionKey);
    if (cached) {
      setAgentRuntimeDiagnostics(cached);
      return;
    }

    setAgentRuntimeDiagnostics((previous) => {
      if (
        previous
        && previous.sessionId
        && isTemporarySessionId(previous.sessionId)
        && !isTemporarySessionId(sessionKey)
      ) {
        const migrated = {
          ...previous,
          sessionId: sessionKey,
        };
        cacheRuntimeDiagnostics(sessionKey, migrated);
        return migrated;
      }

      return null;
    });
  }, [currentSessionId, isConversationSpace, selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    const sessionKey = selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || '';
    if (!sessionKey) {
      setPromptInjectionDebug(null);
      return;
    }

    const cached = promptInjectionDebugBySessionCache.get(sessionKey);
    if (cached) {
      setPromptInjectionDebug(cached);
      return;
    }

    setPromptInjectionDebug((previous) => {
      if (
        previous
        && previous.sessionId
        && isTemporarySessionId(previous.sessionId)
        && !isTemporarySessionId(sessionKey)
      ) {
        const migrated = {
          ...previous,
          sessionId: sessionKey,
        };
        cachePromptInjectionDebug(sessionKey, migrated);
        return migrated;
      }

      return null;
    });
  }, [currentSessionId, isConversationSpace, selectedProject?.name, selectedSession?.id]);

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
      && (
        selectedAgentId
        || selectedSessionSkillNames.length > 0
        || selectedModelProfileId
        || selectedAgentProfileKind !== DEFAULT_AGENT_PROFILE_KIND
        || Object.keys(selectedAgentSetupAnswers).length > 0
        || selectedAgentSetupPresetId
      )
    ) {
      const packageMeta = selectedAgent?.templatePackage || {};
      const configuration = {
        appBindings: selectedAgentAppBindings,
        skills: selectedSessionSkillNames,
        agentProfileKind: selectedAgentProfileKind,
        modelProfileId: selectedModelProfileId,
        packageId: packageMeta.packageId || '',
        packageVersion: packageMeta.packageVersion || '',
        setupAnswers: selectedAgentSetupAnswers,
        setupPresetId: selectedAgentSetupPresetId,
        selectedDependencies: selectedAgent?.templateSelectedDependencies || {},
      };
      skipNextAgentBindingLoadKeyRef.current = bindingKey;
      agentBindingHydratedKeyRef.current = bindingKey;
      agentBindingPersistKeyRef.current = `${bindingKey}:${selectedAgentId}:${JSON.stringify(configuration)}`;
      void api.updateSessionAgent(activeConversationSessionId, selectedAgentId, provider, configuration).catch((error) => {
        console.warn('Failed to persist new conversation Agent binding:', error);
        agentBindingPersistKeyRef.current = '';
      });
    }
  }, [activeConversationSessionId, agentBindingEnabled, currentSessionId, provider, selectedAgent, selectedAgentAppBindings, selectedAgentId, selectedAgentProfileKind, selectedAgentSetupAnswers, selectedAgentSetupPresetId, selectedModelProfileId, selectedSession?.id, selectedSessionSkillNames]);

  useEffect(() => {
    if (!agentBindingEnabled) {
      setPendingAgentSetup(null);
      setSelectedAgentId('');
      setSelectedAgentAppBindings([]);
      setSelectedAgentSetupAnswers({});
      setSelectedAgentSetupPresetId('');
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
      const localAgentId = selectedAgentIdRef.current;
      const localSkills = selectedSessionSkillNamesRef.current;
      const localProfileKind = selectedAgentProfileKindRef.current;
      if (
        !hasQuickStartAgent
        && !localAgentId
        && localSkills.length === 0
        && localProfileKind === DEFAULT_AGENT_PROFILE_KIND
      ) {
        setSelectedAgentId('');
        setSelectedAgentAppBindings([]);
        setSelectedAgentSetupAnswers({});
        setSelectedAgentSetupPresetId('');
        setSelectedSessionSkillNames([]);
        setSelectedAgentProfileKind(DEFAULT_AGENT_PROFILE_KIND);
        setAgentChoiceState(isConversationSpace ? 'pending' : 'default');
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
        const nextAgentProfileKind = normalizeAgentProfileKind(
          data?.configuration?.agentProfileKind,
          DEFAULT_AGENT_PROFILE_KIND,
        );
        const nextModelProfileId = normalizeModelProfileId(data?.configuration?.modelProfileId) || defaultModelProfileId;
        const nextSetupAnswers = data?.configuration?.setupAnswers && typeof data.configuration.setupAnswers === 'object'
          ? data.configuration.setupAnswers
          : {};
        const nextSetupPresetId = typeof data?.configuration?.setupPresetId === 'string'
          ? data.configuration.setupPresetId
          : '';
        setSelectedAgentId(nextAgentId);
        setSelectedAgentAppBindings(nextAppBindings);
        setSelectedAgentSetupAnswers(nextSetupAnswers);
        setSelectedAgentSetupPresetId(nextSetupPresetId);
        setSelectedSessionSkillNames(nextSkills);
        setSelectedAgentProfileKind(nextAgentProfileKind);
        setSelectedModelProfileId(nextModelProfileId);
        setAgentChoiceState(nextAgentId ? 'agent' : 'default');
        agentBindingHydratedKeyRef.current = bindingKey;
        agentBindingPersistKeyRef.current = `${bindingKey}:${nextAgentId}:${JSON.stringify({
          appBindings: nextAppBindings,
          skills: nextSkills,
          agentProfileKind: nextAgentProfileKind,
          modelProfileId: nextModelProfileId,
          packageId: data?.configuration?.packageId || '',
          packageVersion: data?.configuration?.packageVersion || '',
          setupAnswers: nextSetupAnswers,
          setupPresetId: nextSetupPresetId,
          selectedDependencies: data?.configuration?.selectedDependencies || {},
        })}`;
      } catch (error) {
        console.warn('Failed to load conversation Agent binding:', error);
        if (!cancelled && agentBindingLoadKeyRef.current === bindingKey) {
          agentBindingLoadKeyRef.current = '';
        }
      }
    };

    void loadSessionAgent();
    return () => {
      cancelled = true;
    };
  }, [activeConversationSessionId, agentBindingEnabled, currentSessionId, defaultModelProfileId, isConversationSpace, isWorktreeProject, provider, quickStartAgentId, quickStartAgentRequestId, selectedSession?.id]);

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
      setSelectedAgentSetupAnswers({});
      setSelectedAgentSetupPresetId('');
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

    const packageMeta = selectedAgent?.templatePackage || {};
    const configuration = {
      appBindings: selectedAgentAppBindings,
      skills: selectedSessionSkillNames,
      agentProfileKind: selectedAgentProfileKind,
      modelProfileId: selectedModelProfileId,
      packageId: packageMeta.packageId || '',
      packageVersion: packageMeta.packageVersion || '',
      setupAnswers: selectedAgentSetupAnswers,
      setupPresetId: selectedAgentSetupPresetId,
      selectedDependencies: selectedAgent?.templateSelectedDependencies || {},
    };
    const bindingKey = `${provider}:${activeConversationSessionId}:${selectedAgentId}:${JSON.stringify(configuration)}`;
    if (agentBindingPersistKeyRef.current === bindingKey) {
      return;
    }
    const hydratedKey = `${provider}:${activeConversationSessionId}`;
    const isNewlyCreatedSession = !selectedSession?.id;
    if (agentBindingHydratedKeyRef.current !== hydratedKey && !isNewlyCreatedSession) {
      return;
    }
    agentBindingPersistKeyRef.current = bindingKey;

    const persistSessionAgent = selectedAgentId
      || selectedSessionSkillNames.length > 0
      || selectedModelProfileId
      || selectedAgentProfileKind !== DEFAULT_AGENT_PROFILE_KIND
      || Object.keys(selectedAgentSetupAnswers).length > 0
      || selectedAgentSetupPresetId
      ? api.updateSessionAgent(activeConversationSessionId, selectedAgentId, provider, configuration)
      : api.clearSessionAgent(activeConversationSessionId, provider);

    void persistSessionAgent.catch((error) => {
      console.warn('Failed to persist conversation Agent binding:', error);
      agentBindingPersistKeyRef.current = '';
    });
  }, [activeConversationSessionId, agentBindingEnabled, provider, selectedAgent, selectedAgentAppBindings, selectedAgentId, selectedAgentProfileKind, selectedAgentSetupAnswers, selectedAgentSetupPresetId, selectedModelProfileId, selectedSession?.id, selectedSessionSkillNames]);

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
      setSelectedSessionSkillNames((previous) => {
        const next = updateSkills(previous);
        selectedSessionSkillNamesRef.current = next;
        return next;
      });
    } else {
      setSelectedProjectSkillNames((previous) => {
        const next = updateSkills(previous);
        selectedProjectSkillNamesRef.current = next;
        return next;
      });
    }
  }, [agentBindingEnabled]);

  const addSessionSkill = useCallback((skillName: string) => {
    const normalized = skillName.trim();
    if (!normalized) return;
    const updateSkills = (previous: string[]) => {
      const exists = previous.some((name) => name.toLowerCase() === normalized.toLowerCase());
      return exists ? previous : [...previous, normalized].slice(0, 60);
    };
    if (agentBindingEnabled) {
      setSelectedSessionSkillNames((previous) => {
        const next = updateSkills(previous);
        selectedSessionSkillNamesRef.current = next;
        return next;
      });
    } else {
      setSelectedProjectSkillNames((previous) => {
        const next = updateSkills(previous);
        selectedProjectSkillNamesRef.current = next;
        return next;
      });
    }
  }, [agentBindingEnabled]);

  const installRepositorySkill = useCallback(async (skill: RepositorySkillItem) => {
    const key = `${skill.repoId}:${skill.id}`;
    setInstallingRepositorySkillKey(key);
    try {
      const response = await api.installAgentRepositoryItem({
        repoId: skill.repoId,
        itemId: skill.id,
        target: 'user',
        overwrite: false,
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response, 'Failed to install Hub Skill'));
      }
      await response.json().catch(() => null);
      await loadInstalledSkills();
      addSessionSkill(skill.name);
      return { success: true, skillName: skill.name };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install Hub Skill';
      console.warn('Failed to install Hub Skill:', error);
      return { success: false, error: message };
    } finally {
      setInstallingRepositorySkillKey('');
    }
  }, [addSessionSkill, loadInstalledSkills]);

  const activeSkillNames = agentBindingEnabled ? selectedSessionSkillNames : selectedProjectSkillNames;
  const getActiveSkillNames = useCallback(
    () => (agentBindingEnabled ? selectedSessionSkillNamesRef.current : selectedProjectSkillNamesRef.current),
    [agentBindingEnabled],
  );

  const handleControlSubagent = useCallback((action: SubagentControlAction, taskId: string, content = '') => {
    const sessionId = activeConversationSessionId
      || selectedSession?.id
      || currentSessionId
      || pendingViewSessionRef.current?.sessionId
      || null;
    if (!sessionId || isTemporarySessionId(sessionId)) {
      addMessage({
        type: 'error',
        content: 'No active conversation is available for background agent control.',
        timestamp: new Date(),
      });
      return;
    }

    const resolvedProjectPath = selectedProject?.fullPath || selectedProject?.path || '';
    const clientMessageId = createClientControlMessageId();
    const request = buildSubagentControlRequest({
      action,
      taskId,
      content,
      sessionId,
      provider,
      clientMessageId,
      sessionActive: isLoading,
      resumeOptions: {
        projectPath: resolvedProjectPath,
        cwd: resolvedProjectPath,
        projectName: selectedProject?.name || '',
        sessionId,
        resume: true,
        toolsSettings: getClaudeSettings(),
        permissionMode,
        model: claudeModel,
        modelProfileId: selectedModelProfileId,
        agentProfileKind: selectedAgentProfileKind,
        sessionSkills: activeSkillNames,
        allowSessionAgentBinding: agentBindingEnabled
          || activeSkillNames.length > 0
          || Boolean(selectedModelProfileId)
          || selectedAgentProfileKind !== DEFAULT_AGENT_PROFILE_KIND,
      },
    });
    if (!request) {
      addMessage({
        type: 'error',
        content: 'Background agent control is only available for Claude/MTL-Code sessions with a task id.',
        timestamp: new Date(),
      });
      return;
    }

    const summary = action === 'wait'
      ? `Wait for background agent ${taskId}`
      : action === 'send'
        ? `Send message to background agent ${taskId}`
        : `Create follow-up from background agent ${taskId}`;
    addMessage({
      id: clientMessageId,
      type: 'user',
      content: content.trim() ? `${summary}\n\n${content.trim()}` : summary,
      timestamp: new Date(),
    });
    sendMessage(request);
    if (!isLoading && request.type === 'claude-command') {
      setIsLoading(true);
      setCanAbortSession(true);
      onSessionProcessing?.(sessionId);
    }
  }, [
    activeConversationSessionId,
    activeSkillNames,
    addMessage,
    agentBindingEnabled,
    claudeModel,
    currentSessionId,
    isLoading,
    onSessionProcessing,
    pendingViewSessionRef,
    permissionMode,
    provider,
    selectedAgentProfileKind,
    selectedModelProfileId,
    selectedProject,
    selectedSession?.id,
    sendMessage,
    setCanAbortSession,
    setIsLoading,
  ]);

  useEffect(() => {
    if (!projectSkillBindingEnabled || !activeConversationSessionId) {
      return undefined;
    }

    const bindingKey = `${provider}:${activeConversationSessionId}:project-skills`;
    const localSkills = selectedProjectSkillNamesRef.current;
    const localModelProfileId = selectedModelProfileIdRef.current;
    const isNewlyCreatedSession = !selectedSession?.id;
    if (isNewlyCreatedSession && (localSkills.length > 0 || localModelProfileId)) {
      projectSkillBindingHydratedKeyRef.current = bindingKey;
      projectSkillBindingPersistKeyRef.current = `${bindingKey}:${JSON.stringify({ skills: localSkills, modelProfileId: localModelProfileId })}`;
      return undefined;
    }

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
        const nextAgentProfileKind = normalizeAgentProfileKind(
          data?.configuration?.agentProfileKind,
          DEFAULT_AGENT_PROFILE_KIND,
        );
        const nextModelProfileId = normalizeModelProfileId(data?.configuration?.modelProfileId) || defaultModelProfileId;
        setSelectedProjectSkillNames(nextSkills);
        setSelectedAgentProfileKind(nextAgentProfileKind);
        setSelectedModelProfileId(nextModelProfileId);
        projectSkillBindingHydratedKeyRef.current = bindingKey;
        projectSkillBindingPersistKeyRef.current = `${bindingKey}:${JSON.stringify({ skills: nextSkills, agentProfileKind: nextAgentProfileKind, modelProfileId: nextModelProfileId })}`;
      } catch (error) {
        console.warn('Failed to load project Skill binding:', error);
        if (!cancelled && projectSkillBindingLoadKeyRef.current === bindingKey) {
          projectSkillBindingLoadKeyRef.current = '';
        }
      }
    };

    void loadProjectSkillBinding();
    return () => {
      cancelled = true;
    };
  }, [activeConversationSessionId, defaultModelProfileId, projectSkillBindingEnabled, provider, selectedSession?.id]);

  useEffect(() => {
    if (!projectSkillBindingEnabled) {
      previousProjectSkillCurrentSessionIdRef.current = currentSessionId;
      return;
    }

    const previousSessionId = previousProjectSkillCurrentSessionIdRef.current;
    previousProjectSkillCurrentSessionIdRef.current = currentSessionId;
    if (
      !isTemporarySessionId(previousSessionId)
      || !activeConversationSessionId
      || selectedSession?.id
    ) {
      return;
    }

    const skills = selectedProjectSkillNamesRef.current;
    const agentProfileKind = selectedAgentProfileKindRef.current;
    if (
      skills.length === 0
      && !selectedModelProfileId
      && agentProfileKind === DEFAULT_AGENT_PROFILE_KIND
    ) {
      return;
    }

    const bindingKey = `${provider}:${activeConversationSessionId}:project-skills`;
    const configuration = {
      appBindings: [],
      skills,
      agentProfileKind,
      modelProfileId: selectedModelProfileId,
    };
    projectSkillBindingHydratedKeyRef.current = bindingKey;
    projectSkillBindingPersistKeyRef.current = `${bindingKey}:${JSON.stringify({ skills, agentProfileKind, modelProfileId: selectedModelProfileId })}`;
    void api.updateSessionAgent(activeConversationSessionId, '', provider, configuration).catch((error) => {
      console.warn('Failed to persist new project Skill binding:', error);
      projectSkillBindingPersistKeyRef.current = '';
    });
  }, [activeConversationSessionId, currentSessionId, projectSkillBindingEnabled, provider, selectedModelProfileId, selectedSession?.id]);

  useEffect(() => {
    if (!projectSkillBindingEnabled || !activeConversationSessionId) {
      return;
    }

    const hydratedKey = `${provider}:${activeConversationSessionId}:project-skills`;
    const isNewlyCreatedSession = !selectedSession?.id;
    if (projectSkillBindingHydratedKeyRef.current !== hydratedKey && !isNewlyCreatedSession) {
      return;
    }

    const persistKey = `${hydratedKey}:${JSON.stringify({ skills: selectedProjectSkillNames, agentProfileKind: selectedAgentProfileKind, modelProfileId: selectedModelProfileId })}`;
    if (projectSkillBindingPersistKeyRef.current === persistKey) {
      return;
    }
    projectSkillBindingPersistKeyRef.current = persistKey;

    const persistProjectSkills = selectedProjectSkillNames.length > 0
      || selectedModelProfileId
      || selectedAgentProfileKind !== DEFAULT_AGENT_PROFILE_KIND
      ? api.updateSessionAgent(activeConversationSessionId, '', provider, {
        appBindings: [],
        skills: selectedProjectSkillNames,
        agentProfileKind: selectedAgentProfileKind,
        modelProfileId: selectedModelProfileId,
      })
      : api.clearSessionAgent(activeConversationSessionId, provider);

    void persistProjectSkills.catch((error) => {
      console.warn('Failed to persist project Skill binding:', error);
      projectSkillBindingPersistKeyRef.current = '';
    });
  }, [activeConversationSessionId, projectSkillBindingEnabled, provider, selectedAgentProfileKind, selectedModelProfileId, selectedProjectSkillNames, selectedSession?.id]);

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
    fileMentionQuery,
    isLoadingFileMentions,
    fileMentionError,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    attachedFiles,
    setAttachedFiles,
    uploadingImages,
    imageErrors,
    fileAttachmentErrors,
    handleAttachmentFiles,
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
    subagentDispatchRequested,
    setSubagentDispatchRequested,
    pendingLaunchDialog,
    setPendingLaunchDialog,
    confirmLaunchDialog,
    cancelLaunchDialog,
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
    selectedAgentSetupAnswers: agentBindingEnabled ? selectedAgentSetupAnswers : {},
    selectedAgentSetupPresetId: agentBindingEnabled ? selectedAgentSetupPresetId : '',
    selectedSkillNames: activeSkillNames,
    getSelectedSkillNames: getActiveSkillNames,
    agentProfileKind: selectedAgentProfileKind,
    modelProfileId: selectedModelProfileId,
    allowSessionAgentBinding: agentBindingEnabled
      || activeSkillNames.length > 0
      || Boolean(selectedModelProfileId)
      || selectedAgentProfileKind !== DEFAULT_AGENT_PROFILE_KIND,
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
    pendingPermissionRequests,
    setPendingPermissionRequests,
    onPermissionDecisionApplied: syncPermissionDecisionToSessionStore,
    setPromptInjectionDebug: setCachedPromptInjectionDebug,
  });

  const handleReuseSubagentObjective = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }
    setInput(prompt);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [setInput, textareaRef]);

  const applyConversationDraft = useCallback(
    (payload: ConversationDraftPayload | null) => {
      if (!payload || appliedConversationDraftKeyRef.current === payload.id) {
        return false;
      }

      if (!shouldApplyConversationDraft(payload, {
        isConversationSpace,
        selectedProject,
        selectedSession,
        currentSessionId,
      })) {
        return false;
      }

      setInput((previous) => (
        payload.mode === 'append' && previous.trim()
          ? `${previous.trimEnd()}\n\n${payload.text}`
          : payload.text
      ));
      appliedConversationDraftKeyRef.current = payload.id;
      clearStoredConversationDraft(payload.id);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return true;
    },
    [currentSessionId, isConversationSpace, selectedProject, selectedSession, setInput, textareaRef],
  );

  useEffect(() => {
    applyConversationDraft(readStoredConversationDraft());
  }, [applyConversationDraft]);

  useEffect(() => {
    const handleConversationDraft = (event: Event) => {
      applyConversationDraft(getConversationDraftFromEvent(event));
    };

    window.addEventListener(CONVERSATION_DRAFT_EVENT, handleConversationDraft);
    return () => window.removeEventListener(CONVERSATION_DRAFT_EVENT, handleConversationDraft);
  }, [applyConversationDraft]);

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
    const activeSessionId = selectedSession?.id || currentSessionId;
    const providerVal = (selectedSession?.__provider || provider || localStorage.getItem('selected-provider') || 'claude') as LLMProvider;
    if (activeSessionId && providerVal === 'claude') {
      sendMessage({ type: 'check-session-status', sessionId: activeSessionId, provider: 'claude' });
      sendMessage({ type: 'get-pending-permissions', sessionId: activeSessionId });
    }

    if (!selectedProject || !selectedSession) return;
    await sessionStore.refreshFromServer(selectedSession.id, {
      provider: (selectedSession.__provider || providerVal) as LLMProvider,
      projectName: selectedProject.name,
      projectPath: selectedProject.fullPath || selectedProject.path || '',
      limit: allMessagesLoaded ? null : Math.max(visibleMessageCount, 20),
      offset: 0,
    });
    setIsLoading(false);
    setCanAbortSession(false);
  }, [allMessagesLoaded, currentSessionId, provider, selectedProject, selectedSession, sendMessage, sessionStore, setIsLoading, setCanAbortSession, visibleMessageCount]);

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
    setAgentRuntimeDiagnostics: setCachedAgentRuntimeDiagnostics,
    setPromptInjectionDebug: setCachedPromptInjectionDebug,
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

  useEffect(() => {
    if (provider !== 'claude' || pendingPermissionRequests.length === 0) {
      return;
    }

    const settings = getClaudeSettings();
    const shouldAutoAllow =
      settings.skipPermissions
      || settings.permissionMode === 'bypassPermissions'
      || permissionMode === 'bypassPermissions';
    if (!shouldAutoAllow) {
      return;
    }

    const autoAllowRequestIds = pendingPermissionRequests
      .filter((request) => !INTERACTIVE_PERMISSION_TOOLS.has(request.toolName))
      .map((request) => request.requestId);
    if (autoAllowRequestIds.length === 0) {
      return;
    }

    handlePermissionDecision(autoAllowRequestIds, {
      allow: true,
      message: 'Allowed automatically by global permission settings',
    });
  }, [claudeSettingsVersion, handlePermissionDecision, pendingPermissionRequests, permissionMode, provider]);

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
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1">
            <ChatMessagesPane
              scrollContainerRef={scrollContainerRef}
              onPreserveScrollForLayoutChange={preserveScrollForLayoutChange}
              isLoadingSessionMessages={isLoadingSessionMessages}
              sessionLoadError={sessionLoadError}
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
              sessionMessagesCount={loadedMessageCount || Math.min(chatMessages.length, totalMessages || chatMessages.length)}
              visibleMessageCount={visibleMessageCount}
              visibleMessages={visibleMessages}
              isSessionRunning={isLoading}
              loadMoreHistoryMessages={loadMoreHistoryMessages}
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
              selectedModelProfileId={selectedModelProfileId}
              onModelProfileChange={setSelectedModelProfileId}
              onControlSubagent={handleControlSubagent}
            />
          </div>

          {showPromptInjectionPanel && (
            <PromptInjectionDebugPanel
              payload={promptInjectionDebug}
              collapsed={isPromptDebugCollapsed}
              onToggleCollapsed={() => setIsPromptDebugCollapsed((previous) => !previous)}
            />
          )}

          <AgentRuntimeTimelinePanel
            sessionId={selectedSession?.id || currentSessionId}
            provider={(selectedSession?.__provider || provider) as LLMProvider}
            projectName={selectedProject.name || ''}
            projectPath={selectedProject.fullPath || selectedProject.path || ''}
            isSessionRunning={isLoading}
          />

          <CheckpointPanel
            sessionId={selectedSession?.id || currentSessionId}
            provider={(selectedSession?.__provider || provider) as LLMProvider}
            projectPath={selectedProject.fullPath || selectedProject.path || ''}
            isSessionRunning={isLoading}
          />
        </div>

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
          repositorySkills={repositorySkills}
          repositorySkillsLoading={repositorySkillsLoading}
          repositorySkillsError={repositorySkillsError}
          installingRepositorySkillKey={installingRepositorySkillKey}
          onInstallRepositorySkill={installRepositorySkill}
          selectedSkillNames={activeSkillNames}
          onToggleSkillName={toggleSessionSkill}
          onClearSkillNames={() => {
            if (agentBindingEnabled) {
              selectedSessionSkillNamesRef.current = [];
              setSelectedSessionSkillNames([]);
            } else {
              selectedProjectSkillNamesRef.current = [];
              setSelectedProjectSkillNames([]);
            }
          }}
          showRuntimeDiagnostics={agentBindingEnabled || activeSkillNames.length > 0 || Boolean(agentRuntimeDiagnostics)}
          agentRuntimeDiagnostics={agentRuntimeDiagnostics}
          subagentActivity={subagentActivity ?? undefined}
          subagentsEnabled={subagentsEnabled}
          subagentDispatchRequested={subagentDispatchRequested}
          onSubagentDispatchRequestedChange={setSubagentDispatchRequested}
          goalsEnabled={goalsEnabled}
          sessionGoal={displayedSessionGoal}
          onSetGoal={handleSetSessionGoal}
          onPauseGoal={() => handleSessionGoalAction('pause')}
          onResumeGoal={() => handleSessionGoalAction('resume')}
          onCompleteGoal={() => handleSessionGoalAction('complete')}
          onClearGoal={handleClearSessionGoal}
          onStopSubagents={handleStopSubagents}
          onControlSubagent={handleControlSubagent}
          onReuseSubagentObjective={handleReuseSubagentObjective}
          tokenBudget={tokenBudget}
          messages={chatMessages}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          hasConversationContext={Boolean(selectedSession?.id || currentSessionId || chatMessages.length > 0)}
          selectedAgentProfileKind={selectedAgentProfileKind}
          onAgentProfileChange={handleAgentProfileChange}
          selectedModelProfileId={selectedModelProfileId}
          onModelProfileChange={setSelectedModelProfileId}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          attachedFiles={attachedFiles}
          onAttachFiles={handleAttachmentFiles}
          onRemoveFile={(index) =>
            setAttachedFiles((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          fileAttachmentErrors={fileAttachmentErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          fileMentionQuery={fileMentionQuery}
          isLoadingFileMentions={isLoadingFileMentions}
          fileMentionError={fileMentionError}
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

      {pendingLaunchDialog && (
        <AgentLaunchDialog
          agent={pendingLaunchDialog.agent}
          answers={pendingLaunchDialog.answers}
          selectedPresetId={pendingLaunchDialog.presetId}
          isLoading={isLoading}
          onAnswersChange={(answers) => setPendingLaunchDialog((previous) => (
            previous ? { ...previous, answers } : previous
          ))}
          onPresetChange={(presetId) => setPendingLaunchDialog((previous) => (
            previous ? { ...previous, presetId } : previous
          ))}
          onCancel={cancelLaunchDialog}
          onConfirm={confirmLaunchDialog}
        />
      )}

      {agentBindingEnabled && pendingAgentSetup && (
        <AgentSessionSetupDialog
          agent={pendingAgentSetup}
          initialBindings={selectedAgentId === pendingAgentSetup.id ? selectedAgentAppBindings : pendingAgentSetup.appBindings}
          initialDialogAnswers={selectedAgentId === pendingAgentSetup.id ? selectedAgentSetupAnswers : undefined}
          initialSetupPresetId={selectedAgentId === pendingAgentSetup.id ? selectedAgentSetupPresetId : undefined}
          workspacePath={workspacePath}
          isLoading={isLoading}
          onCancel={() => setPendingAgentSetup(null)}
          onConfirm={(bindings, setupAnswers, setupPresetId) => confirmAgentSetup(pendingAgentSetup, bindings, setupAnswers, setupPresetId)}
        />
      )}

      <QuickSettingsPanel />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
