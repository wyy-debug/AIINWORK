import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clipboard,
  ExternalLink,
  FileDiff,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';

import { api, apiFetch } from '../../../utils/api';
import type { Project } from '../../../types/app';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Input, ScrollArea } from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';

type GitStatus = {
  branch?: string;
  hasCommits?: boolean;
  files?: Array<{
    path: string;
    kind: ReviewFileKind;
    status: string;
    staged?: boolean;
    unstaged?: boolean;
  }>;
  modified?: string[];
  added?: string[];
  deleted?: string[];
  untracked?: string[];
  error?: string;
  details?: string;
};

type ReviewFileKind = 'modified' | 'added' | 'deleted' | 'untracked';

type ReviewFile = {
  path: string;
  kind: ReviewFileKind;
  status?: string;
  staged?: boolean;
  unstaged?: boolean;
};

type ReviewComment = {
  id: string;
  filePath: string;
  lineNumber?: number | null;
  body: string;
  source: string;
  status: 'open' | 'closed';
  createdAt: string;
};

type ReviewPanelProps = {
  selectedProject: Project;
};

const FILE_KIND_META: Record<ReviewFileKind, { label: string; shortLabel: string; className: string }> = {
  modified: {
    label: 'Modified',
    shortLabel: 'M',
    className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  },
  added: {
    label: 'Added',
    shortLabel: 'A',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  },
  deleted: {
    label: 'Deleted',
    shortLabel: 'D',
    className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
  },
  untracked: {
    label: 'Untracked',
    shortLabel: 'U',
    className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
  },
};

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const parseJsonResponse = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();

  if (!response.ok || data?.error) {
    throw new Error(data?.details || data?.error || `Request failed with HTTP ${response.status}`);
  }

  return data as T;
};

const getChangedFiles = (status: GitStatus | null): ReviewFile[] => {
  if (!status) {
    return [];
  }

  if (Array.isArray(status.files)) {
    return status.files
      .map((file) => ({
        path: file.path,
        kind: file.kind,
        status: file.status,
        staged: file.staged,
        unstaged: file.unstaged,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  const seen = new Map<string, ReviewFile>();
  const append = (paths: string[], kind: ReviewFileKind) => {
    paths.forEach((filePath) => {
      if (!seen.has(filePath)) {
        seen.set(filePath, { path: filePath, kind });
      }
    });
  };

  append(asStringArray(status.modified), 'modified');
  append(asStringArray(status.added), 'added');
  append(asStringArray(status.deleted), 'deleted');
  append(asStringArray(status.untracked), 'untracked');

  return Array.from(seen.values()).sort((left, right) => left.path.localeCompare(right.path));
};

const getDiffHunks = (diff: string) => {
  const lines = diff.split('\n');
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunkIndex < 0) {
    return [];
  }
  const header = lines.slice(0, firstHunkIndex);
  const hunks: Array<{ index: number; title: string; patch: string }> = [];
  let current: string[] = [];

  for (let index = firstHunkIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('@@') && current.length > 0) {
      hunks.push({
        index: hunks.length,
        title: current[0],
        patch: [...header, ...current].join('\n') + '\n',
      });
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    hunks.push({
      index: hunks.length,
      title: current[0],
      patch: [...header, ...current].join('\n') + '\n',
    });
  }

  return hunks;
};

const getDiffLineClassName = (line: string) => {
  if (line.startsWith('@@')) {
    return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
  }
  if (line.startsWith('+')) {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200';
  }
  if (line.startsWith('-')) {
    return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200';
  }
  return 'text-foreground';
};

const getRenderedDiffRows = (diff: string) => {
  if (!diff) {
    return [];
  }

  let oldLine = 0;
  let newLine = 0;

  return diff.split('\n').map((line, index) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      return { index, line, lineNumber: null as number | null };
    }

    if (line.startsWith('-')) {
      const lineNumber = oldLine;
      oldLine += 1;
      return { index, line, lineNumber };
    }

    if (line.startsWith('+')) {
      const lineNumber = newLine;
      newLine += 1;
      return { index, line, lineNumber };
    }

    const lineNumber = newLine || oldLine || null;
    if (oldLine) oldLine += 1;
    if (newLine) newLine += 1;
    return { index, line, lineNumber };
  });
};

export default function ReviewPanel({ selectedProject }: ReviewPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [diff, setDiff] = useState('');
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [diffError, setDiffError] = useState('');
  const [actionBusy, setActionBusy] = useState<'stage' | 'unstage' | 'discard' | null>(null);
  const [hunkBusy, setHunkBusy] = useState('');
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentStatus, setCommentStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [commentBody, setCommentBody] = useState('');
  const [commentLine, setCommentLine] = useState('');
	  const [feedbackText, setFeedbackText] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');

  const changedFiles = useMemo(() => getChangedFiles(status), [status]);
  const selectedFile = changedFiles.find((file) => file.path === selectedFilePath) || null;
  const diffRows = useMemo(() => getRenderedDiffRows(diff), [diff]);
  const diffHunks = useMemo(() => getDiffHunks(diff), [diff]);
	  const stagedFiles = useMemo(() => changedFiles.filter((file) => file.staged), [changedFiles]);
	  const unstagedFiles = useMemo(() => changedFiles.filter((file) => file.unstaged || !file.staged), [changedFiles]);
  const commentsByLine = useMemo(() => {
    const map = new Map<number, ReviewComment[]>();
    comments
      .filter((comment) => comment.filePath === selectedFile?.path && comment.lineNumber)
      .forEach((comment) => {
        const line = Number(comment.lineNumber);
        map.set(line, [...(map.get(line) || []), comment]);
      });
    return map;
  }, [comments, selectedFile?.path]);

  const loadStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    setStatusError('');

    try {
      const response = await apiFetch(`/api/git/status?project=${encodeURIComponent(selectedProject.name)}`);
      const data = await parseJsonResponse<GitStatus>(response);
      setStatus(data);
    } catch (error) {
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : 'Failed to load review state');
    } finally {
      setIsLoadingStatus(false);
    }
  }, [selectedProject.name]);

  const loadComments = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        project: selectedProject.name,
        status: commentStatus,
      });
      const response = await apiFetch(`/api/git/comments?${params.toString()}`);
      const data = await parseJsonResponse<{ comments?: ReviewComment[] }>(response);
      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (error) {
      console.warn('Failed to load review comments:', error);
      setComments([]);
    }
  }, [commentStatus, selectedProject.name]);

  const loadDiff = useCallback(async () => {
    if (!selectedFile) {
      setDiff('');
      setDiffError('');
      return;
    }

    setIsLoadingDiff(true);
    setDiffError('');

    try {
      const params = new URLSearchParams({
        project: selectedProject.name,
        file: selectedFile.path,
        full: 'true',
      });
      const response = await apiFetch(`/api/git/diff?${params.toString()}`);
      const data = await parseJsonResponse<{ diff?: string }>(response);
      setDiff(data.diff || '');
    } catch (error) {
      setDiff('');
      setDiffError(error instanceof Error ? error.message : 'Failed to load file diff');
    } finally {
      setIsLoadingDiff(false);
    }
  }, [selectedFile, selectedProject.name]);

  useEffect(() => {
    setStatus(null);
    setSelectedFilePath('');
    setDiff('');
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  useEffect(() => {
    if (changedFiles.length === 0) {
      setSelectedFilePath('');
      return;
    }

    if (!selectedFilePath || !changedFiles.some((file) => file.path === selectedFilePath)) {
      setSelectedFilePath(changedFiles[0].path);
    }
  }, [changedFiles, selectedFilePath]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

	  const runFileAction = useCallback(
    async (action: 'stage' | 'unstage' | 'discard') => {
      if (!selectedFile) {
        return;
      }

      if (action === 'discard') {
        const confirmed = window.confirm(`Discard local changes in ${selectedFile.path}?`);
        if (!confirmed) {
          return;
        }
      }

      setActionBusy(action);
      setStatusError('');
      setDiffError('');

      try {
        const response = await apiFetch(`/api/git/${action}`, {
          method: 'POST',
          body: JSON.stringify({
            project: selectedProject.name,
            file: selectedFile.path,
          }),
        });
        await parseJsonResponse<{ success?: boolean }>(response);
        window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
        await loadStatus();
        await loadDiff();
      } catch (error) {
        setStatusError(error instanceof Error ? error.message : `Failed to ${action} file`);
      } finally {
        setActionBusy(null);
      }
    },
    [loadDiff, loadStatus, selectedFile, selectedProject.name],
	  );

  const runBulkAction = useCallback(
    async (action: 'stage-all' | 'unstage-all' | 'discard-all') => {
      if (action === 'discard-all' && !window.confirm('Discard every local change and remove untracked files?')) {
        return;
      }
      setActionBusy(action === 'stage-all' ? 'stage' : action === 'unstage-all' ? 'unstage' : 'discard');
      setStatusError('');
      setReviewMessage('');
      try {
        const response = await apiFetch(`/api/git/${action}`, {
          method: 'POST',
          body: JSON.stringify({ project: selectedProject.name }),
        });
        const data = await parseJsonResponse<{ output?: string }>(response);
        setReviewMessage(data.output || 'Review action completed.');
        window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
        await loadStatus();
        await loadDiff();
      } catch (error) {
        setStatusError(error instanceof Error ? error.message : `Failed to run ${action}`);
      } finally {
        setActionBusy(null);
      }
    },
    [loadDiff, loadStatus, selectedProject.name],
  );

  const runHunkAction = useCallback(
    async (action: 'stage' | 'unstage' | 'discard', hunkIndex: number, patch: string) => {
      if (!selectedFile) {
        return;
      }
      if (action === 'discard' && !window.confirm(`Discard hunk ${hunkIndex + 1} in ${selectedFile.path}?`)) {
        return;
      }

      setHunkBusy(`${action}:${hunkIndex}`);
      setStatusError('');
      try {
        const response = await apiFetch('/api/git/hunk-action', {
          method: 'POST',
          body: JSON.stringify({
            project: selectedProject.name,
            file: selectedFile.path,
            action,
            patch,
          }),
        });
        await parseJsonResponse<{ success?: boolean }>(response);
        window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
        await loadStatus();
        await loadDiff();
      } catch (error) {
        setStatusError(error instanceof Error ? error.message : `Failed to ${action} hunk`);
      } finally {
        setHunkBusy('');
      }
    },
    [loadDiff, loadStatus, selectedFile, selectedProject.name],
  );

  const saveComment = async () => {
    if (!commentBody.trim()) {
      return;
    }
    const lineNumber = Number.parseInt(commentLine, 10);
    await parseJsonResponse(await apiFetch('/api/git/comments', {
      method: 'POST',
      body: JSON.stringify({
        project: selectedProject.name,
        filePath: selectedFile?.path || '',
        lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
        body: commentBody,
        source: 'local',
      }),
    }));
    setCommentBody('');
    setCommentLine('');
    await loadComments();
  };

  const updateCommentStatus = async (comment: ReviewComment, statusValue: 'open' | 'closed') => {
    await parseJsonResponse(await apiFetch(`/api/git/comments/${encodeURIComponent(comment.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: statusValue }),
    }));
    await loadComments();
  };

  const importFeedback = async () => {
    if (!feedbackText.trim()) {
      return;
    }
    await parseJsonResponse(await apiFetch('/api/git/feedback', {
      method: 'POST',
      body: JSON.stringify({
        project: selectedProject.name,
        text: feedbackText,
      }),
    }));
    setFeedbackText('');
    await loadComments();
  };

	  const saveNotesArtifact = async () => {
    const content = comments.map((comment) => {
      const location = comment.filePath ? `${comment.filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ''}` : 'Project';
      return `- [${comment.status}/${comment.source}] ${location}\n  ${comment.body}`;
    }).join('\n\n');
    if (!content.trim()) {
      return;
    }
    await parseJsonResponse(await apiFetch('/api/artifacts', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'review-notes',
        title: `Review notes for ${selectedProject.displayName || selectedProject.name}`,
        projectName: selectedProject.name,
        content,
      }),
    }));
    window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
	  };

  const copyReviewSummary = async (appendToChat = false) => {
    const params = new URLSearchParams({ project: selectedProject.name });
    const data = await parseJsonResponse<{ content: string }>(await apiFetch(`/api/git/review-summary?${params.toString()}`));
    await navigator.clipboard?.writeText(data.content);
    setReviewMessage(appendToChat ? 'Review summary copied and sent to chat context.' : 'Review summary copied.');
    if (appendToChat) {
      window.dispatchEvent(new CustomEvent('argus-attach-context', {
        detail: { source: 'changes', text: data.content },
      }));
      window.dispatchEvent(new CustomEvent('argus-append-chat-input', {
        detail: { text: `Please address this review:\n\n${data.content}` },
      }));
    }
  };

  const openSelectedFile = async () => {
    if (!selectedFile) return;
    const openFile = api.openLocalToolFile as (payload: {
      tool?: string;
      filePath: string;
      projectName?: string;
      line?: number;
    }) => Promise<Response>;
    await openFile({
      tool: 'vscode',
      filePath: selectedFile.path,
      projectName: selectedProject.name,
      line: Number.parseInt(commentLine, 10) || undefined,
    });
  };

  const totalChanges = changedFiles.length;
  const branchName = status?.branch || 'unknown';

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-[64px] items-center justify-between gap-3 border-b border-border/70 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileDiff className="h-4 w-4" />
            <span>Changes</span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-foreground">Local changes</h2>
            <Badge variant="outline" className="shrink-0">
              {totalChanges}
            </Badge>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden max-w-[220px] items-center gap-1.5 truncate rounded-md border border-border/70 px-2.5 py-1.5 text-sm text-muted-foreground md:flex">
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{branchName}</span>
          </div>
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={isLoadingStatus}>
            <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

	          {statusError && (
        <div className="border-b border-border/70 px-5 py-3">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Review unavailable</AlertTitle>
            <AlertDescription>{statusError}</AlertDescription>
          </Alert>
        </div>
	      )}

      {reviewMessage && (
        <div className="border-b border-border/70 px-5 py-2 text-sm text-muted-foreground">
          {reviewMessage}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border/70 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
	            <span className="text-sm font-medium text-foreground">Files</span>
	            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => runBulkAction('stage-all')} disabled={totalChanges === 0 || actionBusy !== null}>
                Stage all
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => runBulkAction('unstage-all')} disabled={stagedFiles.length === 0 || actionBusy !== null}>
                Unstage all
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => runBulkAction('discard-all')} disabled={totalChanges === 0 || actionBusy !== null}>
                Discard all
              </Button>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {isLoadingStatus && !status ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Loading changes...</div>
            ) : changedFiles.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted-foreground">No local changes in this project.</div>
            ) : (
              <div className="space-y-4 p-2">
                {[
                  ['Staged', stagedFiles],
                  ['Unstaged', unstagedFiles],
                ].map(([label, files]) => (
                  <div key={label as string} className="space-y-1">
                    <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {label as string} {(files as ReviewFile[]).length}
                    </div>
                    {(files as ReviewFile[]).length === 0 ? (
                      <div className="px-2 py-1 text-xs text-muted-foreground/70">None</div>
                    ) : (files as ReviewFile[]).map((file) => {
                      const meta = FILE_KIND_META[file.kind];
                      const isSelected = file.path === selectedFilePath;

                      return (
                        <button
                          key={`${label}:${file.kind}:${file.path}`}
                          type="button"
                          onClick={() => setSelectedFilePath(file.path)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                            isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/60',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-semibold',
                              meta.className,
                            )}
                          >
                            {meta.shortLabel}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{file.path}</span>
                          <span className="text-[10px] text-muted-foreground">{file.status}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {selectedFile?.path || 'No file selected'}
              </div>
              {selectedFile && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {FILE_KIND_META[selectedFile.kind].label}
                </div>
              )}
            </div>

	            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={openSelectedFile} disabled={!selectedFile}>
                <ExternalLink className="h-4 w-4" />
                Open
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyReviewSummary(false)} disabled={totalChanges === 0 && comments.length === 0}>
                <Clipboard className="h-4 w-4" />
                Copy summary
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyReviewSummary(true)} disabled={totalChanges === 0 && comments.length === 0}>
                Ask Argus
              </Button>
	              <Button
                variant="outline"
                size="sm"
                onClick={() => runFileAction('stage')}
                disabled={!selectedFile || actionBusy !== null}
              >
                <Plus className="h-4 w-4" />
                Stage
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runFileAction('unstage')}
                disabled={!selectedFile || selectedFile.kind === 'untracked' || actionBusy !== null}
              >
                <Minus className="h-4 w-4" />
                Unstage
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runFileAction('discard')}
                disabled={!selectedFile || actionBusy !== null}
              >
                <RotateCcw className="h-4 w-4" />
                Discard
              </Button>
            </div>
          </div>

          {selectedFile && diffHunks.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-b border-border/70 px-4 py-2">
              {diffHunks.map((hunk) => {
                const canApplyHunk = diff.includes('diff --git');
                const primaryAction = selectedFile.staged && !selectedFile.unstaged ? 'unstage' : 'stage';
                return (
                  <div key={hunk.index} className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1">
                    <span className="max-w-52 truncate text-xs text-muted-foreground">{hunk.title}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!canApplyHunk || Boolean(hunkBusy)}
                      onClick={() => runHunkAction(primaryAction, hunk.index, hunk.patch)}
                    >
                      {primaryAction === 'stage' ? 'Stage hunk' : 'Unstage hunk'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!canApplyHunk || Boolean(hunkBusy)}
                      onClick={() => runHunkAction('discard', hunk.index, hunk.patch)}
                    >
                      Discard
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {diffError && (
            <div className="border-b border-border/70 px-4 py-3">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Diff unavailable</AlertTitle>
                <AlertDescription>{diffError}</AlertDescription>
              </Alert>
            </div>
          )}

          <ScrollArea className="min-h-0 flex-1 bg-muted/20">
            {!selectedFile ? (
              <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  Working tree is clean.
                </div>
              </div>
            ) : isLoadingDiff ? (
              <div className="p-4 text-sm text-muted-foreground">Loading diff...</div>
            ) : diffRows.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No diff to display for this file.</div>
            ) : (
              <pre className="min-w-full p-0 font-mono text-xs leading-5">
	                {diffRows.map((row) => {
                    const inlineComments = row.lineNumber ? commentsByLine.get(row.lineNumber) || [] : [];
                    return (
                      <Fragment key={`${row.index}:${row.line}`}>
                        <div
                          role="button"
                          tabIndex={0}
                          title={row.lineNumber ? `Add note on line ${row.lineNumber}` : undefined}
                          onClick={() => {
                            if (row.lineNumber) {
                              setCommentLine(String(row.lineNumber));
                            }
                          }}
                          onKeyDown={(event) => {
                            if ((event.key === 'Enter' || event.key === ' ') && row.lineNumber) {
                              setCommentLine(String(row.lineNumber));
                            }
                          }}
                          className={cn(
                            'group grid grid-cols-[4rem_minmax(0,1fr)] border-b border-border/40',
                            row.lineNumber && 'cursor-pointer hover:bg-primary/10',
                            getDiffLineClassName(row.line),
                          )}
                        >
                          <span className="flex select-none items-center justify-end gap-1 border-r border-border/50 px-2 py-0.5 text-right text-muted-foreground">
                            {row.lineNumber && (
                              <button
                                type="button"
                                className="hidden h-4 w-4 items-center justify-center rounded bg-primary text-[10px] text-primary-foreground group-hover:flex"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setCommentLine(String(row.lineNumber));
                                }}
                              >
                                +
                              </button>
                            )}
                            {row.lineNumber || ''}
                          </span>
                          <span className="whitespace-pre-wrap break-words px-3 py-0.5">{row.line || ' '}</span>
                        </div>
                        {inlineComments.map((comment) => (
                          <div key={comment.id} className="border-b border-border/40 bg-primary/5 px-4 py-2 text-xs text-foreground">
                            <span className="font-medium">{comment.source}</span>: {comment.body}
                          </div>
                        ))}
                      </Fragment>
                    );
                  })}
              </pre>
            )}
          </ScrollArea>

          <div className="grid max-h-72 grid-cols-1 border-t border-border/70 bg-background md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
            <div className="min-h-0 border-b border-border/70 p-3 md:border-b-0 md:border-r">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Review notes</span>
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
                    value={commentStatus}
                    onChange={(event) => setCommentStatus(event.target.value as 'open' | 'closed' | 'all')}
                  >
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="all">All</option>
                  </select>
                  <Button variant="outline" size="sm" onClick={saveNotesArtifact} disabled={comments.length === 0}>
                    Save artifact
                  </Button>
                </div>
              </div>
              <div className="max-h-40 space-y-2 overflow-auto pr-1">
                {comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No local review notes yet.</p>
                ) : comments.map((comment) => (
                  <div key={comment.id} className="rounded-md border border-border/70 px-2.5 py-2 text-sm">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {comment.filePath || 'Project'}{comment.lineNumber ? `:${comment.lineNumber}` : ''}
                      </span>
                      <span>{comment.status}/{comment.source}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-foreground">{comment.body}</div>
                    <Button
                      className="mt-2 h-7 px-2 text-xs"
                      variant="outline"
                      size="sm"
                      onClick={() => updateCommentStatus(comment, comment.status === 'closed' ? 'open' : 'closed')}
                    >
                      {comment.status === 'closed' ? 'Reopen' : 'Close'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                <Input
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Line comment..."
                />
                <Input
                  value={commentLine}
                  onChange={(event) => setCommentLine(event.target.value)}
                  placeholder="Line"
                />
              </div>
              <Button size="sm" onClick={saveComment} disabled={!commentBody.trim()}>
                Add note
              </Button>
              <textarea
                className="h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
                placeholder="Paste PR feedback here..."
              />
              <Button size="sm" variant="outline" onClick={importFeedback} disabled={!feedbackText.trim()}>
                Import feedback
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
