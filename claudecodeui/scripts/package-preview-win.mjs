import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const bundleRoot = process.env.MTL_CODE_BUNDLE_ROOT
  ? path.resolve(process.env.MTL_CODE_BUNDLE_ROOT)
  : path.join(workspaceRoot, 'workspace', 'vendor', 'bundle');
const previewExeName = process.env.MTL_CODE_PREVIEW_EXE_NAME || 'Argus-Preview.exe';
const resourcesDir = path.join(bundleRoot, 'resources');
const appBundleDir = path.join(resourcesDir, 'app');
const runtimeDir = path.join(resourcesDir, 'runtime');
const mtlCodeDir = path.join(resourcesDir, 'mtl-code');
const claudeCodeRoot = path.join(workspaceRoot, 'claude-code');
const bunExe = process.env.BUN_EXE || path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe');

function assertInsideWorkspace(target) {
  const resolvedWorkspace = path.resolve(workspaceRoot) + path.sep;
  const resolvedTarget = path.resolve(target);

  if (!resolvedTarget.startsWith(resolvedWorkspace)) {
    throw new Error(`Refusing to write outside workspace: ${resolvedTarget}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

function robocopy(src, dest) {
  const result = spawnSync('robocopy', [
    src,
    dest,
    '/E',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP',
    '/R:2',
    '/W:1',
  ], {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status >= 8) {
    throw new Error(`robocopy failed for ${src} -> ${dest} with ${result.status}`);
  }
}

async function copyDir(src, dest) {
  if (!existsSync(src)) {
    throw new Error(`Missing required path: ${src}`);
  }

  await cp(src, dest, { recursive: true, force: true });
}

async function emptyDir(dir) {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    await rm(path.join(dir, entry.name), { recursive: true, force: true });
  }
}

async function main() {
  assertInsideWorkspace(bundleRoot);

  if (!existsSync(bunExe)) {
    throw new Error(`Bun executable not found: ${bunExe}`);
  }

  if (!existsSync(path.join(claudeCodeRoot, 'dist', 'cli-node.js'))) {
    throw new Error('Argus backend is not built. Run bun run build in ../claude-code first.');
  }

  await emptyDir(bundleRoot);
  await mkdir(appBundleDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(mtlCodeDir, { recursive: true });

  await copyDir(path.join(appRoot, 'dist'), path.join(appBundleDir, 'dist'));
  await copyDir(path.join(appRoot, 'dist-server'), path.join(appBundleDir, 'dist-server'));
  await copyDir(path.join(claudeCodeRoot, 'dist'), path.join(mtlCodeDir, 'dist'));
  await cp(path.join(appRoot, 'package.json'), path.join(appBundleDir, 'package.json'));
  await cp(path.join(claudeCodeRoot, 'package.json'), path.join(mtlCodeDir, 'package.json'));
  await cp(process.execPath, path.join(runtimeDir, 'node.exe'));

  console.log('Copying runtime node_modules...');
  robocopy(path.join(appRoot, 'node_modules'), path.join(appBundleDir, 'node_modules'));

  const mtlCodeCmd = [
    '@echo off',
    'setlocal',
    'set "BUN_EXE=%BUN_EXE%"',
    'if not defined BUN_EXE set "BUN_EXE=%USERPROFILE%\\.bun\\bin\\bun.exe"',
    'set "NODE_EXE=%~dp0..\\runtime\\node.exe"',
    'if exist "%BUN_EXE%" (',
    '  "%BUN_EXE%" "%~dp0dist\\cli-bun.js" %*',
    ') else if exist "%NODE_EXE%" (',
    '  "%NODE_EXE%" "%~dp0dist\\cli-node.js" %*',
    ') else (',
    '  node "%~dp0dist\\cli-node.js" %*',
    ')',
    'endlocal',
    '',
  ].join('\r\n');
  await writeFile(path.join(mtlCodeDir, 'mtl-code.cmd'), mtlCodeCmd);

  try {
    run(bunExe, [
      'build',
      '--compile',
      path.join(mtlCodeDir, 'dist', 'cli-bun.js'),
      '--outfile',
      path.join(mtlCodeDir, 'mtl-code.exe'),
    ]);
  } catch (error) {
    console.warn(`Argus exe compile failed; using mtl-code.cmd fallback. ${error.message}`);
  }

  run(bunExe, [
    'build',
    '--compile',
    path.join(appRoot, 'scripts', 'preview-launcher.mjs'),
    '--outfile',
    path.join(bundleRoot, previewExeName),
  ]);

  await writeFile(
    path.join(bundleRoot, 'README.txt'),
    [
      'Argus preview bundle',
      '',
      `Run ${previewExeName} to start the local UI.`,
      'The launcher starts the bundled Node backend and opens http://127.0.0.1 automatically.',
      'Bundled backend path: resources\\mtl-code',
      'Bundled app path: resources\\app',
      '',
    ].join('\r\n'),
  );

  console.log(`Preview bundle created at ${bundleRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
