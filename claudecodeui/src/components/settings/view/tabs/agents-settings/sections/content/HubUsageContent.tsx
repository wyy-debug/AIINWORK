import { useEffect, useMemo, useState } from 'react';
import { Activity, Cable, Clock3, Globe2, Users } from 'lucide-react';

import { api } from '../../../../../../../utils/api';
import { cn } from '../../../../../../../lib/utils';

type HubUsageSummary = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  callCount?: number;
  mcpCallCount?: number;
  uniqueIps?: number;
  uniqueUsers?: number;
};

type HubUsageUserRow = {
  date: string;
  ipAddress: string;
  userId: number | null;
  username: string | null;
  providers: string[];
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  callCount: number;
  mcpCallCount: number;
  usedMcp: boolean;
};

type HubUsageReport = {
  range?: {
    from: string;
    to: string;
  };
  summary: HubUsageSummary;
  daily?: Array<HubUsageSummary & { date: string }>;
  users: HubUsageUserRow[];
};

const EMPTY_REPORT: HubUsageReport = {
  summary: {},
  daily: [],
  users: [],
};

function formatNumber(value: number | undefined | null): string {
  return Number(value || 0).toLocaleString();
}

function formatUser(row: HubUsageUserRow): string {
  if (row.username) return row.username;
  if (row.userId !== null && row.userId !== undefined) return `User ${row.userId}`;
  return 'Anonymous';
}

function StatTile({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  muted?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      {muted ? <div className="mt-1 text-xs text-muted-foreground">{muted}</div> : null}
    </div>
  );
}

export function HubUsageSummaryCards({ summary }: { summary: HubUsageSummary }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <StatTile
        icon={Activity}
        label="Token usage"
        value={formatNumber(summary.totalTokens)}
        muted={`Input ${formatNumber(summary.inputTokens)} / Output ${formatNumber(summary.outputTokens)}`}
      />
      <StatTile
        icon={Clock3}
        label="Calls"
        value={formatNumber(summary.callCount)}
        muted={`${formatNumber(summary.mcpCallCount)} MCP calls`}
      />
      <StatTile
        icon={Globe2}
        label="IP addresses"
        value={formatNumber(summary.uniqueIps)}
      />
      <StatTile
        icon={Users}
        label="Users"
        value={formatNumber(summary.uniqueUsers)}
      />
    </div>
  );
}

export function HubUsageTable({ rows }: { rows: HubUsageUserRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No usage has been reported for this range.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">Date</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">IP</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">User</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">Provider</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Tokens</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Calls</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">MCP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {rows.map((row) => (
              <tr key={`${row.date}:${row.ipAddress}:${row.userId ?? 'anon'}:${row.providers.join('+')}`}>
                <td className="whitespace-nowrap px-4 py-3 text-foreground">{row.date}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-foreground">{row.ipAddress}</td>
                <td className="whitespace-nowrap px-4 py-3 text-foreground">{formatUser(row)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{row.providers.join(', ') || '-'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                  {formatNumber(row.totalTokens)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                  {formatNumber(row.callCount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium',
                      row.usedMcp
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <Cable className="h-3 w-3" />
                    {row.usedMcp ? `MCP ${formatNumber(row.mcpCallCount)}` : 'No MCP'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HubDailyUsageList({ rows }: { rows: HubUsageReport['daily'] }) {
  const visibleRows = rows || [];
  if (visibleRows.length === 0) return null;
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {visibleRows.map((row) => (
        <div key={row.date} className="rounded-lg border border-border bg-background p-3">
          <div className="text-sm font-medium text-foreground">{row.date}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatNumber(row.totalTokens)} tokens - {formatNumber(row.callCount)} calls - {formatNumber(row.mcpCallCount)} MCP
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HubUsageContent() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<HubUsageReport>(EMPTY_REPORT);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api.hubUsage({ days })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load hub usage');
        }
        if (!cancelled) {
          setReport(payload.data || EMPTY_REPORT);
          setStatus('ready');
        }
      })
      .catch((error) => {
        console.warn('[HubUsage] Failed to load usage:', error);
        if (!cancelled) {
          setReport(EMPTY_REPORT);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const rangeLabel = useMemo(() => {
    if (!report.range?.from || !report.range?.to) return `${days} days`;
    return `${report.range.from} to ${report.range.to}`;
  }, [days, report.range?.from, report.range?.to]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Hub usage</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily token usage grouped by IP and user. Range: {rangeLabel}.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Range
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>

      {status === 'error' ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load Hub usage.
        </div>
      ) : null}

      <HubUsageSummaryCards summary={report.summary} />

      {status === 'loading' ? (
        <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">Loading usage...</div>
      ) : (
        <>
          <HubDailyUsageList rows={report.daily} />
          <HubUsageTable rows={report.users} />
        </>
      )}
    </div>
  );
}
