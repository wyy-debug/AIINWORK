import { useCallback, useEffect, useState } from 'react';
import { Archive, GitBranch, Loader2, MessageSquare, RefreshCw, Trash2, X } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { Project, WorktreeDispatchMeta } from '../../../../types/app';
import { api } from '../../../../utils/api';

type WorktreeTasksModalProps = {
  project: Project;
  onClose: () => void;
  onOpenWorktree: (worktree: WorktreeDispatchMeta, openSession?: boolean) => void;
  onRefreshProjects: () => Promise<void> | void;
};

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 && data?.dirtyStatus) {
      throw new Error(
        '工作树存在未提交改动，已阻止删除。请先创建分支保留改动，或进入工作树手动提交、暂存、丢弃后再删除。',
      );
    }
    throw new Error(data?.error || data?.details || 'Request failed');
  }
  return data;
}

function shortCommit(value?: string) {
  return value ? value.slice(0, 8) : 'unknown';
}

function formatTime(value?: string) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusLabel(value?: string) {
  if (value === 'created') return '已创建';
  if (value === 'running') return '运行中';
  if (value === 'done') return '已完成';
  if (value === 'failed') return '失败';
  if (value === 'archived') return '已归档';
  return value || '未知';
}

export default function WorktreeTasksModal({
  project,
  onClose,
  onOpenWorktree,
  onRefreshProjects,
}: WorktreeTasksModalProps) {
  const [worktrees, setWorktrees] = useState<WorktreeDispatchMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const loadWorktrees = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await api.projectWorktrees(project.name);
      const data = await readJsonResponse(response);
      setWorktrees(Array.isArray(data.worktrees) ? data.worktrees : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载工作树任务失败');
      setWorktrees([]);
    } finally {
      setIsLoading(false);
    }
  }, [project.name]);

  useEffect(() => {
    void loadWorktrees();
  }, [loadWorktrees]);

  const createBranch = async (worktree: WorktreeDispatchMeta) => {
    const defaultBranch = worktree.branchName || `codex/${worktree.id.slice(0, 8)}`;
    const branchName = window.prompt('创建分支名称', defaultBranch);
    if (!branchName) return;
    setBusyId(`branch:${worktree.id}`);
    setError('');
    try {
      const response = await api.createWorktreeBranch(worktree.id, branchName);
      await readJsonResponse(response);
      await loadWorktrees();
      await onRefreshProjects();
    } catch (branchError) {
      setError(branchError instanceof Error ? branchError.message : '创建分支失败');
    } finally {
      setBusyId('');
    }
  };

  const deleteWorktree = async (worktree: WorktreeDispatchMeta) => {
    if (!window.confirm('确定删除这个 managed worktree？如果有未提交改动，后端会阻止删除；你可以先创建分支保留改动。')) {
      return;
    }
    setBusyId(`delete:${worktree.id}`);
    setError('');
    try {
      const response = await api.deleteWorktree(worktree.id);
      await readJsonResponse(response);
      await loadWorktrees();
      await onRefreshProjects();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除工作树失败');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(760px,calc(100vh-32px))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Archive className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">工作树任务</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                管理从 {project.displayName || project.name} 派发出去的 managed worktree。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadWorktrees()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载工作树任务...
            </div>
          ) : worktrees.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
              暂无派发任务。可以从项目右侧的派发按钮创建一个 managed worktree。
            </div>
          ) : (
            <div className="space-y-3">
              {worktrees.map((worktree) => (
                <div key={worktree.id} className="rounded-xl border border-border bg-background/60 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">
                          {worktree.displayName || worktree.taskPrompt || worktree.id}
                        </h3>
                        <span className={cn(
                          'rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                          worktree.status === 'archived'
                            ? 'border-muted bg-muted text-muted-foreground'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
                        )}>
                          {statusLabel(worktree.status)}
                        </span>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {worktree.branchName ? '已创建分支' : 'detached HEAD'}
                        </span>
                        {worktree.branchName && (
                          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                            {worktree.branchName}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {worktree.taskPrompt || '未填写任务说明'}
                      </p>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                        <span>父项目：{worktree.parentProjectName || project.name}</span>
                        <span>base：{worktree.baseRef || 'HEAD'} / {shortCommit(worktree.baseCommit)}</span>
                        <span>会话：{worktree.sessionId || '未绑定'}</span>
                        <span>创建时间：{formatTime(worktree.createdAt)}</span>
                        <span className="truncate md:col-span-2" title={worktree.worktreePath}>路径：{worktree.worktreePath}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenWorktree(worktree, false)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        打开
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenWorktree(worktree, true)}
                        disabled={!worktree.sessionId}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        会话
                      </button>
                      <button
                        type="button"
                        onClick={() => void createBranch(worktree)}
                        disabled={Boolean(worktree.branchName) || busyId === `branch:${worktree.id}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyId === `branch:${worktree.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
                        创建分支
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteWorktree(worktree)}
                        disabled={busyId === `delete:${worktree.id}` || worktree.status === 'archived'}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        {busyId === `delete:${worktree.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
