import { app, BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const sourceAppRoot = path.resolve(electronDir, '..');
const appRoot = app.isPackaged ? app.getAppPath() : sourceAppRoot;
const resourcesRoot = app.isPackaged
  ? process.resourcesPath
  : path.join(sourceAppRoot, 'electron-resources');
const userDataDir = app.getPath('userData');
const serverEntry = path.join(appRoot, 'dist-server', 'server', 'index.js');
const runtimeNode = path.join(resourcesRoot, 'runtime', 'node.exe');
const nodeCommand = existsSync(runtimeNode) ? runtimeNode : 'node';
const backendLogPath = path.join(userDataDir, 'logs', 'backend.log');

let backendProcess = null;
let mainWindow = null;

const resolveWindowIconPath = () => {
  const candidates = app.isPackaged
    ? [
        path.join(appRoot, 'dist', 'logo-256.png'),
        path.join(appRoot, 'dist', 'favicon.png'),
      ]
    : [
        path.join(sourceAppRoot, 'public', 'logo-256.png'),
        path.join(sourceAppRoot, 'public', 'favicon.png'),
      ];

  return candidates.find((candidate) => existsSync(candidate));
};

const findFreePort = (startPort) => new Promise((resolve) => {
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

const waitForHealth = (port, timeoutMs = 45000) => new Promise((resolve, reject) => {
  const startedAt = Date.now();

  const retry = () => {
    if (Date.now() - startedAt > timeoutMs) {
      reject(new Error(`MTL-Code UI backend did not become healthy on port ${port}`));
      return;
    }

    setTimeout(poll, 500);
  };

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

  poll();
});

const resolveMtlCodeCliPath = () => {
  const candidates = [
    path.join(resourcesRoot, 'mtl-code', 'mtl-code.exe'),
    path.join(resourcesRoot, 'mtl-code', 'dist', 'cli-node.js'),
    path.join(resourcesRoot, 'mtl-code', 'dist', 'cli-bun.js'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) || '';
};

const pipeBackendLogs = () => {
  mkdirSync(path.dirname(backendLogPath), { recursive: true });
  const logStream = createWriteStream(backendLogPath, { flags: 'a' });

  backendProcess.stdout?.on('data', (chunk) => {
    logStream.write(chunk);
    process.stdout.write(chunk);
  });

  backendProcess.stderr?.on('data', (chunk) => {
    logStream.write(chunk);
    process.stderr.write(chunk);
  });

  backendProcess.once('close', () => {
    logStream.end();
  });
};

const startBackend = async () => {
  if (!existsSync(serverEntry)) {
    throw new Error(`Missing packaged backend entry: ${serverEntry}`);
  }

  mkdirSync(userDataDir, { recursive: true });

  const port = Number(process.env.SERVER_PORT || await findFreePort(3987));
  const env = {
    ...process.env,
    APP_DATA_DIR: userDataDir,
    DATABASE_PATH: path.join(userDataDir, 'auth.db'),
    DESKTOP_MODE: 'true',
    HOST: '127.0.0.1',
    SERVER_PORT: String(port),
    MTL_CODE_RESOURCES_DIR: resourcesRoot,
    MTL_CODE_CLI_PATH: resolveMtlCodeCliPath(),
  };

  backendProcess = spawn(nodeCommand, [serverEntry], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  pipeBackendLogs();

  backendProcess.once('exit', (code, signal) => {
    if (!app.isQuitting) {
      dialog.showErrorBox(
        'MTL-Code UI backend stopped',
        `Backend process exited unexpectedly. code=${code ?? 'null'} signal=${signal ?? 'null'}\n\nLog: ${backendLogPath}`,
      );
      app.quit();
    }
  });

  await waitForHealth(port);
  return `http://127.0.0.1:${port}`;
};

const createMainWindow = async (url) => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'MTL-Code',
    icon: resolveWindowIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  await mainWindow.loadURL(url);
};

const stopBackend = () => {
  if (!backendProcess || backendProcess.killed) {
    return;
  }

  backendProcess.kill('SIGTERM');
  backendProcess = null;
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const url = await startBackend();
      await createMainWindow(url);
    } catch (error) {
      dialog.showErrorBox('MTL-Code failed to start', error?.stack || error?.message || String(error));
      app.quit();
    }
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    stopBackend();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
