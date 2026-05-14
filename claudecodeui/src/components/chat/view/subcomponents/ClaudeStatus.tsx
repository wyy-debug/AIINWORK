import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type ClaudeStatusProps = {
  status: {
    text?: string;
    tokens?: number;
    can_interrupt?: boolean;
  } | null;
  onAbort?: () => void;
  isLoading: boolean;
  provider?: string;
  todoItems?: Array<{
    id?: string;
    content: string;
    status: 'completed' | 'in_progress' | 'pending';
  }>;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
const STATUS_ACTION_KEY_BY_TEXT: Record<string, string> = {
  thinking: 'claudeStatus.actions.thinking',
  processing: 'claudeStatus.actions.processing',
  analyzing: 'claudeStatus.actions.analyzing',
  working: 'claudeStatus.actions.working',
  computing: 'claudeStatus.actions.computing',
  reasoning: 'claudeStatus.actions.reasoning',
};

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  claude: 'messageTypes.claude',
  codex: 'messageTypes.codex',
  cursor: 'messageTypes.cursor',
  gemini: 'messageTypes.gemini',
};

function formatElapsedTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins < 1 ? `${secs}s` : `${mins}m ${secs}s`;
}

export default function ClaudeStatus({
  status,
  onAbort,
  isLoading,
  provider = 'claude',
  todoItems = [],
}: ClaudeStatusProps) {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      return;
    }
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    const dotTimer = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);

    return () => {
      clearInterval(timer);
      clearInterval(dotTimer);
    };
  }, [isLoading]);

  if (!isLoading && !status) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const rawStatusText = (status?.text || actionWords[Math.floor(elapsedTime / 3) % actionWords.length]).replace(/[.]+$/, '');
  const normalizedStatusText = rawStatusText.trim().toLowerCase();
  const statusText = STATUS_ACTION_KEY_BY_TEXT[normalizedStatusText]
    ? t(STATUS_ACTION_KEY_BY_TEXT[normalizedStatusText], { defaultValue: rawStatusText })
    : rawStatusText;

  const providerLabel = t(PROVIDER_LABEL_KEYS[provider] || 'claudeStatus.providers.assistant', { defaultValue: 'Assistant' });
  const stopLabel = t('claudeStatus.controls.stop', { defaultValue: 'Stop' });
  const visibleTodoItems = todoItems.slice(0, 4);
  const hasTodoItems = visibleTodoItems.length > 0;
  const genericLoadingState = isLoading && Boolean(STATUS_ACTION_KEY_BY_TEXT[normalizedStatusText]);
  const showCompactProcessingLamp = hasTodoItems && genericLoadingState;

  const renderTodoIndicator = (itemStatus: 'completed' | 'in_progress' | 'pending') => {
    if (itemStatus === 'completed') {
      return <span className="h-2 w-2 rounded-full bg-emerald-500" />;
    }
    if (itemStatus === 'in_progress') {
      return (
        <span className="relative flex h-2 w-2 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400/70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
        </span>
      );
    }
    return <span className="h-2 w-2 rounded-full border border-muted-foreground/40 bg-transparent" />;
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 mb-3 w-full duration-500">
      <div className="mx-auto flex max-w-4xl items-center gap-3 overflow-hidden rounded-full border border-border/50 bg-slate-100 px-3 py-1.5 shadow-sm backdrop-blur-md dark:bg-slate-900">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 ring-1 ring-primary/10">
            <SessionProviderLogo provider={provider} className="h-3.5 w-3.5" />
            {isLoading && (
              <span className="absolute inset-0 animate-pulse rounded-full ring-2 ring-emerald-500/20" />
            )}
          </div>

          <div className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              {providerLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={cn('relative flex h-2.5 w-2.5 items-center justify-center rounded-full', isLoading ? 'bg-emerald-500/20' : 'bg-amber-500/20')}>
                {isLoading && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />}
                <span className={cn('relative h-1.5 w-1.5 rounded-full', isLoading ? 'bg-emerald-500' : 'bg-amber-500')} />
              </span>
              {!showCompactProcessingLamp && (
                <p className="truncate text-xs font-medium text-foreground">
                  {statusText}
                  <span className="inline-block w-4 text-primary">{isLoading ? dots : ''}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {hasTodoItems ? (
            <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-full border border-border/50 bg-background/70 px-3 py-1">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Todo
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {visibleTodoItems.map((item, index) => (
                  <span
                    key={item.id ?? `${item.content}-${index}`}
                    className={cn(
                      'inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-none',
                      item.status === 'completed'
                        ? 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : item.status === 'in_progress'
                          ? 'border-sky-200/80 bg-sky-50/80 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300'
                          : 'border-border/60 bg-muted/60 text-muted-foreground',
                    )}
                    title={item.content}
                  >
                    {renderTodoIndicator(item.status)}
                    <span className="truncate">{item.content}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="hidden sm:block" />
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isLoading && status?.can_interrupt !== false && onAbort && (
            <>
              <div className="hidden items-center rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground sm:flex">
                {formatElapsedTime(elapsedTime)}
              </div>

              <button
                type="button"
                onClick={onAbort}
                className="group flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-bold text-destructive transition-all hover:bg-destructive hover:text-destructive-foreground"
              >
                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span className="hidden sm:inline">{stopLabel}</span>
                <kbd className="hidden rounded bg-black/10 px-1 text-[9px] group-hover:bg-white/20 sm:block">
                  ESC
                </kbd>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
