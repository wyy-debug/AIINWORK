#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pluginSource = path.join(repoRoot, 'obsidian-plugins', 'argus-bridge');
const pluginId = 'argus-bridge';
const releaseFiles = [
  { source: 'manifest.json', target: 'manifest.json' },
  { source: 'main.js', target: 'main.js' },
  { source: 'core.cjs', target: 'core.js' },
  { source: 'core.cjs', target: 'core.cjs' },
  { source: 'styles.css', target: 'styles.css' },
];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, true);
  } else {
    args.set(key, next);
    index += 1;
  }
}

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const buildBundledMain = async () => {
  const main = await fs.readFile(path.join(pluginSource, 'main.js'), 'utf8');
  const core = await fs.readFile(path.join(pluginSource, 'core.cjs'), 'utf8');
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

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const findDefaultVault = async () => {
  const obsidianConfigPath = path.join(os.homedir(), 'AppData', 'Roaming', 'obsidian', 'obsidian.json');
  const config = await readJson(obsidianConfigPath, null);
  const vaults = config?.vaults && typeof config.vaults === 'object' ? Object.values(config.vaults) : [];
  const selected = vaults.find((vault) => vault?.open) || vaults[0];
  return selected?.path || '';
};

const vaultPath = path.resolve(String(args.get('vault') || await findDefaultVault() || ''));
if (!vaultPath) {
  throw new Error('No Obsidian vault found. Pass --vault "C:\\path\\to\\vault".');
}

const targetDir = path.join(vaultPath, '.obsidian', 'plugins', pluginId);
await fs.mkdir(targetDir, { recursive: true });

for (const file of releaseFiles) {
  if (file.source === 'main.js') {
    await fs.writeFile(path.join(targetDir, file.target), await buildBundledMain(), 'utf8');
  } else {
    await fs.copyFile(path.join(pluginSource, file.source), path.join(targetDir, file.target));
  }
}

const dataPath = path.join(targetDir, 'data.json');
const existingData = await readJson(dataPath, {});
const token = String(args.get('token') || existingData.token || crypto.randomBytes(24).toString('hex'));
await writeJson(dataPath, {
  ...existingData,
  token,
});

if (args.get('enable') !== false && args.get('no-enable') !== true) {
  const communityPluginsPath = path.join(vaultPath, '.obsidian', 'community-plugins.json');
  const enabledPlugins = await readJson(communityPluginsPath, []);
  const nextEnabledPlugins = Array.isArray(enabledPlugins) ? enabledPlugins : [];
  if (!nextEnabledPlugins.includes(pluginId)) {
    nextEnabledPlugins.push(pluginId);
  }
  await writeJson(communityPluginsPath, nextEnabledPlugins);
}

console.log(`Installed ${pluginId} to ${targetDir}`);
console.log(`Pairing token: ${token}`);
console.log('Restart Obsidian or reload community plugins if the local bridge is not listening yet.');
