import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

export const OBSIDIAN_BRIDGE_PLUGIN_ID = 'argus-bridge';
export const BASE_OBSIDIAN_BRIDGE_PORT = 27177;
export const DEFAULT_OBSIDIAN_BRIDGE_ENDPOINT = 'http://127.0.0.1:27177';

const DEFAULT_PLUGIN_SOURCE = path.join(repoRoot, 'obsidian-plugins', 'argus-bridge');
const RELEASE_FILES = [
  { source: 'manifest.json', target: 'manifest.json' },
  { source: 'main.js', target: 'main.js' },
  { source: 'core.cjs', target: 'core.js' },
  { source: 'core.cjs', target: 'core.cjs' },
  { source: 'styles.css', target: 'styles.css' },
];

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const resolveObsidianBridgePluginSource = async ({
  pluginSource = '',
  serviceDirectory = __dirname,
} = {}) => {
  const candidates = [
    pluginSource,
    process.env.ARGUS_OBSIDIAN_BRIDGE_PLUGIN_SOURCE,
    path.resolve(serviceDirectory, '..', '..', '..', 'obsidian-plugins', 'argus-bridge'),
    path.resolve(serviceDirectory, '..', '..', 'obsidian-plugins', 'argus-bridge'),
    DEFAULT_PLUGIN_SOURCE,
    path.resolve(process.cwd(), 'obsidian-plugins', 'argus-bridge'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(String(candidate));
    if (await exists(resolved)) {
      return resolved;
    }
  }

  throw new Error([
    'Argus Bridge for Obsidian plugin source was not found.',
    'Reinstall Argus or run from the repository root so obsidian-plugins/argus-bridge is available.',
  ].join(' '));
};

export const chooseObsidianBridgePort = ({
  preferredPort = 0,
  usedPorts = [],
} = {}) => {
  const used = new Set((Array.isArray(usedPorts) ? usedPorts : [])
    .map((port) => Number.parseInt(String(port), 10))
    .filter((port) => Number.isFinite(port) && port > 0 && port < 65536));
  const preferred = Number.parseInt(String(preferredPort || ''), 10);
  if (Number.isFinite(preferred) && preferred > 0 && preferred < 65536 && !used.has(preferred)) {
    return preferred;
  }
  for (let port = BASE_OBSIDIAN_BRIDGE_PORT; port < 65536; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  throw new Error('No available Obsidian bridge port found.');
};

const defaultObsidianConfigPath = () => {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  }
  return path.join(os.homedir(), '.config', 'obsidian', 'obsidian.json');
};

export const buildBundledObsidianBridgeMain = async ({
  pluginSource = '',
} = {}) => {
  const resolvedPluginSource = await resolveObsidianBridgePluginSource({ pluginSource });
  const main = await fs.readFile(path.join(resolvedPluginSource, 'main.js'), 'utf8');
  const core = await fs.readFile(path.join(resolvedPluginSource, 'core.cjs'), 'utf8');
  const requirePattern = /const\s+\{\r?\n[\s\S]*?\r?\n\}\s*=\s*require\('\.\/core\.js'\);/;
  const requireMatch = main.match(requirePattern);
  if (!requireMatch) {
    throw new Error('Could not find Argus Bridge core require in plugin main.js.');
  }

  const bundledRequire = [
    'const __argusBridgeCoreModule = { exports: {} };',
    '((module) => {',
    core,
    '})(__argusBridgeCoreModule);',
    requireMatch[0].replace("require('./core.js')", '__argusBridgeCoreModule.exports'),
  ].join('\n');

  return main.replace(requirePattern, () => bundledRequire);
};

const readPluginManifest = async (vaultPath) => {
  const manifestPath = path.join(vaultPath, '.obsidian', 'plugins', OBSIDIAN_BRIDGE_PLUGIN_ID, 'manifest.json');
  return readJson(manifestPath, null);
};

const readRawPluginData = async (vaultPath) => {
  const dataPath = path.join(vaultPath, '.obsidian', 'plugins', OBSIDIAN_BRIDGE_PLUGIN_ID, 'data.json');
  try {
    return await fs.readFile(dataPath, 'utf8');
  } catch {
    return '';
  }
};

const matchString = (raw = '', key = '') => {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i');
  return raw.match(pattern)?.[1] || '';
};

const matchNumber = (raw = '', key = '') => {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'i');
  const value = Number.parseInt(raw.match(pattern)?.[1] || '', 10);
  return Number.isFinite(value) ? value : 0;
};

const normalizeFolderList = (value) => (
  Array.isArray(value)
    ? [...new Set(value.map((folder) => String(folder || '').trim()).filter(Boolean))]
    : []
);

const parseReadableFoldersFallback = (raw = '') => {
  const match = raw.match(/"readableFolders"\s*:\s*\[([\s\S]*?)\]/i);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).filter(Boolean);
};

export const readObsidianBridgePluginData = async (vaultPath) => {
  const raw = await readRawPluginData(vaultPath);
  if (!raw) {
    return {
      port: 0,
      endpoint: '',
      token: '',
      tokenConfigured: false,
      baseFolder: '',
      readableFolders: [],
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const port = Number.parseInt(String(parsed?.port || matchNumber(raw, 'port') || ''), 10) || 0;
  const token = String(parsed?.token || matchString(raw, 'token') || '');
  const baseFolder = String(parsed?.baseFolder || matchString(raw, 'baseFolder') || '');
  const readableFolders = normalizeFolderList(parsed?.readableFolders)
    .concat(parseReadableFoldersFallback(raw))
    .filter(Boolean);
  const uniqueReadableFolders = [...new Set(readableFolders)];

  return {
    port,
    endpoint: port ? `http://127.0.0.1:${port}` : '',
    token,
    tokenConfigured: Boolean(token),
    baseFolder,
    readableFolders: uniqueReadableFolders,
  };
};

const probeBridgeStatus = async ({
  endpoint = '',
  token = '',
  fetchImpl = null,
  timeoutMs = 1200,
} = {}) => {
  if (!endpoint || !token || typeof fetchImpl !== 'function') {
    return {
      bridgeReachable: null,
      statusVaultName: '',
      statusPluginVersion: '',
      bridgeLastError: '',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || 1200));
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/argus/v1/status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return {
      bridgeReachable: Boolean(response.ok),
      statusVaultName: body?.vaultName || body?.vault || '',
      statusPluginVersion: body?.pluginVersion || body?.version || '',
      bridgeLastError: response.ok ? '' : body?.error || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      bridgeReachable: false,
      statusVaultName: '',
      statusPluginVersion: '',
      bridgeLastError: error?.message || String(error || 'Bridge probe failed.'),
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const listObsidianVaults = async ({
  obsidianConfigPath = defaultObsidianConfigPath(),
  fetchImpl = null,
  statusTimeoutMs = 1200,
} = {}) => {
  const config = await readJson(obsidianConfigPath, null);
  const vaults = config?.vaults && typeof config.vaults === 'object'
    ? Object.values(config.vaults)
    : [];

  const results = [];
  for (const vault of vaults) {
    if (!vault?.path) {
      continue;
    }

    const vaultPath = path.resolve(String(vault.path));
    const manifest = await readPluginManifest(vaultPath);
    const bridgeData = await readObsidianBridgePluginData(vaultPath);
    const status = await probeBridgeStatus({
      endpoint: bridgeData.endpoint,
      token: bridgeData.token,
      fetchImpl,
      timeoutMs: statusTimeoutMs,
    });
    results.push({
      name: String(vault.name || path.basename(vaultPath)),
      path: vaultPath,
      open: vault.open === true,
      hasObsidianConfig: await exists(path.join(vaultPath, '.obsidian')),
      pluginInstalled: Boolean(manifest),
      pluginVersion: manifest?.version || '',
      bridgePort: bridgeData.port || 0,
      bridgeEndpoint: bridgeData.endpoint || '',
      tokenConfigured: bridgeData.tokenConfigured,
      baseFolder: bridgeData.baseFolder,
      readableFolders: bridgeData.readableFolders,
      ...status,
    });
  }

  return results.sort((left, right) => {
    if (left.open !== right.open) {
      return left.open ? -1 : 1;
    }
    return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
  });
};

export const installObsidianBridgePlugin = async ({
  vaultPath,
  token = '',
  port = 0,
  usedPorts = [],
  enablePlugin = true,
  pluginSource = '',
} = {}) => {
  const normalizedVaultPath = String(vaultPath || '').trim();
  if (!normalizedVaultPath) {
    throw new Error('Obsidian vault path is required.');
  }

  const resolvedVaultPath = path.resolve(normalizedVaultPath);
  const vaultStats = await fs.stat(resolvedVaultPath).catch(() => null);
  if (!vaultStats?.isDirectory()) {
    throw new Error('Obsidian vault path must be an existing directory.');
  }

  const resolvedPluginSource = await resolveObsidianBridgePluginSource({ pluginSource });
  const manifest = await readJson(path.join(resolvedPluginSource, 'manifest.json'), {});
  const targetDir = path.join(resolvedVaultPath, '.obsidian', 'plugins', OBSIDIAN_BRIDGE_PLUGIN_ID);
  await fs.mkdir(targetDir, { recursive: true });

  for (const file of RELEASE_FILES) {
    const targetPath = path.join(targetDir, file.target);
    if (file.source === 'main.js') {
      await fs.writeFile(targetPath, await buildBundledObsidianBridgeMain({ pluginSource: resolvedPluginSource }), 'utf8');
    } else {
      await fs.copyFile(path.join(resolvedPluginSource, file.source), targetPath);
    }
  }

  const dataPath = path.join(targetDir, 'data.json');
  const existingData = await readJson(dataPath, {});
  const pairingToken = String(token || existingData.token || crypto.randomBytes(24).toString('hex'));
  const bridgePort = chooseObsidianBridgePort({
    preferredPort: port || existingData.port,
    usedPorts,
  });
  await writeJson(dataPath, {
    ...existingData,
    token: pairingToken,
    port: bridgePort,
  });

  if (enablePlugin) {
    const communityPluginsPath = path.join(resolvedVaultPath, '.obsidian', 'community-plugins.json');
    const enabledPlugins = await readJson(communityPluginsPath, []);
    const nextEnabledPlugins = Array.isArray(enabledPlugins) ? enabledPlugins : [];
    if (!nextEnabledPlugins.includes(OBSIDIAN_BRIDGE_PLUGIN_ID)) {
      nextEnabledPlugins.push(OBSIDIAN_BRIDGE_PLUGIN_ID);
    }
    await writeJson(communityPluginsPath, nextEnabledPlugins);
  }

  return {
    installed: true,
    pluginId: OBSIDIAN_BRIDGE_PLUGIN_ID,
    vaultPath: resolvedVaultPath,
    vaultName: path.basename(resolvedVaultPath),
    targetDir,
    token: pairingToken,
    tokenConfigured: true,
    enabled: enablePlugin,
    manifestVersion: manifest.version || 'unknown',
    port: bridgePort,
    endpoint: `http://127.0.0.1:${bridgePort}`,
  };
};
