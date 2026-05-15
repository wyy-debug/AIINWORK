import type { AgentAppBinding } from '../../../types/agent';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore } from '../../../stores/useSessionStore';

export type Provider = LLMProvider;

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface ChatImage {
  data: string;
  name: string;
}

export interface ChatUploadedFile {
  name: string;
  path: string;
  size?: number;
  mimeType?: string;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export type SubagentRuntimeStatus = 'RUNNING' | 'DONE' | 'BLOCKED' | 'NEED_PARENT_INPUT';

export interface SubagentRuntimeSnapshot {
  objective?: string;
  currentStep?: number;
  maxSteps?: number;
  remainingSteps?: number;
  startedAt?: number;
  elapsedMs?: number;
  runtimeStatus?: SubagentRuntimeStatus;
  stopReason?: string;
  lastTool?: string;
  lastInput?: string;
  lastToolSummary?: string;
  recentActions?: string[];
}

export type SubagentRegistryStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'need_parent_input'
  | 'interrupted';

export interface SubagentEventV1 {
  id?: string;
  taskId?: string;
  type?: string;
  timestamp?: number;
  message?: string;
  toolName?: string;
  summary?: string;
}

export interface SubagentEventEnvelope {
  seq: number;
  sessionId: string;
  parentToolUseId: string;
  taskId: string;
  threadId: string;
  packageId?: string;
  packageVersion?: string;
  dialogInstanceId?: string;
  type:
    | 'started'
    | 'progress'
    | 'tool_started'
    | 'tool_completed'
    | 'message'
    | 'completed'
    | 'blocked'
    | 'failed'
    | 'cancelled'
    | 'token_usage'
    | 'control_requested'
    | 'control_accepted'
    | 'control_failed';
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface SubagentRegistryRecord {
  taskId?: string;
  agentId?: string;
  parentToolUseId?: string;
  parentSessionId?: string;
  sessionId?: string;
  userTurnId?: string;
  objective?: string;
  role?: string;
  agentType?: string;
  status?: SubagentRegistryStatus;
  runtimeStatus?: SubagentRuntimeStatus;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  currentStep?: number;
  maxSteps?: number;
  remainingSteps?: number;
  lastTool?: string;
  lastInput?: string;
  lastToolSummary?: string;
  stopReason?: string;
  resultSummary?: string;
  evidence?: string;
  nextAction?: string;
  changes?: string;
  blockers?: string;
  recentActions?: string[];
  events?: SubagentEventV1[];
  swarmRunId?: string;
  swarmAgentId?: string;
  swarmRoleId?: string;
}

export interface SubagentActivityItem {
  id?: string;
  taskId?: string;
  label: string;
  status?: SubagentRegistryStatus;
  runtimeStatus?: SubagentRuntimeStatus;
  objective?: string;
  role?: string;
  currentStep?: number;
  maxSteps?: number;
  remainingSteps?: number;
  startedAt?: number;
  endedAt?: number;
  lastTool?: string;
  lastToolSummary?: string;
  stopReason?: string;
  resultSummary?: string;
  evidence?: string;
  nextAction?: string;
  blockers?: string;
  elapsedMs?: number;
  activeToolLabel?: string;
  outputting?: boolean;
  terminal?: boolean;
}

export interface SubagentActivitySummary {
  total: number;
  running: number;
  completed: number;
  outputting: number;
  latestLabel?: string;
  runningLabels?: string[];
  outputtingLabels?: string[];
  activeToolLabels?: string[];
  runtimeStatus?: SubagentRuntimeStatus;
  objective?: string;
  currentStep?: number;
  maxSteps?: number;
  remainingSteps?: number;
  elapsedMs?: number;
  lastTool?: string;
  lastToolSummary?: string;
  stopReason?: string;
  items: SubagentActivityItem[];
  historyItems: SubagentActivityItem[];
}

export interface ChatMessage {
  id?: string;
  sessionId?: string;
  type: string;
  content?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  files?: ChatUploadedFile[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isContextCompaction?: boolean;
  compactType?: 'full' | 'micro' | 'summary' | string;
  compactTrigger?: string;
  compactSummary?: string;
  compactSummaryAvailable?: boolean;
  preTokens?: number;
  tokensSaved?: number;
  compactedToolIds?: unknown;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  isSubagentContainer?: boolean;
  subagentState?: {
    taskId?: string;
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
    isAsyncLaunch?: boolean;
    objective?: string;
    currentStep?: number;
    maxSteps?: number;
    remainingSteps?: number;
    startedAt?: number;
    elapsedMs?: number;
    lastTool?: string;
    lastToolSummary?: string;
    resultSummary?: string;
    evidence?: string;
    nextAction?: string;
    changes?: string;
    blockers?: string;
    runtimeStatus?: SubagentRuntimeStatus;
    stopReason?: string;
    registryRecord?: SubagentRegistryRecord;
    subagentEvents?: SubagentEventEnvelope[];
  };
  [key: string]: unknown;
}

export interface ClaudeSettings {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  permissionMode?: PermissionMode;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface ClaudePermissionSuggestion {
  toolName: string;
  entry: string;
  isAllowed: boolean;
}

export interface PermissionGrantResult {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ClaudeSettings;
}

export interface PendingPermissionRequest {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
}

export interface AgentRuntimePermissionSnapshot {
  permissionMode: string;
  skipPermissions: boolean;
  allowedTools: string[];
  disallowedTools: string[];
  bypassPermissions: boolean;
  sources?: {
    global?: Record<string, unknown>;
    session?: Record<string, unknown>;
    project?: Record<string, unknown>;
  };
  conflicts?: string[];
  matchedRules?: string[];
  explanation?: string;
}

export interface AgentRuntimeSkillDetail {
  name: string;
  label: string;
  path: string;
  scope: string;
  provider?: string;
  callable: boolean;
  exists: boolean;
  promptLength: number;
  unavailableReason?: string;
}

export interface OpenMythosRuntimeDiagnostics {
  enabled: boolean;
  adaptiveEffort: boolean;
  taskCard: boolean;
  routingHints: boolean;
  loopControl?: 'advisory' | 'enforced' | string;
  stableReinjection?: boolean;
  phaseAdapter?: boolean;
  expertRouting?: boolean;
  contextCacheDiagnostics?: boolean;
  bareMode?: boolean;
  openMythosRuntimeCardActive?: boolean;
  minEffort: string;
  maxEffort: string;
  runtimeCard?: {
    goal?: string;
    effort?: string;
    loopBudget?: number;
    riskScore?: number;
    phase?: string;
    phasePlan?: string[];
    remainingBudget?: number;
    reasons?: string[];
    constraints?: string[];
    expertRoutes?: Array<{
      kind?: string;
      label?: string;
      reason?: string;
      required?: boolean;
    }>;
  } | null;
  contextCache?: {
    compactBoundaryCount?: number;
    microcompactBoundaryCount?: number;
    toolSummaryCount?: number;
    summaryLength?: number;
    skillPromptLength?: number;
    appendSystemPromptLength?: number;
  };
}

export interface SubagentRuntimeDiagnostics {
  enabled?: boolean;
  maxConcurrentThreadsPerSession?: number;
  maxDepth?: number;
}

export interface PromptInjectionDebugPayload {
  appendSystemPrompt: string;
  appendSystemPromptLength: number;
  nativeSystemPrompt?: string;
  nativeSystemPromptLength?: number;
  originalCommand?: string;
  effectiveCommand?: string;
  effectiveCommandLength?: number;
  commandChanged?: boolean;
  permissionMode?: string;
  codexStylePlanMode?: boolean;
  coordinatorMode?: boolean;
  claudeNativeMemoryEnabled?: boolean;
  autoMemoryExtractionEnabled?: boolean;
  bareMode?: boolean;
  cli?: {
    hasBareFlag?: boolean;
    hasAppendSystemPromptFlag?: boolean;
  };
  argusInternal?: {
    hiddenFallbackInjected?: boolean;
    preflightInjected?: boolean;
    preflightOk?: boolean;
    preflightSectionCount?: number;
  };
  sessionId?: string | null;
  receivedAt?: string;
}

export interface AgentRuntimeDiagnostics {
  type?: 'agent' | 'skills' | string;
  provider?: string;
  allowSessionAgentBinding?: boolean;
  agentId?: string;
  agentName?: string;
  appBindings?: AgentAppBinding[];
  mcpBindings?: AgentAppBinding[];
  sessionSkills?: string[];
  effectiveSkills?: string[];
  skillDetails?: AgentRuntimeSkillDetail[];
  skillPromptLength?: number;
  mcpDiagnosticsSummary?: Array<{
    slot?: string;
    serverName?: string;
    status?: string;
    runtimeToolsStatus?: string;
    message?: string;
  }>;
  appendSystemPromptLength?: number;
  model?: string;
  modelProfileId?: string;
  bareMode?: boolean;
  openMythosRuntimeCardActive?: boolean;
  openMythosRuntime?: OpenMythosRuntimeDiagnostics | null;
  subagents?: SubagentRuntimeDiagnostics | null;
  contextWindowTokens?: number | null;
  projectPath?: string;
  sessionId?: string | null;
  permissions?: AgentRuntimePermissionSnapshot;
  receivedAt?: string;
  [key: string]: unknown;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  id?: string;
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface ChatInterfaceProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isConversationSpace?: boolean;
  quickStartAgentId?: string;
  quickStartAgentRequestId?: number;
  newConversationRequestId?: number;
  newProjectSessionRequestId?: number;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: any;
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  processingSessions?: Set<string>;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (targetSessionId: string) => void;
  onShowSettings?: (tab?: string) => void;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  autoScrollToBottom?: boolean;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  onTaskClick?: (...args: unknown[]) => void;
  onShowAllTasks?: (() => void) | null;
  sessionStore: SessionStore;
}
