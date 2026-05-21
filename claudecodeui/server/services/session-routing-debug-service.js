import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEBUG_FILE_PREFIX = 'session-routing';
const SECRET_KEY_PATTERN = /(token|secret|password|authorization|auth|cookie|key)/i;
const MAX_STRING_LENGTH = 600;

function dataRootFromEnv(env = process.env) {
  return env.MTL_CODE_UI_DATA_DIR || path.join(os.homedir(), '.mtl-code-ui');
}

function isoDateFromNow(now = () => new Date().toISOString()) {
  return String(now()).slice(0, 10);
}

export function getSessionRoutingDebugLogPath({ env = process.env, now = () => new Date().toISOString() } = {}) {
  const logDir = env.MTL_CODE_UI_DEBUG_DIR || path.join(dataRootFromEnv(env), 'debug');
  return path.join(logDir, `${DEBUG_FILE_PREFIX}-${isoDateFromNow(now)}.jsonl`);
}

function sanitizeDebugValue(key, value) {
  if (SECRET_KEY_PATTERN.test(String(key))) {
    return '[redacted]';
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item, index) => sanitizeDebugValue(`${key}.${index}`, item));
  }

  if (typeof value === 'object') {
    return sanitizeDebugDetails(value);
  }

  return String(value);
}

function sanitizeDebugDetails(details = {}) {
  const output = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (value === undefined) {
      continue;
    }
    if (key === 'command' || key === 'content' || key === 'messageContent') {
      if (typeof value === 'string') {
        output[`${key}Length`] = value.length;
      }
      continue;
    }
    output[key] = sanitizeDebugValue(key, value);
  }
  return output;
}

export function buildSessionRoutingDebugEvent(event, details = {}, { now = () => new Date().toISOString() } = {}) {
  const sanitizedDetails = sanitizeDebugDetails(details);
  if (Object.prototype.hasOwnProperty.call(sanitizedDetails, 'event')) {
    sanitizedDetails.sourceEvent = sanitizedDetails.event;
    delete sanitizedDetails.event;
  }
  return {
    at: now(),
    event,
    ...sanitizedDetails,
  };
}

export function appendSessionRoutingDebugEvent(event, details = {}, options = {}) {
  try {
    const record = buildSessionRoutingDebugEvent(event, details, options);
    const logPath = getSessionRoutingDebugLogPath(options);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
    console.log(`[ArgusRoutingDebug] ${JSON.stringify(record)}`);
    return { success: true, logPath, record };
  } catch (error) {
    console.warn('[ArgusRoutingDebug] failed to write routing debug event:', error?.message || error);
    return { success: false, error };
  }
}
