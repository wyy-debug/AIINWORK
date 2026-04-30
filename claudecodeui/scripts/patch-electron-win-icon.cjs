const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const WIN_CODE_SIGN_VERSION = '2.6.0';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

function findRceditInDir(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return null;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'rcedit-x64.exe') {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findRceditInDir(fullPath);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function getBinariesMirror() {
  return process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR
    || process.env.npm_config_electron_builder_binaries_mirror
    || process.env.npm_package_config_electron_builder_binaries_mirror
    || process.env.ELECTRON_BUILDER_BINARIES_MIRROR
    || 'https://github.com/electron-userland/electron-builder-binaries/releases/download/';
}

function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), outputPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed ${response.statusCode}: ${url}`));
        return;
      }

      const file = fs.createWriteStream(outputPath);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function ensureRcedit(projectDir) {
  if (process.env.RCEDIT_PATH && fs.existsSync(process.env.RCEDIT_PATH)) {
    return process.env.RCEDIT_PATH;
  }

  const localAppData = process.env.LOCALAPPDATA;
  const electronBuilderCache = localAppData
    ? path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign')
    : '';
  const cachedRcedit = findRceditInDir(electronBuilderCache);
  if (cachedRcedit) {
    return cachedRcedit;
  }

  const toolCacheDir = path.join(projectDir, 'node_modules', '.cache', 'mtl-code-rcedit', `winCodeSign-${WIN_CODE_SIGN_VERSION}`);
  const extractedRcedit = findRceditInDir(toolCacheDir);
  if (extractedRcedit) {
    return extractedRcedit;
  }

  fs.mkdirSync(toolCacheDir, { recursive: true });
  const archivePath = path.join(toolCacheDir, `winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`);
  const baseUrl = getBinariesMirror();
  const url = `${baseUrl.replace(/\/?$/, '/')}`
    + `winCodeSign-${WIN_CODE_SIGN_VERSION}/winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`;

  console.log(`[afterPack] Downloading rcedit from ${url}`);
  await download(url, archivePath);

  const sevenZip = path.join(projectDir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  if (!fs.existsSync(sevenZip)) {
    throw new Error(`7za.exe not found: ${sevenZip}`);
  }

  run(sevenZip, ['x', '-bd', archivePath, `-o${toolCacheDir}`, '-snl-']);

  const rcedit = findRceditInDir(toolCacheDir);
  if (!rcedit) {
    throw new Error(`rcedit-x64.exe not found after extracting ${archivePath}`);
  }

  return rcedit;
}

module.exports = async function patchElectronWinIcon(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const projectDir = context.packager.projectDir;
  const iconPath = path.join(projectDir, 'public', 'icon.ico');
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Application icon not found: ${iconPath}`);
  }
  if (!fs.existsSync(exePath)) {
    throw new Error(`Packaged executable not found: ${exePath}`);
  }

  const rcedit = await ensureRcedit(projectDir);
  console.log(`[afterPack] Patching Windows exe icon: ${exePath}`);
  try {
    run(rcedit, [exePath, '--set-icon', iconPath]);
  } catch (error) {
    const tempExePath = `${exePath}.rcedit-${process.pid}.tmp.exe`;
    console.warn(`[afterPack] Direct icon patch failed, retrying through a temporary copy. ${error.message}`);
    try {
      fs.copyFileSync(exePath, tempExePath);
      run(rcedit, [tempExePath, '--set-icon', iconPath]);
      fs.copyFileSync(tempExePath, exePath);
    } finally {
      fs.rmSync(tempExePath, { force: true });
    }
  }
};
