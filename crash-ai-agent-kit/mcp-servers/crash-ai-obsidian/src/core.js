export const SERVER_VERSION = '0.1.3';

export function readConfig(env = process.env) {
  const argusBaseUrl = String(env.ARGUS_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
  return {
    argusBaseUrl,
    argusProbeUrls: normalizeProbeUrls(env.ARGUS_PROBE_URLS, argusBaseUrl),
    argusApiToken: String(env.ARGUS_API_TOKEN || '').trim(),
    defaultProjectName: String(env.OBSIDIAN_PROJECT_NAME || 'CrashAI').trim() || 'CrashAI',
    defaultMode: normalizeMode(env.OBSIDIAN_MODE || 'project-knowledge'),
    defaultWriteMode: normalizeWriteMode(env.OBSIDIAN_WRITE_MODE || 'direct'),
    defaultVaultId: String(env.OBSIDIAN_VAULT_ID || '').trim(),
    defaultBaseFolder: normalizeVaultFolder(env.OBSIDIAN_BASE_FOLDER || ''),
    timeoutMs: readInteger(env.ARGUS_OBSIDIAN_TIMEOUT_MS, 300_000, 5_000, 300_000),
  };
}

function normalizeProbeUrls(value, primaryUrl) {
  const defaults = [
    primaryUrl,
    'http://127.0.0.1:3987',
    'http://localhost:3987',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
  ];
  const configured = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set([primaryUrl, ...configured, ...defaults]
    .map((entry) => String(entry || '').replace(/\/+$/, ''))
    .filter(Boolean))];
}

function readInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeMode(value) {
  return ['project-knowledge', 'second-brain', 'ai-memory'].includes(value)
    ? value
    : 'project-knowledge';
}

function normalizeWriteMode(value) {
  return ['direct', 'wiki', 'auto'].includes(String(value || '').trim().toLowerCase())
    ? String(value || '').trim().toLowerCase()
    : 'direct';
}

function normalizeVaultFolder(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'unknown';
}

export function buildReportArgusId(input = {}) {
  const reportType = String(input.reportType || 'daily').trim().toLowerCase();
  const date = sanitizeSegment(input.date || input.endDate || currentDateKey());
  if (reportType === 'range') {
    return `crash-ai-range-${sanitizeSegment(input.startDate || date)}-${sanitizeSegment(input.endDate || date)}`;
  }
  if (reportType === 'single') {
    return `crash-ai-single-${sanitizeSegment(input.issueId || input.crashHash || 'issue')}-${date}`;
  }
  return `crash-ai-daily-${date}`;
}

export function normalizeReportPayload(input = {}, config = readConfig()) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title is required.');
  if (typeof input.content !== 'string' || !input.content.trim()) {
    throw new Error('content is required.');
  }

  const reportType = String(input.reportType || 'daily').trim().toLowerCase();
  const argusId = String(input.argusId || buildReportArgusId(input)).trim();
  const tags = [
    'crash-ai',
    'crashsight',
    'report',
    reportType,
    ...(Array.isArray(input.tags) ? input.tags : []),
  ].map((tag) => String(tag || '').trim()).filter(Boolean);

  return {
    title,
    content: input.content,
    mode: normalizeMode(input.mode || config.defaultMode),
    writeMode: normalizeWriteMode(input.writeMode || config.defaultWriteMode),
    forceDirectWrite: normalizeWriteMode(input.writeMode || config.defaultWriteMode) === 'direct',
    baseFolder: normalizeVaultFolder(input.baseFolder || config.defaultBaseFolder),
    projectName: String(input.projectName || config.defaultProjectName).trim() || 'CrashAI',
    vaultId: String(input.vaultId || config.defaultVaultId).trim(),
    kind: String(input.kind || 'review-notes').trim(),
    status: String(input.status || 'active').trim(),
    argusId,
    sourceId: String(input.sourceId || argusId).trim(),
    sourceArtifactId: String(input.sourceArtifactId || argusId).trim(),
    tags: [...new Set(tags)],
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 1,
    metadata: {
      source: 'crash-ai-agent',
      reportType,
      date: input.date || '',
      startDate: input.startDate || '',
      endDate: input.endDate || '',
      issueId: input.issueId || '',
      crashHash: input.crashHash || '',
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    },
  };
}

export async function writeCrashReport(input = {}, config = readConfig(), options = {}) {
  const document = normalizeReportPayload(input, config);
  return requestArgus('/api/obsidian-bridge/documents', document, config, options);
}

export async function testConnection(config = readConfig(), options = {}) {
  return requestArgus('/api/obsidian-bridge/test-connection', {}, config, options);
}

async function requestArgus(path, body, config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable.');
  const candidates = config.argusProbeUrls?.length ? config.argusProbeUrls : [config.argusBaseUrl];
  const failures = [];
  for (const baseUrl of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.argusApiToken ? { Authorization: `Bearer ${config.argusApiToken}` } : {}),
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error || data?.success === false) {
        const message = data?.error || `Argus returned HTTP ${response.status}.`;
        if (shouldTryNextArgusUrl(response.status, message)) {
          failures.push(`${baseUrl}: ${message}`);
          continue;
        }
        throw new Error(message);
      }
      return { ...data, argusBaseUrl: baseUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isArgusTimeoutError(error)) {
        throw new Error(`Argus Obsidian Bridge request timed out after ${config.timeoutMs} ms at ${baseUrl}. Increase ARGUS_OBSIDIAN_TIMEOUT_MS or reduce report size.`);
      }
      if (!isRetryableArgusConnectionError(error)) throw error;
      failures.push(`${baseUrl}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Unable to reach Argus Obsidian Bridge. Tried ${failures.join('; ') || candidates.join(', ')}`);
}

function isArgusTimeoutError(error) {
  const name = error instanceof Error ? String(error.name || '').toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return name === 'aborterror' || message.includes('operation was aborted') || message.includes('aborted');
}

function isRetryableArgusConnectionError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('fetch failed')
    || message.includes('econnrefused')
    || message.includes('network')
    || message.includes('timeout')
  );
}

function shouldTryNextArgusUrl(status, message) {
  const text = String(message || '').toLowerCase();
  return status === 404 || status === 405 || text.includes('cannot post') || text.includes('not found');
}

export function toolError(error, details = {}) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: message,
    ...details,
    hints: buildHints(message),
  };
}

function buildHints(message) {
  const text = String(message || '').toLowerCase();
  const hints = [];
  if (text.includes('fetch') || text.includes('econnrefused') || text.includes('network') || text.includes('unavailable')) {
    hints.push('Start Argus/MTL-Code backend and verify ARGUS_BASE_URL, default http://127.0.0.1:3001.');
  }
  if (text.includes('timed out') || text.includes('aborted')) {
    hints.push('The Obsidian write request reached Argus but took too long. Set ARGUS_OBSIDIAN_TIMEOUT_MS=300000, or reduce the report size.');
  }
  if (text.includes('obsidian bridge is disabled') || text.includes('not configured') || text.includes('token')) {
    hints.push('Open Argus Settings -> Runtime -> Argus Bridge for Obsidian, install/enable the bridge, save token, then test connection.');
  }
  if (!hints.length) {
    hints.push('Run obsidian_test_connection first to validate Argus Obsidian Bridge.');
  }
  return hints;
}

function currentDateKey() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
}
