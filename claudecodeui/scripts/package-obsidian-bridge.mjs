#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugins', 'argus-bridge');
const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf8'));
const version = manifest.version || '0.0.0';
const outputDir = path.join(repoRoot, 'dist', 'obsidian-bridge');
const outputPath = path.join(outputDir, `argus-bridge-${version}.zip`);
const releaseFiles = [
  { source: 'manifest.json', target: 'manifest.json' },
  { source: 'main.js', target: 'main.js' },
  { source: 'core.cjs', target: 'core.js' },
  { source: 'core.cjs', target: 'core.cjs' },
  { source: 'styles.css', target: 'styles.css' },
];

const buildBundledMain = async () => {
  const main = await fs.readFile(path.join(pluginDir, 'main.js'), 'utf8');
  const core = await fs.readFile(path.join(pluginDir, 'core.cjs'), 'utf8');
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

const zip = new JSZip();
for (const file of releaseFiles) {
  zip.file(file.target, file.source === 'main.js'
    ? await buildBundledMain()
    : await fs.readFile(path.join(pluginDir, file.source)));
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Packaged argus-bridge ${version}: ${outputPath}`);
