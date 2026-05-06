export const HUB_USAGE_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS hub_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  user_id INTEGER,
  ip_address TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT,
  project_name TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  used_mcp INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT
);`;

export const HUB_USAGE_EVENTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_hub_usage_events_day_ip_user
  ON hub_usage_events(usage_date, ip_address, user_id, provider);`;

function readNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toIsoTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function toUsageDate(timestamp) {
  return toIsoTimestamp(timestamp).slice(0, 10);
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateText, delta) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function resolveRange({ from, to, days } = {}) {
  const end = normalizeDate(to) || todayDate();
  const parsedDays = Math.max(1, Math.min(90, readNonNegativeInteger(days) || 7));
  const start = normalizeDate(from) || addDays(end, -(parsedDays - 1));
  return start <= end
    ? { from: start, to: end }
    : { from: end, to: start };
}

export function normalizeIpAddress(value) {
  const first = String(value || '').split(',')[0]?.trim() || '';
  if (!first) return 'unknown';
  if (first === '::1') return '127.0.0.1';
  if (first.startsWith('::ffff:')) return first.slice('::ffff:'.length);
  return first;
}

export function getRequestIpAddress(req) {
  return normalizeIpAddress(
    req?.headers?.['x-forwarded-for'] ||
      req?.headers?.['x-real-ip'] ||
      req?.socket?.remoteAddress ||
      req?.connection?.remoteAddress,
  );
}

export function extractTokenBreakdownFromContextBudget(contextBudget) {
  const breakdown = contextBudget?.current?.breakdown || {};
  const inputTokens = readNonNegativeInteger(breakdown.input);
  const outputTokens = readNonNegativeInteger(breakdown.output);
  const cacheReadTokens = readNonNegativeInteger(breakdown.cacheRead);
  const cacheCreationTokens = readNonNegativeInteger(breakdown.cacheCreation);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
  };
}

function normalizeUsageEvent(event = {}) {
  const occurredAt = toIsoTimestamp(event.timestamp || event.occurredAt);
  const inputTokens = readNonNegativeInteger(event.inputTokens);
  const outputTokens = readNonNegativeInteger(event.outputTokens);
  const cacheReadTokens = readNonNegativeInteger(event.cacheReadTokens);
  const cacheCreationTokens = readNonNegativeInteger(event.cacheCreationTokens);
  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  return {
    occurredAt,
    usageDate: normalizeDate(event.usageDate) || toUsageDate(occurredAt),
    userId: event.userId === undefined || event.userId === null || event.userId === ''
      ? null
      : readNonNegativeInteger(event.userId) || null,
    ipAddress: normalizeIpAddress(event.ipAddress),
    provider: String(event.provider || 'claude').trim() || 'claude',
    sessionId: event.sessionId ? String(event.sessionId) : null,
    projectName: event.projectName ? String(event.projectName) : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: readNonNegativeInteger(event.totalTokens) || computedTotal,
    usedMcp: Boolean(event.usedMcp),
    metadataJson: event.metadata === undefined ? null : JSON.stringify(event.metadata),
  };
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

function numberOrZero(value) {
  return Number(value || 0);
}

function mapSummary(row = {}) {
  return {
    totalTokens: numberOrZero(row.totalTokens),
    inputTokens: numberOrZero(row.inputTokens),
    outputTokens: numberOrZero(row.outputTokens),
    cacheReadTokens: numberOrZero(row.cacheReadTokens),
    cacheCreationTokens: numberOrZero(row.cacheCreationTokens),
    callCount: numberOrZero(row.callCount),
    mcpCallCount: numberOrZero(row.mcpCallCount),
    uniqueIps: numberOrZero(row.uniqueIps),
    uniqueUsers: numberOrZero(row.uniqueUsers),
  };
}

function mapDaily(row) {
  return {
    date: row.date,
    ...mapSummary(row),
  };
}

function parseProviders(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .sort();
}

function mapUserRow(row) {
  const mcpCallCount = numberOrZero(row.mcpCallCount);
  return {
    date: row.date,
    ipAddress: row.ipAddress,
    userId: row.userId ?? null,
    username: row.username ?? null,
    providers: parseProviders(row.providers),
    totalTokens: numberOrZero(row.totalTokens),
    inputTokens: numberOrZero(row.inputTokens),
    outputTokens: numberOrZero(row.outputTokens),
    cacheReadTokens: numberOrZero(row.cacheReadTokens),
    cacheCreationTokens: numberOrZero(row.cacheCreationTokens),
    callCount: numberOrZero(row.callCount),
    mcpCallCount,
    usedMcp: mcpCallCount > 0,
  };
}

export function createHubUsageStore(db) {
  return {
    ensureSchema() {
      db.exec(HUB_USAGE_EVENTS_TABLE_SQL);
      db.exec(HUB_USAGE_EVENTS_INDEX_SQL);
    },

    recordUsage(event) {
      this.ensureSchema();
      const usage = normalizeUsageEvent(event);
      db.prepare(`
        INSERT INTO hub_usage_events (
          occurred_at,
          usage_date,
          user_id,
          ip_address,
          provider,
          session_id,
          project_name,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_creation_tokens,
          total_tokens,
          used_mcp,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        usage.occurredAt,
        usage.usageDate,
        usage.userId,
        usage.ipAddress,
        usage.provider,
        usage.sessionId,
        usage.projectName,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.cacheCreationTokens,
        usage.totalTokens,
        usage.usedMcp ? 1 : 0,
        usage.metadataJson,
      );
      return usage;
    },

    getDailyUsage(options = {}) {
      this.ensureSchema();
      const range = resolveRange(options);
      const params = [range.from, range.to];
      const summary = mapSummary(db.prepare(`
        SELECT
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(input_tokens), 0) AS inputTokens,
          COALESCE(SUM(output_tokens), 0) AS outputTokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
          COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
          COUNT(*) AS callCount,
          COALESCE(SUM(CASE WHEN used_mcp = 1 THEN 1 ELSE 0 END), 0) AS mcpCallCount,
          COUNT(DISTINCT ip_address) AS uniqueIps,
          COUNT(DISTINCT COALESCE(CAST(user_id AS TEXT), 'ip:' || ip_address)) AS uniqueUsers
        FROM hub_usage_events
        WHERE usage_date BETWEEN ? AND ?
      `).get(...params));

      const daily = db.prepare(`
        SELECT
          usage_date AS date,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(input_tokens), 0) AS inputTokens,
          COALESCE(SUM(output_tokens), 0) AS outputTokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
          COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
          COUNT(*) AS callCount,
          COALESCE(SUM(CASE WHEN used_mcp = 1 THEN 1 ELSE 0 END), 0) AS mcpCallCount,
          COUNT(DISTINCT ip_address) AS uniqueIps,
          COUNT(DISTINCT COALESCE(CAST(user_id AS TEXT), 'ip:' || ip_address)) AS uniqueUsers
        FROM hub_usage_events
        WHERE usage_date BETWEEN ? AND ?
        GROUP BY usage_date
        ORDER BY usage_date DESC
      `).all(...params).map(mapDaily);

      const usersTableAvailable = tableExists(db, 'users');
      const userSelect = usersTableAvailable ? 'u.username AS username,' : 'NULL AS username,';
      const userJoin = usersTableAvailable ? 'LEFT JOIN users u ON u.id = e.user_id' : '';
      const users = db.prepare(`
        SELECT
          e.usage_date AS date,
          e.ip_address AS ipAddress,
          e.user_id AS userId,
          ${userSelect}
          GROUP_CONCAT(DISTINCT e.provider) AS providers,
          COALESCE(SUM(e.total_tokens), 0) AS totalTokens,
          COALESCE(SUM(e.input_tokens), 0) AS inputTokens,
          COALESCE(SUM(e.output_tokens), 0) AS outputTokens,
          COALESCE(SUM(e.cache_read_tokens), 0) AS cacheReadTokens,
          COALESCE(SUM(e.cache_creation_tokens), 0) AS cacheCreationTokens,
          COUNT(*) AS callCount,
          COALESCE(SUM(CASE WHEN e.used_mcp = 1 THEN 1 ELSE 0 END), 0) AS mcpCallCount
        FROM hub_usage_events e
        ${userJoin}
        WHERE e.usage_date BETWEEN ? AND ?
        GROUP BY e.usage_date, e.ip_address, e.user_id
        ORDER BY e.usage_date DESC, totalTokens DESC, e.ip_address ASC
      `).all(...params).map(mapUserRow);

      return {
        range,
        summary,
        daily,
        users,
      };
    },
  };
}
