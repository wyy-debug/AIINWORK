import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Bot,
  Box,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Database,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderUp,
  Github,
  Globe2,
  HardDrive,
  Mail,
  MessageSquare,
  NotebookTabs,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

import type {
  AgentAppBinding,
  AgentChannel,
  AgentConfig,
  AgentKnowledgeSource,
  AgentMemoryConfig,
  AgentStatus,
} from '../../../types/agent';
import type { Project } from '../../../types/app';
import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import { Button, Input } from '../../../shared/view/ui';
import MobileMenuButton from '../../main-content/view/subcomponents/MobileMenuButton';

type AgentConfigDashboardProps = {
  isMobile: boolean;
  onMenuClick: () => void;
  projects: Project[];
  selectedProject?: Project | null;
};

type BuilderModal = 'apps' | 'skills' | null;
type BuilderView = 'builder' | 'memory';
type UploadMode = 'file' | 'folder';
type McpScope = 'user' | 'project';
type McpTransport = 'stdio' | 'http' | 'sse';
type MtlCodeSettingsConfig = {
  anthropic?: {
    model?: string;
  };
  runtime?: {
    contextWindowTokens?: number;
  };
};

type CatalogApp = {
  id: string;
  name: string;
  slot: string;
  category: string;
  description: string;
  icon: LucideIcon;
};

type SkillTemplate = {
  id: string;
  name: string;
  description: string;
  source: 'local' | 'remote' | 'generated';
};

type AgentMcpServer = {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  workspacePath?: string;
  projectDisplayName?: string;
};

type McpFormState = {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  workspacePath: string;
};

type McpInspection = {
  status: 'ok' | 'warning' | 'error';
  checkedAt: string;
  checks: Array<{
    id: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    detail?: string;
  }>;
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  enabled: '已启用',
  draft: '草稿',
  paused: '已暂停',
};

const STATUS_STYLES: Record<AgentStatus, string> = {
  enabled: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  draft: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  paused: 'border-border bg-muted text-muted-foreground',
};

const APP_CATALOG: CatalogApp[] = [
  {
    id: 'custom-mcp',
    name: '自定义 MCP',
    slot: '高级工具',
    category: '高级工具',
    description: '在设置中开启开发者模式后，可以在此工作区中创建并使用自定义 MCP 应用。',
    icon: Wrench,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    slot: '日历',
    category: '日历',
    description: '读取和安排日程，用于会议、排期和任务提醒。',
    icon: CalendarDays,
  },
  {
    id: 'google-drive',
    name: 'Google 云端硬盘',
    slot: '知识库',
    category: '知识库',
    description: '让智能体检索云端文档、表格和共享文件。',
    icon: Cloud,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    slot: '电子邮件',
    category: '电子邮件',
    description: '用于总结邮件、生成回复草稿和跟进待办。',
    icon: Mail,
  },
  {
    id: 'slack',
    name: 'Slack',
    slot: '聊天',
    category: '聊天',
    description: '让智能体在团队频道中协助同步状态和回答问题。',
    icon: MessageSquare,
  },
  {
    id: 'notion',
    name: 'Notion',
    slot: '知识库',
    category: '知识库',
    description: '连接团队知识库、项目页面和产品文档。',
    icon: Database,
  },
  {
    id: 'github',
    name: 'GitHub',
    slot: '代码仓库',
    category: '代码',
    description: '读取 Issue、PR 和代码仓库上下文。',
    icon: Github,
  },
  {
    id: 'teams',
    name: 'Teams',
    slot: '聊天',
    category: '聊天',
    description: '连接 Microsoft Teams 对话和团队通知。',
    icon: Users,
  },
  {
    id: 'sharepoint',
    name: 'SharePoint',
    slot: '知识库',
    category: '知识库',
    description: '检索组织内部文档和共享资料。',
    icon: HardDrive,
  },
  {
    id: 'outlook-mail',
    name: 'Outlook 电子邮件',
    slot: '电子邮件',
    category: '电子邮件',
    description: '处理 Outlook 邮件摘要、草稿和跟进。',
    icon: Mail,
  },
  {
    id: 'outlook-calendar',
    name: 'Outlook 日历',
    slot: '日历',
    category: '日历',
    description: '读取和安排 Outlook 日程。',
    icon: CalendarDays,
  },
  {
    id: 'cook',
    name: '1-2-3-Cook!',
    slot: '生活助手',
    category: '示例应用',
    description: '示例应用，用于验证应用市场和启用流程。',
    icon: Sparkles,
  },
];

const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'example-skill',
    name: 'example-skill',
    description: '示例技能，用于展示 Skill 仓库的安装和绑定流程。',
    source: 'remote',
  },
  {
    id: 'skill-creator',
    name: 'skill-creator',
    description: '根据描述生成 SKILL.md 草稿，适合快速创建可复用能力。',
    source: 'local',
  },
  {
    id: 'meeting-brief',
    name: 'meeting-brief',
    description: '把会议记录整理成结论、待办和风险。',
    source: 'remote',
  },
];

const createDefaultChannels = (): AgentChannel[] => [
  {
    id: 'chat',
    type: 'chat',
    name: '应用内对话',
    description: '在 MTL-Code 中使用你的智能体',
    enabled: true,
  },
];

const createDefaultMemory = (agentId: string): AgentMemoryConfig => ({
  enabled: true,
  namespace: `agent:${agentId}:memory`,
  privacy: 'private',
  description: '代理用来保存笔记、草稿和输出的持久文件夹，让它能长期持续工作。',
});

function cloneAgent(agent: AgentConfig): AgentConfig {
  return JSON.parse(JSON.stringify(agent)) as AgentConfig;
}

function getShortName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return 'AI';
  return Array.from(trimmed).slice(0, 2).join('');
}

function createKnowledgeId(name: string, index: number) {
  return `${Date.now()}-${index}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function withBuilderDefaults(agent: AgentConfig): AgentConfig {
  const id = agent.id || `agent-${Date.now()}`;
  const channels = agent.channels?.length
    ? agent.channels.map((channel) => {
      if (channel.id === 'chat' || channel.name === 'ChatGPT') {
        return {
          ...channel,
          id: 'chat',
          type: 'chat' as const,
          name: '应用内对话',
          description: channel.description === '自定义并分享你的智能体'
            ? '在 MTL-Code 中使用你的智能体'
            : channel.description,
        };
      }
      if (channel.id === 'slack' || channel.description === '在 Slack 中使用你的智能体') {
        return {
          ...channel,
          id: 'dingtalk',
          type: 'dingtalk' as const,
          name: channel.name === 'Slack' ? '钉钉' : channel.name,
          description: '在钉钉中使用你的智能体',
        };
      }
      return channel;
    })
    : createDefaultChannels();
  return {
    ...agent,
    id,
    shortName: agent.shortName || getShortName(agent.name),
    channels,
    appBindings: agent.appBindings || [],
    skills: agent.skills || [],
    tools: agent.tools || [],
    guardrails: agent.guardrails || [],
    knowledgeSources: agent.knowledgeSources || [],
    memory: agent.memory || createDefaultMemory(id),
    triggerRules: agent.triggerRules || {
      mode: 'manual',
      keywords: [],
      confidenceThreshold: 0.8,
    },
    modelConfig: {
      provider: agent.modelConfig?.provider || 'mtl-code',
      model: agent.modelConfig?.model || 'inherit',
      contextWindowTokens: agent.modelConfig?.contextWindowTokens || 200_000,
      temperature: agent.modelConfig?.temperature ?? 0.2,
    },
  };
}

function formatUpdatedAt(value?: string) {
  if (!value) return '尚未保存';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function AgentAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-sm',
        className,
      )}
    >
      <Bot className="h-6 w-6" />
      <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-emerald-400 ring-2 ring-background" />
    </div>
  );
}

function StatusPill({ status }: { status: AgentStatus }) {
  return (
    <span className={cn('rounded-md border px-2 py-1 text-xs font-medium', STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={String(value)}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-muted/35 disabled:text-muted-foreground"
      />
    </label>
  );
}

function BuilderDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/55 p-4 backdrop-blur-md">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="grid h-[min(78vh,560px)] w-full max-w-[720px] overflow-hidden rounded-lg border border-border bg-card shadow-2xl md:grid-cols-[260px_minmax(0,1fr)]"
      >
        {children}
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-[calc(50%-350px)] top-[calc(50%-270px)] hidden h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted md:flex"
        >
          <X className="h-5 w-5" />
        </button>
      </section>
    </div>
  );
}

function SidebarSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/55" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-lg border-border bg-background pl-9 text-sm"
      />
    </div>
  );
}

function getProjectPath(project: Project | null | undefined) {
  return project?.fullPath || project?.path || '';
}

function getProjectLabel(project: Project) {
  return project.displayName || project.name || getProjectPath(project);
}

function createProjectOptions(projects: Project[]) {
  const seen = new Set<string>();
  return projects.reduce<Array<{ label: string; value: string }>>((acc, project) => {
    const value = getProjectPath(project);
    if (!value || seen.has(value)) return acc;
    seen.add(value);
    acc.push({ label: getProjectLabel(project), value });
    return acc;
  }, []);
}

function parseListLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueLines(value: string) {
  return parseListLines(value).reduce<Record<string, string>>((acc, line) => {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) return acc;
    const key = line.slice(0, separatorIndex).trim();
    const itemValue = line.slice(separatorIndex + 1).trim();
    if (key) acc[key] = itemValue;
    return acc;
  }, {});
}

function createDefaultMcpForm(projects: Project[], selectedProject?: Project | null): McpFormState {
  const selectedProjectPath = getProjectPath(selectedProject);
  const firstProjectPath = selectedProjectPath || createProjectOptions(projects)[0]?.value || '';
  return {
    name: '',
    scope: firstProjectPath ? 'project' : 'user',
    transport: 'stdio',
    command: '',
    argsText: '',
    envText: '',
    url: '',
    headersText: '',
    workspacePath: firstProjectPath,
  };
}

function normalizeMcpServer(raw: Partial<AgentMcpServer>, scope: McpScope, projectLabel?: string): AgentMcpServer | null {
  if (!raw?.name) return null;
  const transport = raw.transport === 'http' || raw.transport === 'sse' ? raw.transport : 'stdio';
  return {
    name: raw.name,
    scope: raw.scope === 'project' ? 'project' : scope,
    transport,
    command: raw.command,
    args: Array.isArray(raw.args) ? raw.args : [],
    env: raw.env || {},
    url: raw.url,
    headers: raw.headers || {},
    workspacePath: raw.workspacePath,
    projectDisplayName: raw.projectDisplayName || projectLabel,
  };
}

function getMcpBindingAppName(serverName: string) {
  return `MCP: ${serverName}`;
}

function getMcpServerKey(server: Pick<AgentMcpServer, 'scope' | 'workspacePath' | 'name'>) {
  return `${server.scope}:${server.workspacePath || 'user'}:${server.name}`;
}

function AppCatalogModal({
  agent,
  projects,
  selectedProject,
  onClose,
  onEnableApp,
  onEnableMcpServer,
  onRemoveMcpServer,
}: {
  agent: AgentConfig;
  projects: Project[];
  selectedProject?: Project | null;
  onClose: () => void;
  onEnableApp: (app: CatalogApp) => void;
  onEnableMcpServer: (server: AgentMcpServer) => void;
  onRemoveMcpServer: (serverName: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedAppId, setSelectedAppId] = useState(APP_CATALOG[0]?.id || '');
  const filteredApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return APP_CATALOG;
    return APP_CATALOG.filter((app) => (
      `${app.name} ${app.slot} ${app.category}`.toLowerCase().includes(normalizedQuery)
    ));
  }, [query]);

  const selectedApp = APP_CATALOG.find((app) => app.id === selectedAppId) || filteredApps[0] || APP_CATALOG[0];
  const isCustomMcp = selectedApp?.id === 'custom-mcp';
  const projectOptions = useMemo(() => createProjectOptions(projects), [projects]);
  const [mcpForm, setMcpForm] = useState<McpFormState>(() => createDefaultMcpForm(projects, selectedProject));
  const [mcpServers, setMcpServers] = useState<AgentMcpServer[]>([]);
  const [isLoadingMcp, setIsLoadingMcp] = useState(false);
  const [isSavingMcp, setIsSavingMcp] = useState(false);
  const [mcpError, setMcpError] = useState('');
  const [mcpActionKey, setMcpActionKey] = useState('');
  const [mcpInspections, setMcpInspections] = useState<Record<string, McpInspection>>({});
  const isEnabled = Boolean(selectedApp && (
    isCustomMcp
      ? agent.appBindings.some((binding) => binding.app.startsWith('MCP: '))
      : agent.appBindings.some((binding) => binding.app === selectedApp.name)
  ));
  const currentProjectLabel = projectOptions.find((project) => project.value === mcpForm.workspacePath)?.label;
  const hasProjectScope = projectOptions.length > 0;

  const updateMcpForm = useCallback(<K extends keyof McpFormState>(key: K, value: McpFormState[K]) => {
    setMcpForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  const readMcpServers = useCallback(async () => {
    if (!isCustomMcp) return;
    setIsLoadingMcp(true);
    setMcpError('');

    try {
      const requests: Array<{ scope: McpScope; workspacePath?: string; projectLabel?: string }> = [
        { scope: 'user' },
      ];
      if (mcpForm.workspacePath) {
        requests.push({
          scope: 'project',
          workspacePath: mcpForm.workspacePath,
          projectLabel: currentProjectLabel,
        });
      }

      const batches = await Promise.all(requests.map(async (request) => {
        const response = await api.mcpServers('claude', request.scope, request.workspacePath || '');
        const data = await response.json();
        if (!response.ok || data?.success === false) {
          throw new Error(data?.error?.message || data?.error || data?.details || '加载 MCP Server 失败');
        }
        const servers = data?.data?.servers || data?.servers || [];
        return servers
          .map((server: Partial<AgentMcpServer>) => normalizeMcpServer(server, request.scope, request.projectLabel))
          .filter(Boolean) as AgentMcpServer[];
      }));

      setMcpServers(batches.flat());
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '加载 MCP Server 失败';
      setMcpError(message);
      setMcpServers([]);
    } finally {
      setIsLoadingMcp(false);
    }
  }, [currentProjectLabel, isCustomMcp, mcpForm.workspacePath]);

  useEffect(() => {
    if (!isCustomMcp) return;
    void readMcpServers();
  }, [isCustomMcp, readMcpServers]);

  const saveMcpServer = useCallback(async () => {
    const name = mcpForm.name.trim();
    if (!name) {
      setMcpError('请填写 MCP Server 名称');
      return;
    }
    if (mcpForm.scope === 'project' && !mcpForm.workspacePath) {
      setMcpError('请选择项目作用域');
      return;
    }
    if (mcpForm.transport === 'stdio' && !mcpForm.command.trim()) {
      setMcpError('stdio MCP 需要填写启动命令');
      return;
    }
    if (mcpForm.transport !== 'stdio' && !mcpForm.url.trim()) {
      setMcpError('HTTP/SSE MCP 需要填写 URL');
      return;
    }

    const payload = {
      name,
      scope: mcpForm.scope,
      transport: mcpForm.transport,
      workspacePath: mcpForm.scope === 'project' ? mcpForm.workspacePath : undefined,
      command: mcpForm.transport === 'stdio' ? mcpForm.command.trim() : undefined,
      args: mcpForm.transport === 'stdio' ? parseListLines(mcpForm.argsText) : undefined,
      env: mcpForm.transport === 'stdio' ? parseKeyValueLines(mcpForm.envText) : undefined,
      url: mcpForm.transport !== 'stdio' ? mcpForm.url.trim() : undefined,
      headers: mcpForm.transport !== 'stdio' ? parseKeyValueLines(mcpForm.headersText) : undefined,
    };

    setIsSavingMcp(true);
    setMcpError('');
    try {
      const response = await api.upsertMcpServer('claude', payload);
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error?.message || data?.error || data?.details || '保存 MCP Server 失败');
      }

      const savedServer = normalizeMcpServer(
        data?.data?.server || payload,
        mcpForm.scope,
        currentProjectLabel,
      ) || {
        name,
        scope: mcpForm.scope,
        transport: mcpForm.transport,
        workspacePath: payload.workspacePath,
        projectDisplayName: currentProjectLabel,
      };
      onEnableMcpServer(savedServer);
      setMcpForm((previous) => ({
        ...previous,
        name: '',
        command: '',
        argsText: '',
        envText: '',
        url: '',
        headersText: '',
      }));
      await readMcpServers();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '保存 MCP Server 失败';
      setMcpError(message);
    } finally {
      setIsSavingMcp(false);
    }
  }, [currentProjectLabel, mcpForm, onEnableMcpServer, readMcpServers]);

  const inspectMcpServer = useCallback(async (server: AgentMcpServer) => {
    const key = getMcpServerKey(server);
    setMcpActionKey(`inspect:${key}`);
    setMcpError('');
    try {
      const response = await api.inspectMcpServer('claude', server.name, server.scope, server.workspacePath || '');
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error?.message || data?.error || data?.details || '检测 MCP Server 失败');
      }
      const inspection = data?.data || data;
      setMcpInspections((previous) => ({
        ...previous,
        [key]: {
          status: inspection.status || 'warning',
          checkedAt: inspection.checkedAt || new Date().toISOString(),
          checks: Array.isArray(inspection.checks) ? inspection.checks : [],
        },
      }));
    } catch (inspectError) {
      const message = inspectError instanceof Error ? inspectError.message : '检测 MCP Server 失败';
      setMcpError(message);
      setMcpInspections((previous) => ({
        ...previous,
        [key]: {
          status: 'error',
          checkedAt: new Date().toISOString(),
          checks: [{ id: 'inspect', status: 'fail', message }],
        },
      }));
    } finally {
      setMcpActionKey('');
    }
  }, []);

  const deleteMcpServer = useCallback(async (server: AgentMcpServer) => {
    const key = getMcpServerKey(server);
    setMcpActionKey(`delete:${key}`);
    setMcpError('');
    try {
      const response = await api.deleteMcpServer('claude', server.name, server.scope, server.workspacePath || '');
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error?.message || data?.error || data?.details || '删除 MCP Server 失败');
      }
      onRemoveMcpServer(server.name);
      setMcpInspections((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      await readMcpServers();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : '删除 MCP Server 失败';
      setMcpError(message);
    } finally {
      setMcpActionKey('');
    }
  }, [onRemoveMcpServer, readMcpServers]);

  return (
    <BuilderDialog title="浏览应用" onClose={onClose}>
      <aside className="min-h-0 border-r border-border bg-muted/30 p-2">
        <SidebarSearch value={query} onChange={setQuery} placeholder="搜索应用" />
        <div className="mt-2 h-[calc(100%-48px)] overflow-y-auto pr-1">
          {filteredApps.map((app) => {
            const Icon = app.icon;
            const selected = selectedApp?.id === app.id;
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => setSelectedAppId(app.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                  selected ? 'bg-background text-foreground shadow-sm' : 'text-foreground hover:bg-background/70',
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{app.name}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="relative flex min-h-0 flex-col overflow-y-auto p-7">
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
        {selectedApp && (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background text-foreground">
              <selectedApp.icon className="h-8 w-8" />
            </div>
            <h2 className="mt-8 text-2xl font-semibold text-foreground">{selectedApp.name}</h2>
            <div className="mt-2 text-sm text-muted-foreground">{selectedApp.category}</div>
            <p className="mt-5 max-w-[360px] text-sm leading-7 text-muted-foreground">{selectedApp.description}</p>
            {isCustomMcp ? (
              <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5">
                <section>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">已配置 MCP</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => void readMcpServers()}
                      disabled={isLoadingMcp}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', isLoadingMcp && 'animate-spin')} />
                      刷新
                    </Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {isLoadingMcp && (
                      <div className="rounded-lg border border-border bg-muted/25 px-3 py-3 text-sm text-muted-foreground">
                        正在读取 MCP Server
                      </div>
                    )}
                    {!isLoadingMcp && mcpServers.length === 0 && (
                      <div className="rounded-lg border border-border bg-muted/25 px-3 py-3 text-sm text-muted-foreground">
                        暂无 MCP Server，可以在下方新增一个。
                      </div>
                    )}
                    {!isLoadingMcp && mcpServers.map((server) => {
                      const serverKey = getMcpServerKey(server);
                      const bindingName = getMcpBindingAppName(server.name);
                      const bound = agent.appBindings.some((binding) => binding.app === bindingName);
                      const detail = server.transport === 'stdio'
                        ? server.command || 'stdio'
                        : server.url || server.transport;
                      const inspection = mcpInspections[serverKey];
                      const inspectBusy = mcpActionKey === `inspect:${serverKey}`;
                      const deleteBusy = mcpActionKey === `delete:${serverKey}`;
                      return (
                        <div
                          key={serverKey}
                          className="rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-muted/25"
                        >
                          <div className="flex items-center gap-3">
                            <Wrench className="h-4 w-4 shrink-0 text-primary" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{server.name}</span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {server.scope === 'project' ? `项目：${server.projectDisplayName || server.workspacePath || '当前项目'}` : '用户全局'} · {server.transport} · {detail}
                              </span>
                            </span>
                            {inspection && (
                              <span className={cn(
                                'shrink-0 rounded-full px-2 py-1 text-xs font-medium',
                                inspection.status === 'ok' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
                                inspection.status === 'warning' && 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
                                inspection.status === 'error' && 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
                              )}>
                                {inspection.status === 'ok' ? '可用' : inspection.status === 'warning' ? '需确认' : '异常'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => onEnableMcpServer(server)}
                              className={cn(
                                'shrink-0 rounded-full px-2 py-1 text-xs font-medium transition-colors',
                                bound ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'bg-muted text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {bound ? '已绑定' : '绑定'}
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                            <button
                              type="button"
                              onClick={() => void inspectMcpServer(server)}
                              disabled={Boolean(mcpActionKey)}
                              className="inline-flex h-7 items-center gap-1.5 rounded border border-border px-2 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                            >
                              <RefreshCw className={cn('h-3 w-3', inspectBusy && 'animate-spin')} />
                              测试
                            </button>
                            {bound && (
                              <button
                                type="button"
                                onClick={() => onRemoveMcpServer(server.name)}
                                className="inline-flex h-7 items-center rounded border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              >
                                解绑
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void deleteMcpServer(server)}
                              disabled={Boolean(mcpActionKey)}
                              className="inline-flex h-7 items-center gap-1.5 rounded border border-red-200 px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:hover:bg-red-950/30"
                            >
                              {deleteBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              删除
                            </button>
                          </div>
                          {inspection && inspection.checks.length > 0 && (
                            <div className="mt-2 space-y-1 pl-7 text-xs text-muted-foreground">
                              {inspection.checks.slice(0, 3).map((check) => (
                                <div key={check.id} className="flex gap-2">
                                  <span className={cn(
                                    'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                                    check.status === 'pass' && 'bg-emerald-500',
                                    check.status === 'warn' && 'bg-amber-500',
                                    check.status === 'fail' && 'bg-red-500',
                                  )}
                                  />
                                  <span className="min-w-0 truncate" title={check.detail || check.message}>
                                    {check.message}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="border-t border-border pt-5">
                  <h3 className="text-sm font-semibold text-foreground">新增或更新 MCP Server</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <TextField
                      label="名称"
                      value={mcpForm.name}
                      onChange={(value) => updateMcpForm('name', value)}
                      placeholder="例如 github"
                    />
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">作用域</span>
                      <select
                        value={mcpForm.scope}
                        onChange={(event) => {
                          const scope = event.target.value as McpScope;
                          updateMcpForm('scope', scope);
                        }}
                        className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                      >
                        <option value="user">用户全局</option>
                        <option value="project" disabled={!hasProjectScope}>项目工作区</option>
                      </select>
                    </label>
                  </div>

                  {mcpForm.scope === 'project' && (
                    <label className="mt-3 block min-w-0">
                      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">项目</span>
                      <select
                        value={mcpForm.workspacePath}
                        onChange={(event) => updateMcpForm('workspacePath', event.target.value)}
                        className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                      >
                        {projectOptions.map((project) => (
                          <option key={project.value} value={project.value}>
                            {project.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="mt-3">
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">传输方式</span>
                    <div className="grid grid-cols-3 rounded-lg border border-border bg-muted/30 p-1">
                      {(['stdio', 'http', 'sse'] as McpTransport[]).map((transport) => (
                        <button
                          key={transport}
                          type="button"
                          onClick={() => updateMcpForm('transport', transport)}
                          className={cn(
                            'h-8 rounded-md text-xs font-medium transition-colors',
                            mcpForm.transport === transport
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {transport}
                        </button>
                      ))}
                    </div>
                  </div>

                  {mcpForm.transport === 'stdio' ? (
                    <div className="mt-3 grid gap-3">
                      <TextField
                        label="启动命令"
                        value={mcpForm.command}
                        onChange={(value) => updateMcpForm('command', value)}
                        placeholder="npx"
                      />
                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">参数，每行一个</span>
                        <textarea
                          value={mcpForm.argsText}
                          onChange={(event) => updateMcpForm('argsText', event.target.value)}
                          placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\workspace'}
                          className="min-h-20 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                        />
                      </label>
                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">环境变量，KEY=value</span>
                        <textarea
                          value={mcpForm.envText}
                          onChange={(event) => updateMcpForm('envText', event.target.value)}
                          placeholder="TOKEN=..."
                          className="min-h-16 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-3">
                      <TextField
                        label="URL"
                        value={mcpForm.url}
                        onChange={(value) => updateMcpForm('url', value)}
                        placeholder="https://example.com/mcp"
                      />
                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Headers，KEY=value</span>
                        <textarea
                          value={mcpForm.headersText}
                          onChange={(event) => updateMcpForm('headersText', event.target.value)}
                          placeholder="Authorization=Bearer ..."
                          className="min-h-16 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                        />
                      </label>
                    </div>
                  )}

                  {mcpError && (
                    <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {mcpError}
                    </div>
                  )}

                  <Button
                    type="button"
                    className="mt-4 h-10 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                    onClick={() => void saveMcpServer()}
                    disabled={isSavingMcp}
                  >
                    {isSavingMcp ? '保存中' : '保存并绑定 MCP'}
                  </Button>
                </section>
              </div>
            ) : (
              <>
                <div className="mt-5 rounded-lg border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">绑定槽位</div>
                  <div className="mt-1">{selectedApp.slot}</div>
                </div>
                <div className="mt-auto">
                  <Button
                    type="button"
                    className="h-10 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                    onClick={() => onEnableApp(selectedApp)}
                  >
                    {isEnabled ? '已启用' : '启用'}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </BuilderDialog>
  );
}

function SkillsModal({
  agent,
  onClose,
  onAddSkill,
}: {
  agent: AgentConfig;
  onClose: () => void;
  onAddSkill: (skillName: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState('create');
  const [skillPrompt, setSkillPrompt] = useState('');
  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return SKILL_TEMPLATES;
    return SKILL_TEMPLATES.filter((skill) => (
      `${skill.name} ${skill.description}`.toLowerCase().includes(normalizedQuery)
    ));
  }, [query]);
  const selectedSkill = SKILL_TEMPLATES.find((skill) => skill.id === selectedSkillId);

  const handleGenerateSkill = () => {
    const text = skillPrompt.trim();
    if (!text) return;
    const name = text
      .split(/\s+/)
      .slice(0, 4)
      .join('-')
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '')
      .toLowerCase();
    onAddSkill(name || 'generated-skill');
    setSkillPrompt('');
  };

  return (
    <BuilderDialog title="添加技能" onClose={onClose}>
      <aside className="min-h-0 border-r border-border bg-muted/30 p-2">
        <SidebarSearch value={query} onChange={setQuery} placeholder="搜索技能" />
        <div className="mt-2 space-y-1">
          <button
            type="button"
            onClick={() => setSelectedSkillId('create')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
              selectedSkillId === 'create' ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/70',
            )}
          >
            <Plus className="h-4 w-4" />
            添加技能
          </button>
          <button
            type="button"
            onClick={() => setSelectedSkillId('upload')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
              selectedSkillId === 'upload' ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/70',
            )}
          >
            <Upload className="h-4 w-4" />
            上传技能
          </button>
        </div>

        <div className="mt-5 px-3 text-xs font-medium text-muted-foreground">热门技能</div>
        <div className="mt-2 space-y-1">
          {filteredSkills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => setSelectedSkillId(skill.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                selectedSkillId === skill.id ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/70',
              )}
            >
              <Box className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{skill.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="relative flex min-h-0 flex-col p-7">
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted md:hidden"
        >
          <X className="h-5 w-5" />
        </button>

        {selectedSkillId === 'create' && (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background text-primary">
              <Box className="h-8 w-8" />
            </div>
            <h2 className="mt-8 text-2xl font-semibold text-foreground">添加技能</h2>
            <p className="mt-3 max-w-[360px] text-sm leading-7 text-muted-foreground">
              技能是智能体可执行的可复用任务，例如总结邮件、创建工单或准备会议纪要。
            </p>
            <textarea
              value={skillPrompt}
              onChange={(event) => setSkillPrompt(event.target.value)}
              placeholder="描述你想创建的技能"
              className="mt-5 min-h-[156px] resize-none rounded-lg border border-border bg-background p-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
            />
            <div className="mt-auto">
              <Button
                type="button"
                className="h-10 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                onClick={handleGenerateSkill}
                disabled={!skillPrompt.trim()}
              >
                生成技能
              </Button>
            </div>
          </>
        )}

        {selectedSkillId === 'upload' && (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background text-primary">
              <Upload className="h-8 w-8" />
            </div>
            <h2 className="mt-8 text-2xl font-semibold text-foreground">上传技能</h2>
            <p className="mt-3 max-w-[360px] text-sm leading-7 text-muted-foreground">
              后续会接入 SKILL.md 文件夹或压缩包上传。现在先把上传入口保存为智能体技能绑定。
            </p>
            <div className="mt-auto">
              <Button
                type="button"
                className="h-10 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                onClick={() => onAddSkill('uploaded-skill')}
              >
                添加上传技能
              </Button>
            </div>
          </>
        )}

        {selectedSkill && (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background text-primary">
              <Box className="h-8 w-8" />
            </div>
            <h2 className="mt-8 text-2xl font-semibold text-foreground">{selectedSkill.name}</h2>
            <div className="mt-2 text-sm text-muted-foreground">
              {selectedSkill.source === 'local' ? '本地技能' : '远端仓库'}
            </div>
            <p className="mt-5 max-w-[360px] text-sm leading-7 text-muted-foreground">{selectedSkill.description}</p>
            <div className="mt-auto">
              <Button
                type="button"
                className="h-10 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                onClick={() => onAddSkill(selectedSkill.name)}
                disabled={agent.skills.includes(selectedSkill.name)}
              >
                {agent.skills.includes(selectedSkill.name) ? '已添加' : '添加技能'}
              </Button>
            </div>
          </>
        )}
      </main>
    </BuilderDialog>
  );
}

function MemoryView({
  agent,
  onBack,
  onDeleteMemory,
}: {
  agent: AgentConfig;
  onBack: () => void;
  onDeleteMemory: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[840px] px-5 py-10 sm:px-8">
      <AgentAvatar />
      <h1 className="mt-7 text-3xl font-medium tracking-normal text-muted-foreground">{agent.name || '智能体名称'}</h1>

      <div className="mt-7 flex items-center justify-between">
        <Button type="button" variant="outline" className="h-9 rounded-full px-4" onClick={onBack}>
          返回
        </Button>
        <button
          type="button"
          aria-label="删除记忆"
          onClick={onDeleteMemory}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <section className="mt-7">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500 text-white">
            <Folder className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-medium text-foreground">记忆</h2>
        </div>

        <div className="mt-7 grid overflow-hidden rounded-lg border border-violet-200 bg-violet-50 text-sm text-violet-950 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-100 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-[92px] items-center px-9 py-5 leading-7">
            {agent.memory.description}
          </div>
          <div className="border-t border-violet-200 bg-violet-100/70 p-4 dark:border-violet-900/50 dark:bg-violet-950/40 md:border-l md:border-t-0">
            <div className="mb-3 flex items-center justify-center gap-2 font-medium">
              <Folder className="h-4 w-4 text-violet-600" />
              记忆
            </div>
            <div className="flex items-center justify-center gap-4 text-muted-foreground">
              <FileText className="h-7 w-7 rounded bg-background p-1" />
              <FileText className="h-7 w-7 rounded bg-red-500 p-1 text-white" />
              <FileText className="h-7 w-7 rounded bg-green-500 p-1 text-white" />
              <FileText className="h-7 w-7 rounded bg-blue-500 p-1 text-white" />
            </div>
          </div>
        </div>

        <div className="mt-10 flex items-center gap-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-sky-500 text-white">
            <FolderOpen className="h-7 w-7" />
          </div>
          <div>
            <div className="text-base font-medium text-foreground">应用内对话</div>
            <div className="mt-1 text-sm text-muted-foreground">
              私密 · 保存在您与此智能体中的对话
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function AgentConfigDashboard({
  isMobile,
  onMenuClick,
  projects = [],
  selectedProject = null,
}: AgentConfigDashboardProps) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [draftAgent, setDraftAgent] = useState<AgentConfig | null>(null);
  const [settingsConfig, setSettingsConfig] = useState<MtlCodeSettingsConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<BuilderModal>(null);
  const [builderView, setBuilderView] = useState<BuilderView>('builder');
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [isUploadingKnowledge, setIsUploadingKnowledge] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const settingsModelConfig = useMemo(() => ({
    provider: 'mtl-code',
    model: settingsConfig?.anthropic?.model || 'inherit',
    contextWindowTokens: settingsConfig?.runtime?.contextWindowTokens || 200_000,
  }), [settingsConfig?.anthropic?.model, settingsConfig?.runtime?.contextWindowTokens]);

  const applySettingsModelConfig = useCallback((agent: AgentConfig): AgentConfig => (
    withBuilderDefaults({
      ...agent,
      modelConfig: {
        ...agent.modelConfig,
        provider: settingsModelConfig.provider,
        model: settingsModelConfig.model,
        contextWindowTokens: settingsModelConfig.contextWindowTokens,
      },
    })
  ), [settingsModelConfig]);

  const loadSettingsConfig = useCallback(async () => {
    try {
      const response = await api.get('/settings/mtl-code-model');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load model settings');
      }
      setSettingsConfig(data?.config || null);
    } catch (settingsError) {
      console.warn('Failed to load MTL-Code settings for Agent Builder:', settingsError);
      setSettingsConfig(null);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.agents(true);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || '加载 Agent 失败');
      }
      const nextAgents = Array.isArray(data?.agents)
        ? data.agents.map((agent: AgentConfig) => withBuilderDefaults(agent))
        : [];
      setAgents(nextAgents);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '加载 Agent 失败';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    void loadSettingsConfig();
  }, [loadAgents, loadSettingsConfig]);

  useEffect(() => {
    setAgents((previous) => previous.map((agent) => applySettingsModelConfig(agent)));
  }, [applySettingsModelConfig]);

  useEffect(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) {
      return;
    }
    setSelectedAgentId(agents[0]?.id || '');
  }, [agents, selectedAgentId]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  useEffect(() => {
    setDraftAgent(selectedAgent ? cloneAgent(applySettingsModelConfig(selectedAgent)) : null);
    setBuilderView('builder');
  }, [applySettingsModelConfig, selectedAgent]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedAgent || !draftAgent) return false;
    return JSON.stringify(applySettingsModelConfig(selectedAgent)) !== JSON.stringify(draftAgent);
  }, [applySettingsModelConfig, draftAgent, selectedAgent]);

  const updateDraft = useCallback((patch: Partial<AgentConfig>) => {
    setDraftAgent((previous) => (previous ? withBuilderDefaults({ ...previous, ...patch }) : previous));
  }, []);

  const updateMemory = useCallback((patch: Partial<AgentMemoryConfig>) => {
    setDraftAgent((previous) => (
      previous
        ? withBuilderDefaults({
          ...previous,
          memory: {
            ...previous.memory,
            ...patch,
          },
        })
        : previous
    ));
  }, []);

  const updateModelConfig = useCallback((patch: Partial<AgentConfig['modelConfig']>) => {
    setDraftAgent((previous) => (
      previous
        ? withBuilderDefaults({
          ...previous,
          modelConfig: {
            ...previous.modelConfig,
            ...patch,
          },
        })
        : previous
    ));
  }, []);

  const saveAgent = useCallback(async (status?: AgentStatus) => {
    if (!draftAgent) return;

    const payload = withBuilderDefaults({
      ...draftAgent,
      status: status ?? draftAgent.status,
      shortName: draftAgent.shortName || getShortName(draftAgent.name),
      modelConfig: {
        ...draftAgent.modelConfig,
        provider: settingsModelConfig.provider,
        model: settingsModelConfig.model,
        contextWindowTokens: settingsModelConfig.contextWindowTokens,
      },
    });

    setSavingAgentId(payload.id);
    setError(null);
    try {
      const response = await api.updateAgent(payload.id, payload);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || '保存 Agent 失败');
      }
      const nextAgent = applySettingsModelConfig(data.agent as AgentConfig);
      setAgents((previous) => previous.map((entry) => (entry.id === nextAgent.id ? nextAgent : entry)));
      setSelectedAgentId(nextAgent.id);
      setDraftAgent(cloneAgent(nextAgent));
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '保存 Agent 失败';
      setError(message);
    } finally {
      setSavingAgentId(null);
    }
  }, [applySettingsModelConfig, draftAgent, settingsModelConfig]);

  const createDraftAgent = useCallback(async () => {
    setSavingAgentId('new');
    setError(null);
    try {
      const id = `agent-${Date.now()}`;
      const response = await api.createAgent({
        id,
        name: '智能体名称',
        shortName: '智能',
        description: '自定义并分享你的智能体。',
        status: 'draft',
        scope: 'global',
        modelConfig: {
          provider: settingsModelConfig.provider,
          model: settingsModelConfig.model,
          contextWindowTokens: settingsModelConfig.contextWindowTokens,
          temperature: 0.2,
        },
        repository: 'local/agents',
        systemPrompt: '',
        channels: createDefaultChannels(),
        appBindings: [],
        skills: [],
        knowledgeSources: [],
        memory: createDefaultMemory(id),
        tools: ['Read', 'TodoRead'],
        guardrails: [],
        triggerRules: {
          mode: 'manual',
          keywords: [],
          confidenceThreshold: 0.8,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || '新建 Agent 失败');
      }
      const nextAgent = applySettingsModelConfig(data.agent as AgentConfig);
      setAgents((previous) => [nextAgent, ...previous]);
      setSelectedAgentId(nextAgent.id);
      setDraftAgent(cloneAgent(nextAgent));
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : '新建 Agent 失败';
      setError(message);
    } finally {
      setSavingAgentId(null);
    }
  }, [applySettingsModelConfig, settingsModelConfig]);

  const deleteSelectedAgent = useCallback(async () => {
    if (!draftAgent) return;
    const confirmed = window.confirm(`确定删除 Agent「${draftAgent.name}」吗？关联的知识文件也会一起删除。`);
    if (!confirmed) return;

    setSavingAgentId(draftAgent.id);
    setError(null);
    try {
      const response = await api.deleteAgent(draftAgent.id);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || '删除 Agent 失败');
      }
      const remainingAgents = agents.filter((agent) => agent.id !== draftAgent.id);
      setAgents(remainingAgents);
      setSelectedAgentId(remainingAgents[0]?.id || '');
      setDraftAgent(remainingAgents[0] ? cloneAgent(remainingAgents[0]) : null);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : '删除 Agent 失败';
      setError(message);
    } finally {
      setSavingAgentId(null);
    }
  }, [agents, draftAgent]);

  const enableApp = useCallback((app: CatalogApp) => {
    setDraftAgent((previous) => {
      if (!previous) return previous;
      const existing = previous.appBindings.some((binding) => binding.app === app.name);
      const appBindings = existing
        ? previous.appBindings.map((binding) => (
          binding.app === app.name ? { ...binding, status: 'connected' as const } : binding
        ))
        : [
          ...previous.appBindings,
          {
            slot: app.slot,
            app: app.name,
            status: 'connected' as const,
          },
        ];
      return withBuilderDefaults({ ...previous, appBindings });
    });
  }, []);

  const enableMcpServer = useCallback((server: AgentMcpServer) => {
    setDraftAgent((previous) => {
      if (!previous) return previous;
      const appName = getMcpBindingAppName(server.name);
      const slot = server.scope === 'project'
        ? `高级工具 / ${server.projectDisplayName || '项目工作区'}`
        : '高级工具';
      const existing = previous.appBindings.some((binding) => binding.app === appName);
      const appBindings = existing
        ? previous.appBindings.map((binding) => (
          binding.app === appName ? { ...binding, slot, status: 'connected' as const } : binding
        ))
        : [
          ...previous.appBindings,
          {
            slot,
            app: appName,
            status: 'connected' as const,
          },
        ];
      return withBuilderDefaults({ ...previous, appBindings });
    });
  }, []);

  const removeMcpServerBinding = useCallback((serverName: string) => {
    const appName = getMcpBindingAppName(serverName);
    setDraftAgent((previous) => (
      previous
        ? withBuilderDefaults({
          ...previous,
          appBindings: previous.appBindings.filter((binding) => binding.app !== appName),
        })
        : previous
    ));
  }, []);

  const addSkill = useCallback((skillName: string) => {
    const normalized = skillName.trim();
    if (!normalized) return;
    setDraftAgent((previous) => {
      if (!previous || previous.skills.includes(normalized)) return previous;
      return withBuilderDefaults({ ...previous, skills: [...previous.skills, normalized] });
    });
  }, []);

  const removeSkill = useCallback((skillName: string) => {
    setDraftAgent((previous) => (
      previous ? withBuilderDefaults({ ...previous, skills: previous.skills.filter((skill) => skill !== skillName) }) : previous
    ));
  }, []);

  const removeAppBinding = useCallback((binding: AgentAppBinding) => {
    setDraftAgent((previous) => (
      previous
        ? withBuilderDefaults({
          ...previous,
          appBindings: previous.appBindings.filter((entry) => (
            entry.app !== binding.app || entry.slot !== binding.slot
          )),
        })
        : previous
    ));
  }, []);

  const addDingTalkChannel = useCallback(() => {
    setDraftAgent((previous) => {
      if (!previous) return previous;
      if (previous.channels.some((channel) => channel.id === 'dingtalk')) {
        return withBuilderDefaults({
          ...previous,
          channels: previous.channels.map((channel) => (
            channel.id === 'dingtalk' ? { ...channel, enabled: true } : channel
          )),
        });
      }
      return withBuilderDefaults({
        ...previous,
        channels: [
          ...previous.channels,
          {
            id: 'dingtalk',
            type: 'dingtalk',
            name: '钉钉',
            description: '在钉钉中使用你的智能体',
            enabled: true,
          },
        ],
      });
    });
  }, []);

  const handleKnowledgeUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>, mode: UploadMode) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0 || !draftAgent) return;

    const relativePaths = files.map((file) => (
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    ));
    const optimisticSeen = new Set<string>();
    const optimisticSources: AgentKnowledgeSource[] = [];
    files.forEach((file, index) => {
      const relativePath = relativePaths[index] || file.name;
      const folderName = relativePath.split('/')[0] || file.name;
      const name = mode === 'folder' ? folderName : file.name;
      if (mode === 'folder' && optimisticSeen.has(name)) return;
      optimisticSeen.add(name);
      optimisticSources.push({
        id: createKnowledgeId(name, index),
        type: mode,
        name,
        path: relativePath,
        status: 'pending',
        addedAt: new Date().toISOString(),
      });
    });

    setIsUploadingKnowledge(true);
    setError(null);
    setDraftAgent((previous) => (
      previous
        ? withBuilderDefaults({
          ...previous,
          knowledgeSources: [...optimisticSources, ...previous.knowledgeSources].slice(0, 80),
        })
        : previous
    ));

    try {
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('relativePaths', JSON.stringify(relativePaths));
      files.forEach((file, index) => {
        formData.append('files', file, relativePaths[index] || file.name);
      });

      const response = await api.uploadAgentKnowledge(draftAgent.id, formData);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || '上传 Agent 知识文件失败');
      }

      const nextAgent = applySettingsModelConfig(data.agent as AgentConfig);
      setAgents((previous) => previous.map((agent) => (agent.id === nextAgent.id ? nextAgent : agent)));
      setDraftAgent((previous) => (
        previous
          ? withBuilderDefaults({
            ...previous,
            knowledgeSources: nextAgent.knowledgeSources,
          })
          : nextAgent
      ));
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : '上传 Agent 知识文件失败';
      setError(message);
      setDraftAgent((previous) => (
        previous
          ? withBuilderDefaults({
            ...previous,
            knowledgeSources: previous.knowledgeSources.filter((source) => (
              !optimisticSources.some((optimisticSource) => optimisticSource.id === source.id)
            )),
          })
          : previous
      ));
    } finally {
      setIsUploadingKnowledge(false);
    }
  }, [applySettingsModelConfig, draftAgent]);

  const openUploadPicker = useCallback((mode: UploadMode) => {
    setUploadMenuOpen(false);
    if (mode === 'file') {
      fileInputRef.current?.click();
      return;
    }
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
    folderInputRef.current?.click();
  }, []);

  const deleteMemory = useCallback(() => {
    updateMemory({
      enabled: false,
      description: '记忆已关闭。重新保存后，此智能体不会继续写入持久记忆。',
    });
    setBuilderView('builder');
  }, [updateMemory]);

  const removeKnowledgeSource = useCallback(async (sourceId: string) => {
    if (!draftAgent) return;
    setError(null);
    const previousSources = draftAgent.knowledgeSources;
    setDraftAgent((previous) => (
      previous
        ? withBuilderDefaults({
          ...previous,
          knowledgeSources: previous.knowledgeSources.filter((source) => source.id !== sourceId),
        })
        : previous
    ));

    try {
      const response = await api.deleteAgentKnowledgeSource(draftAgent.id, sourceId);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || '删除知识源失败');
      }
      const nextAgent = applySettingsModelConfig(data.agent as AgentConfig);
      setAgents((previous) => previous.map((agent) => (agent.id === nextAgent.id ? nextAgent : agent)));
      setDraftAgent((previous) => (
        previous
          ? withBuilderDefaults({
            ...previous,
            knowledgeSources: nextAgent.knowledgeSources,
          })
          : nextAgent
      ));
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : '删除知识源失败';
      setError(message);
      setDraftAgent((previous) => (
        previous
          ? withBuilderDefaults({
            ...previous,
            knowledgeSources: previousSources,
          })
          : previous
      ));
    }
  }, [applySettingsModelConfig, draftAgent]);

  if (builderView === 'memory' && draftAgent) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4">
          <div className="flex items-center gap-3">
            {isMobile && <MobileMenuButton onMenuClick={onMenuClick} compact />}
            <div className="text-sm font-medium text-muted-foreground">Agent Builder</div>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => void saveAgent()}
            disabled={!hasUnsavedChanges || savingAgentId === draftAgent.id}
          >
            <Save className="h-3.5 w-3.5" />
            保存
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MemoryView agent={draftAgent} onBack={() => setBuilderView('builder')} onDeleteMemory={deleteMemory} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4">
        <div className="flex min-w-0 items-center gap-3">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} compact />}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">Agent Builder</div>
            <div className="hidden truncate text-xs text-muted-foreground sm:block">创建可在单个对话中调用的智能体</div>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <select
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
            className="hidden h-8 max-w-[180px] rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60 sm:block"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => void createDraftAgent()}
            disabled={savingAgentId === 'new'}
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </Button>
          {draftAgent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => void deleteSelectedAgent()}
              disabled={savingAgentId === draftAgent.id}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          )}
          {draftAgent && (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => void saveAgent(draftAgent.status === 'enabled' ? undefined : 'enabled')}
              disabled={savingAgentId === draftAgent.id}
            >
              <Save className="h-3.5 w-3.5" />
              {draftAgent.status === 'enabled' ? '保存' : '启用并保存'}
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto w-full max-w-[840px] px-5 py-8 sm:px-8 sm:py-10">
          {error && (
            <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {isLoading && (
            <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              加载智能体
            </div>
          )}

          {!isLoading && !draftAgent && (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <AgentAvatar />
              <h1 className="mt-6 text-2xl font-medium text-foreground">还没有智能体</h1>
              <p className="mt-2 text-sm text-muted-foreground">新建一个智能体后开始配置渠道、技能和指令。</p>
              <Button className="mt-6 rounded-lg" onClick={() => void createDraftAgent()}>
                <Plus className="h-4 w-4" />
                新建智能体
              </Button>
            </div>
          )}

          {!isLoading && draftAgent && (
            <>
              <AgentAvatar />

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <input
                    value={draftAgent.name}
                    onChange={(event) => updateDraft({
                      name: event.target.value,
                      shortName: draftAgent.shortName || getShortName(event.target.value),
                    })}
                    aria-label="智能体名称"
                    className="w-full bg-transparent text-3xl font-medium tracking-normal text-muted-foreground outline-none placeholder:text-muted-foreground/60"
                    placeholder="智能体名称"
                  />
                  <input
                    value={draftAgent.description}
                    onChange={(event) => updateDraft({ description: event.target.value })}
                    aria-label="智能体说明"
                    className="mt-3 w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/65"
                    placeholder="一句话说明这个智能体能做什么"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill status={draftAgent.status} />
                  {hasUnsavedChanges && <span className="text-xs text-amber-600 dark:text-amber-300">未保存</span>}
                </div>
              </div>

              <section className="mt-7">
                <h2 className="text-sm font-medium text-muted-foreground">渠道</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {draftAgent.channels.map((channel) => (
                    <button
                      key={channel.id}
                      type="button"
                      className="flex min-h-[88px] items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/25"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-foreground">
                        {channel.type === 'dingtalk' ? <MessageSquare className="h-5 w-5" /> : <Globe2 className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{channel.name}</span>
                          {channel.enabled && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{channel.description}</p>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={addDingTalkChannel}
                    className="flex min-h-[88px] items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/25"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-foreground">
                      <Plus className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">添加频道</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">在钉钉中使用你的智能体</p>
                    </div>
                  </button>
                </div>
              </section>

              <div className="my-6 border-t border-border/70" />

              <div className="relative flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" className="h-9 rounded-lg px-3" onClick={() => setActiveModal('apps')}>
                  <Puzzle className="h-4 w-4" />
                  浏览应用
                </Button>
                <Button type="button" variant="outline" className="h-9 rounded-lg px-3" onClick={() => setActiveModal('skills')}>
                  <Box className="h-4 w-4" />
                  添加技能
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg px-3"
                    disabled={isUploadingKnowledge}
                    onClick={() => setUploadMenuOpen((open) => !open)}
                  >
                    <FileUp className="h-4 w-4" />
                    {isUploadingKnowledge ? '索引中' : '上传文件'}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  {uploadMenuOpen && (
                    <div className="absolute left-0 top-full z-20 mt-2 w-36 rounded-lg border border-border bg-popover p-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => openUploadPicker('file')}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <FileUp className="h-4 w-4" />
                        上传文件
                      </button>
                      <button
                        type="button"
                        onClick={() => openUploadPicker('folder')}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <FolderUp className="h-4 w-4" />
                        上传文件夹
                      </button>
                    </div>
                  )}
                </div>
                <Button type="button" variant="outline" className="h-9 rounded-lg px-3" onClick={() => setBuilderView('memory')}>
                  <NotebookTabs className="h-4 w-4 text-violet-500" />
                  记忆
                </Button>
              </div>

              {(draftAgent.appBindings.length > 0 || draftAgent.skills.length > 0 || draftAgent.knowledgeSources.length > 0) && (
                <section className="mt-5 grid gap-3 md:grid-cols-3">
                  {draftAgent.appBindings.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-medium text-muted-foreground">应用</div>
                      <div className="flex flex-wrap gap-2">
                        {draftAgent.appBindings.map((binding) => (
                          <button
                            key={`${binding.slot}-${binding.app}`}
                            type="button"
                            onClick={() => removeAppBinding(binding)}
                            className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-foreground hover:bg-muted"
                          >
                            {binding.app}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {draftAgent.skills.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-medium text-muted-foreground">技能</div>
                      <div className="flex flex-wrap gap-2">
                        {draftAgent.skills.map((skill) => (
                          <button
                            key={skill}
                            type="button"
                            onClick={() => removeSkill(skill)}
                            className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-foreground hover:bg-muted"
                          >
                            {skill}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {draftAgent.knowledgeSources.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-medium text-muted-foreground">文件</div>
                      <div className="flex flex-wrap gap-2">
                        {draftAgent.knowledgeSources.map((source) => (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => void removeKnowledgeSource(source.id)}
                            className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-foreground hover:bg-muted"
                          >
                            {source.name}
                            {source.status === 'indexed' && source.chunkCount ? ` · ${source.chunkCount}` : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="mt-8">
                <h2 className="text-sm font-medium text-muted-foreground">指令</h2>
                <textarea
                  value={draftAgent.systemPrompt}
                  onChange={(event) => updateDraft({ systemPrompt: event.target.value })}
                  placeholder="为你的智能体提供操作指令。"
                  className="mt-3 min-h-[172px] w-full resize-y rounded-lg border border-border bg-background p-4 text-sm leading-7 text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                />
              </section>

              <section className="mt-6 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">模型与上下文</h2>
                  <span className="ml-auto text-xs text-muted-foreground">
                    最后更新：{formatUpdatedAt(draftAgent.updatedAt)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <TextField
                    label="供应商"
                    value={draftAgent.modelConfig.provider}
                    onChange={(value) => updateModelConfig({ provider: value })}
                    disabled
                  />
                  <TextField
                    label="模型"
                    value={draftAgent.modelConfig.model}
                    onChange={(value) => updateModelConfig({ model: value })}
                    disabled
                  />
                  <TextField
                    label="上下文 tokens"
                    type="number"
                    value={draftAgent.modelConfig.contextWindowTokens}
                    onChange={(value) => updateModelConfig({ contextWindowTokens: Number.parseInt(value, 10) || 1 })}
                    disabled
                  />
                  <TextField
                    label="Temperature"
                    type="number"
                    value={draftAgent.modelConfig.temperature}
                    onChange={(value) => updateModelConfig({ temperature: Number.parseFloat(value) || 0 })}
                  />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">状态</span>
                    <select
                      value={draftAgent.status}
                      onChange={(event) => updateDraft({ status: event.target.value as AgentStatus })}
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                    >
                      <option value="enabled">已启用</option>
                      <option value="draft">草稿</option>
                      <option value="paused">已暂停</option>
                    </select>
                  </label>
                  <TextField
                    label="模板仓库"
                    value={draftAgent.repository}
                    onChange={(value) => updateDraft({ repository: value })}
                    placeholder="local/agents"
                  />
                </div>
              </section>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => handleKnowledgeUpload(event, 'file')}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => handleKnowledgeUpload(event, 'folder')}
              />
            </>
          )}
        </main>
      </div>

      {activeModal === 'apps' && draftAgent && (
        <AppCatalogModal
          agent={draftAgent}
          projects={projects}
          selectedProject={selectedProject}
          onClose={() => setActiveModal(null)}
          onEnableApp={enableApp}
          onEnableMcpServer={enableMcpServer}
          onRemoveMcpServer={removeMcpServerBinding}
        />
      )}
      {activeModal === 'skills' && draftAgent && (
        <SkillsModal
          agent={draftAgent}
          onClose={() => setActiveModal(null)}
          onAddSkill={addSkill}
        />
      )}
    </div>
  );
}
