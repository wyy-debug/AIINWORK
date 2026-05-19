import { app, BrowserView, BrowserWindow, Notification, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybePromptForStartupUpdate } from './auto-update-service.mjs';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const sourceAppRoot = path.resolve(electronDir, '..');
const appRoot = app.isPackaged ? app.getAppPath() : sourceAppRoot;
const preloadEntry = path.join(electronDir, 'preload.cjs');
const resourcesRoot = app.isPackaged
  ? process.resourcesPath
  : path.join(sourceAppRoot, 'electron-resources');
const userDataDir = app.getPath('userData');
const serverEntry = path.join(appRoot, 'dist-server', 'server', 'index.js');
const runtimeNode = path.join(resourcesRoot, 'runtime', 'node.exe');
const nodeCommand = existsSync(runtimeNode) ? runtimeNode : 'node';
const backendLogPath = path.join(userDataDir, 'logs', 'backend.log');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.aiinwork.mtlcode');
}

let backendProcess = null;
let mainWindow = null;
let backendBecameHealthy = false;
let browserPreviewWindow = null;
let browserView = null;
let activeBrowserProjectPath = '';
const configuredBrowserWebContents = new WeakSet();

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

const isTrustedRenderer = (event) => {
  try {
    const rendererUrl = new URL(event.senderFrame?.url || event.sender.getURL());
    return ['127.0.0.1', 'localhost'].includes(rendererUrl.hostname);
  } catch {
    return false;
  }
};

const resolveDialogDefaultPath = (requestedPath) => {
  const homePath = app.getPath('home');
  const desktopPath = app.getPath('desktop') || homePath;

  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    return desktopPath;
  }

  let candidate = requestedPath.trim();
  if (candidate === '~') {
    candidate = homePath;
  } else if (
    candidate.startsWith(`~${path.sep}`) ||
    candidate.startsWith('~/') ||
    candidate.startsWith('~\\')
  ) {
    candidate = path.join(homePath, candidate.slice(2));
  }

  let currentPath = candidate;
  while (currentPath && currentPath !== path.dirname(currentPath)) {
    if (existsSync(currentPath)) {
      return currentPath;
    }
    currentPath = path.dirname(currentPath);
  }

  return existsSync(desktopPath) ? desktopPath : homePath;
};

ipcMain.handle('dialog:select-project-root', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { canceled: true, error: 'Untrusted renderer' };
  }

  const dialogOptions = {
    title: 'Select Project Root',
    defaultPath: resolveDialogDefaultPath(options?.defaultPath),
    properties: ['openDirectory', 'createDirectory'],
  };

  const ownerWindow =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow();
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  return {
    canceled: false,
    path: result.filePaths[0],
  };
});

ipcMain.handle('dialog:select-directory', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { canceled: true, error: 'Untrusted renderer' };
  }

  const title = typeof options?.title === 'string' && options.title.trim()
    ? options.title.trim()
    : 'Select Folder';
  const buttonLabel = typeof options?.buttonLabel === 'string' && options.buttonLabel.trim()
    ? options.buttonLabel.trim()
    : undefined;
  const dialogOptions = {
    title,
    defaultPath: resolveDialogDefaultPath(options?.defaultPath),
    properties: ['openDirectory', 'createDirectory'],
    ...(buttonLabel ? { buttonLabel } : {}),
  };

  const ownerWindow =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow();
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  return {
    canceled: false,
    path: result.filePaths[0],
  };
});

const normalizeNotificationText = (value, fallback = '') => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
};

ipcMain.handle('notification:show', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }

  const title = normalizeNotificationText(options?.title, 'Argus');
  const body = normalizeNotificationText(options?.body);
  const tag = normalizeNotificationText(options?.tag);

  if (!Notification.isSupported()) {
    return { success: false, error: 'Native notifications are not supported' };
  }

  const notification = new Notification({
    title,
    body,
    tag,
    icon: resolveWindowIconPath(),
    urgency: options?.urgency === 'critical' ? 'critical' : 'normal',
    silent: false,
  });

  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  notification.show();
  return { success: true };
});

const isBrowserUrlAllowed = (targetUrl, projectPath = '') => {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  if (['http:', 'https:'].includes(parsed.protocol)) {
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  }

  if (parsed.protocol !== 'file:') {
    return false;
  }

  if (!projectPath) {
    return false;
  }

  let filePath;
  try {
    filePath = fileURLToPath(parsed);
  } catch {
    return false;
  }
  const resolvedProjectPath = path.resolve(projectPath);
  const resolvedFilePath = path.resolve(filePath);
  return resolvedFilePath === resolvedProjectPath || resolvedFilePath.startsWith(`${resolvedProjectPath}${path.sep}`);
};

const resolveBrowserProjectPath = (projectPath = '') => {
  if (typeof projectPath === 'string' && projectPath.trim()) {
    activeBrowserProjectPath = path.resolve(projectPath.trim());
  }
  return activeBrowserProjectPath;
};

const configureBrowserWebContents = (webContents) => {
  if (!webContents || configuredBrowserWebContents.has(webContents)) {
    return;
  }
  configuredBrowserWebContents.add(webContents);

  const isAllowed = (targetUrl) => isBrowserUrlAllowed(targetUrl, activeBrowserProjectPath);
  const blockIfDisallowed = (event, targetUrl) => {
    if (!isAllowed(targetUrl)) {
      event.preventDefault();
    }
  };

  webContents.on('will-navigate', blockIfDisallowed);
  webContents.on('will-redirect', blockIfDisallowed);
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) {
      webContents.loadURL(url).catch(() => undefined);
    }
    return { action: 'deny' };
  });
};

const getBrowserPreviewWindow = () => {
  if (browserPreviewWindow && !browserPreviewWindow.isDestroyed()) {
    return browserPreviewWindow;
  }

  browserPreviewWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configureBrowserWebContents(browserPreviewWindow.webContents);
  return browserPreviewWindow;
};

const getBrowserView = () => {
  if (browserView && !browserView.webContents.isDestroyed()) {
    return browserView;
  }

  browserView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configureBrowserWebContents(browserView.webContents);
  return browserView;
};

const getBrowserWebContents = () => {
  if (browserView && !browserView.webContents.isDestroyed()) {
    return browserView.webContents;
  }
  return getBrowserPreviewWindow().webContents;
};

const normalizeBrowserBounds = (bounds = {}) => ({
  x: Math.max(0, Math.round(Number(bounds.x) || 0)),
  y: Math.max(0, Math.round(Number(bounds.y) || 0)),
  width: Math.max(120, Math.round(Number(bounds.width) || 120)),
  height: Math.max(120, Math.round(Number(bounds.height) || 120)),
});

ipcMain.handle('browser:attach', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const ownerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.fromWebContents(event.sender);
  if (!ownerWindow) {
    return { success: false, error: 'Main window is unavailable' };
  }
  const view = getBrowserView();
  ownerWindow.setBrowserView(view);
  view.setBounds(normalizeBrowserBounds(options?.bounds));
  view.setAutoResize({ width: true, height: true });
  if (options?.url) {
    const projectPath = resolveBrowserProjectPath(options?.projectPath);
    if (!isBrowserUrlAllowed(options.url, projectPath)) {
      return { success: false, error: 'Only localhost, 127.0.0.1, ::1, or file URLs under the project are allowed.' };
    }
    await view.webContents.loadURL(options.url);
  }
  return { success: true, url: view.webContents.getURL() };
});

ipcMain.handle('browser:resize', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  if (!browserView || browserView.webContents.isDestroyed()) {
    return { success: true };
  }
  browserView.setBounds(normalizeBrowserBounds(options?.bounds));
  return { success: true, url: browserView.webContents.getURL() };
});

ipcMain.handle('browser:open', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const projectPath = resolveBrowserProjectPath(options?.projectPath);
  if (!isBrowserUrlAllowed(options?.url, projectPath)) {
    return { success: false, error: 'Only localhost, 127.0.0.1, ::1, or file URLs under the project are allowed.' };
  }
  const webContents = getBrowserWebContents();
  await webContents.loadURL(options.url);
  return { success: true, url: webContents.getURL() };
});

ipcMain.handle('browser:navigate', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const projectPath = resolveBrowserProjectPath(options?.projectPath);
  if (!isBrowserUrlAllowed(options?.url, projectPath)) {
    return { success: false, error: 'Only localhost, 127.0.0.1, ::1, or file URLs under the project are allowed.' };
  }
  const webContents = getBrowserWebContents();
  await webContents.loadURL(options.url);
  return { success: true, url: webContents.getURL() };
});

ipcMain.handle('browser:back', async (event) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const webContents = getBrowserWebContents();
  if (webContents.canGoBack()) {
    webContents.goBack();
  }
  return { success: true, url: webContents.getURL() };
});

ipcMain.handle('browser:forward', async (event) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const webContents = getBrowserWebContents();
  if (webContents.canGoForward()) {
    webContents.goForward();
  }
  return { success: true, url: webContents.getURL() };
});

ipcMain.handle('browser:refresh', async (event) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const webContents = getBrowserWebContents();
  webContents.reload();
  return { success: true, url: webContents.getURL() };
});

ipcMain.handle('browser:screenshot', async (event, options = {}) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const projectPath = resolveBrowserProjectPath(options?.projectPath);
  if (!isBrowserUrlAllowed(options?.url, projectPath)) {
    return { success: false, error: 'Only localhost, 127.0.0.1, ::1, or file URLs under the project are allowed.' };
  }

  const webContents = getBrowserWebContents();
  if (webContents.getURL() !== options.url) {
    await webContents.loadURL(options.url);
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  const image = await webContents.capturePage();
  return {
    success: true,
    dataUrl: image.toDataURL(),
  };
});

ipcMain.handle('browser:close', async (event) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  if (browserPreviewWindow && !browserPreviewWindow.isDestroyed()) {
    browserPreviewWindow.close();
  }
  browserPreviewWindow = null;
  const ownerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.fromWebContents(event.sender);
  if (ownerWindow && browserView && !browserView.webContents.isDestroyed()) {
    ownerWindow.removeBrowserView(browserView);
  }
  if (browserView && !browserView.webContents.isDestroyed()) {
    browserView.webContents.close();
  }
  browserView = null;
  activeBrowserProjectPath = '';
  return { success: true };
});

ipcMain.handle('browser:detach', async (event) => {
  if (!isTrustedRenderer(event)) {
    return { success: false, error: 'Untrusted renderer' };
  }
  const ownerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.fromWebContents(event.sender);
  if (ownerWindow && browserView && !browserView.webContents.isDestroyed()) {
    ownerWindow.removeBrowserView(browserView);
  }
  return { success: true };
});

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
      reject(new Error(`Argus backend did not become healthy on port ${port}`));
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

const readBackendLogTail = () => {
  try {
    const log = readFileSync(backendLogPath, 'utf8');
    const lines = log.split(/\r?\n/).filter(Boolean);
    return lines.slice(-40).join('\n');
  } catch {
    return '';
  }
};

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
  backendBecameHealthy = false;

  const backendExitDuringStartup = new Promise((_, reject) => {
    backendProcess.once('exit', (code, signal) => {
      if (backendBecameHealthy || app.isQuitting) {
        return;
      }

      const logTail = readBackendLogTail();
      reject(new Error([
        `Argus backend exited before health check. code=${code ?? 'null'} signal=${signal ?? 'null'}`,
        `Backend log: ${backendLogPath}`,
        logTail ? `\nLast backend log lines:\n${logTail}` : '',
      ].filter(Boolean).join('\n')));
    });
  });

  backendProcess.once('exit', (code, signal) => {
    if (backendBecameHealthy && !app.isQuitting) {
      dialog.showErrorBox(
        'Argus backend stopped',
        `Backend process exited unexpectedly. code=${code ?? 'null'} signal=${signal ?? 'null'}\n\nLog: ${backendLogPath}`,
      );
      app.quit();
    }
  });

  await Promise.race([
    waitForHealth(port).then(() => {
      backendBecameHealthy = true;
    }),
    backendExitDuringStartup,
  ]);
  return `http://127.0.0.1:${port}`;
};

const createMainWindow = async (url) => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Argus',
    icon: resolveWindowIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadEntry,
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
  if (browserPreviewWindow && !browserPreviewWindow.isDestroyed()) {
    browserPreviewWindow.close();
    browserPreviewWindow = null;
  }

  if (!backendProcess || backendProcess.killed) {
    return;
  }

  backendProcess.kill('SIGTERM');
  backendProcess = null;
};

const checkStartupUpdate = async () => {
  try {
    const result = await maybePromptForStartupUpdate({
      app,
      dialog,
      shell,
      currentVersion: app.getVersion(),
    });
    return result?.launched === true;
  } catch (error) {
    console.warn('[auto-update] startup check failed:', error?.message || error);
    return false;
  }
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
      const updateLaunched = await checkStartupUpdate();
      if (updateLaunched) {
        return;
      }

      const url = await startBackend();
      await createMainWindow(url);
    } catch (error) {
      dialog.showErrorBox('Argus failed to start', error?.stack || error?.message || String(error));
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
