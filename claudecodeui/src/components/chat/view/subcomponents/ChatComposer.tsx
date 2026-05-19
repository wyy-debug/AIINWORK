import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent,
} from 'react';
import {
  ImageIcon,
  MessageSquareIcon,
  XIcon,
  ArrowDownIcon,
  BotIcon,
  SparklesIcon,
  WrenchIcon,
  BracesIcon,
  CheckIcon,
  ChevronDownIcon,
  SearchIcon,
  AtSignIcon,
  FileIcon,
  FolderIcon,
  Loader2Icon,
  DownloadIcon,
  CloudIcon,
  PaperclipIcon,
  ShieldIcon,
  SquareIcon,
  CopyIcon,
  TargetIcon,
  PauseIcon,
  PlayIcon,
  Trash2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { AgentAppBinding, AgentConfig, InstalledSkill, RepositorySkillItem } from '../../../../types/agent';
import type {
  AgentRuntimeDiagnostics,
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
  Provider,
  SubagentActivitySummary,
} from '../../types/types';
import { ARGUS_DEFAULT_PERMISSION_MODE } from '../../utils/chatStorage';
import { normalizeContextBudget } from '../../utils/contextBudget';
import { buildSubagentDetailRows } from '../../utils/subagentDetailRows';
import type { SubagentControlAction } from '../../utils/subagentControlRequest';
import { getSubagentBlockerGuidance } from '../../utils/subagentGuidance';

import AgentRuntimeDiagnosticsPanel from './AgentRuntimeDiagnosticsPanel';
import CommandMenu from './CommandMenu';
import FileAttachment from './FileAttachment';
import ImageAttachment from './ImageAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import RuntimeModelSwitcher from './RuntimeModelSwitcher';
import AgentProfileSwitcher from './AgentProfileSwitcher';

interface MentionableFile {
  name: string;
  path: string;
  type?: 'file' | 'directory';
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

type SessionGoal = {
  objective: string;
  status: 'active' | 'paused' | 'budget_limited' | 'complete';
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
};

type StatusTodoItem = {
  id?: string;
  content: string;
  status: 'completed' | 'in_progress' | 'pending';
};

const normalizeStatusTodoItem = (value: unknown): StatusTodoItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content.trim() : '';
  if (!content) {
    return null;
  }
  const rawStatus = typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    content,
    status: rawStatus === 'completed' || rawStatus === 'in_progress' ? rawStatus : 'pending',
  };
};

const extractTodoItems = (value: unknown): StatusTodoItem[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStatusTodoItem(item)).filter((item): item is StatusTodoItem => Boolean(item));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return extractTodoItems(parsed);
    } catch {
      return [];
    }
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.todos)) {
      return record.todos
        .map((item) => normalizeStatusTodoItem(item))
        .filter((item): item is StatusTodoItem => Boolean(item));
    }
    if (record.content) {
      return extractTodoItems(record.content);
    }
  }

  return [];
};

const getStatusTodoItems = (messages: ChatMessage[]): StatusTodoItem[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message?.isToolUse || !['TodoWrite', 'TodoRead'].includes(String(message.toolName || ''))) {
      continue;
    }

    const fromInput = extractTodoItems(message.toolInput);
    if (fromInput.length > 0) {
      return fromInput;
    }

    const fromResult = extractTodoItems(message.toolResult);
    if (fromResult.length > 0) {
      return fromResult;
    }
  }

  return [];
};

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  onAbortSession: () => void;
  provider: Provider | string;
  agents: AgentConfig[];
  selectedAgentId: string;
  selectedAgentAppBindings: AgentAppBinding[];
  onSelectedAgentIdChange: (agentId: string) => void;
  installedSkills: InstalledSkill[];
  repositorySkills: RepositorySkillItem[];
  repositorySkillsLoading: boolean;
  repositorySkillsError: string | null;
  installingRepositorySkillKey: string;
  onInstallRepositorySkill: (
    skill: RepositorySkillItem,
  ) => Promise<{ success: boolean; skillName?: string; error?: string }>;
  selectedSkillNames: string[];
  onToggleSkillName: (skillName: string) => void;
  onClearSkillNames: () => void;
  showRuntimeDiagnostics: boolean;
  agentRuntimeDiagnostics: AgentRuntimeDiagnostics | null;
  subagentActivity?: SubagentActivitySummary;
  subagentsEnabled?: boolean;
  subagentDispatchRequested: boolean;
  onSubagentDispatchRequestedChange: (value: boolean) => void;
  goalsEnabled?: boolean;
  sessionGoal?: SessionGoal | null;
  onSetGoal?: (objective: string, tokenBudget?: number | null) => Promise<void> | void;
  onPauseGoal?: () => Promise<void> | void;
  onResumeGoal?: () => Promise<void> | void;
  onCompleteGoal?: () => Promise<void> | void;
  onClearGoal?: () => Promise<void> | void;
  onStopSubagents?: (taskIds?: string[]) => void;
  onControlSubagent?: (action: SubagentControlAction, taskId: string, content?: string) => void;
  onReuseSubagentObjective?: (text: string) => void;
  tokenBudget: Record<string, unknown> | null;
  messages: ChatMessage[];
  permissionMode: PermissionMode | string;
  onPermissionModeChange: (mode: PermissionMode) => void;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  hasConversationContext: boolean;
  selectedAgentProfileKind?: string;
  onAgentProfileChange?: (profileKind: string) => void;
  selectedModelProfileId?: string;
  onModelProfileChange?: (profileId: string) => void;
  onScrollToBottom: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedImages: File[];
  onRemoveImage: (index: number) => void;
  attachedFiles: File[];
  onAttachFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  uploadingImages: Map<string, number>;
  imageErrors: Map<string, string>;
  fileAttachmentErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  fileMentionQuery: string;
  isLoadingFileMentions: boolean;
  fileMentionError: string | null;
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openImagePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  isLoading,
  onAbortSession,
  agents,
  selectedAgentId,
  selectedAgentAppBindings,
  onSelectedAgentIdChange,
  installedSkills,
  repositorySkills,
  repositorySkillsLoading,
  repositorySkillsError,
  installingRepositorySkillKey,
  onInstallRepositorySkill,
  selectedSkillNames,
  onToggleSkillName,
  onClearSkillNames,
  showRuntimeDiagnostics,
  agentRuntimeDiagnostics,
  subagentActivity,
  subagentsEnabled = false,
  subagentDispatchRequested,
  onSubagentDispatchRequestedChange,
  goalsEnabled = false,
  sessionGoal,
  onSetGoal,
  onPauseGoal,
  onResumeGoal,
  onCompleteGoal,
  onClearGoal,
  onStopSubagents,
  onControlSubagent,
  onReuseSubagentObjective,
  tokenBudget,
  messages,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  hasConversationContext,
  selectedAgentProfileKind,
  onAgentProfileChange,
  selectedModelProfileId,
  onModelProfileChange,
  onScrollToBottom,
  permissionMode,
  onPermissionModeChange,
  onSubmit,
  isDragActive,
  attachedImages,
  onRemoveImage,
  attachedFiles,
  onAttachFiles,
  onRemoveFile,
  uploadingImages,
  imageErrors,
  fileAttachmentErrors,
  showFileDropdown,
  filteredFiles,
  fileMentionQuery,
  isLoadingFileMentions,
  fileMentionError,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openImagePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false);
  const [agentMenuPosition, setAgentMenuPosition] = useState<{ left: number; bottom: number } | null>(null);
  const [isPermissionMenuOpen, setIsPermissionMenuOpen] = useState(false);
  const [permissionMenuPosition, setPermissionMenuPosition] = useState<{ left: number; bottom: number } | null>(null);
  const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
  const [isSubagentDetailsOpen, setIsSubagentDetailsOpen] = useState(false);
  const [isSubagentManagerOpen, setIsSubagentManagerOpen] = useState(false);
  const [subagentControlDraft, setSubagentControlDraft] = useState<{ taskId: string; action: 'send' | 'followup' } | null>(null);
  const [subagentControlText, setSubagentControlText] = useState('');
  const [isGoalEditorOpen, setIsGoalEditorOpen] = useState(false);
  const [goalObjectiveDraft, setGoalObjectiveDraft] = useState('');
  const [goalBudgetDraft, setGoalBudgetDraft] = useState('');
  const [goalEditorError, setGoalEditorError] = useState('');
  const [isGoalSaving, setIsGoalSaving] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillMenuNotice, setSkillMenuNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [skillMenuPosition, setSkillMenuPosition] = useState<{ left: number; bottom: number } | null>(null);
  const agentMenuButtonRef = useRef<HTMLButtonElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const permissionMenuButtonRef = useRef<HTMLButtonElement>(null);
  const permissionMenuRef = useRef<HTMLDivElement>(null);
  const skillMenuButtonRef = useRef<HTMLButtonElement>(null);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const goalObjectiveInputRef = useRef<HTMLInputElement>(null);
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // Hide the thinking/status bar while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;
  const statusTodoItems = useMemo(() => getStatusTodoItems(messages), [messages]);
  const selectedSkillKeys = useMemo(
    () => new Set(selectedSkillNames.map((name) => name.toLowerCase())),
    [selectedSkillNames],
  );
  const contextBudget = useMemo(() => normalizeContextBudget(tokenBudget), [tokenBudget]);
  const installedSkillKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const skill of installedSkills) {
      [skill.id, skill.name, skill.title]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .forEach((value) => keys.add(value.trim().toLowerCase()));
    }
    return keys;
  }, [installedSkills]);
  const normalizedSkillSearch = skillSearch.trim().toLowerCase();
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || null;
  const selectedMcpBindings = selectedAgentAppBindings.filter((binding) => binding.app.trim().startsWith('MCP: '));
  const filteredInstalledSkills = useMemo(() => {
    const matches = installedSkills.filter((skill) => (
      !normalizedSkillSearch
      || `${skill.name} ${skill.title} ${skill.description || ''} ${skill.provider} ${skill.scope}`
        .toLowerCase()
        .includes(normalizedSkillSearch)
    ));

    return [...matches].sort((left, right) => {
      const leftLabel = left.title || left.name;
      const rightLabel = right.title || right.name;
      const leftSelected = selectedSkillKeys.has(left.name.toLowerCase()) || selectedSkillKeys.has(leftLabel.toLowerCase());
      const rightSelected = selectedSkillKeys.has(right.name.toLowerCase()) || selectedSkillKeys.has(rightLabel.toLowerCase());

      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return leftLabel.localeCompare(rightLabel);
    });
  }, [installedSkills, normalizedSkillSearch, selectedSkillKeys]);
  const filteredRepositorySkills = useMemo(() => {
    return repositorySkills
      .filter((skill) => {
        const candidates = [skill.id, skill.name, skill.title].map((value) => String(value || '').toLowerCase());
        if (candidates.some((value) => installedSkillKeys.has(value))) {
          return false;
        }
        return !normalizedSkillSearch || [
          skill.name,
          skill.title,
          skill.description || '',
          skill.repoName || '',
          skill.author || '',
          ...(skill.tags || []),
        ].join(' ').toLowerCase().includes(normalizedSkillSearch);
      })
      .sort((left, right) => {
        const likesDiff = Number(right.likes || 0) - Number(left.likes || 0);
        if (likesDiff !== 0) return likesDiff;
        return (left.title || left.name).localeCompare(right.title || right.name);
      });
  }, [installedSkillKeys, normalizedSkillSearch, repositorySkills]);
  const hasSkillChoices = installedSkills.length > 0 || repositorySkills.length > 0 || repositorySkillsLoading;
  const selectedSkillSummaries = selectedSkillNames.map((skillName) => {
    const normalized = skillName.toLowerCase();
    const installedSkill = installedSkills.find((skill) => (
      skill.name.toLowerCase() === normalized || skill.title.toLowerCase() === normalized
    ));
    return {
      name: skillName,
      label: installedSkill?.title || installedSkill?.name || skillName,
      callable: Boolean(installedSkill?.callable),
      source: installedSkill ? `${installedSkill.provider}/${installedSkill.scope}` : 'missing',
    };
  });
  const hasRuntimeBindings = Boolean(selectedAgent || selectedMcpBindings.length > 0 || selectedSkillSummaries.length > 0);
  const activeGoalRemainingTokens = typeof sessionGoal?.tokenBudget === 'number'
    ? Math.max(0, sessionGoal.tokenBudget - sessionGoal.tokensUsed)
    : null;
  const handleGoalButtonClick = () => {
    if (!goalsEnabled) {
      return;
    }
    setGoalObjectiveDraft(sessionGoal?.objective || '');
    setGoalBudgetDraft(typeof sessionGoal?.tokenBudget === 'number' ? String(sessionGoal.tokenBudget) : '');
    setGoalEditorError('');
    setIsGoalEditorOpen(true);
    window.setTimeout(() => goalObjectiveInputRef.current?.focus(), 0);
  };

  const handleGoalEditorSubmit = async () => {
    if (!goalsEnabled || !onSetGoal || isGoalSaving) {
      return;
    }
    const objective = goalObjectiveDraft.trim();
    if (!objective) {
      setGoalEditorError('请输入 Goal 内容');
      return;
    }

    const budgetText = goalBudgetDraft.trim();
    const parsedBudget = budgetText ? Number.parseInt(budgetText, 10) : null;
    if (budgetText && (!Number.isFinite(parsedBudget) || parsedBudget! <= 0)) {
      setGoalEditorError('Token 预算需要是正整数，或留空');
      return;
    }

    setIsGoalSaving(true);
    setGoalEditorError('');
    try {
      await onSetGoal(objective, parsedBudget);
      setIsGoalEditorOpen(false);
      textareaRef.current?.focus();
    } catch (error) {
      setGoalEditorError(error instanceof Error ? error.message : '保存 Goal 失败');
    } finally {
      setIsGoalSaving(false);
    }
  };

  const handleGoalEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleGoalEditorSubmit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsGoalEditorOpen(false);
      textareaRef.current?.focus();
    }
  };
  const hasAttachments = attachedImages.length > 0 || attachedFiles.length > 0;
  const normalizedPermissionMode: PermissionMode = (
    permissionMode === 'acceptEdits'
    || permissionMode === 'bypassPermissions'
    || permissionMode === 'plan'
  ) ? permissionMode : ARGUS_DEFAULT_PERMISSION_MODE;
  const permissionModeOptions: Array<{
    id: PermissionMode;
    label: string;
    shortLabel: string;
    description: string;
    tone: string;
  }> = [
    {
      id: 'default',
      label: '默认模式',
      shortLabel: '默认',
      description: '按需申请工具权限，适合日常对话。',
      tone: 'text-slate-700 dark:text-slate-200',
    },
    {
      id: 'acceptEdits',
      label: '自动同意编辑',
      shortLabel: '编辑',
      description: '自动允许文件编辑，其他工具仍按设置处理。',
      tone: 'text-blue-700 dark:text-blue-300',
    },
    {
      id: 'bypassPermissions',
      label: '全权限',
      shortLabel: '全权限',
      description: '跳过权限确认，等同于危险跳过权限。',
      tone: 'text-amber-700 dark:text-amber-300',
    },
    {
      id: 'plan',
      label: 'Plan 模式',
      shortLabel: 'Plan',
      description: '先生成执行计划，确认后再继续。',
      tone: 'text-indigo-700 dark:text-indigo-300',
    },
  ];
  const activePermissionMode = permissionModeOptions.find((mode) => mode.id === normalizedPermissionMode) || permissionModeOptions[0];
  const selectedAgentIsProfile = Boolean(selectedAgent?.profileKind);
  const agentButtonLabel = selectedAgent
    ? `${selectedAgentIsProfile ? 'Profile' : 'Agent'}: ${selectedAgent.shortName || selectedAgent.name}`
    : 'Default';
  const subagentRuntimeStatusLabel: Record<string, string> = {
    RUNNING: '运行中',
    DONE: '已完成',
    BLOCKED: '已阻塞',
    NEED_PARENT_INPUT: '等待输入',
  };
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      onAttachFiles(files);
    }
    event.target.value = '';
  };

  const activeSubagentItems = subagentActivity?.items || [];
  const subagentHistoryItems = subagentActivity?.historyItems || [];
  const primarySubagent = activeSubagentItems[0] || null;
  const stoppableSubagentIds = activeSubagentItems
    .map((item) => item.taskId)
    .filter((taskId): taskId is string => Boolean(taskId && taskId.trim()));
  const canStopSubagents = Boolean(onStopSubagents && stoppableSubagentIds.length > 0);
  const hasSubagentHistory = subagentHistoryItems.length > 0;
  const visibleManagerItems = buildSubagentDetailRows(subagentActivity, {
    mode: isSubagentManagerOpen ? 'history' : 'active',
  });
  const formatSubagentElapsed = (elapsedMs?: number) => {
    if (!Number.isFinite(elapsedMs || NaN)) return '';
    const totalSeconds = Math.max(0, Math.floor((elapsedMs || 0) / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };
  const copySubagentEvidence = (text?: string) => {
    if (!text?.trim()) return;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  useEffect(() => {
    if (!isAgentMenuOpen) return undefined;

    const updatePosition = () => {
      const buttonRect = agentMenuButtonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;

      const menuWidth = Math.min(320, window.innerWidth - 16);
      const left = Math.min(
        Math.max(8, buttonRect.left),
        Math.max(8, window.innerWidth - menuWidth - 8),
      );

      setAgentMenuPosition({
        left,
        bottom: window.innerHeight - buttonRect.top + 8,
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (agentMenuRef.current?.contains(target) || agentMenuButtonRef.current?.contains(target)) {
        return;
      }
      setIsAgentMenuOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAgentMenuOpen(false);
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAgentMenuOpen]);

  useEffect(() => {
    if (!isPermissionMenuOpen) return undefined;

    const updatePosition = () => {
      const buttonRect = permissionMenuButtonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;

      const menuWidth = Math.min(340, window.innerWidth - 16);
      const left = Math.min(
        Math.max(8, buttonRect.left),
        Math.max(8, window.innerWidth - menuWidth - 8),
      );

      setPermissionMenuPosition({
        left,
        bottom: window.innerHeight - buttonRect.top + 8,
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (permissionMenuRef.current?.contains(target) || permissionMenuButtonRef.current?.contains(target)) {
        return;
      }
      setIsPermissionMenuOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPermissionMenuOpen(false);
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPermissionMenuOpen]);

  useEffect(() => {
    if (!isSkillMenuOpen) return undefined;

    const updatePosition = () => {
      const buttonRect = skillMenuButtonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;

      const menuWidth = Math.min(380, window.innerWidth - 16);
      const left = Math.min(
        Math.max(8, buttonRect.left),
        Math.max(8, window.innerWidth - menuWidth - 8),
      );

      setSkillMenuPosition({
        left,
        bottom: window.innerHeight - buttonRect.top + 8,
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (skillMenuRef.current?.contains(target) || skillMenuButtonRef.current?.contains(target)) {
        return;
      }
      setIsSkillMenuOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSkillMenuOpen(false);
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSkillMenuOpen]);

  const handleInstallRepositorySkill = async (skill: RepositorySkillItem) => {
    setSkillMenuNotice(null);
    const result = await onInstallRepositorySkill(skill);
    if (result.success) {
      setSkillMenuNotice({
        type: 'success',
        text: `${skill.title || skill.name} 已安装并绑定到当前会话`,
      });
      return;
    }
    setSkillMenuNotice({
      type: 'error',
      text: result.error || '安装 Hub Skill 失败',
    });
  };

  return (
    <div className="flex-shrink-0 p-2 pb-2 sm:p-4 sm:pb-4 md:p-4 md:pb-6">
      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 w-full max-w-[1120px]">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      {!hasQuestionPanel && <div className="relative mx-auto w-full max-w-[1120px]">
        {hasRuntimeBindings && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-xs shadow-sm">
            {selectedAgent && (
              <span
                className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 font-medium text-primary"
                title={`${selectedAgentIsProfile ? 'Profile' : 'Agent'} bound to this conversation: ${selectedAgent.name}`}
              >
                <BotIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{selectedAgentIsProfile ? 'Profile' : 'Agent'}: {selectedAgent.shortName || selectedAgent.name}</span>
                <span className="shrink-0 text-[10px] opacity-75">
                  {selectedAgent.permissionPreset || 'bound'}
                </span>
              </span>
            )}
            {selectedMcpBindings.map((binding) => (
              <span
                key={`${binding.slot}:${binding.app}`}
                className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 font-medium text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300"
                title={`${binding.slot} 已绑定 ${binding.app}。运行时由 Argus 原生 MCP 配置发现工具。`}
              >
                <WrenchIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{binding.app}</span>
                <span className="shrink-0 text-[10px] opacity-75">MCP</span>
              </span>
            ))}
            {selectedSkillSummaries.map((skill) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => onToggleSkillName(skill.name)}
                disabled={isLoading}
                className={`inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 font-medium transition-colors disabled:opacity-60 ${
                  skill.callable
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                }`}
                title={skill.callable ? `${skill.label} 已可调用：${skill.source}` : `${skill.label} 未在本机 Skill 注册表中找到`}
              >
                <SparklesIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{skill.label}</span>
                <span className="shrink-0 text-[10px] opacity-75">{skill.callable ? '已可调用' : '不可用'}</span>
              </button>
            ))}
          </div>
        )}

        {isUserScrolledUp && hasMessages && (
          <div className="absolute -top-10 left-0 right-0 z-10 flex justify-center">
            <button
              type="button"
              onClick={onScrollToBottom}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
              title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
            >
              <ArrowDownIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        {showFileDropdown && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border/60 bg-card/95 shadow-xl ring-1 ring-black/5 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <AtSignIcon className="h-4 w-4" />
                </span>
                <span className="truncate">选择项目文件</span>
              </div>
              <span className="max-w-[42%] truncate font-mono text-xs text-muted-foreground">
                {fileMentionQuery ? `@${fileMentionQuery}` : '@'}
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto p-1.5">
              {isLoadingFileMentions && (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  <span>正在搜索项目文件...</span>
                </div>
              )}

              {!isLoadingFileMentions && fileMentionError && (
                <div className="px-3 py-4 text-sm text-destructive">
                  文件搜索失败：{fileMentionError}
                </div>
              )}

              {!isLoadingFileMentions && !fileMentionError && filteredFiles.length === 0 && (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  没有找到匹配文件
                </div>
              )}

              {!isLoadingFileMentions && !fileMentionError && filteredFiles.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  className={`flex w-full cursor-pointer touch-manipulation items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    index === selectedFileIndex
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent/60'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectFile(file);
                  }}
                >
                  {file.type === 'directory' ? (
                    <FolderIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{file.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{file.path}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        {showRuntimeDiagnostics && isDiagnosticsOpen && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-3">
            <AgentRuntimeDiagnosticsPanel
              diagnostics={agentRuntimeDiagnostics}
              contextBudget={contextBudget}
              onClose={() => setIsDiagnosticsOpen(false)}
            />
          </div>
        )}

        {isAgentMenuOpen && (
          <div
            ref={agentMenuRef}
            className="fixed z-[92] flex max-h-[360px] w-[min(320px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl ring-1 ring-black/5 backdrop-blur-md"
            style={{
              left: agentMenuPosition?.left ?? 8,
              bottom: agentMenuPosition?.bottom ?? 80,
            }}
            role="listbox"
            aria-label="Select profile or agent"
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border/50 px-3 py-2.5">
              <div className="text-sm font-semibold text-foreground">Profiles / Agents</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">Use the selector for this conversation, or type @profile for one message.</div>
            </div>
            <div className="min-h-0 overflow-y-auto p-1.5">
              <button
                type="button"
                onClick={() => {
                  onSelectedAgentIdChange('');
                  setIsAgentMenuOpen(false);
                  textareaRef.current?.focus();
                }}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                  !selectedAgentId ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/70',
                )}
                role="option"
                aria-selected={!selectedAgentId}
              >
                <span className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border',
                  !selectedAgentId ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground',
                )}>
                  {!selectedAgentId ? <CheckIcon className="h-3.5 w-3.5" /> : <BotIcon className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">Default conversation</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">Use the current Argus model and permission mode.</span>
                </span>
              </button>

              {agents.map((agent) => {
                const selected = agent.id === selectedAgentId;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      onSelectedAgentIdChange(agent.id);
                      setIsAgentMenuOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className={cn(
                      'mt-1 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/70',
                    )}
                    role="option"
                    aria-selected={selected}
                  >
                    <span className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground',
                    )}>
                      {selected ? <CheckIcon className="h-3.5 w-3.5" /> : <BotIcon className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{agent.shortName || agent.name}</span>
                      {agent.description && (
                        <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                          {agent.description}
                        </span>
                      )}
                      {agent.profileKind && (
                        <span className="mt-1 block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                          {agent.profileKind} · {agent.permissionPreset || 'preset'}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isPermissionMenuOpen && (
          <div
            ref={permissionMenuRef}
            className="fixed z-[92] flex max-h-[360px] w-[min(340px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl ring-1 ring-black/5 backdrop-blur-md"
            style={{
              left: permissionMenuPosition?.left ?? 8,
              bottom: permissionMenuPosition?.bottom ?? 80,
            }}
            role="listbox"
            aria-label="切换权限模式"
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border/50 px-3 py-2.5">
              <div className="text-sm font-semibold text-foreground">权限 / Plan 模式</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">影响当前会话发送给后端的权限模式。</div>
            </div>
            <div className="min-h-0 overflow-y-auto p-1.5">
              {permissionModeOptions.map((mode) => {
                const selected = mode.id === normalizedPermissionMode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      onPermissionModeChange(mode.id);
                      setIsPermissionMenuOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/70',
                    )}
                    role="option"
                    aria-selected={selected}
                  >
                    <span className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground',
                    )}>
                      {selected ? <CheckIcon className="h-3.5 w-3.5" /> : <ShieldIcon className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm font-semibold', mode.tone)}>{mode.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{mode.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isSkillMenuOpen && (
          <div
            ref={skillMenuRef}
            className="fixed z-[90] flex max-h-[420px] w-[min(380px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl ring-1 ring-black/5 backdrop-blur-md"
            style={{
              left: skillMenuPosition?.left ?? 8,
              bottom: skillMenuPosition?.bottom ?? 80,
            }}
          >
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SparklesIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">添加 Skill</div>
                  <div className="text-[11px] text-muted-foreground">
                    {selectedSkillNames.length > 0
                      ? `${selectedSkillNames.length} 个已绑定`
                      : `${installedSkills.length} 本地 · ${repositorySkills.length} Hub`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSkillMenuOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="关闭 Skill 菜单"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-border/50 p-2">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-background px-2.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
                <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                  placeholder="搜索本地或 Hub Skill"
                  autoFocus
                />
              </div>
              {skillMenuNotice && (
                <div
                  className={cn(
                    'mt-2 rounded-lg border px-2.5 py-2 text-xs',
                    skillMenuNotice.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
                  )}
                >
                  {skillMenuNotice.text}
                </div>
              )}
            </div>

            <div
              className="max-h-[320px] overflow-y-auto p-1.5"
              role="listbox"
              aria-label="可用 Skill"
              onWheel={(event) => event.stopPropagation()}
            >
              {filteredInstalledSkills.length > 0 && (
                <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  本地已安装
                </div>
              )}
              {filteredInstalledSkills.map((skill) => {
                const label = skill.title || skill.name;
                const selected = selectedSkillKeys.has(skill.name.toLowerCase()) || selectedSkillKeys.has(label.toLowerCase());
                const statusLabel = selected ? '已绑定' : (skill.callable ? '已可调用' : '不可用');

                return (
                  <button
                    key={`${skill.provider}:${skill.scope}:${skill.name}`}
                    type="button"
                    onClick={() => onToggleSkillName(skill.name)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      selected ? 'bg-primary/8 text-primary' : 'text-foreground hover:bg-muted/70',
                    )}
                    role="option"
                    aria-selected={selected}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground',
                      )}
                    >
                      {selected ? <CheckIcon className="h-3.5 w-3.5" /> : <SparklesIcon className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {skill.provider} / {skill.scope}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        selected
                          ? 'border-primary/25 bg-primary/10 text-primary'
                          : skill.callable
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
                      )}
                    >
                      {statusLabel}
                    </span>
                  </button>
                );
              })}

              {repositorySkillsLoading && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  正在读取 Hub Skills...
                </div>
              )}

              {repositorySkillsError && (
                <div className="mx-1.5 my-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  {repositorySkillsError}
                </div>
              )}

              {filteredRepositorySkills.length > 0 && (
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  云端 Hub
                </div>
              )}

              {filteredRepositorySkills.map((skill) => {
                const key = `${skill.repoId}:${skill.id}`;
                const label = skill.title || skill.name;
                const installing = installingRepositorySkillKey === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void handleInstallRepositorySkill(skill)}
                    disabled={installing}
                    className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-foreground transition-colors hover:bg-muted/70 disabled:cursor-wait disabled:opacity-70"
                    role="option"
                    aria-selected={false}
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                      <CloudIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {skill.repoName || 'Hub'} / {skill.author || 'remote'}
                        {skill.version ? ` / v${skill.version}` : ''}
                      </span>
                      {skill.description && (
                        <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {skill.description}
                        </span>
                      )}
                    </span>
                    <span className="bg-primary/8 mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {installing ? (
                        <>
                          <Loader2Icon className="h-3 w-3 animate-spin" />
                          安装中
                        </>
                      ) : (
                        <>
                          <DownloadIcon className="h-3 w-3" />
                          安装
                        </>
                      )}
                    </span>
                  </button>
                );
              })}

              {filteredInstalledSkills.length === 0 && filteredRepositorySkills.length === 0 && !repositorySkillsLoading && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的 Skill</div>
              )}
            </div>
          </div>
        )}

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status="ready"
          className={isTextareaExpanded ? 'chat-input-expanded' : ''}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">拖放图片或文件</p>
              </div>
            </div>
          )}

          {hasAttachments && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((file, index) => (
                    <ImageAttachment
                      key={index}
                      file={file}
                      onRemove={() => onRemoveImage(index)}
                      uploadProgress={uploadingImages.get(file.name)}
                      error={imageErrors.get(file.name)}
                    />
                  ))}
                  {attachedFiles.map((file, index) => (
                    <FileAttachment
                      key={`${file.name}-${index}`}
                      file={file}
                      onRemove={() => onRemoveFile(index)}
                      error={fileAttachmentErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          {subagentActivity && (subagentActivity.total > 0 || hasSubagentHistory) && (
            <PromptInputHeader>
              <div className="mx-1 rounded-xl border border-border/70 bg-background/95 px-2.5 py-2 text-xs shadow-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSubagentDetailsOpen((value) => !value)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/70"
                    aria-expanded={isSubagentDetailsOpen}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      {subagentActivity.running > 0 || subagentActivity.outputting > 0
                        ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                        : <BotIcon className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      Agents {subagentActivity.running}/3
                      {primarySubagent?.label ? ` · ${primarySubagent.label}` : ''}
                      {primarySubagent?.lastTool ? ` · ${primarySubagent.lastTool}` : ''}
                    </span>
                    {primarySubagent?.elapsedMs !== undefined ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatSubagentElapsed(primarySubagent.elapsedMs)}
                      </span>
                    ) : null}
                    {typeof primarySubagent?.currentStep === 'number' && typeof primarySubagent?.maxSteps === 'number' ? (
                      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {primarySubagent.currentStep}/{primarySubagent.maxSteps}
                      </span>
                    ) : null}
                    <ChevronDownIcon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                        isSubagentDetailsOpen && 'rotate-180',
                      )}
                    />
                  </button>
                  {hasSubagentHistory ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSubagentManagerOpen((value) => !value);
                        setIsSubagentDetailsOpen(true);
                      }}
                      className={cn(
                        'inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[11px] font-medium transition-colors',
                        isSubagentManagerOpen
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {isSubagentManagerOpen ? '运行中' : '管理'}
                    </button>
                  ) : null}
                  {canStopSubagents ? (
                    <button
                      type="button"
                      onClick={() => onStopSubagents?.(stoppableSubagentIds)}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                      title="停止所有后台 Agent"
                    >
                      <SquareIcon className="h-3 w-3 fill-current" />
                      停止
                    </button>
                  ) : null}
                </div>

                {isSubagentDetailsOpen && (
                  <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                    {isSubagentManagerOpen ? (
                      <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                        <span>后台 Agent 管理</span>
                        <span>运行 {subagentActivity.running} · 历史 {subagentHistoryItems.length}</span>
                      </div>
                    ) : null}
                    {visibleManagerItems.length === 0 ? (
                      <div className="rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
                        暂无运行中的后台 Agent。
                      </div>
                    ) : (
                      visibleManagerItems.map((item) => {
                        const statusKey = item.runtimeStatus || (item.status === 'blocked' ? 'BLOCKED' : item.status === 'completed' ? 'DONE' : 'RUNNING');
                        const terminal = Boolean(item.terminal);
                        const evidenceText = [item.evidence, item.resultSummary, item.nextAction, item.blockers]
                          .filter(Boolean)
                          .join('\n\n');
                        const blockerGuidance = terminal && (
                          item.runtimeStatus === 'BLOCKED'
                          || item.status === 'blocked'
                          || item.status === 'cancelled'
                          || item.status === 'failed'
                          || item.status === 'interrupted'
                          || Boolean(item.stopReason || item.blockers)
                        )
                          ? getSubagentBlockerGuidance({
                            status: item.runtimeStatus || item.status,
                            stopReason: item.stopReason,
                            objective: item.objective || item.label,
                            lastTool: item.lastTool,
                            blockers: item.blockers,
                            nextAction: item.nextAction,
                          })
                          : null;
                        return (
                          <div
                            key={item.taskId || item.id || item.label}
                            className={cn(
                              'flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2',
                              terminal ? 'bg-muted/30' : 'bg-muted/45',
                            )}
                          >
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                              {item.outputting && !terminal ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <BotIcon className="h-3 w-3" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium text-foreground">{item.label}</span>
                                <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {subagentRuntimeStatusLabel[statusKey || 'RUNNING'] || statusKey || '运行中'}
                                </span>
                                {typeof item.currentStep === 'number' && typeof item.maxSteps === 'number' ? (
                                  <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {item.currentStep}/{item.maxSteps}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {item.objective || item.activeToolLabel || '后台任务运行中'}
                              </div>
                              {blockerGuidance ? (
                                <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                                  <div className="font-medium">{blockerGuidance.title}</div>
                                  <div className="mt-0.5 line-clamp-2">{blockerGuidance.description}</div>
                                  <div className="mt-0.5 line-clamp-2">{blockerGuidance.nextAction}</div>
                                </div>
                              ) : null}
                              {!blockerGuidance && (item.lastTool || item.lastToolSummary || item.stopReason || item.resultSummary || item.nextAction) && (
                                <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                  {item.stopReason
                                    ? `阻塞原因：${item.stopReason}`
                                    : item.resultSummary || item.nextAction || `${item.lastTool || '最近输出'}${item.lastToolSummary ? ` · ${item.lastToolSummary}` : ''}`}
                                </div>
                              )}
                              {item.blockers ? (
                                <div className="mt-1 line-clamp-2 text-[11px] text-amber-700 dark:text-amber-300">
                                  {item.blockers}
                                </div>
                              ) : null}
                              {item.taskId && subagentControlDraft?.taskId === item.taskId ? (
                                <div className="mt-2 grid gap-1.5 rounded-md border border-border bg-background p-2">
                                  <input
                                    type="text"
                                    value={subagentControlText}
                                    onChange={(event) => setSubagentControlText(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' && subagentControlText.trim()) {
                                        onControlSubagent?.(subagentControlDraft.action, item.taskId!, subagentControlText);
                                        setSubagentControlDraft(null);
                                        setSubagentControlText('');
                                      }
                                      if (event.key === 'Escape') {
                                        setSubagentControlDraft(null);
                                        setSubagentControlText('');
                                      }
                                    }}
                                    placeholder={subagentControlDraft.action === 'send' ? 'Message' : 'Follow-up objective'}
                                    className="h-8 min-w-0 rounded border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
                                  />
                                  <div className="flex justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSubagentControlDraft(null);
                                        setSubagentControlText('');
                                      }}
                                      className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!subagentControlText.trim()}
                                      onClick={() => {
                                        onControlSubagent?.(subagentControlDraft.action, item.taskId!, subagentControlText);
                                        setSubagentControlDraft(null);
                                        setSubagentControlText('');
                                      }}
                                      className="h-6 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:opacity-60"
                                    >
                                      Send
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-0.5 flex shrink-0 items-center gap-1">
                              {item.taskId && onControlSubagent ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onControlSubagent('wait', item.taskId!)}
                                    className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                    title="Wait for this background agent"
                                  >
                                    Wait
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSubagentControlDraft({ taskId: item.taskId!, action: 'send' });
                                      setSubagentControlText('');
                                    }}
                                    className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                    title="Send a message to this background agent"
                                  >
                                    Send
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSubagentControlDraft({ taskId: item.taskId!, action: 'followup' });
                                      setSubagentControlText('');
                                    }}
                                    className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                    title="Create a follow-up task from this background agent"
                                  >
                                    Follow
                                  </button>
                                </>
                              ) : null}
                              {evidenceText ? (
                                <button
                                  type="button"
                                  onClick={() => copySubagentEvidence(evidenceText)}
                                  className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                  title="复制证据"
                                >
                                  <CopyIcon className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                              {terminal && onReuseSubagentObjective && (item.objective || item.label) ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onReuseSubagentObjective(item.objective || item.label);
                                    setIsSubagentManagerOpen(false);
                                    setIsSubagentDetailsOpen(false);
                                  }}
                                  className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-background hover:text-primary"
                                  title="重新派发"
                                >
                                  重新
                                </button>
                              ) : null}
                              {!terminal && item.taskId && onStopSubagents ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (item.taskId) {
                                      onStopSubagents([item.taskId]);
                                    }
                                  }}
                                  className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-red-600"
                                  title="停止这个后台 Agent"
                                >
                                  <XIcon className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </PromptInputHeader>
          )}

          <input {...getInputProps({ accept: 'image/*' })} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
            />
        </PromptInputBody>

        {goalsEnabled && sessionGoal && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <TargetIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{sessionGoal.objective}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1">
                <span>{sessionGoal.status}</span>
                <span>{sessionGoal.tokensUsed} tokens</span>
                {activeGoalRemainingTokens !== null && <span>剩余 {activeGoalRemainingTokens}</span>}
              </div>
            </div>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => (sessionGoal.status === 'paused' || sessionGoal.status === 'budget_limited' ? onResumeGoal?.() : onPauseGoal?.())}
              title={sessionGoal.status === 'paused' || sessionGoal.status === 'budget_limited' ? '恢复 Goal' : '暂停 Goal'}
            >
              {sessionGoal.status === 'paused' || sessionGoal.status === 'budget_limited'
                ? <PlayIcon className="h-3.5 w-3.5" />
                : <PauseIcon className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => onCompleteGoal?.()}
              title="完成 Goal"
            >
              <CheckIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => onClearGoal?.()}
              title="清除 Goal"
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {goalsEnabled && isGoalEditorOpen && (
          <div className="mx-3 mb-2 rounded-lg border border-primary/20 bg-background px-3 py-3 text-xs shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-foreground">
              <TargetIcon className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">{sessionGoal ? '更新本会话 Goal' : '设置本会话 Goal'}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
              <input
                ref={goalObjectiveInputRef}
                type="text"
                value={goalObjectiveDraft}
                onChange={(event) => setGoalObjectiveDraft(event.target.value)}
                onKeyDown={handleGoalEditorKeyDown}
                placeholder="这轮对话要持续完成的目标"
                className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
              />
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={goalBudgetDraft}
                onChange={(event) => setGoalBudgetDraft(event.target.value)}
                onKeyDown={handleGoalEditorKeyDown}
                placeholder="Token 预算，可留空"
                className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
              />
            </div>
            {goalEditorError && (
              <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">{goalEditorError}</div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsGoalEditorOpen(false);
                  setGoalEditorError('');
                  textareaRef.current?.focus();
                }}
                className="h-8 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isGoalSaving}
                onClick={() => void handleGoalEditorSubmit()}
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
              >
                {isGoalSaving ? '保存中...' : '保存 Goal'}
              </button>
            </div>
          </div>
        )}

        <PromptInputFooter className="gap-3">
          <PromptInputTools className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <PromptInputButton
              tooltip={{ content: t('input.attachImages') }}
              onClick={openImagePicker}
            >
              <ImageIcon />
            </PromptInputButton>

            <PromptInputButton
              tooltip={{ content: '上传文件' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
            </PromptInputButton>

            <RuntimeModelSwitcher
              variant="toolbar"
              disabled={isLoading}
              selectedProfileId={selectedModelProfileId}
              onProfileChange={onModelProfileChange}
              onRequestInputFocus={() => textareaRef.current?.focus()}
              hasConversationContext={hasConversationContext}
            />

            <AgentProfileSwitcher
              disabled={isLoading}
              selectedProfileKind={selectedAgentProfileKind}
              onProfileChange={onAgentProfileChange}
              onRequestInputFocus={() => textareaRef.current?.focus()}
            />

            {agents.length > 0 && (
              <button
                ref={agentMenuButtonRef}
                type="button"
                onClick={() => setIsAgentMenuOpen((previous) => !previous)}
                disabled={isLoading}
                aria-haspopup="listbox"
                aria-expanded={isAgentMenuOpen}
                className={cn(
                  'flex h-9 min-w-[132px] max-w-[190px] items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  selectedAgentId
                    ? 'border-primary/25 bg-primary/8 text-primary hover:bg-primary/12'
                    : 'border-border/60 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
                title="选择当前对话使用的 Agent，也可以在输入框开头使用 @Agent 只作用于当前消息"
              >
                <BotIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left font-medium">{agentButtonLabel}</span>
                <ChevronDownIcon className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isAgentMenuOpen && 'rotate-180')} />
              </button>
            )}

            <PromptInputButton
              tooltip={{
                content: subagentsEnabled
                  ? (subagentDispatchRequested ? '本条消息已允许多任务分发' : '本条消息允许多任务分发')
                  : '先在设置里开启 Subagent',
              }}
              onClick={() => {
                if (!subagentsEnabled) {
                  return;
                }
                onSubagentDispatchRequestedChange(!subagentDispatchRequested);
                textareaRef.current?.focus();
              }}
              disabled={isLoading || !subagentsEnabled}
              aria-pressed={subagentDispatchRequested}
              className="hidden"
            >
              <BotIcon />
            </PromptInputButton>

            <PromptInputButton
              tooltip={{
                content: goalsEnabled
                  ? (sessionGoal ? '设置新的持久 Goal' : '设置本会话持久 Goal')
                  : '先在运行时设置里开启 Goal',
              }}
              onClick={() => {
                void handleGoalButtonClick();
              }}
              disabled={!goalsEnabled}
              className="hidden"
            >
              <TargetIcon />
            </PromptInputButton>

            <button
              ref={permissionMenuButtonRef}
              type="button"
              onClick={() => setIsPermissionMenuOpen((previous) => !previous)}
              disabled={isLoading}
              aria-haspopup="listbox"
              aria-expanded={isPermissionMenuOpen}
              className={cn(
                'flex h-9 min-w-[96px] max-w-[132px] items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                normalizedPermissionMode === 'plan'
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300'
                  : normalizedPermissionMode === 'bypassPermissions'
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                    : 'border-border/60 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
              title="切换当前对话的权限/Plan 模式"
            >
              <ShieldIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left font-medium">{activePermissionMode.shortLabel}</span>
              <ChevronDownIcon className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isPermissionMenuOpen && 'rotate-180')} />
            </button>

            {hasSkillChoices && (
              <button
                ref={skillMenuButtonRef}
                type="button"
                onClick={() => {
                  setIsSkillMenuOpen((previous) => !previous);
                  setSkillSearch('');
                  setSkillMenuNotice(null);
                }}
                disabled={isLoading}
                aria-haspopup="listbox"
                aria-expanded={isSkillMenuOpen}
                className={cn(
                  'flex h-9 min-w-[132px] items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  selectedSkillNames.length > 0
                    ? 'border-primary/25 bg-primary/8 text-primary hover:bg-primary/12'
                    : 'border-border/60 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
                title="为当前对话添加 Skill"
              >
                <SparklesIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[116px] truncate font-medium">
                  {selectedSkillNames.length > 0 ? `${selectedSkillNames.length} Skills` : '添加 Skill'}
                </span>
                <ChevronDownIcon className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isSkillMenuOpen && 'rotate-180')} />
              </button>
            )}

            {selectedSkillNames.length > 0 && (
              <div className="hidden max-w-[260px] items-center gap-1 overflow-hidden sm:flex">
                {selectedSkillNames.slice(0, 2).map((skillName) => (
                  <button
                    key={skillName}
                    type="button"
                    onClick={() => onToggleSkillName(skillName)}
                    disabled={isLoading}
                    className="inline-flex h-7 max-w-[118px] items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                    title={`移除 ${skillName}`}
                  >
                    <span className="truncate">{skillName}</span>
                    <XIcon className="h-3 w-3 shrink-0" />
                  </button>
                ))}
                {selectedSkillNames.length > 2 && (
                  <button
                    type="button"
                    onClick={onClearSkillNames}
                    disabled={isLoading}
                    className="h-7 rounded-full border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                    title="清空当前对话 Skill"
                  >
                    +{selectedSkillNames.length - 2}
                  </button>
                )}
              </div>
            )}

            {null}

            {showRuntimeDiagnostics && (
              <PromptInputButton
                tooltip={{ content: agentRuntimeDiagnostics ? '查看运行诊断' : '暂无运行诊断' }}
                onClick={() => setIsDiagnosticsOpen((previous) => !previous)}
                className={agentRuntimeDiagnostics ? 'text-primary' : ''}
              >
                <BracesIcon />
              </PromptInputButton>
            )}

            <PromptInputButton
              tooltip={{ content: t('input.showAllCommands') }}
              onClick={onToggleCommandMenu}
              className="relative"
            >
              <MessageSquareIcon />
              {slashCommandsCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                >
                  {slashCommandsCount}
                </span>
              )}
            </PromptInputButton>

            {statusTodoItems.length > 0 && (
              <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 md:flex">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                  Todo
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  {statusTodoItems.slice(0, 3).map((todo, index) => (
                    <span
                      key={todo.id ?? `${todo.content}-${index}`}
                      className={cn(
                        'inline-flex min-w-0 max-w-[220px] items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-none',
                        todo.status === 'completed'
                          ? 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700 line-through dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : todo.status === 'in_progress'
                            ? 'border-sky-200/80 bg-sky-50/80 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300'
                            : 'border-border/60 bg-background/70 text-muted-foreground',
                      )}
                      title={todo.content}
                    >
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          todo.status === 'completed'
                            ? 'bg-emerald-500'
                            : todo.status === 'in_progress'
                              ? 'bg-sky-500'
                              : 'border border-muted-foreground/40 bg-transparent',
                        )}
                      />
                      <span className="truncate">{todo.content}</span>
                    </span>
                  ))}
                  {statusTodoItems.length > 3 && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      +{statusTodoItems.length - 3}
                    </span>
                  )}
                </div>
              </div>
            )}

          </PromptInputTools>

          <div className="flex shrink-0 items-center gap-2">
            {null}
            {hasInput && (
              <PromptInputButton
                tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
                onClick={onClearInput}
                className="hidden sm:flex"
              >
                <XIcon />
              </PromptInputButton>
            )}
            <PromptInputSubmit
              disabled={!input.trim() && !hasAttachments}
              className={cn(
                'h-11 sm:h-11',
                isLoading ? 'w-16 px-3 text-sm font-semibold' : 'w-11 sm:w-11',
              )}
              title={isLoading ? '追加引导到当前运行中的回复' : '发送'}
              aria-label={isLoading ? '追加引导到当前运行中的回复' : '发送'}
              onMouseDown={(event) => {
                event.preventDefault();
                onSubmit(event as unknown as MouseEvent<HTMLButtonElement>);
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                onSubmit(event as unknown as TouchEvent<HTMLButtonElement>);
              }}
            >
              {isLoading ? '引导' : undefined}
            </PromptInputSubmit>
            {isLoading && (
              <button
                type="button"
                className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-50/85 text-emerald-700 transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:border-destructive/40 dark:hover:bg-destructive/15 dark:hover:text-destructive"
                title={t('claudeStatus.controls.stop', { defaultValue: '停止' })}
                aria-label={t('claudeStatus.controls.stop', { defaultValue: '停止' })}
                onClick={onAbortSession}
              >
                <span className="relative flex h-3 w-3 items-center justify-center group-hover:hidden">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                  <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="hidden text-xs font-semibold group-hover:inline">
                  停止
                </span>
              </button>
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}
