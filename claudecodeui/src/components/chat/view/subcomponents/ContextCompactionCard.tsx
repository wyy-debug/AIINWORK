import { Archive, ChevronDown, Scissors } from 'lucide-react';

import type { ChatMessage } from '../../types/types';

import { Markdown } from './Markdown';

type ContextCompactionCardProps = {
  message: ChatMessage;
  formattedTime: string;
};

const formatNumber = (value: unknown): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat().format(value);
};

const getToolCount = (value: unknown): number | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.length;
};

const formatTrigger = (trigger: unknown): string | null => {
  if (typeof trigger !== 'string' || !trigger.trim()) {
    return null;
  }

  const normalized = trigger.trim().toLowerCase();
  if (normalized === 'auto') return '自动';
  if (normalized === 'manual') return '手动';
  if (normalized === 'reactive') return '超限恢复';
  return trigger.trim();
};

export default function ContextCompactionCard({ message, formattedTime }: ContextCompactionCardProps) {
  const compactType = typeof message.compactType === 'string' ? message.compactType : 'full';
  const isMicro = compactType === 'micro';
  const isSummaryOnly = compactType === 'summary';
  const summary = typeof message.compactSummary === 'string' ? message.compactSummary.trim() : '';
  const preTokens = formatNumber(message.preTokens);
  const tokensSaved = formatNumber(message.tokensSaved);
  const compactedToolCount = getToolCount(message.compactedToolIds);
  const trigger = formatTrigger(message.compactTrigger);
  const title = isMicro
    ? '工具输出已压缩'
    : isSummaryOnly
      ? '压缩摘要已载入'
      : '对话已压缩';
  const Icon = isMicro ? Scissors : Archive;
  const stats = [
    trigger,
    preTokens ? `压缩前 ${preTokens} tokens` : null,
    tokensSaved ? `节省 ${tokensSaved} tokens` : null,
    compactedToolCount !== null ? `${compactedToolCount} 个工具结果` : null,
    formattedTime,
  ].filter(Boolean);

  return (
    <div className="my-2 flex w-full justify-center">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <div className="inline-flex min-w-0 items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
            <Icon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="font-medium">{title}</span>
            {stats.length > 0 && (
              <span className="hidden min-w-0 truncate text-blue-700/75 dark:text-blue-200/75 sm:inline">
                {stats.join(' · ')}
              </span>
            )}
          </div>
          <div className="h-px flex-1 bg-border" />
        </div>

        {stats.length > 0 && (
          <div className="mt-1 text-center text-[11px] text-muted-foreground sm:hidden">
            {stats.join(' · ')}
          </div>
        )}

        {summary && (
          <details className="group mx-auto mt-2 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/60">
              <span>查看压缩摘要</span>
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="max-h-96 overflow-y-auto border-t border-border bg-muted/20 px-3 py-3">
              <Markdown className="prose prose-sm max-w-none dark:prose-invert">
                {summary}
              </Markdown>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
