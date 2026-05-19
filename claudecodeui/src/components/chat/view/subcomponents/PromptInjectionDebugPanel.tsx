import { useMemo, useState } from 'react';
import {
  BugIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardIcon,
} from 'lucide-react';

import type { PromptInjectionDebugPayload } from '../../types/types';
import { cn } from '../../../../lib/utils';

type PromptInjectionDebugPanelProps = {
  payload: PromptInjectionDebugPayload | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function formatBoolean(value: unknown) {
  return typeof value === 'boolean' ? (value ? 'true' : 'false') : 'n/a';
}

function formatText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'n/a';
}

function DebugField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function DebugTextBlock({
  title,
  value,
  emptyText,
  maxHeightClass = 'max-h-[30vh] lg:max-h-[calc((100vh-430px)/2)]',
}: {
  title: string;
  value: string;
  emptyText: string;
  maxHeightClass?: string;
}) {
  const hasValue = value.trim().length > 0;
  return (
    <section className="mt-3 min-h-0 rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
        {title}
      </div>
      {hasValue ? (
        <pre className={cn(
          'overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground',
          maxHeightClass,
        )}
        >
          {value}
        </pre>
      ) : (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </section>
  );
}

export default function PromptInjectionDebugPanel({
  payload,
  collapsed,
  onToggleCollapsed,
}: PromptInjectionDebugPanelProps) {
  const [copied, setCopied] = useState(false);
  const appendSystemPrompt = payload?.appendSystemPrompt || '';
  const nativeSystemPrompt = payload?.nativeSystemPrompt || '';
  const originalCommand = payload?.originalCommand || '';
  const effectiveCommand = payload?.effectiveCommand || '';
  const hasPrompt = appendSystemPrompt.trim().length > 0;
  const hasEffectiveCommand = effectiveCommand.trim().length > 0;
  const promptLength = payload?.appendSystemPromptLength ?? appendSystemPrompt.length;
  const nativeSystemPromptLength = payload?.nativeSystemPromptLength ?? nativeSystemPrompt.length;
  const effectiveCommandLength = payload?.effectiveCommandLength ?? effectiveCommand.length;
  const argusInternal = payload?.argusInternal;
  const copyValue = effectiveCommand || appendSystemPrompt;
  const hasCopyValue = copyValue.trim().length > 0;
  const summary = useMemo(() => {
    if (!payload) {
      return 'Waiting for next Claude run';
    }
    if (payload.commandChanged && hasEffectiveCommand) {
      return `Command changed · ${effectiveCommandLength.toLocaleString()} chars`;
    }
    if (hasEffectiveCommand) {
      return `Command captured · ${effectiveCommandLength.toLocaleString()} chars`;
    }
    if (!hasPrompt) {
      return 'No appendSystemPrompt for this run';
    }
    return `appendSystemPrompt · ${promptLength.toLocaleString()} chars`;
  }, [effectiveCommandLength, hasEffectiveCommand, hasPrompt, payload, promptLength]);

  const handleCopy = async () => {
    if (!copyValue || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(copyValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <aside className="shrink-0 border-t border-border bg-background/95 lg:h-full lg:w-[380px] lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BugIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">Prompt Debug</h2>
            <p className="truncate text-xs text-muted-foreground">{summary}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!hasCopyValue}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
              hasCopyValue ? 'hover:bg-muted hover:text-foreground' : 'cursor-not-allowed opacity-45',
            )}
            title={hasEffectiveCommand ? 'Copy command sent to Claude' : 'Copy appendSystemPrompt'}
          >
            {copied ? <CheckIcon className="h-4 w-4 text-emerald-500" /> : <ClipboardIcon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={collapsed ? 'Expand prompt debug' : 'Collapse prompt debug'}
          >
            {collapsed ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-[42vh] overflow-y-auto p-3 lg:max-h-none lg:h-[calc(100%-58px)]">
          <div className="grid grid-cols-2 gap-2">
            <DebugField label="permission" value={formatText(payload?.permissionMode)} />
            <DebugField label="length" value={promptLength.toLocaleString()} />
            <DebugField label="plan mode" value={formatBoolean(payload?.codexStylePlanMode)} />
            <DebugField label="native memory" value={formatBoolean(payload?.claudeNativeMemoryEnabled)} />
            <DebugField label="auto memory" value={formatBoolean(payload?.autoMemoryExtractionEnabled)} />
            <DebugField label="bare env" value={formatBoolean(payload?.bareMode)} />
            <DebugField label="--bare" value={formatBoolean(payload?.cli?.hasBareFlag)} />
            <DebugField label="--append" value={formatBoolean(payload?.cli?.hasAppendSystemPromptFlag)} />
            <DebugField label="cmd changed" value={formatBoolean(payload?.commandChanged)} />
            <DebugField label="cmd length" value={effectiveCommandLength.toLocaleString()} />
            <DebugField label="native sys" value={nativeSystemPromptLength.toLocaleString()} />
            <DebugField label="hidden fallback" value={formatBoolean(argusInternal?.hiddenFallbackInjected)} />
            <DebugField label="preflight" value={formatBoolean(argusInternal?.preflightInjected)} />
            <DebugField label="preflight ok" value={formatBoolean(argusInternal?.preflightOk)} />
            <DebugField label="preflight sections" value={(argusInternal?.preflightSectionCount ?? 0).toLocaleString()} />
          </div>

          <DebugTextBlock
            title="Command sent to Claude"
            value={effectiveCommand}
            emptyText="No command payload was captured for this run."
          />

          <DebugTextBlock
            title="Original user command"
            value={originalCommand}
            emptyText="No original user command was captured for this run."
          />

          <DebugTextBlock
            title="appendSystemPrompt"
            value={appendSystemPrompt}
            emptyText="No appendSystemPrompt was injected for this run."
            maxHeightClass="max-h-[34vh] lg:max-h-[calc(100vh-520px)]"
          />

          <DebugTextBlock
            title="Native Claude Code system prompt"
            value={nativeSystemPrompt}
            emptyText="No native system prompt was captured for this run."
            maxHeightClass="max-h-[34vh] lg:max-h-[calc(100vh-520px)]"
          />
        </div>
      )}
    </aside>
  );
}
