import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, MessageSquarePlus, Plus, X } from 'lucide-react';

import { apiFetch } from '../../../../utils/api';
import type { Project } from '../../../../types/app';
import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { SessionWithProvider } from '../../types/types';
import { saveConversationDraft } from '../../../chat/utils/conversationDraft';

type ConversationGuideMode = 'guide' | 'append';

type ConversationGuideModalProps = {
  sourceProject: Project;
  sourceSession: SessionWithProvider;
  conversationSessions: SessionWithProvider[];
  onClose: () => void;
  onStartNewConversation: () => void;
  onAppendToConversation: (session: SessionWithProvider) => void;
};

type SourceSnippet = {
  role: string;
  text: string;
};

function getSessionTitle(session: SessionWithProvider) {
  return String(session.summary || session.name || session.title || session.id);
}

function truncateText(value: string, maxLength = 900) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function extractMessageText(message: Record<string, unknown>) {
  const direct = message.content;
  if (typeof direct === 'string') {
    return direct;
  }
  if (Array.isArray(direct)) {
    return direct
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text || '') : ''))
      .filter(Boolean)
      .join('\n');
  }

  const nested = message.message;
  if (nested && typeof nested === 'object') {
    const nestedContent = (nested as { content?: unknown }).content;
    if (typeof nestedContent === 'string') {
      return nestedContent;
    }
    if (Array.isArray(nestedContent)) {
      return nestedContent
        .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text || '') : ''))
        .filter(Boolean)
        .join('\n');
    }
  }

  return '';
}

function extractMessageRole(message: Record<string, unknown>) {
  const nested = message.message;
  if (nested && typeof nested === 'object' && typeof (nested as { role?: unknown }).role === 'string') {
    return String((nested as { role: string }).role);
  }
  if (typeof message.role === 'string') {
    return message.role;
  }
  if (typeof message.type === 'string') {
    return message.type;
  }
  return 'message';
}

function createDraftText({
  mode,
  sourceProject,
  sourceSession,
  snippets,
}: {
  mode: ConversationGuideMode;
  sourceProject: Project;
  sourceSession: SessionWithProvider;
  snippets: SourceSnippet[];
}) {
  const sourceTitle = getSessionTitle(sourceSession);
  const sourceKind = sourceProject.isStandaloneConversation ? '独立对话' : '项目会话';
  const sourcePath = sourceProject.fullPath || sourceProject.path || '';
  const snippetText = snippets.length > 0
    ? snippets
      .slice(0, 8)
      .map((snippet, index) => `${index + 1}. ${snippet.role}: ${truncateText(snippet.text, 420)}`)
      .join('\n')
    : '暂无可读取的消息片段，请只把来源信息作为线索。';

  if (mode === 'append') {
    return [
      '追加上下文：请把下面来源会话作为背景继续当前对话，不要覆盖当前目标。',
      '',
      `来源：${sourceTitle}`,
      `来源类型：${sourceKind}`,
      `来源项目：${sourceProject.displayName || sourceProject.name}`,
      sourcePath ? `来源路径：${sourcePath}` : '',
      `来源 Session：${sourceSession.id}`,
      '',
      '来源片段：',
      snippetText,
      '',
      '请结合这些上下文继续处理；如果上下文不足，先指出缺口并提出需要补充的问题。',
    ].filter(Boolean).join('\n');
  }

  return [
    '请基于下面来源会话，先引导我继续推进这个任务。',
    '',
    '要求：',
    '1. 先复述你理解的目标和当前状态。',
    '2. 如果关键信息不足，先问 2-4 个澄清问题。',
    '3. 给出建议的下一步，不要直接开始大范围实现。',
    '',
    `来源：${sourceTitle}`,
    `来源类型：${sourceKind}`,
    `来源项目：${sourceProject.displayName || sourceProject.name}`,
    sourcePath ? `来源路径：${sourcePath}` : '',
    `来源 Session：${sourceSession.id}`,
    '',
    '来源片段：',
    snippetText,
  ].filter(Boolean).join('\n');
}

function createDraftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `conversation-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ConversationGuideModal({
  sourceProject,
  sourceSession,
  conversationSessions,
  onClose,
  onStartNewConversation,
  onAppendToConversation,
}: ConversationGuideModalProps) {
  const [mode, setMode] = useState<ConversationGuideMode>('guide');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [draftText, setDraftText] = useState('');
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [error, setError] = useState('');
  const isStandaloneSource = Boolean(sourceProject.isStandaloneConversation);

  const targetSessions = useMemo(() => conversationSessions
    .filter((session) => !(isStandaloneSource && session.id === sourceSession.id))
    .slice(0, 30), [conversationSessions, isStandaloneSource, sourceSession.id]);

  const selectedTarget = targetSessions.find((session) => session.id === selectedTargetId) || null;

  useEffect(() => {
    let cancelled = false;

    const loadContext = async () => {
      setIsLoadingContext(true);
      setError('');
      try {
        const params = new URLSearchParams({
          provider: sourceSession.__provider || 'claude',
          projectName: sourceProject.name,
          projectPath: sourceProject.fullPath || sourceProject.path || '',
          limit: '10',
          offset: '0',
        });
        const response = await apiFetch(`/api/sessions/${encodeURIComponent(sourceSession.id)}/messages?${params.toString()}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const snippets = messages
          .map((message: unknown): SourceSnippet | null => {
            if (!message || typeof message !== 'object') {
              return null;
            }
            const record = message as Record<string, unknown>;
            const text = extractMessageText(record).trim();
            if (!text) {
              return null;
            }
            return {
              role: extractMessageRole(record),
              text,
            };
          })
          .filter((snippet: SourceSnippet | null): snippet is SourceSnippet => Boolean(snippet));
        if (!cancelled) {
          setDraftText(createDraftText({ mode, sourceProject, sourceSession, snippets }));
        }
      } catch (loadError) {
        console.warn('Failed to load source conversation context:', loadError);
        if (!cancelled) {
          setError('没有读取到完整消息，只会带入会话标题和来源信息。');
          setDraftText(createDraftText({ mode, sourceProject, sourceSession, snippets: [] }));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingContext(false);
        }
      }
    };

    void loadContext();
    return () => {
      cancelled = true;
    };
  }, [mode, sourceProject, sourceSession]);

  const handleConfirm = () => {
    const text = draftText.trim();
    if (!text) {
      setError('请先填写要带入目标对话的内容。');
      return;
    }

    if (mode === 'append' && !selectedTarget) {
      setError('请选择要追加到的独立对话。');
      return;
    }

    saveConversationDraft({
      id: createDraftId(),
      scope: 'conversations',
      mode: mode === 'append' ? 'append' : 'replace',
      text,
      targetSessionId: mode === 'append' ? selectedTarget?.id || null : null,
      sourceSessionId: sourceSession.id,
      sourceProjectName: sourceProject.name,
      sourceTitle: getSessionTitle(sourceSession),
      createdAt: Date.now(),
    });

    if (mode === 'append' && selectedTarget) {
      onAppendToConversation(selectedTarget);
    } else {
      onStartNewConversation();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MessageSquarePlus className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-foreground">引导 / 追加对话</h2>
                <p className="text-xs text-muted-foreground">从一个会话提取上下文，带到新对话或已有独立对话。</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-border bg-muted/25 p-3">
            <div className="text-xs font-medium text-muted-foreground">来源会话</div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">{getSessionTitle(sourceSession)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {isStandaloneSource ? '独立对话' : sourceProject.displayName || sourceProject.name}
              <span className="mx-1.5">·</span>
              {sourceSession.__provider || 'claude'}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition',
                mode === 'guide'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setMode('guide')}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Plus className="h-4 w-4" />
                引导到新对话
              </div>
              <p className="mt-1 text-xs opacity-80">创建一个新的独立对话草稿。</p>
            </button>
            <button
              type="button"
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition',
                mode === 'append'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setMode('append')}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <ArrowRight className="h-4 w-4" />
                追加到已有对话
              </div>
              <p className="mt-1 text-xs opacity-80">把上下文接到目标对话输入草稿。</p>
            </button>
          </div>

          {mode === 'append' && (
            <div className="mt-4 rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                目标独立对话
              </div>
              {targetSessions.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  暂无可追加的独立对话。可以先选择“引导到新对话”。
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto p-1.5">
                  {targetSessions.map((session) => (
                    <button
                      key={`${session.__provider}-${session.id}`}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-muted',
                        selectedTargetId === session.id && 'bg-primary/10 text-primary',
                      )}
                      onClick={() => {
                        setSelectedTargetId(session.id);
                        setError('');
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{getSessionTitle(session)}</span>
                        <span className="block text-xs text-muted-foreground">{session.__provider || 'claude'}</span>
                      </span>
                      {selectedTargetId === session.id && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                          已选择
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="mt-4 block">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">将写入目标对话的草稿</span>
              {isLoadingContext && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  读取来源会话
                </span>
              )}
            </div>
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              className="min-h-56 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          {error && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={isLoadingContext}>
            {mode === 'append' ? '追加到对话' : '创建引导对话'}
          </Button>
        </div>
      </div>
    </div>
  );
}
