import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '..');

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  return packageJson.version || '0.0.0';
}

function readManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, 'build-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing packaged build manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function resolvePackagedSmokeConfig({
  packageRoot = process.env.ARGUS_SMOKE_PACKAGE_ROOT
    || path.join(workspaceRoot, 'workspace', 'vendor', 'debug', `Argus-Debug-${readPackageVersion()}`),
  port = Number(process.env.ARGUS_SMOKE_PORT || process.env.SERVER_PORT || 3998),
  appDataDir,
} = {}) {
  const resolvedRoot = path.resolve(packageRoot);
  const manifest = readManifest(resolvedRoot);
  if (manifest.channel !== 'debug' || manifest.debug !== true) {
    throw new Error(`Packaged smoke expects a debug portable bundle. Got channel=${manifest.channel}, debug=${manifest.debug}`);
  }

  const exePath = path.join(resolvedRoot, 'Argus-Debug.exe');
  if (!existsSync(exePath)) {
    throw new Error(`Missing debug executable: ${exePath}`);
  }

  const resolvedPort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 3998;
  const resolvedAppDataDir = path.resolve(appDataDir || path.join(os.tmpdir(), `argus-debug-smoke-${resolvedPort}`));

  return {
    packageRoot: resolvedRoot,
    exePath,
    channel: manifest.channel,
    version: manifest.version,
    port: resolvedPort,
    baseUrl: `http://127.0.0.1:${resolvedPort}`,
    appDataDir: resolvedAppDataDir,
    env: {
      MTL_CODE_NO_OPEN: '1',
      ARGUS_PACKAGE_CHANNEL: 'debug',
      ARGUS_DEBUG_PACKAGE: '1',
      SERVER_PORT: String(resolvedPort),
      APP_DATA_DIR: resolvedAppDataDir,
    },
  };
}

function waitForHealth(baseUrl, timeoutMs = 45_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(`${baseUrl}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Packaged app did not become healthy at ${baseUrl}`));
        return;
      }
      setTimeout(poll, 500);
    };
    poll();
  });
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: appRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${process.execPath} ${args.join(' ')} failed with ${code}`));
    });
  });
}

export async function runPackagedDebugSmoke(options = {}) {
  const config = resolvePackagedSmokeConfig(options);
  await mkdir(config.appDataDir, { recursive: true });

  const packagedApp = spawn(config.exePath, [], {
    cwd: config.packageRoot,
    env: {
      ...process.env,
      ...config.env,
    },
    stdio: 'inherit',
    windowsHide: true,
  });

  try {
    await waitForHealth(config.baseUrl);
    await runNode(['scripts/smoke-ui.mjs'], {
      SMOKE_BASE_URL: config.baseUrl,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS || 'true',
    });
  } finally {
    packagedApp.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPackagedDebugSmoke().catch((error) => {
    console.error(`[packaged-smoke] failed: ${error.message}`);
    process.exit(1);
  });
}
