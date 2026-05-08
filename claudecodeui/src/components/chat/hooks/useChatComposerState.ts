import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';

import { apiFetch } from '../../../utils/api';
import { thinkingModes } from '../constants/thinkingModes';
import { grantClaudeToolPermission } from '../utils/chatPermissions';
import { getClaudeSettings, safeLocalStorage } from '../utils/chatStorage';
import type {
  ChatMessage,
  ChatUploadedFile,
  PendingPermissionRequest,
  PermissionMode,
} from '../types/types';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { AgentAppBinding, AgentConfig } from '../../../types/agent';
import { escapeRegExp } from '../utils/chatFormatting';

import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  provider: LLMProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  cursorModel: string;
  claudeModel: string;
  codexModel: string;
  geminiModel: string;
  agents?: AgentConfig[];
  selectedAgentId?: string;
  selectedAgentAppBindings?: AgentAppBinding[];
  selectedSkillNames?: string[];
  getSelectedSkillNames?: () => string[];
  modelProfileId?: string;
  allowSessionAgentBinding?: boolean;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: (tab?: string) => void;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage) => void;
  clearMessages: () => void;
  rewindMessages: (count: number) => void;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const createClientUserMessageId = () =>
  `client_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const MAX_CHAT_IMAGES = 5;
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_FILES = 10;
const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;

const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

const normalizeAgentToken = (value: string) => value.trim().toLowerCase();

const resolveAgentInvocation = (
  rawInput: string,
  agents: AgentConfig[] = [],
  selectedAgentId = '',
) => {
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId && agent.status === 'enabled') || null;
  const trimmedStart = rawInput.trimStart();
  const mentionMatch = trimmedStart.match(/^@([^\s]+)\s*/);

  if (!mentionMatch) {
    return {
      agent: selectedAgent,
      content: rawInput,
    };
  }

  const token = normalizeAgentToken(mentionMatch[1]);
  const mentionedAgent = agents.find((agent) => {
    if (agent.status !== 'enabled') {
      return false;
    }
    return normalizeAgentToken(agent.id) === token
      || normalizeAgentToken(agent.name) === token
      || normalizeAgentToken(agent.shortName) === token;
  }) || null;

  if (!mentionedAgent) {
    return {
      agent: selectedAgent,
      content: rawInput,
    };
  }

  const content = trimmedStart.slice(mentionMatch[0].length);
  return {
    agent: mentionedAgent,
    content: content.trim() ? content : rawInput,
  };
};


export function useChatComposerState({
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
  agents = [],
  selectedAgentId = '',
  selectedAgentAppBindings = [],
  selectedSkillNames = [],
  getSelectedSkillNames,
  modelProfileId = '',
  allowSessionAgentBinding = false,
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
}: UseChatComposerStateArgs) {
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState<Map<string, number>>(new Map());
  const [imageErrors, setImageErrors] = useState<Map<string, string>>(new Map());
  const [fileAttachmentErrors, setFileAttachmentErrors] = useState<Map<string, string>>(new Map());
  const [ingestAttachmentsToObsidian, setIngestAttachmentsToObsidian] = useState(true);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState('none');
  const [subagentDispatchRequested, setSubagentDispatchRequested] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  const oneShotPermissionModeRef = useRef<PermissionMode | string | null>(null);
  const inputValueRef = useRef(input);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'clear':
          clearMessages();
          break;

        case 'help':
          addMessage({
            type: 'assistant',
            content: data.content,
            timestamp: Date.now(),
          });
          break;

        case 'model':
          addMessage({
            type: 'assistant',
            content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nArgus: ${data.available.mtlCode.join(', ')}`,
            timestamp: Date.now(),
          });
          break;

        case 'cost': {
          const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
          addMessage({ type: 'assistant', content: costMessage, timestamp: Date.now() });
          break;
        }

        case 'status': {
          const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
          addMessage({ type: 'assistant', content: statusMessage, timestamp: Date.now() });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\nPath: \`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        case 'rewind':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            rewindMessages(data.steps * 2);
            addMessage({
              type: 'assistant',
              content: `Rewound ${data.steps} step(s). ${data.message}`,
              timestamp: Date.now(),
            });
          }
          break;

        case 'open-tab':
          if (typeof data?.tab === 'string') {
            window.dispatchEvent(new CustomEvent('argus-open-tab', {
              detail: {
                tab: data.tab,
                mode: data.mode || '',
              },
            }));
            addMessage({
              type: 'assistant',
              content: data.message || `Opening ${data.tab}`,
              timestamp: Date.now(),
            });
          }
          break;

        case 'open-settings':
          onShowSettings?.(typeof data?.tab === 'string' ? data.tab : undefined);
          addMessage({
            type: 'assistant',
            content: data.message || 'Opening settings',
            timestamp: Date.now(),
          });
          break;

        case 'insert-text': {
          const nextText = typeof data?.text === 'string' ? data.text : '';
          setInput((previous) => {
            const separator = previous.trim() ? '\n\n' : '';
            const value = `${previous}${separator}${nextText}`;
            inputValueRef.current = value;
            return value;
          });
          addMessage({
            type: 'assistant',
            content: data.message || 'Inserted command text',
            timestamp: Date.now(),
          });
          break;
        }

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, addMessage, clearMessages, rewindMessages],
  );

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [addMessage]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          provider,
          model: provider === 'cursor' ? cursorModel : provider === 'codex' ? codexModel : provider === 'gemini' ? geminiModel : claudeModel,
          tokenUsage: tokenBudget,
        };

        const response = await apiFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          setInput('');
          inputValueRef.current = '';
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        addMessage({
          type: 'assistant',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      geminiModel,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      addMessage,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    fileMentionQuery,
    isLoadingFileMentions,
    fileMentionError,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleImageFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > MAX_CHAT_IMAGE_BYTES) {
          const fileName = file.name || 'Unknown file';
          setImageErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 5MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages((previous) => [...previous, ...validFiles].slice(0, MAX_CHAT_IMAGES));
    }
  }, []);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const imageFiles: File[] = [];
    const documentFiles: File[] = [];

    files.forEach((file) => {
      if (!file || typeof file !== 'object') {
        return;
      }

      if (file.type?.startsWith('image/')) {
        imageFiles.push(file);
        return;
      }

      const fileName = file.name || 'Unknown file';
      if (!file.size || file.size > MAX_CHAT_FILE_BYTES) {
        setFileAttachmentErrors((previous) => {
          const next = new Map(previous);
          next.set(fileName, 'File too large (max 25MB)');
          return next;
        });
        return;
      }

      documentFiles.push(file);
    });

    if (imageFiles.length > 0) {
      handleImageFiles(imageFiles);
    }

    if (documentFiles.length > 0) {
      setAttachedFiles((previous) => [...previous, ...documentFiles].slice(0, MAX_CHAT_FILES));
    }
  }, [handleImageFiles]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        handleAttachmentFiles(files);
      }
    },
    [handleAttachmentFiles, handleImageFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_CHAT_FILE_BYTES,
    maxFiles: MAX_CHAT_FILES,
    onDrop: handleAttachmentFiles,
    noClick: true,
    noKeyboard: true,
  });

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      const currentInput = inputValueRef.current;
      const hasAttachments = attachedImages.length > 0 || attachedFiles.length > 0;
      if ((!currentInput.trim() && !hasAttachments) || !selectedProject) {
        return;
      }

      if (isLoading) {
        const guidanceText = currentInput.trim();
        if (!guidanceText) {
          return;
        }
        if (hasAttachments) {
          addMessage({
            type: 'error',
            content: '运行中引导暂不支持附件，请等当前回复结束后再发送附件。',
            timestamp: new Date(),
          });
          return;
        }
        if (provider !== 'claude') {
          addMessage({
            type: 'error',
            content: '当前后端暂不支持运行中引导，请等当前回复结束后再发送。',
            timestamp: new Date(),
          });
          return;
        }

        const pendingSessionId =
          typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
        const guidanceSessionId = [
          currentSessionId,
          pendingViewSessionRef.current?.sessionId || null,
          pendingSessionId,
          selectedSession?.id || null,
        ].find((sessionId) => Boolean(sessionId)) || null;

        if (!guidanceSessionId) {
          addMessage({
            type: 'error',
            content: '当前会话还没有准备好接收引导，请稍后再试。',
            timestamp: new Date(),
          });
          return;
        }

        const clientMessageId = createClientUserMessageId();
        addMessage({
          id: clientMessageId,
          type: 'user',
          content: guidanceText,
          timestamp: new Date(),
        });
        sendMessage({
          type: 'claude-guidance',
          sessionId: guidanceSessionId,
          command: guidanceText,
          clientMessageId,
        });

        setInput('');
        inputValueRef.current = '';
        resetCommandMenuState();
        setIsTextareaExpanded(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.focus();
        }
        safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
        setTimeout(() => scrollToBottom(), 50);
        return;
      }

      // Intercept slash commands: if input starts with /commandName, execute as command with args
      const trimmedInput = currentInput.trim();
      if (trimmedInput.startsWith('/')) {
        const firstSpace = trimmedInput.indexOf(' ');
        const commandName = firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        const matchedCommand = slashCommands.find((cmd: SlashCommand) => cmd.name === commandName);
        if (matchedCommand) {
          executeCommand(matchedCommand, trimmedInput);
          setInput('');
          inputValueRef.current = '';
          setAttachedImages([]);
          setAttachedFiles([]);
          setUploadingImages(new Map());
          setImageErrors(new Map());
          setFileAttachmentErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      if (submitLockRef.current) {
        return;
      }
      submitLockRef.current = true;

      const agentInvocation = resolveAgentInvocation(currentInput, agents, selectedAgentId);
      const activeAgent = agentInvocation.agent;
      const activeAgentAppBindings = activeAgent
        ? activeAgent.id === selectedAgentId && selectedAgentAppBindings.length > 0
          ? selectedAgentAppBindings
          : activeAgent.appBindings
        : [];
      const activeSkillNames = (getSelectedSkillNames?.() || selectedSkillNames)
        .map((skill) => skill.trim())
        .filter(Boolean)
        .slice(0, 60);
      let messageContent = agentInvocation.content;
      if (!messageContent.trim() && hasAttachments) {
        messageContent = '请查看我上传的附件。';
      }
      const selectedThinkingMode = thinkingModes.find((mode: { id: string; prefix?: string }) => mode.id === thinkingMode);
      if (selectedThinkingMode && selectedThinkingMode.prefix) {
        messageContent = `${selectedThinkingMode.prefix}: ${messageContent}`;
      }

      let uploadedImages: unknown[] = [];
      if (attachedImages.length > 0) {
        const formData = new FormData();
        attachedImages.forEach((file) => {
          formData.append('images', file);
        });

        try {
          const response = await apiFetch(`/api/projects/${selectedProject.name}/upload-images`, {
            method: 'POST',
            headers: {},
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload images');
          }

          const result = await response.json();
          uploadedImages = result.images;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Image upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload images: ${message}`,
            timestamp: new Date(),
          });
          submitLockRef.current = false;
          return;
        }
      }

      let uploadedFiles: ChatUploadedFile[] = [];
      if (attachedFiles.length > 0) {
        const formData = new FormData();
        attachedFiles.forEach((file) => {
          formData.append('files', file);
        });
        formData.append('obsidianIngest', ingestAttachmentsToObsidian ? 'true' : 'false');
        const uploadSessionId = currentSessionId || selectedSession?.id || '';
        if (uploadSessionId && !isTemporarySessionId(uploadSessionId)) {
          formData.append('sessionId', uploadSessionId);
        }

        try {
          const response = await apiFetch(`/api/projects/${selectedProject.name}/upload-files`, {
            method: 'POST',
            headers: {},
            body: formData,
          });

          if (!response.ok) {
            let errorMessage = 'Failed to upload files';
            try {
              const errorPayload = await response.json();
              errorMessage = errorPayload?.error || errorMessage;
            } catch {
              // Keep fallback error text.
            }
            throw new Error(errorMessage);
          }

          const result = await response.json();
          uploadedFiles = Array.isArray(result.files) ? result.files : [];
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('File upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          submitLockRef.current = false;
          return;
        }
      }

      const storedCursorSessionId =
        provider === 'cursor' ? sessionStorage.getItem('cursorSessionId') : null;
      const effectiveSessionId = currentSessionId || selectedSession?.id || storedCursorSessionId;
      const backendSessionId =
        effectiveSessionId && !isTemporarySessionId(effectiveSessionId) ? effectiveSessionId : null;
      const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
      const clientMessageId = createClientUserMessageId();

      const userMessage: ChatMessage = {
        id: clientMessageId,
        type: 'user',
        content: currentInput.trim() ? currentInput : messageContent,
        images: uploadedImages as any,
        files: uploadedFiles,
        timestamp: new Date(),
        agentId: activeAgent?.id,
        agentName: activeAgent?.name,
      };

      addMessage(userMessage);
      setIsLoading(true); // Processing banner starts
      setCanAbortSession(true);
      setClaudeStatus({
        text: 'Processing',
        tokens: 0,
        can_interrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      if (!effectiveSessionId && !selectedSession?.id) {
        if (typeof window !== 'undefined') {
          // Reset stale pending IDs from previous interrupted runs before creating a new one.
          sessionStorage.removeItem('pendingSessionId');
        }
        pendingViewSessionRef.current = { sessionId: sessionToActivate, startedAt: Date.now() };
        setCurrentSessionId(sessionToActivate);
      }
      onSessionActive?.(sessionToActivate);
      if (backendSessionId) {
        onSessionProcessing?.(backendSessionId);
      }

      const getToolsSettings = () => {
        if (provider === 'claude') {
          return getClaudeSettings();
        }

        try {
          const settingsKey =
            provider === 'cursor'
              ? 'cursor-tools-settings'
              : provider === 'codex'
                ? 'codex-settings'
                : provider === 'gemini'
                  ? 'gemini-settings'
                  : 'claude-settings';
          const savedSettings = safeLocalStorage.getItem(settingsKey);
          if (savedSettings) {
            return JSON.parse(savedSettings);
          }
        } catch (error) {
          console.error('Error loading tools settings:', error);
        }

        return {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        };
      };

      const toolsSettings = getToolsSettings();
      const permissionModeForSend = oneShotPermissionModeRef.current || permissionMode;
      const skipToolPermissions = Boolean(
        toolsSettings?.skipPermissions
        || toolsSettings?.permissionMode === 'bypassPermissions'
        || permissionModeForSend === 'bypassPermissions',
      );
      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, currentInput);

      if (provider === 'cursor') {
        sendMessage({
          type: 'cursor-command',
          command: messageContent,
          sessionId: backendSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            projectName: selectedProject.name,
            sessionId: backendSessionId,
            resume: Boolean(backendSessionId),
            model: cursorModel,
            modelProfileId,
            agentId: activeAgent?.id,
            agentAppBindings: activeAgentAppBindings,
            sessionSkills: activeSkillNames,
            allowSessionAgentBinding,
            skipPermissions: skipToolPermissions,
            sessionSummary,
            toolsSettings,
            files: uploadedFiles,
            clientMessageId,
          },
        });
      } else if (provider === 'codex') {
        sendMessage({
          type: 'codex-command',
          command: messageContent,
          sessionId: backendSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            projectName: selectedProject.name,
            sessionId: backendSessionId,
            resume: Boolean(backendSessionId),
            model: codexModel,
            modelProfileId,
            agentId: activeAgent?.id,
            agentAppBindings: activeAgentAppBindings,
            sessionSkills: activeSkillNames,
            allowSessionAgentBinding,
            sessionSummary,
            permissionMode: permissionModeForSend === 'plan' ? 'default' : permissionModeForSend,
            files: uploadedFiles,
            clientMessageId,
          },
        });
      } else if (provider === 'gemini') {
        sendMessage({
          type: 'gemini-command',
          command: messageContent,
          sessionId: backendSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            projectName: selectedProject.name,
            sessionId: backendSessionId,
            resume: Boolean(backendSessionId),
            model: geminiModel,
            modelProfileId,
            agentId: activeAgent?.id,
            agentAppBindings: activeAgentAppBindings,
            sessionSkills: activeSkillNames,
            allowSessionAgentBinding,
            sessionSummary,
            permissionMode: permissionModeForSend,
            skipPermissions: skipToolPermissions,
            toolsSettings,
            files: uploadedFiles,
            clientMessageId,
          },
        });
      } else {
        sendMessage({
          type: 'claude-command',
          command: messageContent,
          options: {
            projectPath: resolvedProjectPath,
            cwd: resolvedProjectPath,
            projectName: selectedProject.name,
            sessionId: backendSessionId,
            resume: Boolean(backendSessionId),
            toolsSettings,
            permissionMode: permissionModeForSend,
            skipPermissions: skipToolPermissions,
            model: claudeModel,
            modelProfileId,
            agentId: activeAgent?.id,
            agentAppBindings: activeAgentAppBindings,
            sessionSkills: activeSkillNames,
            allowSessionAgentBinding,
            sessionSummary,
            images: uploadedImages,
            files: uploadedFiles,
            clientMessageId,
            clientSessionId: sessionToActivate,
            ...(subagentDispatchRequested ? { subagentDispatch: true } : {}),
          },
        });
      }

      setInput('');
      inputValueRef.current = '';
      resetCommandMenuState();
      setAttachedImages([]);
      setAttachedFiles([]);
      setUploadingImages(new Map());
      setImageErrors(new Map());
      setFileAttachmentErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode('none');
      setSubagentDispatchRequested(false);
      oneShotPermissionModeRef.current = null;

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    },
    [
      agents,
      selectedSession,
      attachedImages,
      attachedFiles,
      ingestAttachmentsToObsidian,
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      executeCommand,
      geminiModel,
      isLoading,
      onSessionActive,
      onSessionProcessing,
      pendingViewSessionRef,
      permissionMode,
      provider,
      resetCommandMenuState,
      scrollToBottom,
      selectedProject,
      selectedAgentId,
      selectedAgentAppBindings,
      selectedSkillNames,
      getSelectedSkillNames,
      subagentDispatchRequested,
      modelProfileId,
      allowSessionAgentBinding,
      sendMessage,
      setCanAbortSession,
      addMessage,
      setClaudeStatus,
      setCurrentSessionId,
      setIsLoading,
      setIsUserScrolledUp,
      slashCommands,
      thinkingMode,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    const handleAppendChatInput = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) {
        return;
      }
      setInput((previous) => {
        const next = previous.trim() ? `${previous.trimEnd()}\n\n${text}` : text;
        inputValueRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    };

    window.addEventListener('argus-append-chat-input', handleAppendChatInput);
    return () => window.removeEventListener('argus-append-chat-input', handleAppendChatInput);
  }, []);

  useEffect(() => {
    const handleSubmitChatInput = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; permissionMode?: PermissionMode | string }>).detail || {};
      const text = typeof detail.text === 'string' ? detail.text.trim() : '';
      if (!text) {
        return;
      }

      setInput(text);
      inputValueRef.current = text;
      oneShotPermissionModeRef.current = detail.permissionMode || null;
      window.setTimeout(() => {
        void handleSubmitRef.current?.(createFakeSubmitEvent());
      }, 0);
    };

    window.addEventListener('argus-submit-chat-input', handleSubmitChatInput);
    return () => window.removeEventListener('argus-submit-chat-input', handleSubmitChatInput);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      submitLockRef.current = false;
    }
  }, [isLoading]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.max(22, textareaRef.current.scrollHeight)}px`;
    const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = 'auto';
      target.style.height = `${Math.max(22, target.scrollHeight)}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const pendingSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
    const cursorSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('cursorSessionId') : null;

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      provider === 'cursor' ? cursorSessionId : null,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find((sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId)) || null;

    if (!targetSessionId) {
      console.warn('Abort requested but no concrete session ID is available yet.');
      return;
    }

    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      provider,
    });
  }, [canAbortSession, currentSessionId, pendingViewSessionRef, provider, selectedSession?.id, sendMessage]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantClaudeToolPermission(suggestion.entry);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'claude-permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      setPendingPermissionRequests((previous) => {
        const next = previous.filter((request) => !validIds.includes(request.requestId));
        if (next.length === 0) {
          setClaudeStatus(null);
        }
        return next;
      });
    },
    [sendMessage, setClaudeStatus, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    subagentDispatchRequested,
    setSubagentDispatchRequested,
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
    filteredFiles: filteredFiles as MentionableFile[],
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
    ingestAttachmentsToObsidian,
    setIngestAttachmentsToObsidian,
    handleAttachmentFiles,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker: open,
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
    isInputFocused,
  };
}
