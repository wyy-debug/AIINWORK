import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const bundleRoot = path.dirname(process.execPath);
const resourcesDir = path.join(bundleRoot, 'resources');
const appDir = path.join(resourcesDir, 'app');
const runtimeNode = path.join(resourcesDir, 'runtime', 'node.exe');
const nodeCommand = existsSync(runtimeNode) ? runtimeNode : 'node';
const serverEntry = path.join(appDir, 'dist-server', 'server', 'index.js');
const mtlCodeExe = path.join(resourcesDir, 'mtl-code', 'mtl-code.exe');
const mtlCodeBunEntry = path.join(resourcesDir, 'mtl-code', 'dist', 'cli-bun.js');
const mtlCodeNodeEntry = path.join(resourcesDir, 'mtl-code', 'dist', 'cli-node.js');
const bunExe = process.env.BUN_EXE || path.join(os.homedir(), '.bun', 'bin', 'bun.exe');
const appDataDir = process.env.APP_DATA_DIR ||
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Argus-UI');

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once('error', () => tryPort(port + 1));
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    };

    tryPort(startPort);
  });
}

function waitForHealth(port, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
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
        reject(new Error(`Backend did not become healthy on port ${port}`));
        return;
      }

      setTimeout(poll, 500);
    };

    poll();
  });
}

function openBrowser(url) {
  if (process.env.MTL_CODE_NO_OPEN === '1') {
    return;
  }

  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
}

function resolveMtlCodeCliPath() {
  if (existsSync(mtlCodeExe)) {
    return mtlCodeExe;
  }
  if (existsSync(mtlCodeBunEntry)) {
    return mtlCodeBunEntry;
  }
  if (existsSync(mtlCodeNodeEntry)) {
    return mtlCodeNodeEntry;
  }
  return '';
}

async function main() {
  if (!existsSync(serverEntry)) {
    throw new Error(`Missing backend entry: ${serverEntry}`);
  }

  mkdirSync(appDataDir, { recursive: true });

  const port = Number(process.env.SERVER_PORT || await findFreePort(3987));
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    APP_DATA_DIR: appDataDir,
    DATABASE_PATH: path.join(appDataDir, 'auth.db'),
    DESKTOP_MODE: 'true',
    HOST: '127.0.0.1',
    SERVER_PORT: String(port),
    MTL_CODE_RESOURCES_DIR: resourcesDir,
    MTL_CODE_CLI_PATH: resolveMtlCodeCliPath(),
  };
  if (path.basename(process.execPath).toLowerCase().includes('debug')) {
    env.ARGUS_PACKAGE_CHANNEL = 'debug';
    env.ARGUS_DEBUG_PACKAGE = '1';
    env.ARGUS_OBSIDIAN_DEBUG = '1';
    env.ARGUS_CODEGRAPH_DEBUG = '1';
  }
  if (existsSync(bunExe)) {
    env.BUN_EXE = bunExe;
  }

  console.log(`Starting Argus at ${url}`);
  console.log(`Bundle: ${bundleRoot}`);
  console.log(`Data: ${appDataDir}`);

  const child = spawn(nodeCommand, [serverEntry], {
    cwd: appDir,
    env,
    stdio: 'inherit',
    windowsHide: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
    }
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => child.kill());
  process.on('SIGTERM', () => child.kill());

  await waitForHealth(port);
  openBrowser(url);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
