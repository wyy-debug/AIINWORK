import crypto from 'node:crypto';

export const SERVER_VERSION = '0.1.5';

export const PLATFORM_IDS = {
  android: 1,
  ios: 2,
  pc: 10,
};

export const PLATFORM_LABELS = {
  1: 'Android',
  2: 'iOS',
  10: 'PC',
};

const BASE_URL_BY_REGION = {
  cn: 'https://crashsight.qq.com',
  sg: 'https://crashsight.wetest.net',
};

const DEFAULT_BRANCH_FILTERS = {
  trunk: '*trunk*',
  weekly: '*weekly*',
};

const MAX_STACK_BYTES = 1024 * 1024;

export function readConfig(env = process.env) {
  const region = String(env.CRASHSIGHT_REGION || 'cn').trim().toLowerCase();
  const baseUrl = String(env.CRASHSIGHT_BASE_URL || BASE_URL_BY_REGION[region] || BASE_URL_BY_REGION.cn)
    .trim()
    .replace(/\/+$/, '');

  return {
    region,
    baseUrl,
    redmineBaseUrl: String(env.CRASH_AI_REDMINE_BASE_URL || env.REDMINE_BASE_URL || 'http://soc-redmine.wd.com')
      .trim()
      .replace(/\/+$/, ''),
    localUserId: String(env.CRASHSIGHT_LOCAL_USER_ID || '').trim(),
    openApiKey: String(env.CRASHSIGHT_OPENAPI_KEY || '').trim(),
    timeoutMs: readInteger(env.CRASHSIGHT_TIMEOUT_MS, 30_000, 3_000, 120_000),
    rateLimitPerMinute: readInteger(env.CRASHSIGHT_RATE_LIMIT_PER_MINUTE, 25, 1, 25),
    branchFilters: parseBranchFilters(env.CRASHSIGHT_BRANCH_FILTERS),
    appIds: {
      pc: String(env.CRASHSIGHT_APP_ID_PC || '').trim(),
      android: String(env.CRASHSIGHT_APP_ID_ANDROID || '').trim(),
      ios: String(env.CRASHSIGHT_APP_ID_IOS || '').trim(),
    },
  };
}

export function readInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function parseBranchFilters(value) {
  if (!value) return { ...DEFAULT_BRANCH_FILTERS };
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalizeBranchFilters(value);
  }
  try {
    return normalizeBranchFilters(JSON.parse(String(value)));
  } catch {
    return { ...DEFAULT_BRANCH_FILTERS };
  }
}

function normalizeBranchFilters(value) {
  const filters = { ...DEFAULT_BRANCH_FILTERS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return filters;
  for (const [key, pattern] of Object.entries(value)) {
    const name = String(key || '').trim();
    const text = String(pattern || '').trim();
    if (name && text) filters[name] = text;
  }
  return filters;
}

export function normalizePlatform(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'android') return { key: 'android', id: 1, label: 'Android' };
  if (raw === '2' || raw === 'ios' || raw === 'iphone') return { key: 'ios', id: 2, label: 'iOS' };
  if (raw === '10' || raw === 'pc' || raw === 'windows') return { key: 'pc', id: 10, label: 'PC' };
  throw new Error(`Unsupported platform "${value}". Use pc, android, ios, 10, 1, or 2.`);
}

export function normalizePlatforms(args = {}) {
  const input = args.platforms ?? args.platform ?? ['pc', 'android', 'ios'];
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set();
  return list.map(normalizePlatform).filter((platform) => {
    if (seen.has(platform.id)) return false;
    seen.add(platform.id);
    return true;
  });
}

export function resolveAppId(config, platform, overrideAppId = '') {
  const normalized = typeof platform === 'object' ? platform : normalizePlatform(platform);
  const appId = String(overrideAppId || config.appIds[normalized.key] || '').trim();
  if (!appId) {
    throw new Error(`Missing appId for ${normalized.label}. Configure CRASHSIGHT_APP_ID_${normalized.key.toUpperCase()}.`);
  }
  return appId;
}

export function resolveVersionFilters(args = {}, config = readConfig()) {
  const input = args.versionFilters ?? args.branches ?? Object.keys(config.branchFilters);
  const list = Array.isArray(input) ? input : [input];
  const filters = list.map((entry) => {
    if (entry && typeof entry === 'object') {
      return String(entry.pattern || entry.version || entry.versionPattern || entry.name || '').trim();
    }
    const text = String(entry || '').trim();
    return config.branchFilters[text] || text;
  }).filter(Boolean);
  return [...new Set(filters.length ? filters : Object.values(config.branchFilters))];
}

export function normalizeDate(value) {
  const date = normalizeDateTime(value).dateKey;
  if (!date) {
    throw new Error('date must be YYYYMMDD or YYYY-MM-DD.');
  }
  return date;
}

export function normalizeDateRange(args = {}) {
  const startInput = args.startTime ?? args.startDateTime ?? args.startDate ?? args.date;
  const endInput = args.endTime ?? args.endDateTime ?? args.endDate ?? args.date ?? startInput;
  if (!startInput && !endInput) {
    throw new Error('date, startDate/endDate, or startTime/endTime is required.');
  }
  const start = normalizeDateTime(startInput || endInput, false);
  const end = normalizeDateTime(endInput || startInput, true);
  if (start.timestampMs > end.timestampMs) {
    throw new Error('startDate/startTime must be earlier than or equal to endDate/endTime.');
  }
  const date = start.dateKey === end.dateKey && !args.startTime && !args.endTime && !args.startDateTime && !args.endDateTime
    ? start.dateKey
    : '';
  return {
    date,
    startDate: start.dateKey,
    endDate: end.dateKey,
    startTime: start.text,
    endTime: end.text,
    startTimestampMs: start.timestampMs,
    endTimestampMs: end.timestampMs,
  };
}

function normalizeDateTime(value, endOfDay = false) {
  if (value instanceof Date) {
    const date = new Date(value.getTime());
    if (Number.isNaN(date.getTime())) throw new Error('Invalid date/time value.');
    return normalizedDateTimeFromDate(date);
  }
  const text = String(value || '').trim();
  if (!text) throw new Error('date/time value is required.');
  const normalized = text.replace('T', ' ').replace(/\//g, '-');
  let match = normalized.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[ _]?(\d{2}):?(\d{2})(?::?(\d{2}))?)?$/);
  if (!match) {
    match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  }
  if (!match) {
    throw new Error('date/time must be YYYYMMDD, YYYY-MM-DD, or YYYY-MM-DD HH:mm:ss.');
  }
  const hasTime = match[4] !== undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = hasTime ? Number(match[4]) : endOfDay ? 23 : 0;
  const minute = hasTime ? Number(match[5] || 0) : endOfDay ? 59 : 0;
  const second = hasTime ? Number(match[6] || 0) : endOfDay ? 59 : 0;
  const date = new Date(year, month - 1, day, hour, minute, second, endOfDay && !hasTime ? 999 : 0);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    throw new Error('Invalid date/time value.');
  }
  return normalizedDateTimeFromDate(date);
}

function normalizedDateTimeFromDate(date) {
  return {
    dateKey: formatDateKey(date),
    text: formatDateTime(date),
    timestampMs: date.getTime(),
  };
}

function formatDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
}

function formatDateTime(date) {
  return [
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
  ].join(' ');
}

export function buildAuthParams(localUserId, openApiKey, timestamp = Math.floor(Date.now() / 1000)) {
  const message = `${localUserId}_${timestamp}`;
  const hex = crypto.createHmac('sha256', openApiKey).update(message).digest('hex');
  return {
    userSecret: Buffer.from(hex).toString('base64'),
    localUserId,
    t: timestamp,
  };
}

function buildSignedUrl(config, apiPath, timestamp = Math.floor(Date.now() / 1000)) {
  const params = buildAuthParams(config.localUserId, config.openApiKey, timestamp);
  const url = new URL(apiPath, config.baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export class RateLimiter {
  constructor(perMinute = 25, sleep = defaultSleep, now = () => Date.now()) {
    this.intervalMs = Math.ceil(60_000 / Math.max(1, Math.min(25, Number(perMinute) || 25)));
    this.sleep = sleep;
    this.now = now;
    this.nextAt = 0;
  }

  async wait() {
    const now = this.now();
    const waitMs = Math.max(0, this.nextAt - now);
    this.nextAt = Math.max(now, this.nextAt) + this.intervalMs;
    if (waitMs > 0) await this.sleep(waitMs);
    return waitMs;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CrashSightApiClient {
  constructor(config = readConfig(), options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.limiter = options.limiter || new RateLimiter(config.rateLimitPerMinute);
  }

  requireConfig() {
    const missing = [];
    if (!this.config.localUserId) missing.push('CRASHSIGHT_LOCAL_USER_ID');
    if (!this.config.openApiKey) missing.push('CRASHSIGHT_OPENAPI_KEY');
    if (missing.length) {
      throw new Error(`Missing CrashSight credentials: ${missing.join(', ')}`);
    }
  }

  async post(apiPath, body = {}) {
    this.requireConfig();
    await this.limiter.wait();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(buildSignedUrl(this.config, apiPath), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Accept-Encoding': '*',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      const parsed = raw ? JSON.parse(raw) : {};
      if (!response.ok) {
        const error = new Error(`CrashSight HTTP ${response.status} for ${apiPath}`);
        error.status = response.status;
        error.payload = parsed;
        throw error;
      }
      return unwrapCrashSightResponse(parsed, apiPath);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function unwrapCrashSightResponse(parsed, apiPath = '') {
  if (parsed?.ret && typeof parsed.ret === 'object') {
    if (parsed.ret.code !== undefined && Number(parsed.ret.code) !== 200) {
      const error = new Error(`CrashSight API code ${parsed.ret.code} for ${apiPath}`);
      error.payload = parsed;
      throw error;
    }
    if ('data' in parsed.ret) return parsed.ret.data;
    return parsed.ret;
  }
  if (parsed?.code !== undefined && Number(parsed.code) !== 200) {
    const error = new Error(`CrashSight API code ${parsed.code} for ${apiPath}`);
    error.payload = parsed;
    throw error;
  }
  return parsed?.data ?? parsed;
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
  if (text.includes('credentials') || text.includes('crashsight_local_user_id') || text.includes('crashsight_openapi_key')) {
    hints.push('Configure CRASHSIGHT_LOCAL_USER_ID and CRASHSIGHT_OPENAPI_KEY in local MCP env. Do not paste secrets into chat.');
  }
  if (text.includes('appid')) {
    hints.push('Configure CRASHSIGHT_APP_ID_PC, CRASHSIGHT_APP_ID_ANDROID, and CRASHSIGHT_APP_ID_IOS for target projects.');
  }
  if (text.includes('401') || text.includes('403') || text.includes('auth')) {
    hints.push('Check whether the CrashSight OpenAPI key has access to the configured appId.');
  }
  if (!hints.length) hints.push('Run health_check first to validate CrashSight config and appId mapping.');
  return hints;
}

export async function healthCheck(args = {}, config = readConfig(), client = new CrashSightApiClient(config)) {
  const platforms = normalizePlatforms(args);
  const missing = [];
  if (!config.localUserId) missing.push('CRASHSIGHT_LOCAL_USER_ID');
  if (!config.openApiKey) missing.push('CRASHSIGHT_OPENAPI_KEY');
  for (const platform of platforms) {
    if (!config.appIds[platform.key]) missing.push(`CRASHSIGHT_APP_ID_${platform.key.toUpperCase()}`);
  }
  const result = {
    ok: missing.length === 0,
    version: SERVER_VERSION,
    region: config.region,
    baseUrl: config.baseUrl,
    missing,
    appIds: Object.fromEntries(platforms.map((platform) => [
      platform.label,
      config.appIds[platform.key] ? 'configured' : 'missing',
    ])),
  };
  if (args.ping && missing.length === 0) {
    const platform = platforms[0];
    result.selectorProbe = await client.post('/uniform/openapi/getSelectorDatas', {
      appId: resolveAppId(config, platform),
      pid: String(platform.id),
      types: 'version,tag',
    });
  }
  return result;
}

export function extractRedmineRefs(input = {}) {
  const pieces = [];
  const tags = Array.isArray(input.tags) ? input.tags : input.tags ? [input.tags] : [];
  for (const tag of tags) {
    if (tag && typeof tag === 'object') {
      pieces.push(
        tag.name,
        tag.label,
        tag.value,
        tag.text,
        tag.tagName,
        tag.tag_name,
        tag.displayName,
        tag.display_name,
        tag.title,
        tag.content,
        tag.url,
        tag.href,
      );
    } else {
      pieces.push(tag);
    }
  }
  pieces.push(input.title, input.message, input.description);

  const refs = [];
  const add = (value) => {
    const id = Number.parseInt(String(value || ''), 10);
    if (Number.isFinite(id) && id > 0 && !refs.includes(id)) refs.push(id);
  };

  for (const piece of pieces) {
    const text = String(piece || '').trim();
    if (!text) continue;
    if (/^#?\d{5,8}$/.test(text)) add(text.replace('#', ''));
    for (const match of text.matchAll(/(?:https?:\/\/[^\s"'<>]+)?\/issues\/(\d{5,8})\b/gi)) {
      add(match[1]);
    }
    for (const match of text.matchAll(/\b(?:redmine|rm|issue|bug|ticket)[\s:#-]*(\d{5,8})\b/gi)) {
      add(match[1]);
    }
    for (const match of text.matchAll(/(?:单号|提单|缺陷|问题单|禅道|红矿|红 mine|redmine单)[\s:：#-]*(\d{5,8})\b/gi)) {
      add(match[1]);
    }
    for (const match of text.matchAll(/#(\d{5,8})\b/g)) {
      add(match[1]);
    }
  }
  return refs;
}

export function normalizeIssue(issue, context = {}) {
  const platform = context.platform || normalizePlatform(issue.platformId || 'pc');
  const appId = context.appId || issue.appId || '';
  const versionFilter = context.versionFilter || context.versionPattern || '';
  const issueId = stringField(issue.issueId || issue.esMap?.issueId);
  const tags = normalizeTags(issue.tagInfoList || issue.tags || issue.tag || issue.issueTag || issue.esMap?.tag || []);
  const title = issue.exceptionName || issue.esMap?.exceptionName || issue.exceptionMessage || issue.esMap?.exceptionMessage || '';
  const message = issue.exceptionMessage || issue.esMap?.exceptionMessage || issue.keyStack || issue.esMap?.keyStack || '';
  const sample = normalizeCrashSample(issue.lastMatchedReport?.crashMap || issue.lastMatchedReport || issue.crashMap);
  const totalCrashNum = firstMetricValue(
    issue.totalCrashNum,
    issue.totalExceptionNum,
    issue.totalCrashCount,
    issue.totalCount,
    issue.totalUploadCount,
    issue.totalIssueCrashNum,
    issue.crashTotal,
    issue.crashCount,
    issue.esMap?.totalCrashNum,
    issue.esMap?.totalExceptionNum,
    issue.esMap?.totalCrashCount,
    issue.esMap?.totalCount,
    issue.crashNum,
    issue.exceptionNum,
    issue.count,
    issue.uploadCount,
    issue.esMap?.crashNum,
    issue.esMap?.exceptionNum,
    issue.esMap?.count,
    issue.esMap?.uploadCount,
  ) ?? 0;
  const periodCrashNum = firstMetricValue(
    issue.periodCrashNum,
    issue.currentPeriodCrashNum,
    issue.rangeCrashNum,
    issue.crashNumInRange,
    issue.todayCrashNum,
    issue.todayCount,
    issue.dayCrashNum,
    issue.dateCrashNum,
    issue.currentCrashNum,
    issue.exceptionNum,
    issue.esMap?.periodCrashNum,
    issue.esMap?.rangeCrashNum,
    issue.esMap?.todayCrashNum,
    issue.esMap?.dayCrashNum,
    issue.esMap?.dateCrashNum,
    issue.esMap?.currentCrashNum,
  );
  const totalAffectedUsersOrDevices = firstMetricValue(
    issue.totalAffectedUsersOrDevices,
    issue.totalDeviceCount,
    issue.totalImeiCount,
    issue.totalUserCount,
    issue.affectedDeviceCount,
    issue.affectedDevices,
    issue.deviceCount,
    issue.imeiCount,
    issue.esDeviceCount,
    issue.esMap?.totalAffectedUsersOrDevices,
    issue.esMap?.totalDeviceCount,
    issue.esMap?.totalImeiCount,
    issue.esMap?.totalUserCount,
    issue.esMap?.affectedDeviceCount,
    issue.esMap?.affectedDevices,
    issue.esMap?.deviceCount,
    issue.esMap?.imeiCount,
    issue.esMap?.esDeviceCount,
    issue.userCount,
    issue.esMap?.userCount,
  ) ?? 0;
  const periodAffectedUsersOrDevices = firstMetricValue(
    issue.periodAffectedUsersOrDevices,
    issue.currentPeriodAffectedUsersOrDevices,
    issue.periodUserCount,
    issue.periodDeviceCount,
    issue.rangeUserCount,
    issue.rangeDeviceCount,
    issue.userCountInRange,
    issue.deviceCountInRange,
    issue.todayUserCount,
    issue.todayDeviceCount,
    issue.dayUserCount,
    issue.dayDeviceCount,
    issue.dateUserCount,
    issue.dateDeviceCount,
    issue.currentUserCount,
    issue.currentDeviceCount,
    issue.esMap?.periodAffectedUsersOrDevices,
    issue.esMap?.periodUserCount,
    issue.esMap?.periodDeviceCount,
    issue.esMap?.todayUserCount,
    issue.esMap?.todayDeviceCount,
  );
  const redmineRefs = extractRedmineRefs({ tags, title, message });
  const applicationVersion = stringField(
    issue.appVersion
    || issue.applicationVersion
    || issue.productVersion
    || issue.versionName
    || issue.buildVersion
    || issue.esMap?.appVersion
    || issue.esMap?.applicationVersion
    || issue.esMap?.productVersion
    || issue.esMap?.versionName
    || issue.esMap?.buildVersion
    || sample.productVersion
    || issue.issueVersion
    || issue.version
    || issue.esMap?.issueVersion
    || versionFilter,
  );
  return {
    platform: platform.label,
    platformId: platform.id,
    appId,
    versionFilter,
    issueId,
    issueHash: stringField(issue.issueHash || issue.esMap?.issueHash),
    crashHash: stringField(issue.crashHash || sample.crashHash),
    exceptionName: stringField(issue.exceptionName || issue.esMap?.exceptionName),
    exceptionMessage: stringField(issue.exceptionMessage || issue.esMap?.exceptionMessage),
    keyStack: stackText(issue.keyStack || issue.esMap?.keyStack || issue.stackText || issue.esMap?.stackText || sample.stack, 2000),
    periodCrashNum,
    totalCrashNum,
    crashNum: periodCrashNum,
    periodCrashNumVerified: periodCrashNum !== null,
    periodAffectedUsersOrDevices,
    totalAffectedUsersOrDevices,
    affectedUsersOrDevices: periodAffectedUsersOrDevices,
    periodAffectedUsersOrDevicesVerified: periodAffectedUsersOrDevices !== null,
    periodMetricsVerified: periodCrashNum !== null && periodAffectedUsersOrDevices !== null,
    firstSeenTime: stringField(issue.firstUploadTime || issue.firstCrashTime || issue.esMap?.firstUploadTime),
    latestUploadTime: stringField(issue.lastestUploadTime || issue.latestUploadTime || issue.firstUploadTime || issue.esMap?.latestUploadTime),
    latestUploadTimestamp: issue.latestUploadTimestamp || issue.lastUploadTimestamp || issue.firstUploadTimestamp || issue.esMap?.latestUploadTimestamp || 0,
    firstSeenVersion: stringField(issue.firstCrashVersion || issue.firstVersion || issue.esMap?.firstCrashVersion || issue.issueVersion || issue.version),
    applicationVersion,
    currentVersion: applicationVersion,
    status: issue.status ?? issue.esMap?.status ?? '',
    processor: stringField(issue.processor || issue.esMap?.processor),
    tags,
    redmineRefs,
    redmineLinks: redmineRefs.map((id) => ({
      id,
      url: buildRedmineIssueLink(context.redmineBaseUrl || 'http://soc-redmine.wd.com', id),
    })),
    crashSightLink: buildIssueLink(context.baseUrl || BASE_URL_BY_REGION.cn, appId, platform.id, issueId),
    matchedVersionFilters: versionFilter ? [versionFilter] : [],
    sample,
  };
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : tags ? [tags] : [];
  return list.map((tag) => {
    if (tag && typeof tag === 'object') {
      return String(
        tag.name
        || tag.label
        || tag.value
        || tag.text
        || tag.tagName
        || tag.tag_name
        || tag.displayName
        || tag.display_name
        || tag.title
        || tag.content
        || tag.url
        || tag.href
        || tag.id
        || '',
      ).trim();
    }
    return String(tag || '').trim();
  }).filter(Boolean);
}

export function normalizeCrashSample(sample) {
  if (!sample || typeof sample !== 'object') return {};
  return {
    userId: stringField(sample.userId ?? sample.user ?? sample.expUid),
    deviceId: stringField(sample.deviceId ?? sample.imei ?? sample.mac),
    model: stringField(sample.model ?? sample.hardware ?? sample.brand ?? sample.gpu),
    osVersion: stringField(sample.osVersion ?? sample.osVer),
    productVersion: stringField(sample.productVersion ?? sample.version),
    crashTime: stringField(sample.crashTime ?? sample.uploadTime),
    crashHash: stringField(sample.crashHash || crashIdToHash(sample.crashId || sample.id || '')),
    stack: stackText(sample.keyStack || sample.callStack || sample.rawStack || sample.retraceCrashDetail || sample.threadStack || ''),
    raw: sample,
  };
}

export function crashIdToHash(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes(':')) return raw;
  return raw.match(/.{1,2}/g)?.join(':') || raw;
}

export function buildIssueLink(baseUrl, appId, platformId, issueId) {
  const safeAppId = encodeURIComponent(String(appId || ''));
  const safeIssueId = encodeURIComponent(String(issueId || ''));
  const url = new URL(
    `/crash-reporting/crashes/${safeAppId}/${safeIssueId}`,
    String(baseUrl || BASE_URL_BY_REGION.cn).replace(/\/+$/, ''),
  );
  url.searchParams.set('pid', String(platformId || ''));
  return url.toString();
}

export function buildRedmineIssueLink(baseUrl, issueId) {
  return new URL(
    `/issues/${encodeURIComponent(String(issueId || ''))}`,
    String(baseUrl || 'http://soc-redmine.wd.com').replace(/\/+$/, ''),
  ).toString();
}

export async function scanDailyCrashes(args = {}, config = readConfig(), client = new CrashSightApiClient(config)) {
  const dateRange = normalizeDateRange(args);
  const platforms = normalizePlatforms(args);
  const versionFilters = resolveVersionFilters(args, config);
  const pageSize = readInteger(args.pageSize ?? args.rows, 500, 1, 500);
  const maxPages = readInteger(args.maxPages, 100, 1, 1000);
  const rawItems = [];
  const errors = [];
  let filteredOutByDate = 0;
  let missingUploadTimeCount = 0;
  let apiRowCount = 0;
  let pagesScanned = 0;
  let duplicatePageBreaks = 0;
  let possiblyTruncated = false;

  for (const platform of platforms) {
    const appId = resolveAppId(config, platform, args.appId);
    for (const versionFilter of versionFilters) {
      const seenPageKeys = new Set();
      try {
        for (let page = 1; page <= maxPages; page += 1) {
          const offset = (page - 1) * pageSize;
          const data = await client.post('/uniform/openapi/queryIssueList', {
            appId,
            platformId: platform.id,
            pid: String(platform.id),
            exceptionTypeList: 'Crash,Native,ExtensionCrash',
            rows: pageSize,
            page,
            pageNum: page,
            offset,
            start: offset,
            sortField: args.sortField || 'uploadTime',
            sortOrder: args.sortOrder || 'desc',
            skipQueryHbase: true,
            version: versionFilter,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            startTime: dateRange.startTime,
            endTime: dateRange.endTime,
            issueUploadStartTime: dateRange.startTime,
            issueUploadEndTime: dateRange.endTime,
            issueUploadTimeRelativeMillis: args.issueUploadTimeRelativeMillis,
          });
          const rawIssues = Array.isArray(data?.issueList) ? data.issueList.filter(Boolean) : [];
          if (!rawIssues.length) break;

          const pageKey = rawIssues
            .map((rawIssue) => rawIssueIdentity(rawIssue, platform, appId))
            .join('|');
          if (seenPageKeys.has(pageKey)) {
            duplicatePageBreaks += 1;
            break;
          }
          seenPageKeys.add(pageKey);
          apiRowCount += rawIssues.length;
          pagesScanned += 1;

          for (const rawIssue of rawIssues) {
            const item = normalizeIssue(rawIssue, {
              platform,
              appId,
              versionFilter,
              baseUrl: config.baseUrl,
              redmineBaseUrl: config.redmineBaseUrl,
            });
            const uploadTimestampMs = issueUploadTimestampMs(rawIssue, item);
            if (!uploadTimestampMs) {
              missingUploadTimeCount += 1;
              filteredOutByDate += 1;
              continue;
            }
            if (uploadTimestampMs < dateRange.startTimestampMs || uploadTimestampMs > dateRange.endTimestampMs) {
              filteredOutByDate += 1;
              continue;
            }
            rawItems.push(item);
          }
          if (rawIssues.length < pageSize) break;
          if (page === maxPages) possiblyTruncated = true;
        }
      } catch (error) {
        errors.push({
          platform: platform.label,
          versionFilter,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const items = rawItems;
  const duplicateStats = detectPotentialDuplicateIssues(rawItems);
  const summary = {
    totalIssues: items.length,
    rawIssueCount: rawItems.length,
    apiRowCount,
    duplicateIssueCount: 0,
    dedupeApplied: false,
    potentialDuplicateIssueCount: duplicateStats.potentialDuplicateIssueCount,
    crossVersionDuplicateIssueCount: duplicateStats.crossVersionDuplicateIssueCount,
    periodCrashCount: items.reduce((sum, item) => sum + numberFrom(item.periodCrashNum), 0),
    totalCrashCount: items.reduce((sum, item) => sum + numberFrom(item.totalCrashNum), 0),
    periodAffectedUsersOrDevices: items.reduce((sum, item) => sum + numberFrom(item.periodAffectedUsersOrDevices), 0),
    totalAffectedUsersOrDevices: items.reduce((sum, item) => sum + numberFrom(item.totalAffectedUsersOrDevices), 0),
    redmineRefCount: new Set(items.flatMap((item) => item.redmineRefs)).size,
    errorCount: errors.length,
    filteredOutByDate,
    missingUploadTimeCount,
    pagesScanned,
    pageSize,
    maxPages,
    duplicatePageBreaks,
    possiblyTruncated,
  };

  return {
    date: dateRange.date,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    startTime: dateRange.startTime,
    endTime: dateRange.endTime,
    platforms: platforms.map((platform) => platform.label),
    versionFilters,
    pageSize,
    maxPages,
    summary,
    items,
    errors,
    filteredOutByDate,
    missingUploadTimeCount,
    pagesScanned,
    duplicateIssueCount: 0,
    dedupeApplied: false,
    potentialDuplicateIssueCount: duplicateStats.potentialDuplicateIssueCount,
    crossVersionDuplicateIssueCount: duplicateStats.crossVersionDuplicateIssueCount,
    duplicatePageBreaks,
    possiblyTruncated,
  };
}

function detectPotentialDuplicateIssues(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = [
      item.platformId || '',
      item.appId || '',
      item.issueId || item.issueHash || item.crashHash || item.crashSightLink,
    ].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  let potentialDuplicateIssueCount = 0;
  let crossVersionDuplicateIssueCount = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    potentialDuplicateIssueCount += group.length - 1;
    const filters = new Set(group.flatMap((item) => item.matchedVersionFilters?.length ? item.matchedVersionFilters : [item.versionFilter].filter(Boolean)));
    if (filters.size > 1) crossVersionDuplicateIssueCount += group.length - 1;
  }
  return { potentialDuplicateIssueCount, crossVersionDuplicateIssueCount };
}

function rawIssueIdentity(rawIssue = {}, platform = {}, appId = '') {
  return [
    platform.id || rawIssue.platformId || '',
    appId || rawIssue.appId || '',
    stringField(rawIssue.issueId || rawIssue.esMap?.issueId || rawIssue.issueHash || rawIssue.esMap?.issueHash || rawIssue.crashHash || rawIssue.crashId),
  ].join(':');
}

function dedupeIssues(items = []) {
  const byKey = new Map();
  let duplicateIssueCount = 0;
  for (const item of items) {
    const key = [
      item.platformId || '',
      item.appId || '',
      item.issueId || item.issueHash || item.crashHash || item.crashSightLink,
    ].join(':');
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...item,
        matchedVersionFilters: [...new Set(item.matchedVersionFilters?.length ? item.matchedVersionFilters : [item.versionFilter].filter(Boolean))],
      });
      continue;
    }
    duplicateIssueCount += 1;
    mergeDuplicateIssue(byKey.get(key), item);
  }
  return { items: [...byKey.values()], duplicateIssueCount };
}

function mergeDuplicateIssue(target, item) {
  target.matchedVersionFilters = [...new Set([
    ...(target.matchedVersionFilters || []),
    ...(item.matchedVersionFilters?.length ? item.matchedVersionFilters : [item.versionFilter].filter(Boolean)),
  ])];
  target.versionFilter = target.matchedVersionFilters.join(', ');
  target.tags = [...new Set([...(target.tags || []), ...(item.tags || [])])];
  target.redmineRefs = [...new Set([...(target.redmineRefs || []), ...(item.redmineRefs || [])])].sort((a, b) => a - b);
  const redmineLinks = new Map();
  for (const link of [...(target.redmineLinks || []), ...(item.redmineLinks || [])]) {
    if (link?.id) redmineLinks.set(link.id, link);
  }
  target.redmineLinks = [...redmineLinks.values()];

  target.periodCrashNum = maxMetric(target.periodCrashNum, item.periodCrashNum);
  target.totalCrashNum = maxMetric(target.totalCrashNum, item.totalCrashNum);
  target.crashNum = target.periodCrashNum;
  target.periodAffectedUsersOrDevices = maxMetric(target.periodAffectedUsersOrDevices, item.periodAffectedUsersOrDevices);
  target.totalAffectedUsersOrDevices = maxMetric(target.totalAffectedUsersOrDevices, item.totalAffectedUsersOrDevices);
  target.affectedUsersOrDevices = target.periodAffectedUsersOrDevices;
  target.periodCrashNumVerified = Boolean(target.periodCrashNumVerified || item.periodCrashNumVerified);
  target.periodAffectedUsersOrDevicesVerified = Boolean(
    target.periodAffectedUsersOrDevicesVerified || item.periodAffectedUsersOrDevicesVerified,
  );
  target.periodMetricsVerified = Boolean(target.periodMetricsVerified || item.periodMetricsVerified);

  if (isEarlierTime(item.firstSeenTime, target.firstSeenTime)) target.firstSeenTime = item.firstSeenTime;
  if (isLaterTime(item.latestUploadTime || item.latestUploadTimestamp, target.latestUploadTime || target.latestUploadTimestamp)) {
    target.latestUploadTime = item.latestUploadTime;
    target.latestUploadTimestamp = item.latestUploadTimestamp;
  }
  if (!target.firstSeenVersion && item.firstSeenVersion) target.firstSeenVersion = item.firstSeenVersion;
  if (!target.currentVersion && item.currentVersion) target.currentVersion = item.currentVersion;
}

function maxMetric(a, b) {
  if (a === undefined || a === null || a === '') return b === undefined || b === '' ? null : b;
  if (b === undefined || b === null || b === '') return a;
  return Math.max(numberFrom(a), numberFrom(b));
}

function isEarlierTime(a, b) {
  const at = timestampFromValue(a);
  const bt = timestampFromValue(b);
  return Boolean(at && (!bt || at < bt));
}

function isLaterTime(a, b) {
  const at = timestampFromValue(a);
  const bt = timestampFromValue(b);
  return Boolean(at && (!bt || at > bt));
}

export function issueUploadDateKey(rawIssue = {}, normalizedIssue = {}) {
  return dateKeyFromValue(
    normalizedIssue.latestUploadTimestamp
    || rawIssue.latestUploadTimestamp
    || rawIssue.lastUploadTimestamp
    || rawIssue.firstUploadTimestamp
    || rawIssue.esMap?.latestUploadTimestamp,
  ) || dateKeyFromValue(
    normalizedIssue.latestUploadTime
    || rawIssue.lastestUploadTime
    || rawIssue.latestUploadTime
    || rawIssue.lastUploadTime
    || rawIssue.firstUploadTime
    || rawIssue.esMap?.latestUploadTime
    || rawIssue.esMap?.firstUploadTime,
  );
}

export function issueUploadTimestampMs(rawIssue = {}, normalizedIssue = {}) {
  return timestampFromValue(
    normalizedIssue.latestUploadTimestamp
    || rawIssue.latestUploadTimestamp
    || rawIssue.lastUploadTimestamp
    || rawIssue.firstUploadTimestamp
    || rawIssue.esMap?.latestUploadTimestamp,
  ) || timestampFromValue(
    normalizedIssue.latestUploadTime
    || rawIssue.lastestUploadTime
    || rawIssue.latestUploadTime
    || rawIssue.lastUploadTime
    || rawIssue.firstUploadTime
    || rawIssue.esMap?.latestUploadTime
    || rawIssue.esMap?.firstUploadTime,
  );
}

export function dateKeyFromValue(value) {
  const timestamp = timestampFromValue(value);
  if (!timestamp) return '';
  return formatDateKey(new Date(timestamp));
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value).trim())) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '';
    const millis = num < 10_000_000_000 ? num * 1000 : num;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('');
  }
  const text = String(value).trim();
  const match = text.match(/(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/);
  if (!match) return '';
  return [
    match[1],
    String(Number(match[2])).padStart(2, '0'),
    String(Number(match[3])).padStart(2, '0'),
  ].join('');
}

function timestampFromValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value).trim())) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '';
    const millis = num < 10_000_000_000 ? num * 1000 : num;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? '' : date.getTime();
  }
  const text = String(value).trim();
  const match = text.match(/(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})(?:日)?(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? '' : date.getTime();
}

export async function compareIssueVersions(args = {}, config = readConfig(), client = new CrashSightApiClient(config)) {
  const platform = normalizePlatform(args.platform || 'pc');
  const appId = resolveAppId(config, platform, args.appId);
  const issueId = stringField(args.issueId);
  const issueHash = stringField(args.issueHash);
  const stackFingerprint = stringField(args.stackFingerprint);
  if (!issueId && !issueHash && !stackFingerprint) {
    throw new Error('issueId, issueHash, or stackFingerprint is required.');
  }

  const versionFilters = resolveVersionFilters(args, config);
  const versionHistory = [];
  const errors = [];
  for (const versionFilter of versionFilters) {
    try {
      const data = await client.post('/uniform/openapi/queryIssueList', {
        appId,
        platformId: platform.id,
        pid: String(platform.id),
        exceptionTypeList: 'Crash,Native,ExtensionCrash',
        rows: readInteger(args.rows, 200, 1, 500),
        sortField: 'uploadTime',
        sortOrder: 'desc',
        skipQueryHbase: true,
        version: versionFilter,
      });
      const rawIssues = Array.isArray(data?.issueList) ? data.issueList.filter(Boolean) : [];
      const match = rawIssues.find((issue) => issueMatches(issue, { issueId, issueHash, stackFingerprint }));
      versionHistory.push({
        versionFilter,
        present: Boolean(match),
        issue: match ? normalizeIssue(match, {
          platform,
          appId,
          versionFilter,
          baseUrl: config.baseUrl,
          redmineBaseUrl: config.redmineBaseUrl,
        }) : null,
      });
    } catch (error) {
      errors.push({ versionFilter, error: error instanceof Error ? error.message : String(error) });
      versionHistory.push({ versionFilter, present: false, issue: null, error: errors.at(-1).error });
    }
  }

  const presentHistory = versionHistory.filter((entry) => entry.present);
  const lastEntry = versionHistory.at(-1);
  const first = presentHistory[0]?.issue || null;
  return {
    issueId,
    issueHash,
    platform: platform.label,
    appId,
    versionFilters,
    firstSeenVersion: first?.firstSeenVersion || presentHistory[0]?.versionFilter || '',
    firstSeenTime: first?.firstSeenTime || '',
    continuedVersionCount: presentHistory.length,
    judgement: buildVersionJudgement(versionHistory, presentHistory, lastEntry),
    versionHistory,
    errors,
  };
}

function issueMatches(issue, criteria) {
  const issueId = stringField(issue.issueId || issue.esMap?.issueId);
  const issueHash = stringField(issue.issueHash || issue.esMap?.issueHash);
  const stack = stringField(issue.keyStack || issue.esMap?.keyStack || issue.stackText || issue.esMap?.stackText);
  return (
    (criteria.issueId && issueId === criteria.issueId)
    || (criteria.issueHash && issueHash === criteria.issueHash)
    || (criteria.stackFingerprint && stack.includes(criteria.stackFingerprint))
  );
}

function buildVersionJudgement(versionHistory, presentHistory, lastEntry) {
  if (!versionHistory.length || !presentHistory.length) return '版本历史不足，无法确认是否已解决';
  if (lastEntry?.present) return '仍在发生';
  if (presentHistory.length > 0) return '疑似已解决';
  return '无法确认';
}

export async function getSingleCrashAnalysisContext(args = {}, config = readConfig(), client = new CrashSightApiClient(config)) {
  const platform = normalizePlatform(args.platform || 'pc');
  const appId = resolveAppId(config, platform, args.appId);
  const issueId = stringField(args.issueId);
  if (!issueId) throw new Error('issueId is required.');

  const issue = await client.post('/uniform/openapi/issueInfo', {
    appId,
    platformId: String(platform.id),
    issueId,
  });

  let crashHash = stringField(args.crashHash);
  let lastCrash = null;
  const errors = [];
  if (!crashHash) {
    try {
      lastCrash = await client.post('/uniform/openapi/lastCrashInfo', {
        appId,
        platformId: String(platform.id),
        issues: issueId,
        crashDataType: 'undefined',
      });
      crashHash = stringField(lastCrash?.crashHash || crashIdToHash(lastCrash?.crashId || ''));
    } catch (error) {
      errors.push({ step: 'lastCrashInfo', error: error instanceof Error ? error.message : String(error) });
    }
  }

  let crashDoc = null;
  let crashDetail = null;
  if (crashHash) {
    try {
      crashDoc = await client.post('/uniform/openapi/crashDoc', {
        appId,
        platformId: String(platform.id),
        crashHash,
        logtype: args.logtype || 'all',
        needQueryCustomKv: args.needCustomKv !== false,
      });
    } catch (error) {
      errors.push({ step: 'crashDoc', error: error instanceof Error ? error.message : String(error) });
    }

    try {
      crashDetail = await client.post('/uniform/openapi/appDetailCrash', {
        appId,
        platformId: String(platform.id),
        crashHash,
      });
    } catch (error) {
      errors.push({ step: 'appDetailCrash', error: error instanceof Error ? error.message : String(error) });
    }
  }

  const crashMap = crashDoc?.crashMap || crashDetail?.crashMap || null;
  const detailMap = crashDetail?.crashMap || {};
  const sample = normalizeCrashSample(crashMap);
  const fullStack = collectFullStacks([crashMap, detailMap, issue]);

  return {
    platform: platform.label,
    platformId: platform.id,
    appId,
    issueId,
    crashHash,
    crashSightLink: buildIssueLink(config.baseUrl, appId, platform.id, issueId),
    issue,
    lastCrash,
    crashDoc,
    crashDetail,
    crashMap,
    sample,
    fullStack,
    dumpIncluded: false,
    note: 'Dump/minidump payload is intentionally not fetched by crash-ai-crashsight.',
    errors,
  };
}

function collectFullStacks(sources = []) {
  const parts = [];
  const keys = [
    'keyStack',
    'callStack',
    'rawStack',
    'retraceCrashDetail',
    'threadStack',
    'allThreadStack',
    'stackText',
    'exceptionStack',
  ];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const text = stringField(source[key]).trim();
      if (text && !parts.includes(text)) parts.push(text);
    }
    if (Array.isArray(source.threads)) {
      for (const thread of source.threads) {
        const text = stringField(thread.stack || thread.callStack || thread.rawStack).trim();
        if (text && !parts.includes(text)) parts.push(text);
      }
    }
  }
  return stackText(parts.join('\n\n--- thread/stack split ---\n\n'), MAX_STACK_BYTES);
}

function stackText(value, maxBytes = MAX_STACK_BYTES) {
  const text = String(value || '').replace(/\r/g, '').trim();
  if (!text) return '';
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n...[truncated by crash-ai-crashsight]`;
}

function numberFrom(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstMetricNumber(...values) {
  return firstMetricValue(...values) ?? 0;
}

function firstMetricValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(String(value).replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringField(value) {
  return value === undefined || value === null ? '' : String(value);
}
