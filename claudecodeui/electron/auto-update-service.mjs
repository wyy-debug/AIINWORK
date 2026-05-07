import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPDATE_DIR_ENV_KEYS = [
  'ARGUS_UPDATE_DIR',
  'ARGUS_AUTO_UPDATE_DIR',
  'ARGUS_RELEASE_DIR',
];
const UPDATE_MANIFEST_ENV_KEYS = [
  'ARGUS_UPDATE_MANIFEST_URL',
  'ARGUS_UPDATE_MANIFEST_PATH',
  'ARGUS_UPDATE_MANIFEST',
];
const INSTALLER_FILE_PATTERN = /^Argus-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)-x64\.exe$/i;

export function resolveConfiguredUpdateDir(env = process.env) {
  return firstConfiguredValue(env, UPDATE_DIR_ENV_KEYS);
}

export function resolveConfiguredUpdateManifest(env = process.env) {
  return firstConfiguredValue(env, UPDATE_MANIFEST_ENV_KEYS);
}

export async function findLatestInstaller({
  updateDir,
  currentVersion,
  readDirectory = readdir,
}) {
  if (!updateDir) {
    return null;
  }

  let entries;
  try {
    entries = await readDirectory(updateDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => typeof entry.name === 'string' && (!entry.isFile || entry.isFile()))
    .map((entry) => parseInstallerEntry(updateDir, entry.name))
    .filter((candidate) => candidate && compareVersions(candidate.version, currentVersion) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));

  return candidates[0] || null;
}

export async function readUpdateManifest({
  manifestLocation,
  fetchText = readTextFromLocation,
}) {
  if (!manifestLocation) {
    return null;
  }

  const text = await fetchText(manifestLocation);
  const raw = String(text || '').trim();
  if (!raw) {
    return null;
  }

  const parsed = raw.startsWith('<')
    ? parseXmlManifest(raw)
    : parseJsonManifest(raw);
  if (!parsed?.version || !parsed?.installerUrl) {
    return null;
  }

  return {
    version: parsed.version,
    installerUrl: resolveInstallerUrl(manifestLocation, parsed.installerUrl),
    sha256: parsed.sha256 || '',
    fileName: parsed.fileName || installerFileName(parsed.installerUrl, parsed.version),
  };
}

export async function maybePromptForStartupUpdate({
  app,
  dialog,
  shell,
  mainWindow = null,
  env = process.env,
  currentVersion = app?.getVersion?.() || '0.0.0',
  readDirectory = readdir,
}) {
  const manifestLocation = resolveConfiguredUpdateManifest(env);
  const updateDir = resolveConfiguredUpdateDir(env);
  if (!manifestLocation && !updateDir) {
    return { checked: false, reason: 'not_configured' };
  }

  const checkInDev = env?.ARGUS_AUTO_UPDATE_IN_DEV === 'true' || env?.ARGUS_UPDATE_CHECK_IN_DEV === 'true';
  if (!app?.isPackaged && !checkInDev) {
    return { checked: false, reason: 'not_packaged' };
  }

  const latest = manifestLocation
    ? await readUpdateManifest({ manifestLocation }).then((release) => (
      release && compareVersions(release.version, currentVersion) > 0 ? release : null
    )).catch(() => null)
    : await findLatestInstaller({ updateDir, currentVersion, readDirectory });

  if (!latest) {
    return { checked: true, updateAvailable: false };
  }

  const response = await showUpdateDialog({
    dialog,
    mainWindow,
    currentVersion,
    latest,
  });

  if (response !== 0) {
    return { checked: true, updateAvailable: true, launched: false, latest };
  }

  const installerPath = await downloadInstallerToCache({
    release: {
      ...latest,
      installerUrl: latest.installerUrl || latest.filePath,
    },
    cacheDir: path.join(app.getPath('userData'), 'updates'),
  });
  const openResult = await shell.openPath(installerPath);
  if (typeof openResult === 'string' && openResult) {
    return { checked: true, updateAvailable: true, launched: false, error: openResult, latest };
  }

  app.quit();
  return { checked: true, updateAvailable: true, launched: true, latest };
}

function firstConfiguredValue(env, keys) {
  for (const key of keys) {
    const value = typeof env?.[key] === 'string' ? env[key].trim() : '';
    if (value) {
      return value;
    }
  }
  return '';
}

function parseInstallerEntry(updateDir, fileName) {
  const match = fileName.match(INSTALLER_FILE_PATTERN);
  if (!match) {
    return null;
  }

  return {
    version: match[1],
    fileName,
    filePath: path.join(updateDir, fileName),
  };
}

function parseJsonManifest(text) {
  const manifest = JSON.parse(text);
  const release = manifest?.latest || manifest?.release || manifest;
  const selected = Array.isArray(manifest?.releases)
    ? manifest.releases[0]
    : release;
  return normalizeManifestRelease(selected);
}

function parseXmlManifest(text) {
  return normalizeManifestRelease({
    version: readXmlTag(text, 'version'),
    installerUrl: readXmlTag(text, 'installerUrl') || readXmlTag(text, 'url') || readXmlTag(text, 'path'),
    sha256: readXmlTag(text, 'sha256'),
    fileName: readXmlTag(text, 'fileName'),
  });
}

function normalizeManifestRelease(release) {
  if (!release || typeof release !== 'object') {
    return null;
  }
  const installerUrl = release.installerUrl || release.url || release.path || release.downloadUrl;
  return {
    version: stringOrEmpty(release.version),
    installerUrl: stringOrEmpty(installerUrl),
    sha256: stringOrEmpty(release.sha256 || release.sha256sum),
    fileName: stringOrEmpty(release.fileName || release.filename),
  };
}

function readXmlTag(text, tagName) {
  const match = text.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : '';
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function showUpdateDialog({ dialog, mainWindow, currentVersion, latest }) {
  const installerLocation = latest.filePath || latest.installerUrl || '';
  const options = {
    type: 'info',
    buttons: ['\u7acb\u5373\u66f4\u65b0', '\u7a0d\u540e'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Argus \u66f4\u65b0',
    message: `\u53d1\u73b0 Argus \u65b0\u7248\u672c ${latest.version}`,
    detail: `\u5f53\u524d\u7248\u672c\uff1a${currentVersion}\n\u5b89\u88c5\u5305\uff1a${installerLocation}\n\n\u9009\u62e9\u201c\u7acb\u5373\u66f4\u65b0\u201d\u4f1a\u5148\u4e0b\u8f7d\u5230\u672c\u5730\uff0c\u7136\u540e\u6253\u5f00\u5b89\u88c5\u5305\u5e76\u9000\u51fa\u5f53\u524d\u5e94\u7528\u3002`,
  };

  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result?.response;
}

async function downloadInstallerToCache({ release, cacheDir }) {
  await mkdir(cacheDir, { recursive: true });
  const fileName = release.fileName || installerFileName(release.installerUrl, release.version);
  const targetPath = path.join(cacheDir, fileName);
  const source = release.installerUrl;

  if (isHttpUrl(source)) {
    const bytes = await downloadHttp(source);
    verifySha256(bytes, release.sha256);
    await writeFile(targetPath, bytes);
    return targetPath;
  }

  const sourcePath = localPathFromLocation(source);
  const bytes = await readFile(sourcePath);
  verifySha256(bytes, release.sha256);
  await copyFile(sourcePath, targetPath);
  return targetPath;
}

function verifySha256(bytes, expectedSha256) {
  if (!expectedSha256) {
    return;
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error('Downloaded Argus installer checksum mismatch.');
  }
}

async function readTextFromLocation(location) {
  if (isHttpUrl(location)) {
    return (await downloadHttp(location)).toString('utf8');
  }
  return readFile(localPathFromLocation(location), 'utf8');
}

function downloadHttp(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadHttp(new URL(response.headers.location, url).href).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Update download failed with HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error('Update download timed out.'));
    });
  });
}

function resolveInstallerUrl(manifestLocation, installerUrl) {
  if (isHttpUrl(installerUrl) || installerUrl.startsWith('file:') || path.isAbsolute(installerUrl) || installerUrl.startsWith('\\\\')) {
    return installerUrl;
  }
  if (isHttpUrl(manifestLocation)) {
    return new URL(installerUrl, manifestLocation).href;
  }
  const manifestPath = localPathFromLocation(manifestLocation);
  return path.resolve(path.dirname(manifestPath), installerUrl);
}

function localPathFromLocation(location) {
  if (location.startsWith('file:')) {
    return fileURLToPath(location);
  }
  return location;
}

function installerFileName(installerUrl, version) {
  const parsedPath = isHttpUrl(installerUrl)
    ? new URL(installerUrl).pathname
    : installerUrl.startsWith('file:')
      ? decodeURIComponent(new URL(installerUrl).pathname)
      : localPathFromLocation(installerUrl);
  const baseName = path.basename(parsedPath);
  return baseName || `Argus-${version}-x64.exe`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }

  return 0;
}

function normalizeVersion(version) {
  const [core] = String(version || '').split(/[+-]/);
  return core
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))
    .concat([0, 0, 0])
    .slice(0, 3);
}
