import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type {
  ChatMessage,
  ClaudePermissionSuggestion,
  PermissionGrantResult,
  Provider,
} from '../../types/types';
import { formatUsageLimitText } from '../../utils/chatFormatting';
import { getClaudePermissionSuggestion } from '../../utils/chatPermissions';
import type { SubagentControlAction } from '../../utils/subagentControlRequest';
import type { Project } from '../../../../types/app';
import { ToolRenderer, shouldHideToolResult } from '../../tools';
import { Button, Reasoning, ReasoningTrigger, ReasoningContent } from '../../../../shared/view/ui';
import { apiFetch } from '../../../../utils/api';

import { Markdown } from './Markdown';
import MessageCopyControl from './MessageCopyControl';
import ContextCompactionCard from './ContextCompactionCard';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

type MessageComponentProps = {
  message: ChatMessage;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  sessionId?: string | null;
  provider: Provider | string;
  messageKey?: string;
  obsidianBridgeEnabled?: boolean;
  isLatestAssistantReply?: boolean;
  onControlSubagent?: (action: SubagentControlAction, taskId: string, content?: string) => void;
};

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

type PermissionGrantState = 'idle' | 'granted' | 'error';
type ObsidianCaptureStatus = {
  status?: string;
  mode?: string;
  routingMode?: string;
  routingModes?: string[];
  routingReason?: string;
  aiRoutingReason?: string;
  artifactId?: string;
  obsidianPath?: string;
  obsidianTargets?: Array<{
    mode?: string;
    path?: string;
    fallbackPath?: string;
    error?: string;
    destination?: string;
  }>;
  obsidianPaths?: Record<string, string>;
  fallbackPath?: string;
  error?: string;
};
type ObsidianContextSource = {
  kind?: string;
  path?: string;
  title?: string;
  snippet?: string;
  hitReason?: string;
};
type ObsidianContextStatus = {
  used?: boolean;
  resultCount?: number;
  reranked?: boolean;
  rerankModel?: string;
  refinementModel?: string;
  tokenBudgetUsed?: number;
  sources?: ObsidianContextSource[];
  error?: string;
};
type WikiUploadSuggestion = {
  loading: boolean;
  shouldUpload: boolean;
  reason: string;
  confidence: number;
  mode: string;
  error: string;
};
type WikiUploadState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  path: string;
  error: string;
};
const WIKI_SUMMARY_TYPES = [
  { value: 'auto', label: '自动总结' },
  { value: 'technical-review', label: '技术评审' },
  { value: 'project-summary', label: '项目总结' },
  { value: 'reading-note', label: '阅读笔记' },
  { value: 'decision-adr', label: '决策 ADR' },
  { value: 'meeting-notes', label: '会议纪要' },
  { value: 'general-wiki', label: '通用 Wiki' },
];
const COPY_HIDDEN_TOOL_NAMES = new Set(['Bash', 'Edit', 'Write', 'ApplyPatch']);

const OBSIDIAN_CAPTURE_STATUS_LABELS: Record<string, string> = {
  synced: '已保存到 Obsidian',
  captured: '已保存到 Obsidian',
  fallback: '已回退到 docs/knowledge',
  failed: '保存失败',
  skipped: '未保存',
  duplicate: '已保存过',
  candidate: '待确认记忆',
  in_progress: '正在保存',
};

const OBSIDIAN_CAPTURE_MODE_LABELS: Record<string, string> = {
  'project-knowledge': '项目知识库',
  'second-brain': '第二大脑',
  'ai-memory': 'AI 记忆',
};

const labelForObsidianMode = (mode: string) => OBSIDIAN_CAPTURE_MODE_LABELS[mode] || mode;

const uniqueStrings = (values: Array<string | undefined>) => {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

function formatFileSize(size?: number) {
  if (!size || !Number.isFinite(size) || size <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / (1024 ** exponent);
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

const parseApiJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
};

const titleFromAssistantContent = (content = '') => {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('```') && !line.startsWith('---'));
  const title = heading || firstLine || '对话回复';
  return title.length > 80 ? `${title.slice(0, 80).trim()}...` : title;
};

const formatWikiRoutingReason = (reason = '') => {
  const trimmed = reason.trim();
  if (!trimmed) return '';
  const matched = trimmed.match(/^Matched (.+); routed to ([\w-]+)\.$/i);
  if (!matched) return trimmed;
  const signals = matched[1] === 'default mode' ? '默认规则' : matched[1];
  return `命中 ${signals}，建议整理成 Wiki。`;
};

const MessageComponent = memo(({ message, prevMessage, createDiff, onFileOpen, onShowSettings, onGrantToolPermission, autoExpandTools, showRawParameters, showThinking, selectedProject, sessionId, provider, messageKey, obsidianBridgeEnabled = false, isLatestAssistantReply = false, onControlSubagent }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'tool') ||
      (prevMessage.type === 'error'));
  const messageRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const permissionSuggestion = getClaudePermissionSuggestion(message, provider);
  const [permissionGrantState, setPermissionGrantState] = useState<PermissionGrantState>('idle');
  const userCopyContent = String(message.content || '');
  const formattedMessageContent = useMemo(
    () => formatUsageLimitText(String(message.content || '')),
    [message.content]
  );
  const assistantCopyContent = message.isToolUse
    ? String(message.displayText || message.content || '')
    : formattedMessageContent;
  const isCommandOrFileEditToolResponse = Boolean(
    message.isToolUse && COPY_HIDDEN_TOOL_NAMES.has(String(message.toolName || ''))
  );
  const shouldShowUserCopyControl = message.type === 'user' && userCopyContent.trim().length > 0;
  const shouldShowAssistantCopyControl = message.type === 'assistant' &&
    assistantCopyContent.trim().length > 0 &&
    !isCommandOrFileEditToolResponse &&
    !message.isThinking;
  const obsidianContextStatus = (message.obsidianContextStatus || null) as ObsidianContextStatus | null;
  const obsidianContextSources = Array.isArray(obsidianContextStatus?.sources)
    ? obsidianContextStatus.sources.filter((source) => source?.path || source?.title || source?.snippet)
    : [];
  const obsidianContextCount = obsidianContextSources.length || Number(obsidianContextStatus?.resultCount || 0);
  const shouldShowObsidianContextStatus = obsidianBridgeEnabled
    && message.type === 'user'
    && Boolean(obsidianContextStatus);
  const obsidianCaptureStatus = obsidianBridgeEnabled
    ? (message.obsidianCaptureStatus || null) as ObsidianCaptureStatus | null
    : null;
  const obsidianCaptureLabel = obsidianCaptureStatus?.status
    ? OBSIDIAN_CAPTURE_STATUS_LABELS[obsidianCaptureStatus.status] || obsidianCaptureStatus.status
    : '';
  const obsidianCaptureMode = obsidianCaptureStatus?.routingMode || obsidianCaptureStatus?.mode || '';
  const obsidianCaptureModes = uniqueStrings([
    ...(Array.isArray(obsidianCaptureStatus?.routingModes) ? obsidianCaptureStatus.routingModes : []),
    obsidianCaptureMode,
  ]);
  const obsidianCaptureModeLabel = obsidianCaptureModes.map(labelForObsidianMode).join('、');
  const obsidianCaptureReason = obsidianCaptureStatus?.status === 'skipped'
    ? obsidianCaptureStatus.aiRoutingReason || obsidianCaptureStatus.routingReason || '内容不像知识沉淀'
    : '';
  const obsidianTargetDetail = Array.isArray(obsidianCaptureStatus?.obsidianTargets)
    ? obsidianCaptureStatus.obsidianTargets
      .map((target) => {
        const targetMode = target.mode ? labelForObsidianMode(target.mode) : '';
        const targetPath = target.path || target.fallbackPath || target.error || target.destination || '';
        return [targetMode, targetPath].filter(Boolean).join('：');
      })
      .filter(Boolean)
      .join('\n')
    : '';
  const obsidianPathsDetail = obsidianCaptureStatus?.obsidianPaths && typeof obsidianCaptureStatus.obsidianPaths === 'object'
    ? Object.entries(obsidianCaptureStatus.obsidianPaths)
      .map(([mode, notePath]) => `${labelForObsidianMode(mode)}：${notePath}`)
      .join('\n')
    : '';
  const obsidianCaptureDetail = obsidianTargetDetail
    || obsidianPathsDetail
    || obsidianCaptureStatus?.obsidianPath
    || obsidianCaptureStatus?.fallbackPath
    || obsidianCaptureStatus?.error
    || obsidianCaptureStatus?.routingReason
    || '';
  const [wikiSuggestion, setWikiSuggestion] = useState<WikiUploadSuggestion>({
    loading: false,
    shouldUpload: false,
    reason: '',
    confidence: 0,
    mode: '',
    error: '',
  });
  const [wikiUploadState, setWikiUploadState] = useState<WikiUploadState>({
    status: 'idle',
    path: '',
    error: '',
  });
  const [wikiSummaryType, setWikiSummaryType] = useState('auto');
  const wikiUploadContent = assistantCopyContent.trim();
  const shouldOfferWikiUpload = obsidianBridgeEnabled
    && isLatestAssistantReply
    && message.type === 'assistant'
    && !message.isStreaming
    && !message.isToolUse
    && !message.isThinking
    && !message.isTaskNotification
    && wikiUploadContent.length > 0;
  const wikiUploadSourceId = `chat:${sessionId || 'unknown'}:message:${String(message.id || messageKey || message.timestamp)}`;
  const wikiSuggestionLabel = wikiSuggestion.loading
    ? '判断中'
    : wikiSuggestion.error
      ? '建议不可用'
      : wikiSuggestion.shouldUpload
        ? '建议上传'
        : '不建议上传';
  const wikiSuggestionDetail = wikiSuggestion.reason
    || (wikiSuggestion.shouldUpload ? '这段回答像可沉淀的知识。' : '内容不太像长期知识沉淀。');
  const wikiUploadButtonLabel = wikiUploadState.status === 'saved'
    ? '已上传到 Wiki'
    : wikiUploadState.status === 'saving'
      ? '上传中'
      : '上传到 Wiki';


  useEffect(() => {
    setPermissionGrantState('idle');
  }, [permissionSuggestion?.entry, message.toolId]);

  useEffect(() => {
    setWikiUploadState({ status: 'idle', path: '', error: '' });
  }, [wikiUploadSourceId]);

  useEffect(() => {
    if (!shouldOfferWikiUpload) {
      setWikiSuggestion({
        loading: false,
        shouldUpload: false,
        reason: '',
        confidence: 0,
        mode: '',
        error: '',
      });
      return;
    }

    let cancelled = false;
    setWikiSuggestion((previous) => ({
      ...previous,
      loading: true,
      error: '',
    }));

    const loadSuggestion = async () => {
      try {
        const data = await parseApiJson<{
          shouldCapture?: boolean;
          wouldWrite?: boolean;
          routingReason?: string;
          aiRoutingReason?: string;
          routingConfidence?: number;
          confidence?: number;
          routingMode?: string;
          mode?: string;
        }>(await apiFetch('/api/obsidian-bridge/routing/preview', {
          method: 'POST',
          body: JSON.stringify({
            content: wikiUploadContent,
            userPrompt: typeof prevMessage?.content === 'string' ? prevMessage.content : '',
            defaultMode: 'project-knowledge',
            timestamp: message.timestamp,
          }),
        }));
        if (cancelled) return;
        const confidence = Number(data.routingConfidence ?? data.confidence ?? 0);
        setWikiSuggestion({
          loading: false,
          shouldUpload: Boolean(data.shouldCapture || data.wouldWrite || confidence >= 0.55),
          reason: data.aiRoutingReason || formatWikiRoutingReason(data.routingReason || ''),
          confidence,
          mode: data.routingMode || data.mode || '',
          error: '',
        });
      } catch (error) {
        if (cancelled) return;
        setWikiSuggestion({
          loading: false,
          shouldUpload: false,
          reason: '',
          confidence: 0,
          mode: '',
          error: error instanceof Error ? error.message : '判断建议失败',
        });
      }
    };

    void loadSuggestion();
    return () => {
      cancelled = true;
    };
  }, [message.timestamp, prevMessage?.content, shouldOfferWikiUpload, wikiUploadContent]);

  const uploadAssistantReplyToWiki = async () => {
    if (!selectedProject?.name) {
      setWikiUploadState({ status: 'error', path: '', error: '请先选择项目后再上传到 Wiki。' });
      return;
    }
    if (!wikiUploadContent) {
      setWikiUploadState({ status: 'error', path: '', error: '没有可上传的回答内容。' });
      return;
    }

    setWikiUploadState({ status: 'saving', path: '', error: '' });
    try {
      const created = await parseApiJson<{
        artifact?: { id?: string };
      }>(await apiFetch('/api/artifacts', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'chat-note',
          title: titleFromAssistantContent(wikiUploadContent),
          projectName: selectedProject.name,
          sessionId: sessionId || '',
          content: wikiUploadContent,
          metadata: {
            source: 'manual-chat-wiki-upload',
            sourceId: wikiUploadSourceId,
            summaryType: wikiSummaryType,
            provider: String(provider || ''),
            messageKey: messageKey || '',
            messageTimestamp: message.timestamp,
            routingMode: wikiSuggestion.mode,
            routingReason: wikiSuggestion.reason,
            routingConfidence: wikiSuggestion.confidence,
            obsidianStatus: 'not_sent',
          },
        }),
      }));
      const artifactId = created.artifact?.id;
      if (!artifactId) {
        throw new Error('创建结果记录失败。');
      }
      const exported = await parseApiJson<{
        obsidianBridge?: { path?: string; wikiPath?: string; fallbackPath?: string; destination?: string };
      }>(await apiFetch(`/api/artifacts/${encodeURIComponent(artifactId)}/send-to-obsidian`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'auto', summaryType: wikiSummaryType }),
      }));
      const targetPath = exported.obsidianBridge?.wikiPath
        || exported.obsidianBridge?.path
        || exported.obsidianBridge?.fallbackPath
        || '';
      setWikiUploadState({ status: 'saved', path: targetPath, error: '' });
      window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
    } catch (error) {
      setWikiUploadState({
        status: 'error',
        path: '',
        error: error instanceof Error ? error.message : '上传到 Wiki 失败',
      });
    }
  };

  useEffect(() => {
    const node = messageRef.current;
    if (!autoExpandTools || !node || !message.isToolUse) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isExpanded) {
            setIsExpanded(true);
            const details = node.querySelectorAll<HTMLDetailsElement>('details');
            details.forEach((detail) => {
              detail.open = true;
            });
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(node);

    return () => {
      observer.unobserve(node);
    };
  }, [autoExpandTools, isExpanded, message.isToolUse]);

  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);
  const messageSourceSessionId = typeof message.sessionId === 'string' && message.sessionId.trim()
    ? message.sessionId
    : sessionId || null;

  if (shouldHideThinkingMessage) {
    return null;
  }

  if (message.isContextCompaction) {
    return (
      <div
        ref={messageRef}
        data-message-key={messageKey}
        data-message-timestamp={message.timestamp || undefined}
        className="chat-message system px-3 sm:px-0"
      >
        <ContextCompactionCard
          message={message}
          formattedTime={formattedTime}
          provider={String(provider || 'claude')}
          projectName={selectedProject?.name || selectedProject?.displayName || ''}
          projectPath={selectedProject?.fullPath || selectedProject?.path || ''}
        />
      </div>
    );
  }

  return (
    <div
      ref={messageRef}
      data-message-key={messageKey}
      data-message-timestamp={message.timestamp || undefined}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User message bubble on the right */
        <div className="flex w-full items-end space-x-0 sm:w-auto sm:max-w-[85%] sm:space-x-3 md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="group flex-1 rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-white shadow-sm sm:flex-initial sm:px-4">
            <div className="whitespace-pre-wrap break-words text-sm">
              {message.content}
            </div>
            {message.images && message.images.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {message.images.map((img, idx) => (
                  <img
                    key={img.name || idx}
                    src={img.data}
                    alt={img.name}
                    className="h-auto max-w-full cursor-pointer rounded-lg transition-opacity hover:opacity-90"
                    onClick={() => window.open(img.data, '_blank')}
                  />
                ))}
              </div>
            )}
            {message.files && message.files.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {message.files.map((file, idx) => (
                  <button
                    key={`${file.path || file.name}-${idx}`}
                    type="button"
                    onClick={() => file.path && onFileOpen?.(file.path)}
                    className="flex min-w-0 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-2.5 py-2 text-left text-white transition-colors hover:bg-white/15"
                    title={file.path || file.name}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15 text-[10px] font-semibold">
                      FILE
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{file.name || file.path}</span>
                      <span className="block truncate text-[11px] text-blue-100">
                        {[formatFileSize(file.size), file.mimeType].filter(Boolean).join(' · ') || 'Uploaded file'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {shouldShowObsidianContextStatus && (
              <details className="mt-2 rounded-lg border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-blue-50">
                <summary className="cursor-pointer select-none text-blue-50">
                  {obsidianContextStatus?.used
                    ? `已注入 ${obsidianContextCount} 条 Wiki 上下文`
                    : `Wiki 上下文未注入${obsidianContextStatus?.error ? '：' + obsidianContextStatus.error : ''}`}
                  {obsidianContextStatus?.reranked ? ` · ${obsidianContextStatus.rerankModel || obsidianContextStatus.refinementModel || '小模型筛选'}` : ''}
                </summary>
                {obsidianContextSources.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {obsidianContextSources.map((source, index) => (
                      <div key={`${source.path || source.title || index}-${index}`} className="rounded-md bg-white/10 p-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {source.title || source.path || 'Wiki source'}
                          </span>
                          {source.path && (
                            <a
                              href={`obsidian://open?path=${encodeURIComponent(source.path)}`}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/15"
                              title="打开 Obsidian 笔记"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {source.path && (
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/15"
                              title="复制路径"
                              onClick={() => {
                                void navigator.clipboard?.writeText(source.path || '');
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {source.path && <div className="mt-1 truncate text-[11px] text-blue-100">{source.path}</div>}
                        {source.hitReason && <div className="mt-1 text-[11px] text-blue-100">命中原因：{source.hitReason}</div>}
                        {source.snippet && <div className="mt-1 line-clamp-3 text-[11px] text-blue-50/90">{source.snippet}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </details>
            )}
            <div className="mt-1 flex items-center justify-end gap-1 text-xs text-blue-100">
              {shouldShowUserCopyControl && (
                <MessageCopyControl content={userCopyContent} messageType="user" />
              )}
              <span>{formattedTime}</span>
            </div>
          </div>
          {!isGrouped && (
            <div className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm text-white sm:flex">
              U
            </div>
          )}
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${message.taskStatus === 'completed' ? 'bg-green-400 dark:bg-green-500' : 'bg-amber-400 dark:bg-amber-500'}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full">
          {!isGrouped && (
            <div className="mb-2 flex items-center space-x-3">
              {message.type === 'error' ? (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-sm text-white">
                  !
                </div>
              ) : message.type === 'tool' ? (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-600 text-sm text-white dark:bg-gray-700">
                  🔧
                </div>
              ) : (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full p-1 text-sm text-white">
                  <SessionProviderLogo provider={provider} className="h-full w-full" />
                </div>
              )}
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {message.type === 'error' ? t('messageTypes.error') : message.type === 'tool' ? t('messageTypes.tool') : (provider === 'cursor' ? t('messageTypes.cursor') : provider === 'codex' ? t('messageTypes.codex') : provider === 'gemini' ? t('messageTypes.gemini') : t('messageTypes.claude'))}
              </div>
            </div>
          )}

          <div className="w-full">

            {message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <Markdown
                      className="prose prose-sm max-w-none dark:prose-invert"
                      onFileOpen={onFileOpen}
                      projectName={selectedProject?.name}
                    >
                      {String(message.displayText || '')}
                    </Markdown>
                  </div>
                </div>

                {message.toolInput && (
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    toolInput={message.toolInput}
                    toolResult={message.toolResult}
                    toolId={message.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                    provider={String(provider || '')}
                    sourceSessionId={messageSourceSessionId}
                    isSubagentContainer={message.isSubagentContainer}
                    subagentState={message.subagentState}
                    onControlSubagent={onControlSubagent}
                  />
                )}

                {/* Tool Result Section */}
                {message.toolResult && !shouldHideToolResult(message.toolName || 'UnknownTool', message.toolResult) && (
                  message.toolResult.isError ? (
                    // Error results - red error box with content
                    <div
                      id={`tool-result-${message.toolId}`}
                      className="relative mt-2 scroll-mt-4 rounded border border-red-200/60 bg-red-50/50 p-3 dark:border-red-800/40 dark:bg-red-950/10"
                    >
                      <div className="relative mb-2 flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-xs font-medium text-red-700 dark:text-red-300">{t('messageTypes.error')}</span>
                      </div>
                      <div className="relative text-sm text-red-900 dark:text-red-100">
                        <Markdown
                          className="prose prose-sm prose-red max-w-none dark:prose-invert"
                          onFileOpen={onFileOpen}
                          projectName={selectedProject?.name}
                        >
                          {String(message.toolResult.content || '')}
                        </Markdown>
                        {permissionSuggestion && (
                          <div className="mt-4 border-t border-red-200/60 pt-3 dark:border-red-800/60">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!onGrantToolPermission) return;
                                  const result = onGrantToolPermission(permissionSuggestion);
                                  if (result?.success) {
                                    setPermissionGrantState('granted');
                                  } else {
                                    setPermissionGrantState('error');
                                  }
                                }}
                                disabled={permissionSuggestion.isAllowed || permissionGrantState === 'granted'}
                                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                  ? 'cursor-default border-green-300/70 bg-green-100 text-green-800 dark:border-green-800/60 dark:bg-green-900/30 dark:text-green-200'
                                  : 'border-red-300/70 bg-white/80 text-red-700 hover:bg-white dark:border-red-800/60 dark:bg-gray-900/40 dark:text-red-200 dark:hover:bg-gray-900/70'
                                  }`}
                              >
                                {permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                  ? t('permissions.added')
                                  : t('permissions.grant', { tool: permissionSuggestion.toolName })}
                              </button>
                              {onShowSettings && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onShowSettings(); }}
                                  className="text-xs text-red-700 underline hover:text-red-800 dark:text-red-200 dark:hover:text-red-100"
                                >
                                  {t('permissions.openSettings')}
                                </button>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-red-700/90 dark:text-red-200/80">
                              {t('permissions.addTo', { entry: permissionSuggestion.entry })}
                            </div>
                            {permissionGrantState === 'error' && (
                              <div className="mt-2 text-xs text-red-700 dark:text-red-200">
                                {t('permissions.error')}
                              </div>
                            )}
                            {(permissionSuggestion.isAllowed || permissionGrantState === 'granted') && (
                              <div className="mt-2 text-xs text-green-700 dark:text-green-200">
                                {t('permissions.retry')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Non-error results - route through ToolRenderer (single source of truth)
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolRenderer
                        toolName={message.toolName || 'UnknownTool'}
                        toolInput={message.toolInput}
                        toolResult={message.toolResult}
                        toolId={message.toolId}
                        mode="result"
                        onFileOpen={onFileOpen}
                        createDiff={createDiff}
                        selectedProject={selectedProject}
                        autoExpandTools={autoExpandTools}
                      />
                    </div>
                  )
                )}
              </>
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500">
                    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-3 text-base font-semibold text-amber-900 dark:text-amber-100">
                      {t('interactive.title')}
                    </h4>
                    {(() => {
                      const lines = (message.content || '').split('\n').filter((line) => line.trim());
                      const questionLine = lines.find((line) => line.includes('?')) || lines[0] || '';
                      const options: InteractiveOption[] = [];

                      // Parse the menu options
                      lines.forEach((line) => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });

                      return (
                        <>
                          <p className="mb-4 text-sm text-amber-800 dark:text-amber-200">
                            {questionLine}
                          </p>

                          {/* Option buttons */}
                          <div className="mb-4 space-y-2">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full rounded-lg border-2 px-4 py-3 text-left transition-all ${option.isSelected
                                  ? 'border-amber-600 bg-amber-600 text-white shadow-md dark:border-amber-700 dark:bg-amber-700'
                                  : 'border-amber-300 bg-white text-amber-900 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-100'
                                  } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${option.isSelected
                                    ? 'bg-white/20'
                                    : 'bg-amber-100 dark:bg-amber-800/50'
                                    }`}>
                                    {option.number}
                                  </span>
                                  <span className="flex-1 text-sm font-medium sm:text-base">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="rounded-lg bg-amber-100 p-3 dark:bg-amber-800/30">
                            <p className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-100">
                              {t('interactive.waiting')}
                            </p>
                            <p className="text-xs text-amber-800 dark:text-amber-200">
                              {t('interactive.instruction')}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isThinking ? (
              /* Thinking messages — Reasoning component (ai-elements pattern) */
              <Reasoning defaultOpen={false}>
                <ReasoningTrigger />
                <ReasoningContent>
                  <Markdown
                    className="prose prose-sm prose-gray max-w-none dark:prose-invert"
                    onFileOpen={onFileOpen}
                    projectName={selectedProject?.name}
                  >
                    {message.content}
                  </Markdown>
                  <div className="mt-3 flex items-center text-[11px]">
                    <MessageCopyControl content={String(message.content || '')} messageType="assistant" />
                  </div>
                </ReasoningContent>
              </Reasoning>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {/* Reasoning accordion */}
                {showThinking && message.reasoning && (
                  <Reasoning className="mb-3" defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent>
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </ReasoningContent>
                  </Reasoning>
                )}

                {(() => {
                  const content = formattedMessageContent;

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                    (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-gray-600/30 bg-gray-800 dark:border-gray-700 dark:bg-gray-900">
                            <pre className="overflow-x-auto p-4">
                              <code className="block whitespace-pre font-mono text-sm text-gray-100 dark:text-gray-200">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    <Markdown
                      className="prose prose-sm prose-gray max-w-none dark:prose-invert"
                      onFileOpen={onFileOpen}
                      projectName={selectedProject?.name}
                    >
                      {content}
                    </Markdown>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}

            {(shouldShowAssistantCopyControl || shouldOfferWikiUpload || !isGrouped) && (
              <div className="mt-1 flex w-full flex-wrap items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
                {shouldShowAssistantCopyControl && (
                  <MessageCopyControl content={assistantCopyContent} messageType="assistant" />
                )}
                {shouldOfferWikiUpload && (
                  <span
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 text-[11px] text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300"
                    title={[
                      wikiSuggestion.error ? `建议失败：${wikiSuggestion.error}` : wikiSuggestionDetail,
                      wikiSuggestion.confidence ? `置信度：${Math.round(wikiSuggestion.confidence * 100)}%` : '',
                      wikiUploadState.path,
                      wikiUploadState.error,
                    ].filter(Boolean).join('\n')}
                  >
                    {wikiSuggestion.loading && <Loader2 className="h-3 w-3 animate-spin" />}
                    <span className={wikiSuggestion.shouldUpload ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}>
                      {wikiSuggestionLabel}
                    </span>
                    <select
                      className="h-6 rounded border border-gray-200 bg-white px-1 text-[11px] text-gray-600 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      value={wikiSummaryType}
                      onChange={(event) => setWikiSummaryType(event.target.value)}
                      title="summaryType"
                    >
                      {WIKI_SUMMARY_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[11px]"
                      onClick={uploadAssistantReplyToWiki}
                      disabled={wikiUploadState.status === 'saving' || wikiUploadState.status === 'saved'}
                    >
                      {wikiUploadState.status === 'saving'
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <BookOpen className="h-3 w-3" />}
                      {wikiUploadButtonLabel}
                    </Button>
                    {wikiUploadState.status === 'error' && (
                      <span className="max-w-[180px] truncate text-destructive">{wikiUploadState.error}</span>
                    )}
                  </span>
                )}
                {obsidianCaptureLabel && (
                  <span
                    className="truncate rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400"
                    title={[
                      obsidianCaptureModeLabel ? `目标：${obsidianCaptureModeLabel}` : '',
                      obsidianCaptureReason,
                      obsidianCaptureStatus?.routingReason || '',
                      obsidianCaptureDetail,
                    ].filter(Boolean).join('\n')}
                  >
                    {obsidianCaptureLabel}
                    {obsidianCaptureStatus?.status !== 'skipped' && obsidianCaptureModeLabel ? ` · ${obsidianCaptureModeLabel}` : ''}
                    {obsidianCaptureReason ? ` · ${obsidianCaptureReason}` : ''}
                  </span>
                )}
                {!isGrouped && <span>{formattedTime}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;

