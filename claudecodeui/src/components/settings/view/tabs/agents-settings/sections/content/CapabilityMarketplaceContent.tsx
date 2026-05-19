import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
  Filter,
  Loader2,
  PackageCheck,
  PlugZap,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Wrench,
} from 'lucide-react';

import { cn } from '../../../../../../../lib/utils';
import { api } from '../../../../../../../utils/api';
import type { SettingsProject } from '../../../../../types/types';

type CapabilityKind = 'all' | 'skill' | 'mcp-server' | 'recipe' | 'agent-template';
type ConcreteCapabilityKind = Exclude<CapabilityKind, 'all'>;

type CapabilityDependencyMap = {
  skills?: string[];
  mcpServers?: string[];
  recipes?: string[];
};

type CapabilityMarketplaceItem = {
  id: string;
  kind: ConcreteCapabilityKind;
  name: string;
  title: string;
  description?: string;
  source?: string;
  repoId?: string;
  itemId?: string;
  tags?: string[];
  dependencies?: CapabilityDependencyMap;
  setupFields?: Array<{ key: string; label?: string; required?: boolean; type?: string }>;
  setupRequired?: boolean;
  installState?: 'available' | 'installed';
  enabled?: boolean;
  configurationStatus?: 'ready' | 'needs-configuration' | string;
};

type MarketplaceCatalog = {
  schemaVersion?: number;
  items?: CapabilityMarketplaceItem[];
};

type RepositoryCatalogItem = {
  id?: string;
  kind?: string;
  name?: string;
  title?: string;
  description?: string;
  source?: string;
  repoId?: string;
  repoName?: string;
  tags?: string[];
  dependencies?: CapabilityDependencyMap;
  mcp?: { setupFields?: CapabilityMarketplaceItem['setupFields'] } | null;
};

type CapabilityMarketplaceContentProps = {
  projects: SettingsProject[];
};

const KIND_OPTIONS: Array<{ value: CapabilityKind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'skill', label: 'Skills' },
  { value: 'mcp-server', label: 'MCP' },
  { value: 'recipe', label: 'Recipes' },
  { value: 'agent-template', label: 'Agents' },
];

function sanitizeSlug(value: string, fallback = 'capability') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function normalizeKind(value?: string): ConcreteCapabilityKind {
  const kind = String(value || '').trim().toLowerCase();
  if (kind === 'mcp' || kind === 'mcp_server' || kind === 'mcp-server-template') return 'mcp-server';
  if (kind === 'agent' || kind === 'template') return 'agent-template';
  if (kind === 'recipe') return 'recipe';
  if (kind === 'agent-template' || kind === 'skill' || kind === 'mcp-server') return kind;
  return 'skill';
}

function normalizeRepositoryItem(item: RepositoryCatalogItem): CapabilityMarketplaceItem {
  const kind = normalizeKind(item.kind);
  const slug = sanitizeSlug(item.id || item.name || item.title || kind, kind);
  const setupFields = Array.isArray(item.mcp?.setupFields) ? item.mcp?.setupFields || [] : [];
  return {
    id: `${kind}-${slug}`,
    kind,
    name: item.name || item.title || slug,
    title: item.title || item.name || slug,
    description: item.description || '',
    source: item.repoName || item.source || 'repository',
    repoId: item.repoId || '',
    itemId: item.id || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    dependencies: item.dependencies || {},
    setupFields,
    setupRequired: setupFields.some((field) => field.required),
    installState: 'available',
    enabled: false,
    configurationStatus: setupFields.some((field) => field.required) ? 'needs-configuration' : 'ready',
  };
}

function mergeMarketplaceItems(items: CapabilityMarketplaceItem[]) {
  const byId = new Map<string, CapabilityMarketplaceItem>();
  for (const item of items) {
    const previous = byId.get(item.id);
    if (!previous) {
      byId.set(item.id, item);
      continue;
    }
    byId.set(item.id, {
      ...previous,
      ...item,
      tags: Array.from(new Set([...(previous.tags || []), ...(item.tags || [])])),
      installState: previous.installState === 'installed' || item.installState === 'installed' ? 'installed' : 'available',
      enabled: Boolean(previous.enabled || item.enabled),
      repoId: previous.repoId || item.repoId,
      itemId: previous.itemId || item.itemId,
    });
  }
  return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
}

function dependencyCount(dependencies?: CapabilityDependencyMap) {
  return (dependencies?.skills || []).length + (dependencies?.mcpServers || []).length + (dependencies?.recipes || []).length;
}

function kindLabel(kind: ConcreteCapabilityKind) {
  if (kind === 'mcp-server') return 'MCP';
  if (kind === 'agent-template') return 'Agent';
  if (kind === 'recipe') return 'Recipe';
  return 'Skill';
}

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const data = payload as { error?: unknown; details?: unknown };
    if (typeof data.details === 'string') return data.details;
    if (typeof data.error === 'string') return data.error;
  }
  return fallback;
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Sparkles; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export default function CapabilityMarketplaceContent({ projects }: CapabilityMarketplaceContentProps) {
  const [items, setItems] = useState<CapabilityMarketplaceItem[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CapabilityKind>('all');
  const [projectPath, setProjectPath] = useState(() => projects[0]?.fullPath || projects[0]?.path || '');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [configurationDrafts, setConfigurationDrafts] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!projectPath && projects[0]) {
      setProjectPath(projects[0].fullPath || projects[0].path || '');
    }
  }, [projectPath, projects]);

  const loadMarketplace = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [marketplaceResponse, repositoryResponse] = await Promise.all([
        api.capabilityMarketplace(projectPath),
        api.agentRepositoryCatalog().catch(() => null),
      ]);
      const marketplacePayload = await marketplaceResponse.json();
      if (!marketplaceResponse.ok || !marketplacePayload?.success) {
        throw new Error(readError(marketplacePayload, 'Failed to load marketplace'));
      }
      const marketplaceCatalog = (marketplacePayload.catalog || {}) as MarketplaceCatalog;
      const marketplaceItems = Array.isArray(marketplaceCatalog.items) ? marketplaceCatalog.items : [];

      let repositoryItems: CapabilityMarketplaceItem[] = [];
      if (repositoryResponse?.ok) {
        const repositoryPayload = await repositoryResponse.json();
        const rawItems = Array.isArray(repositoryPayload?.items) ? repositoryPayload.items : [];
        repositoryItems = rawItems.map((item: RepositoryCatalogItem) => normalizeRepositoryItem(item));
      }

      setItems(mergeMarketplaceItems([...marketplaceItems, ...repositoryItems]));
      setStatus('ready');
    } catch (loadError) {
      setItems([]);
      setStatus('error');
      setError(loadError instanceof Error ? loadError.message : 'Failed to load marketplace');
    }
  }, [projectPath]);

  useEffect(() => {
    void loadMarketplace();
  }, [loadMarketplace]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        item.title,
        item.name,
        item.description,
        item.source,
        ...(item.tags || []),
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [items, kind, query]);

  const summary = useMemo(() => ({
    total: items.length,
    installed: items.filter((item) => item.installState === 'installed').length,
    enabled: items.filter((item) => item.enabled).length,
    needsSetup: items.filter((item) => item.setupRequired || item.configurationStatus === 'needs-configuration').length,
  }), [items]);

  const toggleEnabled = async (item: CapabilityMarketplaceItem) => {
    const nextEnabled = !item.enabled;
    setBusyKey(`toggle:${item.id}`);
    setError('');
    try {
      const response = await api.setCapabilityMarketplaceEnabled(item.id, nextEnabled);
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(readError(payload, 'Failed to update capability'));
      }
      setItems((previous) => previous.map((candidate) => (
        candidate.id === item.id ? { ...candidate, enabled: nextEnabled } : candidate
      )));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update capability');
    } finally {
      setBusyKey('');
    }
  };

  const updateConfigurationDraft = (itemId: string, key: string, value: string) => {
    setConfigurationDrafts((previous) => ({
      ...previous,
      [itemId]: {
        ...(previous[itemId] || {}),
        [key]: value,
      },
    }));
  };

  const installMarketplaceItem = async (item: CapabilityMarketplaceItem) => {
    setBusyKey(`install:${item.id}`);
    setError('');
    const configuration = configurationDrafts[item.id] || {};
    try {
      const response = item.repoId && item.itemId
        ? await api.installAgentRepositoryItem({
            repoId: item.repoId,
            itemId: item.itemId,
            target: projectPath ? 'project' : 'user',
            projectPath: projectPath || undefined,
            overwrite: false,
            configuration: { mcpValues: configuration },
          })
        : await api.installCapabilityMarketplaceItem(item.id, {
            scope: projectPath ? 'project' : 'user',
            configuration,
          });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(readError(payload, 'Failed to install capability'));
      }
      await loadMarketplace();
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : 'Failed to install capability');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Capability Marketplace</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Discover, install, enable, and disable Skills, MCP servers, recipes, and agent templates from one place.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMarketplace()}
          disabled={status === 'loading'}
          className="inline-flex h-9 items-center justify-center gap-2 rounded border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={PackageCheck} label="Capabilities" value={summary.total} />
        <StatCard icon={Download} label="Installed" value={summary.installed} />
        <StatCard icon={CheckCircle2} label="Enabled" value={summary.enabled} />
        <StatCard icon={Settings2} label="Need setup" value={summary.needsSetup} />
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-3 lg:grid-cols-[minmax(0,1fr)_180px_220px]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search capabilities"
            className="h-10 w-full rounded border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>

        <label className="relative block">
          <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CapabilityKind)}
            className="h-10 w-full appearance-none rounded border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <select
          value={projectPath}
          onChange={(event) => setProjectPath(event.target.value)}
          className="h-10 rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="">User scope</option>
          {projects.map((project) => {
            const value = project.fullPath || project.path || '';
            return (
              <option key={`${project.name}:${value}`} value={value}>
                {project.displayName || project.name}
              </option>
            );
          })}
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {status === 'loading' && (
        <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading marketplace...
        </div>
      )}

      {status !== 'loading' && filteredItems.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No capabilities match the current filters.
        </div>
      )}

      {status !== 'loading' && filteredItems.length > 0 && (
        <div className="grid gap-3 xl:grid-cols-2">
          {filteredItems.map((item) => {
            const setupFields = item.setupFields || [];
            const hasSetupFields = setupFields.length > 0;
            const canInstall = item.installState !== 'installed';
            const canConfigure = hasSetupFields;
            const busy = busyKey === `toggle:${item.id}` || busyKey === `install:${item.id}`;
            const Icon = item.kind === 'mcp-server' ? PlugZap : item.kind === 'agent-template' ? Bot : item.kind === 'skill' ? Wrench : Sparkles;
            return (
              <div key={item.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                        <Icon className="h-3.5 w-3.5" />
                        {kindLabel(item.kind)}
                      </span>
                      <span
                        className={cn(
                          'rounded px-2 py-1 text-xs font-medium',
                          item.installState === 'installed'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {item.installState === 'installed' ? 'Installed' : 'Available'}
                      </span>
                      {(item.setupRequired || item.configurationStatus === 'needs-configuration') && (
                        <span className="rounded bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                          Needs setup
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 truncate text-base font-semibold text-foreground">{item.title || item.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description || 'No description provided.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleEnabled(item)}
                    disabled={busy}
                    className={cn(
                      'inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded px-3 text-sm font-medium transition-colors disabled:opacity-60',
                      item.enabled
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border border-border text-foreground hover:bg-muted',
                    )}
                    title={item.enabled ? 'Disable capability' : 'Enable capability'}
                  >
                    {busyKey === `toggle:${item.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : item.enabled ? (
                      <ToggleRight className="h-4 w-4" />
                    ) : (
                      <ToggleLeft className="h-4 w-4" />
                    )}
                    {item.enabled ? 'Enabled' : 'Enable'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {item.source && <span className="rounded bg-background px-2 py-1">{item.source}</span>}
                  {dependencyCount(item.dependencies) > 0 && (
                    <span className="rounded bg-background px-2 py-1">{dependencyCount(item.dependencies)} dependencies</span>
                  )}
                  {(item.tags || []).slice(0, 5).map((tag) => (
                    <span key={`${item.id}:${tag}`} className="rounded bg-background px-2 py-1">{tag}</span>
                  ))}
                </div>

                {hasSetupFields && (
                  <div className="mt-4 grid gap-2 rounded-lg border border-border/70 bg-background/50 p-3">
                    <div className="text-xs font-medium text-foreground">Configure</div>
                    {setupFields.map((field) => (
                      <label key={`${item.id}:${field.key}`} className="grid gap-1 text-xs text-muted-foreground">
                        <span>{field.label || field.key}{field.required ? ' *' : ''}</span>
                        <input
                          type={field.type === 'password' ? 'password' : 'text'}
                          value={configurationDrafts[item.id]?.[field.key] || ''}
                          onChange={(event) => updateConfigurationDraft(item.id, field.key, event.target.value)}
                          placeholder={field.key}
                          className="h-8 rounded border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
                        />
                      </label>
                    ))}
                  </div>
                )}

                {(canInstall || canConfigure) && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => void installMarketplaceItem(item)}
                      disabled={busy}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      {busyKey === `install:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      {item.installState === 'installed' ? 'Save configuration' : (hasSetupFields ? 'Configure' : 'Install')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
