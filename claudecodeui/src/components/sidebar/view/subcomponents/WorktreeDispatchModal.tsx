import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Check, GitBranch, Loader2, Sparkles, X } from 'lucide-react';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import type { AgentConfig, InstalledSkill } from '../../../../types/agent';
import { api } from '../../../../utils/api';

type WorktreeDispatchModalProps = {
  project: Project;
  onClose: () => void;
  onCreated: (project: Project, shouldCreateSession: boolean) => void;
};

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Request failed');
  }
  return data;
}

export default function WorktreeDispatchModal({
  project,
  onClose,
  onCreated,
}: WorktreeDispatchModalProps) {
  const [taskPrompt, setTaskPrompt] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [createSession, setCreateSession] = useState(true);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [parentGitState, setParentGitState] = useState<{
    isGit: boolean;
    isDirty: boolean;
    branch?: string;
    message?: string;
  } | null>(null);
  const [isLoadingChoices, setIsLoadingChoices] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadChoices() {
      setIsLoadingChoices(true);
      setError('');
      try {
        const [agentsResponse, skillsResponse, gitStatusResponse] = await Promise.all([
          api.agents(false),
          api.installedAgentSkills(project.fullPath || project.path || ''),
          api.get(`/git/status?project=${encodeURIComponent(project.name)}`),
        ]);
        const [agentsData, skillsData, gitStatusData] = await Promise.all([
          readJsonResponse(agentsResponse),
          readJsonResponse(skillsResponse),
          gitStatusResponse.json().catch(() => ({})),
        ]);
        if (!cancelled) {
          setAgents(Array.isArray(agentsData?.agents) ? agentsData.agents : []);
          setSkills(Array.isArray(skillsData?.skills) ? skillsData.skills : []);
          if (gitStatusData?.error) {
            setParentGitState({
              isGit: false,
              isDirty: false,
              message: gitStatusData.details || gitStatusData.error,
            });
          } else {
            const dirtyCount = [
              ...(Array.isArray(gitStatusData?.modified) ? gitStatusData.modified : []),
              ...(Array.isArray(gitStatusData?.added) ? gitStatusData.added : []),
              ...(Array.isArray(gitStatusData?.deleted) ? gitStatusData.deleted : []),
              ...(Array.isArray(gitStatusData?.untracked) ? gitStatusData.untracked : []),
            ].length;
            setParentGitState({
              isGit: true,
              isDirty: dirtyCount > 0,
              branch: typeof gitStatusData?.branch === 'string' ? gitStatusData.branch : '',
              message: dirtyCount > 0 ? `${dirtyCount} 个未提交改动；worktree 仍会基于 HEAD 创建，不复制这些改动。` : '',
            });
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载 Agent / Skill 失败');
          setAgents([]);
          setSkills([]);
          setParentGitState(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingChoices(false);
        }
      }
    }

    void loadChoices();
    return () => {
      cancelled = true;
    };
  }, [project.fullPath, project.name, project.path]);

  const enabledAgents = useMemo(
    () => agents.filter((agent) => agent.status === 'enabled'),
    [agents],
  );

  const selectedAgent = enabledAgents.find((agent) => agent.id === selectedAgentId) || null;

  const toggleSkill = (skillName: string) => {
    setSelectedSkills((previous) => {
      const normalized = skillName.trim();
      const exists = previous.some((name) => name.toLowerCase() === normalized.toLowerCase());
      if (exists) {
        return previous.filter((name) => name.toLowerCase() !== normalized.toLowerCase());
      }
      return [...previous, normalized].slice(0, 60);
    });
  };

  const handleCreate = async () => {
    if (isCreating) return;
    if (parentGitState && !parentGitState.isGit) {
      setError(parentGitState.message || '当前项目不是 Git 仓库，不能派发 worktree。');
      return;
    }
    setIsCreating(true);
    setError('');
    try {
      const response = await api.createProjectWorktree(project.name, {
        taskPrompt,
        baseRef,
        agentId: selectedAgent?.id || '',
        appBindings: selectedAgent?.appBindings || [],
        skills: selectedSkills,
        provider: 'claude',
        createSession,
      });
      const data = await readJsonResponse(response);
      onCreated(data.project as Project, createSession);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建 worktree 失败');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <GitBranch className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">派发工作树</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                从当前 Git HEAD 创建 detached worktree，主项目保持干净。
              </p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80" title={project.fullPath || project.path}>
                {project.displayName} · {project.fullPath || project.path}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {parentGitState && (
            <div className={cn(
              'mb-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm',
              !parentGitState.isGit
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                : parentGitState.isDirty
                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
            )}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {!parentGitState.isGit
                  ? parentGitState.message || '当前项目不是 Git 仓库，不能派发 worktree。'
                  : parentGitState.isDirty
                    ? parentGitState.message
                    : `Git 状态干净${parentGitState.branch ? `，当前分支 ${parentGitState.branch}` : ''}。`}
              </span>
            </div>
          )}

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">任务说明</span>
              <textarea
                value={taskPrompt}
                onChange={(event) => setTaskPrompt(event.target.value)}
                className="min-h-[120px] resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
                placeholder="描述要派发给这个 worktree 的任务。创建后会预填到新会话输入框。"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-foreground">Base ref</span>
                <input
                  value={baseRef}
                  onChange={(event) => setBaseRef(event.target.value)}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
                  placeholder="留空使用当前分支 HEAD"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium text-foreground">Agent</span>
                <select
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  disabled={isLoadingChoices}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-primary/10 disabled:opacity-60"
                >
                  <option value="">默认 MTL-Code</option>
                  {enabledAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.shortName || agent.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedAgent && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Bot className="h-4 w-4" />
                  {selectedAgent.name}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  会沿用该 Agent 已配置的 MCP / 应用槽位，并保存到 worktree 会话绑定。
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Skill</span>
                <span className="text-xs text-muted-foreground">
                  {isLoadingChoices ? '加载中' : `${skills.length} 个已安装`}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-background p-2">
                {isLoadingChoices ? (
                  <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    加载 Skill
                  </div>
                ) : skills.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">暂无可绑定 Skill</div>
                ) : (
                  <div className="grid gap-1">
                    {skills.map((skill) => {
                      const selected = selectedSkills.some((name) => name.toLowerCase() === skill.name.toLowerCase());
                      return (
                        <button
                          key={`${skill.provider}:${skill.scope}:${skill.name}`}
                          type="button"
                          onClick={() => toggleSkill(skill.name)}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                            selected ? 'bg-primary/8 text-primary' : 'hover:bg-muted/70',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary',
                            )}>
                              {selected ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{skill.title || skill.name}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {skill.provider} / {skill.scope}
                              </span>
                            </span>
                          </span>
                          <span className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
                            skill.callable
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
                          )}>
                            {skill.callable ? '已可调用' : '不可用'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/25 px-3 py-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={createSession}
                onChange={(event) => setCreateSession(event.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
              />
              创建后立即进入新 worktree 会话
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-4">
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || isLoadingChoices || parentGitState?.isGit === false}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            创建 worktree
          </Button>
        </div>
      </div>
    </div>
  );
}
