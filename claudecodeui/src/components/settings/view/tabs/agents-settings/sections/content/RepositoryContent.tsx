import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Heart,
  AlertTriangle,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { cn } from '../../../../../../../lib/utils';
import { api, apiFetch } from '../../../../../../../utils/api';
import type { SettingsProject } from '../../../../../types/types';

type RepositoryKind = 'agent-template' | 'skill' | 'mcp-server';
type InstallScope = 'user' | 'project';

type AppOption = {
  id: string;
  label: string;
  icon?: string;
  category?: string;
};

type AppSlot = {
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: AppOption[];
};

type RepositorySource = {
  id: string;
  name: string;
  type: 'local' | 'remote';
  url?: string | null;
  enabled: boolean;
  writable: boolean;
  description?: string;
  updatedAt?: string | null;
  itemCount?: number;
};

type RepositoryItem = {
  id: string;
  kind: RepositoryKind;
  name: string;
  title: string;
  description?: string;
  author?: string;
  version?: string;
  tags: string[];
  icon?: string | null;
  supportedApps?: AppOption[];
  appSlots?: AppSlot[];
  capabilities?: string[];
  dependencies?: AgentDependencies;
  mcp?: RepositoryMcpDefinition | null;
  likes: number;
  liked: boolean;
  downloads: number;
  repoId: string;
  repoName: string;
  repoWritable: boolean;
  contentUrl?: string | null;
  sourceUrl?: string | null;
  updatedAt?: string | null;
};

type RepositoryDependency = {
  kind: 'skill' | 'mcp-server';
  name: string;
  id?: string;
  itemId?: string;
  repoId?: string;
  optional?: boolean;
  configuration?: Record<string, unknown>;
};

type AgentDependencies = {
  skills?: RepositoryDependency[];
  mcpServers?: RepositoryDependency[];
};

type McpSetupField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'path' | 'path-list' | 'number' | 'select' | 'boolean';
  target: 'env' | 'arg' | 'args' | 'cwd' | 'url' | 'header' | 'tool-argument' | 'metadata';
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: string;
  options?: string[];
};

type RepositoryMcpDefinition = {
  serverName?: string;
  transport?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  setupFields?: McpSetupField[];
  runtimeFields?: McpSetupField[];
  tools?: Array<{ name: string; description?: string }>;
};

type InstalledMcpServer = {
  name: string;
  scope: 'user' | 'project' | 'local';
  workspacePath?: string;
  transport?: string;
};

type McpDiagnosticCheck = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  detail?: string;
};

type McpDiagnostics = {
  status: 'ok' | 'warning' | 'error';
  checkedAt: string;
  installDir?: string;
  configWritten?: boolean;
  packageInstalled?: boolean;
  dependenciesInstalled?: boolean;
  launchable?: {
    status: 'pass' | 'warn' | 'fail';
    message: string;
    detail?: string;
  } | null;
  runtimeToolsStatus?: {
    status: 'pass' | 'warn' | 'fail';
    tools?: string[];
    message: string;
  };
  safeMessages?: McpDiagnosticCheck[];
  requiredFields?: Array<{
    key: string;
    label: string;
    type?: string;
    target?: string;
    required?: boolean;
    configured: boolean;
  }>;
  checks: McpDiagnosticCheck[];
};

type InstalledSkill = {
  name: string;
  title?: string;
  scope: 'user' | 'project';
  provider: string;
  workspacePath?: string;
  path: string;
  skillPath: string;
  updatedAt?: string;
};

type UploadPackageFile = {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  size: number;
};

type CatalogResponse = {
  repositories: RepositorySource[];
  items: RepositoryItem[];
  errors: Array<{ repoId: string; repoName: string; error: string }>;
};

type UploadForm = {
  kind: RepositoryKind;
  name: string;
  title: string;
  description: string;
  author: string;
  tags: string;
  icon: string;
  supportedApps: string;
  capabilities: string;
  skillDependencies: string;
  mcpDependencies: string;
  content: string;
  packageFiles: UploadPackageFile[];
  overwrite: boolean;
};

const EMPTY_UPLOAD_FORM: UploadForm = {
  kind: 'agent-template',
  name: '',
  title: '',
  description: '',
  author: '',
  tags: '',
  icon: '',
  supportedApps: '',
  capabilities: '',
  skillDependencies: '',
  mcpDependencies: '',
  content: '',
  packageFiles: [],
  overwrite: false,
};

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string };

const DEFAULT_SLOT_LABELS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'chat', label: 'Chat' },
  { id: 'email', label: 'Email' },
  { id: 'knowledge', label: 'Knowledge base' },
  { id: 'project-tracker', label: 'Project tracker' },
] as const;

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseAppOptions(value: string): AppOption[] {
  return parseTags(value).map((label) => ({
    id: label.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || label,
    label,
  }));
}

function parseDependencies(value: string, kind: 'skill' | 'mcp-server'): RepositoryDependency[] {
  return parseTags(value).map((name) => ({ kind, name }));
}

function dependencyName(dependency: RepositoryDependency) {
  return dependency.name || dependency.itemId || dependency.id || 'dependency';
}

function dependencyChipLabel(dependency: RepositoryDependency) {
  return `${dependency.kind === 'mcp-server' ? 'MCP' : 'Skill'}: ${dependencyName(dependency)}`;
}

function getFileRelativePath(file: File) {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return (withRelativePath.webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
}

function stripCommonRoot(paths: string[]) {
  const firstSegments = paths
    .map((filePath) => filePath.split('/').filter(Boolean)[0])
    .filter(Boolean);
  if (firstSegments.length === 0 || !firstSegments.every((segment) => segment === firstSegments[0])) {
    return { rootName: '', paths };
  }
  const rootName = firstSegments[0];
  return {
    rootName,
    paths: paths.map((filePath) => filePath.split('/').slice(1).join('/')).filter(Boolean),
  };
}

function isTextPackageFile(file: File, relativePath: string) {
  if (file.type.startsWith('text/')) return true;
  return /\.(md|markdown|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|js|jsx|ts|tsx|mjs|cjs|py|ps1|psm1|sh|bash|zsh|fish|bat|cmd|css|html?|xml|csv|svg|rs|go|java|cs|c|cpp|h|hpp|sql)$/i.test(relativePath);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function readPackageFile(file: File, relativePath: string): Promise<UploadPackageFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isTextPackageFile(file, relativePath)) {
    return {
      path: relativePath,
      content: new TextDecoder('utf-8').decode(bytes),
      encoding: 'utf8',
      size: file.size,
    };
  }
  return {
    path: relativePath,
    content: bytesToBase64(bytes),
    encoding: 'base64',
    size: file.size,
  };
}

async function readError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    if (data?.code === 'INSTALL_TARGET_EXISTS') {
      return data.details || '安装目标已经存在。请点击“更新”，或勾选“Overwrite existing installed files”后重试。';
    }
    return data.details || data.error || fallback;
  } catch {
    return fallback;
  }
}

function kindLabel(kind: RepositoryKind) {
  if (kind === 'skill') return 'Skill';
  if (kind === 'mcp-server') return 'MCP';
  return 'Agent';
}

function kindAccent(kind: RepositoryKind) {
  if (kind === 'skill') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';
  }
  if (kind === 'mcp-server') {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300';
  }
  return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300';
}

function templateKey(item: RepositoryItem) {
  return `${item.repoId}:${item.id}`;
}

function normalizeInstallName(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^skill-/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeLocalPath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function itemNameCandidates(item: RepositoryItem) {
  return new Set([item.name, item.title, item.id]
    .map(normalizeInstallName)
    .filter(Boolean));
}

function getMcpServerName(item: RepositoryItem) {
  return normalizeInstallName(item.mcp?.serverName || item.name || item.id || item.title);
}

function getMcpSetupFields(item: RepositoryItem) {
  return item.mcp?.setupFields || [];
}

function getMcpRuntimeFields(item: RepositoryItem) {
  return item.mcp?.runtimeFields || [];
}

function formatAppLabel(app: AppOption | string) {
  return typeof app === 'string' ? app : app.label;
}

function stripAgentMarkdownFrontmatter(content: string) {
  const trimmed = String(content || '').trim();
  if (!trimmed.startsWith('---')) {
    return trimmed;
  }
  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex < 0) {
    return trimmed;
  }
  return trimmed.slice(endIndex + 4).trim();
}

function toAgentId(item: RepositoryItem) {
  return (item.name || item.id || item.title)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `agent-${Date.now()}`;
}

function dependencySkillNames(item: RepositoryItem, installResult?: { dependencies?: Array<{ kind?: string; name?: string; title?: string }> }) {
  const names = new Set<string>();
  for (const dependency of item.dependencies?.skills || []) {
    names.add(dependencyName(dependency));
  }
  for (const dependency of installResult?.dependencies || []) {
    if (dependency.kind === 'skill' && dependency.name) {
      names.add(dependency.name);
    }
  }
  return Array.from(names).filter(Boolean);
}

function dependencyMcpBindings(_item: RepositoryItem, installResult?: { dependencies?: Array<{ kind?: string; name?: string; status?: string; mcpServer?: { name?: string } }> }) {
  const names = new Set<string>();
  for (const dependency of installResult?.dependencies || []) {
    if (
      dependency.kind === 'mcp-server'
      && !['needs-configuration', 'missing-optional', 'failed-optional'].includes(String(dependency.status || ''))
    ) {
      names.add(dependency.mcpServer?.name || dependency.name || '');
    }
  }
  return Array.from(names)
    .filter(Boolean)
    .map((name) => ({
      slot: `mcp-${toAgentId({ name, id: name, title: name, kind: 'agent-template', tags: [], likes: 0, liked: false, downloads: 0, repoId: '', repoName: '', repoWritable: false })}`,
      app: `MCP: ${name}`,
      status: 'optional' as const,
    }));
}

function dependencyStatusSummary(installResult?: { dependencies?: Array<{ kind?: string; name?: string; status?: string }> }) {
  const dependencies = installResult?.dependencies || [];
  if (dependencies.length === 0) return '';
  const skillInstalled = dependencies.filter((dependency) => dependency.kind === 'skill' && ['installed', 'already-installed'].includes(String(dependency.status || ''))).length;
  const mcpConfigured = dependencies.filter((dependency) => dependency.kind === 'mcp-server' && ['installed', 'already-installed'].includes(String(dependency.status || ''))).length;
  const mcpMissingConfig = dependencies.filter((dependency) => dependency.kind === 'mcp-server' && dependency.status === 'needs-configuration').length;
  const failed = dependencies.filter((dependency) => String(dependency.status || '').includes('failed')).length;
  return [
    skillInstalled > 0 ? `${skillInstalled} Skill 已安装` : '',
    mcpConfigured > 0 ? `${mcpConfigured} MCP 已配置` : '',
    mcpMissingConfig > 0 ? `${mcpMissingConfig} MCP 缺配置` : '',
    failed > 0 ? `${failed} 依赖失败` : '',
  ].filter(Boolean).join('，');
}

function getTemplateSlots(item: RepositoryItem): AppSlot[] {
  if (item.appSlots && item.appSlots.length > 0) {
    return item.appSlots;
  }

  const supportedApps = item.supportedApps || [];
  if (supportedApps.length === 0) {
    return [];
  }

  return DEFAULT_SLOT_LABELS.map((slot) => ({
    ...slot,
    placeholder: 'Add application',
    options: supportedApps,
  }));
}

type ItemCardProps = {
  item: RepositoryItem;
  busy: boolean;
  installed: boolean;
  onLike: (item: RepositoryItem) => void;
  onInstall: (item: RepositoryItem) => void;
  onUpdate: (item: RepositoryItem) => void;
  onUninstall: (item: RepositoryItem) => void;
  onDiagnose?: (item: RepositoryItem) => void;
  diagnostics?: McpDiagnostics;
};

function ItemCard({ item, busy, installed, onLike, onInstall, onUpdate, onUninstall, onDiagnose, diagnostics }: ItemCardProps) {
  const diagnosticStatusClass = diagnostics?.status === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
    : diagnostics?.status === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
      : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300';

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', kindAccent(item.kind))}>
              {kindLabel(item.kind)}
            </span>
            <h4 className="truncate text-sm font-semibold text-foreground">{item.title}</h4>
            {installed && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                已安装
              </span>
            )}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {item.repoName}
            </span>
          </div>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
              {item.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {item.author && <span>{item.author}</span>}
            {item.version && <span>v{item.version}</span>}
            {item.downloads > 0 && <span>{item.downloads} installs</span>}
            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                source
              </a>
            )}
          </div>
          {item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.slice(0, 6).map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {item.kind === 'mcp-server' && (
            <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
              {item.mcp?.transport && (
                <span className="rounded bg-muted px-1.5 py-0.5">{item.mcp.transport}</span>
              )}
              {getMcpSetupFields(item).length > 0 && (
                <span className="rounded bg-muted px-1.5 py-0.5">{getMcpSetupFields(item).length} config</span>
              )}
              {(item.mcp?.tools || []).slice(0, 3).map((tool) => (
                <span key={tool.name} className="rounded bg-muted px-1.5 py-0.5">{tool.name}</span>
              ))}
            </div>
          )}
          {diagnostics && (
            <div className="mt-3 rounded-lg border border-border bg-muted/25 p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn('rounded border px-1.5 py-0.5 font-medium', diagnosticStatusClass)}>
                  {diagnostics.status === 'ok' ? '可调用' : diagnostics.status === 'warning' ? '需确认' : '不可用'}
                </span>
                <span className="text-muted-foreground">检测时间 {new Date(diagnostics.checkedAt).toLocaleString()}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className={cn(
                  'rounded border px-1.5 py-0.5',
                  diagnostics.configWritten ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
                )}>
                  配置 {diagnostics.configWritten ? '已写入' : '缺失'}
                </span>
                <span className={cn(
                  'rounded border px-1.5 py-0.5',
                  diagnostics.packageInstalled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
                )}>
                  包 {diagnostics.packageInstalled ? '已安装' : '缺失'}
                </span>
                <span className={cn(
                  'rounded border px-1.5 py-0.5',
                  diagnostics.dependenciesInstalled !== false ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
                )}>
                  依赖 {diagnostics.dependenciesInstalled === false ? '缺失' : '已满足'}
                </span>
                {diagnostics.launchable && (
                  <span className={cn(
                    'rounded border px-1.5 py-0.5',
                    diagnostics.launchable.status === 'pass'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : diagnostics.launchable.status === 'warn'
                        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                        : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
                  )}>
                    启动 {diagnostics.launchable.status === 'pass' ? '成功' : diagnostics.launchable.status === 'warn' ? '需确认' : '失败'}
                  </span>
                )}
                {diagnostics.runtimeToolsStatus && (
                  <span className="rounded border border-border bg-background px-1.5 py-0.5 text-muted-foreground">
                    工具 {diagnostics.runtimeToolsStatus.tools?.length ? `${diagnostics.runtimeToolsStatus.tools.length} declared` : '运行时发现'}
                  </span>
                )}
              </div>
              {diagnostics.requiredFields && diagnostics.requiredFields.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {diagnostics.requiredFields.map((field) => (
                    <span
                      key={`${field.target}:${field.key}`}
                      className={cn(
                        'rounded border px-1.5 py-0.5',
                        field.configured
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
                      )}
                    >
                      {field.label || field.key}: {field.configured ? 'configured' : 'missing'}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                {(diagnostics.safeMessages || diagnostics.checks).map((check) => (
                  <div key={check.id} className="flex gap-1.5">
                    <span className={cn(
                      'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                      check.status === 'pass' && 'bg-emerald-500',
                      check.status === 'warn' && 'bg-amber-500',
                      check.status === 'fail' && 'bg-red-500',
                    )} />
                    <span className="min-w-0">
                      {check.message}
                      {check.detail && <span className="ml-1 break-all opacity-80">{check.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onLike(item)}
            disabled={busy}
            title={item.liked ? 'Unlike' : 'Like'}
            className={cn(
              'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded border px-2 text-xs transition-colors',
              item.liked
                ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Heart className={cn('h-3.5 w-3.5', item.liked && 'fill-current')} />
            <span>{item.likes}</span>
          </button>
          {installed ? (
            <>
              {item.kind === 'mcp-server' && onDiagnose && (
                <button
                  type="button"
                  onClick={() => onDiagnose(item)}
                  disabled={busy}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  检测
                </button>
              )}
              <button
                type="button"
                onClick={() => onUpdate(item)}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                更新
              </button>
              <button
                type="button"
                onClick={() => onUninstall(item)}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-red-200 px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                卸载
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onInstall(item)}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {item.kind === 'mcp-server' ? 'Pull & Configure' : 'Pull'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type TemplateGalleryProps = {
  templates: RepositoryItem[];
  selectedTemplate: RepositoryItem | null;
  selectedKey: string | null;
  busyKey: string | null;
  onSelect: (item: RepositoryItem) => void;
  onLike: (item: RepositoryItem) => void;
  onUseTemplate: (item: RepositoryItem) => void;
};

function TemplateGallery({
  templates,
  selectedTemplate,
  selectedKey,
  busyKey,
  onSelect,
  onLike,
  onUseTemplate,
}: TemplateGalleryProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid min-h-[420px] md:grid-cols-[250px_1fr]">
        <div className="border-b border-border bg-muted/30 p-3 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-sm text-muted-foreground">
            <Search className="h-4 w-4" />
            <span>Search templates</span>
          </div>
          <div className="mt-2 max-h-[360px] space-y-1 overflow-y-auto pr-1">
            {templates.map((item) => {
              const key = templateKey(item);
              const active = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(item)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                  )}
                >
                  <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-background text-xs">
                    {item.icon || <Bot className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate">{item.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative p-5">
          {selectedTemplate ? (
            <div className="flex h-full flex-col">
              <div className="flex min-w-0 items-start gap-4">
                <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-lg text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                  {selectedTemplate.icon || <Bot className="h-6 w-6" />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold text-foreground">{selectedTemplate.title}</h3>
                    <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{selectedTemplate.repoName}</span>
                  </div>
                  {selectedTemplate.description && (
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                      {selectedTemplate.description}
                    </p>
                  )}
                </div>
              </div>

              {(selectedTemplate.supportedApps || []).length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-foreground">Supported apps</h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(selectedTemplate.supportedApps || []).map((app) => (
                      <span key={app.id || app.label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground">
                        {app.icon && <span className="text-xs">{app.icon}</span>}
                        {formatAppLabel(app)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(selectedTemplate.capabilities || []).length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-foreground">Capabilities</h4>
                  <ul className="mt-2 grid gap-2 text-sm text-muted-foreground">
                    {(selectedTemplate.capabilities || []).map((capability) => (
                      <li key={capability} className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span>{capability}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {((selectedTemplate.dependencies?.skills || []).length > 0 || (selectedTemplate.dependencies?.mcpServers || []).length > 0) && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-foreground">Dependencies</h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[...(selectedTemplate.dependencies?.skills || []), ...(selectedTemplate.dependencies?.mcpServers || [])].map((dependency) => (
                      <span
                        key={`${dependency.kind}:${dependency.repoId || selectedTemplate.repoId}:${dependencyName(dependency)}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                      >
                        {dependencyChipLabel(dependency)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => onLike(selectedTemplate)}
                  disabled={busyKey === `like:${selectedTemplate.repoId}:${selectedTemplate.id}`}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded border px-3 text-sm transition-colors',
                    selectedTemplate.liked
                      ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Heart className={cn('h-4 w-4', selectedTemplate.liked && 'fill-current')} />
                  {selectedTemplate.likes}
                </button>
                <button
                  type="button"
                  onClick={() => onUseTemplate(selectedTemplate)}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                >
                  <Settings2 className="h-4 w-4" />
                  Use template
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No agent templates found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type AgentSetupDialogProps = {
  item: RepositoryItem;
  values: Record<string, string>;
  busy: boolean;
  onChange: (slotId: string, value: string) => void;
  onClose: () => void;
  onCreate: () => void;
};

function AgentSetupDialog({ item, values, busy, onChange, onClose, onCreate }: AgentSetupDialogProps) {
  const slots = getTemplateSlots(item);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[520px] rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{item.title} Setup</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose the applications this agent should treat as its working context.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          {slots.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              This template does not require application setup.
            </div>
          ) : (
            slots.map((slot) => (
              <div key={slot.id} className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-center">
                <label className="text-sm font-medium text-foreground">{slot.label}</label>
                <select
                  value={values[slot.id] || ''}
                  onChange={(event) => onChange(slot.id, event.target.value)}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">{slot.placeholder || 'Add application'}</option>
                  {(slot.options || []).map((option) => (
                    <option key={option.id || option.label} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-full border border-border px-4 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create agent
          </button>
        </div>
      </div>
    </div>
  );
}

type McpSetupDialogProps = {
  item: RepositoryItem;
  values: Record<string, string>;
  busy: boolean;
  action: 'install' | 'update';
  error?: string | null;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

function McpSetupDialog({ item, values, busy, action, error, onChange, onClose, onSave }: McpSetupDialogProps) {
  const setupFields = getMcpSetupFields(item);
  const runtimeFields = getMcpRuntimeFields(item);
  const tools = item.mcp?.tools || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                <Server className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="text-xs text-muted-foreground">
                  MCP server: {item.mcp?.serverName || item.name}
                </p>
              </div>
            </div>
            {item.description && (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Pull 会把 MCP 包下载安装到本机，然后写入 MTL-Code/Claude Code 的 MCP 配置。
            工具列表由后端运行时发现；这里先配置启动参数和必填输入。
          </div>

          <div className="mt-5 grid gap-4">
            {setupFields.length === 0 ? (
              <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
                这个 MCP 不需要额外启动配置。
              </div>
            ) : (
              setupFields.map((field) => (
                <label key={field.key} className="grid gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {field.label || field.key}
                    {field.required && <span className="text-red-500">*</span>}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      {field.target}
                    </span>
                  </span>
                  {field.type === 'select' ? (
                    <select
                      value={values[field.key] ?? field.defaultValue ?? ''}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                    >
                      <option value="">{field.placeholder || 'Select value'}</option>
                      {(field.options || []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={values[field.key] ?? field.defaultValue ?? ''}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      placeholder={field.placeholder || field.key}
                      type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                      className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                  )}
                  {field.description && (
                    <span className="text-xs leading-5 text-muted-foreground">{field.description}</span>
                  )}
                </label>
              ))
            )}
          </div>

          {runtimeFields.length > 0 && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="font-medium">运行时输入</div>
              <div className="mt-2 grid gap-1">
                {runtimeFields.map((field) => (
                  <div key={field.key}>
                    <span className="font-mono">{field.key}</span>
                    {field.required && <span> 必填</span>}
                    {field.description && <span>：{field.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tools.length > 0 && (
            <div className="mt-5">
              <h4 className="text-sm font-medium text-foreground">包含工具</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {tools.slice(0, 16).map((tool) => (
                  <span key={tool.name} className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                    {tool.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 break-words">{error}</div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border p-5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-full border border-border px-4 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {action === 'update' ? '更新 MCP' : '安装并配置 MCP'}
          </button>
        </div>
      </div>
    </div>
  );
}

type RepositoryContentProps = {
  projects: SettingsProject[];
};

export default function RepositoryContent({ projects }: RepositoryContentProps) {
  const [repositories, setRepositories] = useState<RepositorySource[]>([]);
  const [items, setItems] = useState<RepositoryItem[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installedMcpServers, setInstalledMcpServers] = useState<InstalledMcpServer[]>([]);
  const [errors, setErrors] = useState<CatalogResponse['errors']>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | RepositoryKind>('all');
  const [search, setSearch] = useState('');
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [uploadRepoId, setUploadRepoId] = useState('');
  const [uploadAdminToken, setUploadAdminToken] = useState('');
  const [installScope, setInstallScope] = useState<InstallScope>('user');
  const [projectPath, setProjectPath] = useState('');
  const [overwriteInstall, setOverwriteInstall] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadForm>(EMPTY_UPLOAD_FORM);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null);
  const [setupItem, setSetupItem] = useState<RepositoryItem | null>(null);
  const [setupValues, setSetupValues] = useState<Record<string, string>>({});
  const [mcpSetupItem, setMcpSetupItem] = useState<RepositoryItem | null>(null);
  const [mcpSetupValues, setMcpSetupValues] = useState<Record<string, string>>({});
  const [mcpSetupAction, setMcpSetupAction] = useState<'install' | 'update'>('install');
  const [mcpDiagnostics, setMcpDiagnostics] = useState<Record<string, McpDiagnostics>>({});
  const selectedProjectPath = installScope === 'project' ? projectPath : '';

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/agent-repository/catalog');
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to load repository catalog'));
      }
      const data = (await response.json()) as CatalogResponse;
      setRepositories(data.repositories || []);
      setItems(data.items || []);
      setErrors(data.errors || []);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load repository catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadInstalledSkills = useCallback(async () => {
    try {
      const response = await api.installedAgentSkills(selectedProjectPath);
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to load installed skills'));
      }
      const data = await response.json();
      setInstalledSkills(Array.isArray(data.skills) ? data.skills : []);
    } catch {
      setInstalledSkills([]);
    }
  }, [selectedProjectPath]);

  useEffect(() => {
    void loadInstalledSkills();
  }, [loadInstalledSkills]);

  const loadInstalledMcpServers = useCallback(async () => {
    try {
      if (installScope === 'project' && !selectedProjectPath) {
        setInstalledMcpServers([]);
        return;
      }
      const scope = installScope === 'project' ? 'project' : 'user';
      const response = await api.mcpServers('claude', scope, selectedProjectPath);
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to load MCP servers'));
      }
      const data = await response.json();
      setInstalledMcpServers(Array.isArray(data.data?.servers) ? data.data.servers : []);
    } catch {
      setInstalledMcpServers([]);
    }
  }, [installScope, selectedProjectPath]);

  useEffect(() => {
    void loadInstalledMcpServers();
  }, [loadInstalledMcpServers]);

  useEffect(() => {
    if (installScope === 'project' && !projectPath && projects[0]) {
      setProjectPath(projects[0].fullPath || projects[0].path || '');
    }
  }, [installScope, projectPath, projects]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (!query) return true;
      const appLabels = (item.supportedApps || []).map((app) => app.label);
      const mcpTools = (item.mcp?.tools || []).map((tool) => tool.name);
      const mcpFields = [
        ...(item.mcp?.setupFields || []).map((field) => field.label || field.key),
        ...(item.mcp?.runtimeFields || []).map((field) => field.label || field.key),
      ];
      const haystack = [
        item.title,
        item.name,
        item.description,
        item.author,
        item.repoName,
        ...item.tags,
        ...appLabels,
        ...(item.capabilities || []),
        item.mcp?.serverName,
        ...mcpTools,
        ...mcpFields,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [items, kindFilter, search]);

  const agentTemplates = useMemo(
    () => filteredItems.filter((item) => item.kind === 'agent-template'),
    [filteredItems],
  );
  const skillItems = useMemo(
    () => filteredItems.filter((item) => item.kind === 'skill'),
    [filteredItems],
  );
  const mcpItems = useMemo(
    () => filteredItems.filter((item) => item.kind === 'mcp-server'),
    [filteredItems],
  );

  const installedSkillNames = useMemo(() => {
    const names = new Set<string>();
    for (const skill of installedSkills) {
      const isSelectedTarget = installScope === 'project'
        ? skill.scope === 'project'
          && skill.provider === 'claude'
          && normalizeLocalPath(skill.workspacePath || '') === normalizeLocalPath(projectPath)
        : skill.scope === 'user' && skill.provider === 'mtl-code';
      if (isSelectedTarget) {
        names.add(normalizeInstallName(skill.name));
        if (skill.title) names.add(normalizeInstallName(skill.title));
      }
    }
    return names;
  }, [installScope, installedSkills, projectPath]);

  const isSkillInstalled = useCallback((item: RepositoryItem) => {
    if (item.kind !== 'skill') return false;
    const candidates = itemNameCandidates(item);
    return Array.from(candidates).some((name) => installedSkillNames.has(name));
  }, [installedSkillNames]);

  const installedMcpServerNames = useMemo(() => (
    new Set(installedMcpServers.map((server) => normalizeInstallName(server.name)).filter(Boolean))
  ), [installedMcpServers]);

  const isMcpInstalled = useCallback((item: RepositoryItem) => {
    if (item.kind !== 'mcp-server') return false;
    return installedMcpServerNames.has(getMcpServerName(item));
  }, [installedMcpServerNames]);

  const diagnoseMcpItem = useCallback(async (item: RepositoryItem) => {
    if (item.kind !== 'mcp-server') return;
    const serverName = getMcpServerName(item);
    const scope = installScope === 'project' ? 'project' : 'user';
    const key = templateKey(item);
    setBusyKey(`diagnose:${item.repoId}:${item.id}`);
    setActionError(null);
    setMessage(null);
    try {
      const response = await api.diagnoseMcpServer('claude', serverName, scope, selectedProjectPath);
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to diagnose MCP server'));
      }
      const data = await response.json();
      setMcpDiagnostics((prev) => ({
        ...prev,
        [key]: data.data as McpDiagnostics,
      }));
      setMessage(`MCP "${serverName}" 检测完成：${data.data?.status || 'unknown'}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to diagnose MCP server');
    } finally {
      setBusyKey(null);
    }
  }, [installScope, selectedProjectPath]);

  useEffect(() => {
    if (agentTemplates.length === 0) {
      setSelectedTemplateKey(null);
      return;
    }
    if (!selectedTemplateKey || !agentTemplates.some((item) => templateKey(item) === selectedTemplateKey)) {
      setSelectedTemplateKey(templateKey(agentTemplates[0]));
    }
  }, [agentTemplates, selectedTemplateKey]);

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateKey) return agentTemplates[0] || null;
    return agentTemplates.find((item) => templateKey(item) === selectedTemplateKey) || agentTemplates[0] || null;
  }, [agentTemplates, selectedTemplateKey]);

  const remoteUploadRepositories = useMemo(
    () => repositories.filter((repo) => repo.type !== 'local' && repo.enabled && repo.url),
    [repositories],
  );
  const itemCounts = useMemo(() => ({
    agents: items.filter((item) => item.kind === 'agent-template').length,
    skills: items.filter((item) => item.kind === 'skill').length,
    mcps: items.filter((item) => item.kind === 'mcp-server').length,
  }), [items]);

  useEffect(() => {
    if (uploadRepoId && remoteUploadRepositories.some((repo) => repo.id === uploadRepoId)) {
      return;
    }
    setUploadRepoId(remoteUploadRepositories[0]?.id || '');
  }, [remoteUploadRepositories, uploadRepoId]);

  const addRepository = async () => {
    setBusyKey('add-repo');
    setActionError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/agent-repository/sources', {
        method: 'POST',
        body: JSON.stringify({ name: newRepoName, url: newRepoUrl }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to add repository'));
      }
      setNewRepoName('');
      setNewRepoUrl('');
      setMessage('Repository added.');
      await loadCatalog();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to add repository');
    } finally {
      setBusyKey(null);
    }
  };

  const removeRepository = async (repoId: string) => {
    setBusyKey(`remove:${repoId}`);
    setActionError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/agent-repository/sources/${encodeURIComponent(repoId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to remove repository'));
      }
      setMessage('Repository removed.');
      await loadCatalog();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to remove repository');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleRepository = async (repo: RepositorySource) => {
    setBusyKey(`toggle:${repo.id}`);
    setActionError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/agent-repository/sources/${encodeURIComponent(repo.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !repo.enabled }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to update repository'));
      }
      await loadCatalog();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update repository');
    } finally {
      setBusyKey(null);
    }
  };

  const likeItem = async (item: RepositoryItem) => {
    const key = `like:${item.repoId}:${item.id}`;
    setBusyKey(key);
    setActionError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/agent-repository/items/${encodeURIComponent(item.repoId)}/${encodeURIComponent(item.id)}/like`, {
        method: 'POST',
        body: JSON.stringify({ liked: !item.liked }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to update like'));
      }
      const data = await response.json();
      if (data.item) {
        setItems((prev) => prev.map((candidate) => (
          candidate.repoId === item.repoId && candidate.id === item.id ? data.item : candidate
        )));
      } else {
        await loadCatalog();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update like');
    } finally {
      setBusyKey(null);
    }
  };

  const installItem = async (
    item: RepositoryItem,
    configuration?: { appBindings?: Record<string, string>; mcpValues?: Record<string, string> },
    options?: { overwrite?: boolean; action?: 'install' | 'update' },
  ) => {
    const action = options?.action || 'install';
    const key = `${action}:${item.repoId}:${item.id}`;
    setBusyKey(key);
    setActionError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/agent-repository/install', {
        method: 'POST',
        body: JSON.stringify({
          repoId: item.repoId,
          itemId: item.id,
          target: installScope,
          projectPath: installScope === 'project' ? projectPath : undefined,
          overwrite: options?.overwrite ?? overwriteInstall,
          configuration,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to install item'));
      }
      const data = await response.json();
      const actionText = action === 'update' ? '已更新' : '已安装';
      const targetText = installScope === 'project' ? '项目范围' : '用户范围';
      const installPath = typeof data.installPath === 'string' && data.installPath.trim()
        ? `：${data.installPath.trim()}`
        : '';
      setMessage(`${kindLabel(item.kind)}「${item.title || item.name}」${actionText}到${targetText}${installPath}`);
      setSetupItem(null);
      setSetupValues({});
      setMcpSetupItem(null);
      setMcpSetupValues({});
      await loadCatalog();
      await loadInstalledSkills();
      await loadInstalledMcpServers();
      return data;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to install item');
      return null;
    } finally {
      setBusyKey(null);
    }
  };

  const uninstallItem = async (item: RepositoryItem) => {
    const key = `uninstall:${item.repoId}:${item.id}`;
    setBusyKey(key);
    setActionError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/agent-repository/install', {
        method: 'DELETE',
        body: JSON.stringify({
          repoId: item.repoId,
          itemId: item.id,
          target: installScope,
          projectPath: installScope === 'project' ? projectPath : undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to uninstall item'));
      }
      const data = await response.json();
      setMessage(`${kindLabel(item.kind)} uninstalled from ${data.installPath}`);
      await loadInstalledSkills();
      await loadInstalledMcpServers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to uninstall item');
    } finally {
      setBusyKey(null);
    }
  };

  const openTemplateSetup = (item: RepositoryItem) => {
    const slots = getTemplateSlots(item);
    const nextValues: Record<string, string> = {};
    for (const slot of slots) {
      nextValues[slot.id] = '';
    }
    setSetupItem(item);
    setSetupValues(nextValues);
  };

  const openMcpSetup = (item: RepositoryItem, action: 'install' | 'update' = 'install') => {
    const nextValues: Record<string, string> = {};
    for (const field of getMcpSetupFields(item)) {
      nextValues[field.key] = field.defaultValue || '';
    }
    setActionError(null);
    setMcpSetupItem(item);
    setMcpSetupValues(nextValues);
    setMcpSetupAction(action);
  };

  const saveConfiguredMcp = async () => {
    if (!mcpSetupItem) return;
    const result = await installItem(
      mcpSetupItem,
      { mcpValues: mcpSetupValues },
      { overwrite: mcpSetupAction === 'update' ? true : overwriteInstall, action: mcpSetupAction },
    );
    if (result?.success) {
      setMcpSetupItem(null);
      setMcpSetupValues({});
      await diagnoseMcpItem(mcpSetupItem);
    }
  };

  const createConfiguredAgent = async () => {
    if (!setupItem) return;
    const appBindings = Object.fromEntries(
      Object.entries(setupValues).filter(([, value]) => value.trim()),
    );
    const installResult = await installItem(setupItem, { appBindings });
    if (!installResult?.success) {
      return;
    }

    const prompt = stripAgentMarkdownFrontmatter(String(installResult.content || ''));
    const selectedBindings = Object.entries(appBindings).map(([slot, app]) => ({
      slot,
      app,
      status: 'optional' as const,
    }));
    const mcpDependencyBindings = dependencyMcpBindings(setupItem, installResult);
    const mergedBindings = [...selectedBindings];
    for (const binding of mcpDependencyBindings) {
      if (!mergedBindings.some((candidate) => candidate.app === binding.app)) {
        mergedBindings.push(binding);
      }
    }
    const installedSkillDependencies = dependencySkillNames(setupItem, installResult);
    const response = await api.createAgent({
      id: toAgentId(setupItem),
      name: setupItem.title || setupItem.name,
      shortName: (setupItem.title || setupItem.name).slice(0, 6),
      description: setupItem.description || '',
      status: 'enabled',
      scope: installScope === 'project' ? 'project' : 'global',
      repository: `${setupItem.repoId}/${setupItem.id}`,
      systemPrompt: prompt || setupItem.description || '',
      appBindings: mergedBindings,
      skills: installedSkillDependencies,
      tools: [],
      guardrails: [],
      triggerRules: {
        mode: 'suggest',
        keywords: [setupItem.name, setupItem.title].filter(Boolean),
        confidenceThreshold: 0.8,
      },
    });
    const data = await response.json();
    if (!response.ok || data?.success === false) {
      setActionError(data?.error || 'Template installed, but Agent creation failed');
      return;
    }
    const dependencyCount = installResult.dependencies?.length || 0;
    const dependencySummary = dependencyStatusSummary(installResult);
    setMessage(
      `Agent "${data.agent?.name || setupItem.title}" created and enabled. Dependencies processed: ${dependencyCount}`
      + (dependencySummary ? ` (${dependencySummary}).` : '.'),
    );
  };

  const uploadItem = async () => {
    setBusyKey('upload');
    setActionError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/agent-repository/remote-upload', {
        method: 'POST',
        body: JSON.stringify({
          repoId: uploadRepoId,
          adminToken: uploadAdminToken,
          ...uploadForm,
          packageFiles: uploadForm.kind === 'skill' ? uploadForm.packageFiles : [],
          tags: parseTags(uploadForm.tags),
          supportedApps: parseAppOptions(uploadForm.supportedApps),
          capabilities: parseTags(uploadForm.capabilities),
          dependencies: uploadForm.kind === 'agent-template'
            ? {
                skills: parseDependencies(uploadForm.skillDependencies, 'skill'),
                mcpServers: parseDependencies(uploadForm.mcpDependencies, 'mcp-server'),
              }
            : undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to upload item'));
      }
      setUploadForm((prev) => ({ ...EMPTY_UPLOAD_FORM, kind: prev.kind }));
      const repository = remoteUploadRepositories.find((repo) => repo.id === uploadRepoId);
      setMessage(`Uploaded to ${repository?.name || 'remote Hub'}.`);
      await loadCatalog();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to upload item');
    } finally {
      setBusyKey(null);
    }
  };

  const readUploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const name = file.name.replace(/\.(md|txt)$/i, '');
    setUploadForm((prev) => ({
      ...prev,
      name: prev.name || name,
      title: prev.title || name,
      content: text,
      packageFiles: [],
    }));
    event.target.value = '';
  };

  const readSkillPackageFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;
    setActionError(null);
    try {
      const rawPaths = selectedFiles.map(getFileRelativePath);
      const { rootName, paths } = stripCommonRoot(rawPaths);
      const pathPairs = selectedFiles
        .flatMap((file, index) => {
          const relativePath = paths[index] || rawPaths[index];
          return relativePath && !relativePath.endsWith('/') ? [{ file, relativePath }] : [];
        });
      if (!pathPairs.some((entry) => entry.relativePath.toLowerCase() === 'skill.md')) {
        throw new Error('Skill package must include SKILL.md at the selected folder root');
      }

      const packageFiles = await Promise.all(
        pathPairs.map((entry) => readPackageFile(entry.file, entry.relativePath)),
      );
      const skillFile = packageFiles.find((file) => file.path.toLowerCase() === 'skill.md');
      const skillContent = skillFile?.encoding === 'utf8' ? skillFile.content : '';
      const fallbackName = rootName || uploadForm.name || 'skill-package';
      setUploadForm((prev) => ({
        ...prev,
        kind: 'skill',
        name: prev.name || fallbackName,
        title: prev.title || fallbackName,
        content: skillContent || prev.content,
        packageFiles,
      }));
      setMessage(`Loaded Skill package with ${packageFiles.length} file(s).`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load Skill package');
    } finally {
      event.target.value = '';
    }
  };

  const uploadHasContent = Boolean(uploadForm.content.trim() || (uploadForm.kind === 'skill' && uploadForm.packageFiles.length > 0));
  const inlineActionError = Boolean(actionError && (setupItem || mcpSetupItem));
  const showRepositoryNotice = Boolean(message || (!inlineActionError && actionError) || errors.length > 0);

  return (
    <div className="space-y-4">
      {message && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[80] flex w-[calc(100vw-32px)] max-w-md items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-2xl ring-1 ring-emerald-900/5 dark:border-emerald-900/60 dark:bg-emerald-950 dark:text-emerald-200 sm:w-auto"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">操作成功</div>
            <div className="mt-0.5 break-all text-xs leading-5 opacity-90">{message}</div>
          </div>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
            title="关闭提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground">Agent Templates</h3>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-2 py-1">{repositories.length} repositories</span>
                <span className="rounded bg-muted px-2 py-1">{itemCounts.agents} agents</span>
                <span className="rounded bg-muted px-2 py-1">{itemCounts.skills} skills</span>
                <span className="rounded bg-muted px-2 py-1">{itemCounts.mcps} MCP</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadCatalog()}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Install Target</h3>
          </div>
          <div className="mt-3 grid gap-2">
            <select
              value={installScope}
              onChange={(event) => setInstallScope(event.target.value as InstallScope)}
              className="h-9 rounded border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="user">User scope (~/.mtl-code)</option>
              <option value="project" disabled={projects.length === 0}>Project scope (.claude)</option>
            </select>
            {installScope === 'project' && (
              <select
                value={projectPath}
                onChange={(event) => setProjectPath(event.target.value)}
                className="h-9 rounded border border-border bg-background px-2 text-sm text-foreground"
              >
                {projects.map((project) => {
                  const value = project.fullPath || project.path || '';
                  return (
                    <option key={`${project.name}:${value}`} value={value}>
                      {project.displayName || project.name}
                    </option>
                  );
                })}
              </select>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={overwriteInstall}
                onChange={(event) => setOverwriteInstall(event.target.checked)}
                className="h-3.5 w-3.5"
              />
              Overwrite existing installed files
            </label>
          </div>
        </div>
      </div>

      {showRepositoryNotice && (
        <div className={cn(
          'rounded border px-3 py-2 text-sm',
          (!inlineActionError && actionError) || errors.length > 0
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
        )}>
          {message && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span className="break-all">{message}</span>
            </div>
          )}
          {!inlineActionError && actionError && <div>{actionError}</div>}
          {errors.map((error) => (
            <div key={`${error.repoId}:${error.error}`}>
              {error.repoName}: {error.error}
            </div>
          ))}
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Agent/Skill/MCP Hub</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The shared remote repository server runs as a standalone Hub.
              It can publish Agent templates, Skills, and MCP server packages with setup fields such as root paths.
            </p>
          </div>
        </div>
      </section>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <label className="text-xs font-medium text-muted-foreground">Catalog URL</label>
            <input
              value={newRepoUrl}
              onChange={(event) => setNewRepoUrl(event.target.value)}
              placeholder="Enter catalog URL"
              className="mt-1 h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="w-full md:w-48">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={newRepoName}
              onChange={(event) => setNewRepoName(event.target.value)}
              placeholder="Team repository"
              className="mt-1 h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => void addRepository()}
            disabled={!newRepoUrl.trim() || busyKey === 'add-repo'}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busyKey === 'add-repo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {repositories.map((repo) => (
            <div key={repo.id} className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1 text-xs">
              <span className={cn('h-1.5 w-1.5 rounded-full', repo.enabled ? 'bg-emerald-500' : 'bg-muted-foreground')} />
              <span className="font-medium text-foreground">{repo.name}</span>
              <span className="text-muted-foreground">{repo.itemCount ?? 0}</span>
              {repo.url && (
                <span className="max-w-[180px] truncate text-muted-foreground" title={repo.url}>
                  {repo.url}
                </span>
              )}
              {repo.type !== 'local' && (
                <>
                  <button
                    type="button"
                    onClick={() => void toggleRepository(repo)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {repo.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeRepository(repo.id)}
                    title="Remove repository"
                    className="text-muted-foreground transition-colors hover:text-red-500"
                  >
                    {busyKey === `remove:${repo.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(380px,440px)]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search templates"
                className="h-9 w-full rounded border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
            <div className="inline-flex h-9 overflow-hidden rounded border border-border">
              {(['all', 'agent-template', 'skill', 'mcp-server'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kind)}
                  className={cn(
                    'px-3 text-sm transition-colors',
                    kindFilter === kind ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  {kind === 'all' ? 'All' : kindLabel(kind)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading repository catalog...
            </div>
          ) : (
            <div className="space-y-4">
              {(kindFilter === 'all' || kindFilter === 'agent-template') && (
                <TemplateGallery
                  templates={agentTemplates}
                  selectedTemplate={selectedTemplate}
                  selectedKey={selectedTemplateKey}
                  busyKey={busyKey}
                  onSelect={(item) => setSelectedTemplateKey(templateKey(item))}
                  onLike={(item) => void likeItem(item)}
                  onUseTemplate={openTemplateSetup}
                />
              )}

              {(kindFilter === 'all' || kindFilter === 'skill') && (
                <div className="space-y-2">
                  {skillItems.length > 0 && (
                    <h3 className="text-sm font-semibold text-foreground">Skills</h3>
                  )}
                  {skillItems.map((item) => {
                    const installed = isSkillInstalled(item);
                    const busy = busyKey === `like:${item.repoId}:${item.id}`
                      || busyKey === `install:${item.repoId}:${item.id}`
                      || busyKey === `update:${item.repoId}:${item.id}`
                      || busyKey === `uninstall:${item.repoId}:${item.id}`;
                    return (
                      <ItemCard
                        key={`${item.repoId}:${item.id}`}
                        item={item}
                        busy={busy}
                        installed={installed}
                        onLike={(nextItem) => void likeItem(nextItem)}
                        onInstall={(nextItem) => void installItem(nextItem)}
                        onUpdate={(nextItem) => void installItem(nextItem, undefined, { overwrite: true, action: 'update' })}
                        onUninstall={(nextItem) => void uninstallItem(nextItem)}
                      />
                    );
                  })}
                  {skillItems.length === 0 && kindFilter === 'skill' && (
                    <div className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                      No skills found.
                    </div>
                  )}
                </div>
              )}

              {(kindFilter === 'all' || kindFilter === 'mcp-server') && (
                <div className="space-y-2">
                  {mcpItems.length > 0 && (
                    <h3 className="text-sm font-semibold text-foreground">MCP Servers</h3>
                  )}
                  {mcpItems.map((item) => {
                    const installed = isMcpInstalled(item);
                    const busy = busyKey === `like:${item.repoId}:${item.id}`
                      || busyKey === `install:${item.repoId}:${item.id}`
                      || busyKey === `update:${item.repoId}:${item.id}`
                      || busyKey === `uninstall:${item.repoId}:${item.id}`
                      || busyKey === `diagnose:${item.repoId}:${item.id}`;
                    return (
                      <ItemCard
                        key={`${item.repoId}:${item.id}`}
                        item={item}
                        busy={busy}
                        installed={installed}
                        diagnostics={mcpDiagnostics[templateKey(item)]}
                        onLike={(nextItem) => void likeItem(nextItem)}
                        onInstall={(nextItem) => openMcpSetup(nextItem, 'install')}
                        onUpdate={(nextItem) => openMcpSetup(nextItem, 'update')}
                        onUninstall={(nextItem) => void uninstallItem(nextItem)}
                        onDiagnose={(nextItem) => void diagnoseMcpItem(nextItem)}
                      />
                    );
                  })}
                  {mcpItems.length === 0 && kindFilter === 'mcp-server' && (
                    <div className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                      No MCP servers found.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Upload to Hub</h3>
          </div>

          <div className="mt-3 grid gap-2">
            <select
              value={uploadRepoId}
              onChange={(event) => setUploadRepoId(event.target.value)}
              className="h-9 rounded border border-border bg-background px-2 text-sm text-foreground"
              disabled={remoteUploadRepositories.length === 0}
            >
              {remoteUploadRepositories.length === 0 ? (
                <option value="">Add a remote Hub first</option>
              ) : (
                remoteUploadRepositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))
              )}
            </select>
            <input
              value={uploadAdminToken}
              onChange={(event) => setUploadAdminToken(event.target.value)}
              placeholder="Hub admin token"
              type="password"
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Upload uses the selected remote Hub admin API. Local repository upload is hidden and disabled.
            </p>
          </div>

          <div className="mt-3 inline-flex h-9 overflow-hidden rounded border border-border">
            {(['agent-template', 'skill'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setUploadForm((prev) => ({ ...prev, kind, packageFiles: kind === 'skill' ? prev.packageFiles : [] }))}
                className={cn(
                  'px-3 text-sm transition-colors',
                  uploadForm.kind === kind ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                {kindLabel(kind)}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2">
            <input
              value={uploadForm.name}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={uploadForm.kind === 'skill' ? 'skill-name' : 'agent-name'}
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
            <input
              value={uploadForm.title}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Display title"
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
            <textarea
              value={uploadForm.description}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Short description"
              rows={2}
              className="resize-none rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <input
              value={uploadForm.author}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, author: event.target.value }))}
              placeholder="Author"
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
            <input
              value={uploadForm.tags}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, tags: event.target.value }))}
              placeholder="coding, review, frontend"
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
            <input
              value={uploadForm.icon}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, icon: event.target.value }))}
              placeholder="Icon text"
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
            {uploadForm.kind === 'agent-template' && (
              <>
                <input
                  value={uploadForm.supportedApps}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, supportedApps: event.target.value }))}
                  placeholder="Asana, Slack, Notion"
                  className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
                <input
                  value={uploadForm.capabilities}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, capabilities: event.target.value }))}
                  placeholder="Summarize tasks, draft updates"
                  className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
                <input
                  value={uploadForm.skillDependencies}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, skillDependencies: event.target.value }))}
                  placeholder="Required Skills: code-review-security, unity-memory-profiler-code-analysis"
                  className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
                <input
                  value={uploadForm.mcpDependencies}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, mcpDependencies: event.target.value }))}
                  placeholder="Required MCP servers: ainwork-code-search, soc-redmine"
                  className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </>
            )}
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded border border-border text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Upload className="h-4 w-4" />
              Load markdown file
              <input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={(event) => void readUploadFile(event)} className="sr-only" />
            </label>
            {uploadForm.kind === 'skill' && (
              <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded border border-border text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Upload className="h-4 w-4" />
                Load Skill folder
                <input
                  type="file"
                  multiple
                  {...directoryInputProps}
                  onChange={(event) => void readSkillPackageFolder(event)}
                  className="sr-only"
                />
              </label>
            )}
            {uploadForm.kind === 'skill' && uploadForm.packageFiles.length > 0 && (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                Skill package selected: {uploadForm.packageFiles.length} file(s). The full folder will be installed with SKILL.md.
              </div>
            )}
            <textarea
              value={uploadForm.content}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, content: event.target.value, packageFiles: [] }))}
              placeholder={uploadForm.kind === 'skill' ? 'Paste SKILL.md content, or load a full Skill folder' : 'Paste the agent system prompt'}
              rows={10}
              className="min-h-[220px] resize-y rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={uploadForm.overwrite}
                onChange={(event) => setUploadForm((prev) => ({ ...prev, overwrite: event.target.checked }))}
                className="h-3.5 w-3.5"
              />
              Overwrite existing item in remote Hub
            </label>
            <button
              type="button"
              onClick={() => void uploadItem()}
              disabled={!uploadRepoId || !uploadAdminToken.trim() || !uploadForm.name.trim() || !uploadHasContent || busyKey === 'upload'}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busyKey === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload to remote Hub
            </button>
          </div>
        </div>
      </div>

      {setupItem && (
        <AgentSetupDialog
          item={setupItem}
          values={setupValues}
          busy={busyKey === `install:${setupItem.repoId}:${setupItem.id}`}
          onChange={(slotId, value) => setSetupValues((prev) => ({ ...prev, [slotId]: value }))}
          onClose={() => {
            setSetupItem(null);
            setSetupValues({});
          }}
          onCreate={() => void createConfiguredAgent()}
        />
      )}
      {mcpSetupItem && (
        <McpSetupDialog
          item={mcpSetupItem}
          values={mcpSetupValues}
          busy={busyKey === `${mcpSetupAction}:${mcpSetupItem.repoId}:${mcpSetupItem.id}`}
          action={mcpSetupAction}
          error={actionError}
          onChange={(key, value) => setMcpSetupValues((prev) => ({ ...prev, [key]: value }))}
          onClose={() => {
            setMcpSetupItem(null);
            setMcpSetupValues({});
          }}
          onSave={() => void saveConfiguredMcp()}
        />
      )}
    </div>
  );
}
