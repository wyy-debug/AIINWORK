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
    const timeoutMs = Number.parseInt(String(env.CRASH_AI_CORE_TIMEOUT_MS || '300000'), 10);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CrashAI Rust core timed out after ${timeoutMs}ms`));
    }, Number.isFinite(timeoutMs) ? timeoutMs : 300000);

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
