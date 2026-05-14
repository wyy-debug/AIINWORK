import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  Download,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Shimmer,
  Tooltip,
} from '../../../../shared/view/ui';
import { usePermission } from '../../../../contexts/PermissionContext';
import { cn } from '../../../../lib/utils';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import {
  buildApprovedSubagentDispatchCommand,
  isSubagentDispatchPlanContent,
} from '../../utils/subagentDispatchPlan';

import { MarkdownContent } from './ContentRenderers';

interface PlanDisplayProps {
  title: string;
  content: string;
  defaultOpen?: boolean;
  isStreaming?: boolean;
  showRawParameters?: boolean;
  rawContent?: string;
  toolName: string;
  toolId?: string;
  provider?: string;
  sourceSessionId?: string | null;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  projectName?: string;
}

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const iconButtonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

const downloadPlanMarkdown = (title: string, content: string) => {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'plan';

  anchor.href = url;
  anchor.download = `${safeTitle}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const PlanDisplay: React.FC<PlanDisplayProps> = ({
  title,
  content,
  defaultOpen = false,
  isStreaming = false,
  showRawParameters = false,
  rawContent,
  toolName,
  provider,
  sourceSessionId,
  onFileOpen,
  projectName,
}) => {
  const permissionCtx = usePermission();

  const pendingRequest = permissionCtx?.pendingPermissionRequests.find(
    (r) => r.toolName === 'ExitPlanMode' || r.toolName === 'exit_plan_mode'
  );
  const isProposedPlan = toolName === 'proposed_plan';
  const usesPreviewLayout = isProposedPlan || Boolean(pendingRequest);
  const [submittedPlanKey, setSubmittedPlanKey] = React.useState('');
  const [isExpanded, setIsExpanded] = React.useState(() => !usesPreviewLayout && defaultOpen);
  const [planFeedback, setPlanFeedback] = React.useState<'helpful' | 'needs-work' | ''>('');
  const isSubagentDispatchPlan = isSubagentDispatchPlanContent(content);
  const proposedPlanSubmitKey = isProposedPlan && content.trim() ? `${toolName}:${content.trim()}` : '';
  const hasSubmittedProposedPlan = Boolean(proposedPlanSubmitKey && submittedPlanKey === proposedPlanSubmitKey);
  const concreteSourceSessionId = sourceSessionId && !isTemporarySessionId(sourceSessionId)
    ? sourceSessionId.trim()
    : '';
  const isWaitingForSourceSession = isProposedPlan && !concreteSourceSessionId;
  const isPrimaryActionDisabled = hasSubmittedProposedPlan || isWaitingForSourceSession;
  const isSecondaryActionDisabled = hasSubmittedProposedPlan || isWaitingForSourceSession;
  const assistantDisplayName = String(provider || '').toLowerCase() === 'codex' ? 'Codex' : 'Argus';

  React.useEffect(() => {
    setSubmittedPlanKey('');
    setPlanFeedback('');
    setIsExpanded(!usesPreviewLayout && defaultOpen);
  }, [content, defaultOpen, toolName, usesPreviewLayout]);

  const handleCopyPlan = () => {
    const planText = content.trim();
    if (!planText) return;
    void copyTextToClipboard(planText);
  };

  const handleDownloadPlan = () => {
    const planText = content.trim();
    if (!planText) return;
    downloadPlanMarkdown(title, planText);
  };

  const handleBuild = () => {
    if (pendingRequest && permissionCtx) {
      permissionCtx.handlePermissionDecision(pendingRequest.requestId, { allow: true });
      return;
    }
    if (isProposedPlan && content.trim()) {
      if (hasSubmittedProposedPlan || isWaitingForSourceSession) {
        return;
      }
      setSubmittedPlanKey(proposedPlanSubmitKey);
      window.dispatchEvent(new CustomEvent('argus-submit-chat-input', {
        detail: {
          text: isSubagentDispatchPlan
            ? buildApprovedSubagentDispatchCommand(content)
            : `PLEASE IMPLEMENT THIS PLAN:\n\n${content.trim()}`,
          subagentDispatch: isSubagentDispatchPlan,
          approvedSubagentPlan: content.trim(),
          sourceSessionId: concreteSourceSessionId || undefined,
        },
      }));
    }
  };

  const handleRevise = () => {
    if (pendingRequest && permissionCtx) {
      permissionCtx.handlePermissionDecision(pendingRequest.requestId, {
        allow: false,
        message: 'User asked to revise the plan',
      });
      return;
    }
    if (isProposedPlan && content.trim()) {
      if (isWaitingForSourceSession) {
        return;
      }
      window.dispatchEvent(new CustomEvent('argus-submit-chat-input', {
        detail: {
          permissionMode: 'plan',
          text: `Please revise this plan and keep Plan Mode active:\n\n${content.trim()}`,
          sourceSessionId: concreteSourceSessionId || undefined,
        },
      }));
    }
  };

  return (
    <div className="my-2 space-y-3">
      <Card className="relative flex flex-col overflow-hidden rounded-[14px] border-0 bg-muted/60 shadow-none dark:bg-muted/30">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-0 pt-3">
          <CardTitle className="text-sm font-semibold leading-6 text-foreground">
            {isStreaming ? <Shimmer>{title}</Shimmer> : title}
          </CardTitle>
          <div className="flex items-center gap-0.5">
            <Tooltip content="下载计划" position="top">
              <button
                type="button"
                aria-label="下载计划"
                className={iconButtonClass}
                onClick={handleDownloadPlan}
                disabled={!content.trim()}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="复制计划" position="top">
              <button
                type="button"
                aria-label="复制计划"
                className={iconButtonClass}
                onClick={handleCopyPlan}
                disabled={!content.trim()}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="计划有帮助" position="top">
              <button
                type="button"
                aria-label="计划有帮助"
                aria-pressed={planFeedback === 'helpful'}
                className={cn(iconButtonClass, planFeedback === 'helpful' && 'bg-background/80 text-foreground')}
                onClick={() => setPlanFeedback(planFeedback === 'helpful' ? '' : 'helpful')}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="计划需要调整" position="top">
              <button
                type="button"
                aria-label="计划需要调整"
                aria-pressed={planFeedback === 'needs-work'}
                className={cn(iconButtonClass, planFeedback === 'needs-work' && 'bg-background/80 text-foreground')}
                onClick={() => setPlanFeedback(planFeedback === 'needs-work' ? '' : 'needs-work')}
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={isExpanded ? '收起计划' : '展开计划'} position="top">
              <button
                type="button"
                aria-label={isExpanded ? '收起计划' : '展开计划'}
                aria-expanded={isExpanded}
                className={iconButtonClass}
                onClick={() => setIsExpanded((open) => !open)}
              >
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </Tooltip>
          </div>
        </CardHeader>

        <div className="relative">
          <CardContent
            className={cn(
              'px-4 pb-7 pt-5 transition-[max-height] duration-200 ease-out',
              usesPreviewLayout && !isExpanded && 'max-h-[350px] overflow-hidden',
            )}
          >
            {content ? (
              <MarkdownContent
                content={content}
                className="prose prose-sm max-w-none text-foreground prose-headings:font-semibold prose-headings:text-foreground prose-h1:mb-4 prose-h1:text-[26px] prose-h1:leading-tight prose-h2:mb-3 prose-h2:text-xl prose-p:leading-6 prose-li:my-1 dark:prose-invert"
                onFileOpen={onFileOpen}
                projectName={projectName}
              />
            ) : isStreaming ? (
              <div className="py-2">
                <Shimmer>Generating plan...</Shimmer>
              </div>
            ) : null}

            {showRawParameters && rawContent && (
              <Collapsible className="mt-3">
                <CollapsibleTrigger className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                  <svg
                    className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  raw params
                </CollapsibleTrigger>
                <CollapsibleContent lazy>
                  <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-words rounded border border-border/40 bg-background/80 p-2 font-mono text-[11px] text-muted-foreground">
                    {rawContent}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>

          {usesPreviewLayout && !isExpanded && content && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-muted via-muted/95 to-transparent px-4 pb-4 pt-24 dark:from-background dark:via-background/95">
              <button
                type="button"
                aria-label="展开计划"
                className="pointer-events-auto rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background shadow-sm transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setIsExpanded(true)}
              >
                展开计划
              </button>
            </div>
          )}
        </div>
      </Card>

      {(pendingRequest || isProposedPlan) && (
        <div className="rounded-[18px] border border-border/70 bg-background p-3 shadow-sm">
          <div className="mb-2 px-1 text-sm font-semibold text-foreground">实施此计划?</div>
          {isWaitingForSourceSession && (
            <div className="mb-2 rounded-lg bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
              等待会话创建完成后再实施此计划
            </div>
          )}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={handleBuild}
              disabled={isPrimaryActionDisabled}
              className="flex min-h-9 w-full items-center gap-2 rounded-lg bg-muted px-3 text-left text-sm text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="w-5 shrink-0 text-xs text-muted-foreground">1.</span>
              <span className="font-medium">
                {hasSubmittedProposedPlan
                  ? (isSubagentDispatchPlan ? '正在分派...' : '正在开始...')
                  : (isSubagentDispatchPlan ? '是，分派这些代理' : '是，实施此计划')}
              </span>
              <span className="ml-auto flex items-center gap-0.5 text-muted-foreground">
                <ArrowUp className="h-3.5 w-3.5" />
                <ArrowDown className="h-3.5 w-3.5" />
              </span>
            </button>

            <div className="flex min-h-9 flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleRevise}
                disabled={isSecondaryActionDisabled}
                className="flex min-h-9 flex-1 items-center gap-2 rounded-lg px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="w-5 shrink-0 text-xs text-muted-foreground">2.</span>
                <span>否，请告知 {assistantDisplayName} 如何调整</span>
              </button>
              <div className="flex items-center justify-end gap-2 pl-3 sm:pl-0">
                <button
                  type="button"
                  onClick={handleRevise}
                  disabled={isSecondaryActionDisabled}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  忽略
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
                </button>
                <Button
                  size="sm"
                  onClick={handleBuild}
                  disabled={isPrimaryActionDisabled}
                  className="h-8 rounded-lg px-3 text-xs font-semibold"
                >
                  提交
                  <CornerDownLeft className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
