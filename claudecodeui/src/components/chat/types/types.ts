import type { AgentAppBinding } from '../../../types/agent';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';

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

export interface SubagentActivitySummary {
  total: number;
  running: number;
  completed: number;
  outputting: number;
  latestLabel?: string;
}

export interface ChatMessage {
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
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
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
  autoDispatchSubagents?: boolean;
  configuredAutoDispatchSubagents?: boolean;
  effectiveAutoDispatchSubagents?: boolean;
  autoDispatchMinEffort?: string;
  autoDispatchMaxWorkers?: number;
  dispatchConfirmation?: {
    required?: boolean;
    confirmed?: boolean;
    mode?: 'single-agent' | 'auto-dispatch' | string;
    source?: string;
  };
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
    dispatchPlan?: Array<{
      kind?: string;
      label?: string;
      reason?: string;
      required?: boolean;
      description?: string;
      prompt?: string;
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
  openMythosRuntime?: OpenMythosRuntimeDiagnostics | null;
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
}
