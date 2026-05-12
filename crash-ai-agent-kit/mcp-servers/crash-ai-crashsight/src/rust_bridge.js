import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveRustCorePath() {
  return path.resolve(__dirname, '..', 'bin', 'win32-x64', 'crash-ai-core.exe');
}

export async function runRustCore(args = {}, env = process.env, options = {}) {
  const corePath = options.corePath || resolveRustCorePath();
  const coreArgs = options.coreArgs || [];
  if (!fs.existsSync(corePath)) {
    throw new Error('CrashAI Rust core missing; reinstall MCP package or check bin/win32-x64/crash-ai-core.exe');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(corePath, coreArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = estimateRustCoreTimeoutMs(args, env);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CrashAI Rust core timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `CrashAI Rust core exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`CrashAI Rust core returned invalid JSON: ${error.message}`));
      }
    });

    child.stdin.end(JSON.stringify(args));
  });
}

export function estimateRustCoreTimeoutMs(args = {}, env = process.env) {
  const explicit = Number.parseInt(String(env.CRASH_AI_CORE_TIMEOUT_MS || ''), 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const rateLimit = readInteger(
    env.CRASH_AI_OPENAPI_RATE_LIMIT_PER_MINUTE || env.CRASHSIGHT_RATE_LIMIT_PER_MINUTE,
    20,
    1,
    25,
  );
  const platforms = countList(args.platforms ?? args.platform, 3);
  const versions = countList(args.versionFilters ?? args.branches, defaultBranchFilterCount(env));
  const maxPages = readInteger(args.maxPages, 100, 1, 1000);
  const scanCalls = platforms * versions * maxPages;

  // Scan calls are the lower bound. issueInfo and retry calls can add minutes,
  // so keep a fixed headroom and a generous floor for report generation.
  const minMs = Math.ceil((scanCalls / rateLimit) * 60_000);
  const withHeadroom = minMs + 10 * 60_000;
  return Math.min(Math.max(withHeadroom, 10 * 60_000), 2 * 60 * 60_000);
}

function countList(value, fallback) {
  if (Array.isArray(value)) return Math.max(value.filter((item) => String(item ?? '').trim()).length, 1);
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return 1;
}

function defaultBranchFilterCount(env) {
  const raw = env.CRASHSIGHT_BRANCH_FILTERS;
  if (!raw) return 2;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Math.max(Object.keys(parsed).length, 1);
    }
  } catch {
    // keep fallback
  }
  return 2;
}

function readInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
