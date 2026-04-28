import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitBranch, Loader2, Trash2 } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import { api } from '../../../../utils/api';

type WorktreeProjectBadgeProps = {
  project: Project;
};

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Request failed');
  }
  return data;
}

export default function WorktreeProjectBadge({ project }: WorktreeProjectBadgeProps) {
  const worktree = project.worktree;
  const worktreeId = worktree?.id || '';
  const storedBranchName = worktree?.branchName || '';
  const [isBranchPanelOpen, setIsBranchPanelOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [currentBranchName, setCurrentBranchName] = useState(storedBranchName);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setCurrentBranchName(storedBranchName);
    setBranchName(worktreeId ? `codex/${worktreeId.slice(0, 8)}` : '');
    setError('');
    setIsBranchPanelOpen(false);
  }, [storedBranchName, worktreeId]);

  const baseCommit = useMemo(
    () => worktree?.baseCommit ? worktree.baseCommit.slice(0, 8) : '',
    [worktree?.baseCommit],
  );

  if (!worktree) {
    return null;
  }

  const handleCreateBranch = async () => {
    if (isCreatingBranch) return;
    setIsCreatingBranch(true);
    setError('');
    try {
      const response = await api.createWorktreeBranch(worktree.id, branchName);
      const data = await readJsonResponse(response);
      setCurrentBranchName(data?.branchName || branchName);
      setIsBranchPanelOpen(false);
      await window.refreshProjects?.();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建分支失败');
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    const confirmed = window.confirm('删除这个 managed worktree？有未提交改动时会被后端阻止。');
    if (!confirmed) return;
    setIsDeleting(true);
    setError('');
    try {
      const response = await api.deleteWorktree(worktree.id);
      await readJsonResponse(response);
      await window.refreshProjects?.();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 worktree 失败');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="relative mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Worktree</span>
      </span>
      <span className="inline-flex max-w-[220px] items-center rounded-full border border-border bg-muted/40 px-2 py-1 text-muted-foreground" title={worktree.parentProjectPath}>
        父项目: {worktree.parentProjectPath}
      </span>
      <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-1 text-muted-foreground">
        {currentBranchName ? `branch ${currentBranchName}` : 'detached HEAD'}
      </span>
      {baseCommit && (
        <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-1 font-mono text-muted-foreground">
          {worktree.baseRef}@{baseCommit}
        </span>
      )}
      {!currentBranchName && (
        <button
          type="button"
          onClick={() => setIsBranchPanelOpen((previous) => !previous)}
          className="bg-primary/8 hover:bg-primary/12 inline-flex h-7 items-center rounded-full border border-primary/25 px-2.5 font-medium text-primary transition-colors"
        >
          创建分支
        </button>
      )}
      {worktree.mode === 'managed' && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        >
          {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          删除
        </button>
      )}

      {isBranchPanelOpen && (
        <div className="absolute left-0 top-9 z-30 w-[min(360px,calc(100vw-32px))] rounded-xl border border-border bg-card p-3 shadow-xl">
          <label className="grid gap-2">
            <span className="text-xs font-medium text-foreground">分支名</span>
            <input
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsBranchPanelOpen(false)}
              className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreateBranch}
              disabled={isCreatingBranch || !branchName.trim()}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-60"
            >
              {isCreatingBranch && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              创建
            </button>
          </div>
        </div>
      )}

      {error && (
        <span className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
        )}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </span>
      )}
    </div>
  );
}
