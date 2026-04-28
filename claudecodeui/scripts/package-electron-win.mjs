import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const claudeCodeRoot = path.join(workspaceRoot, 'claude-code');
const electronDistDir = path.join(workspaceRoot, 'workspace', 'vendor', 'electron-dist');
const resourcesDir = path.join(appRoot, 'electron-resources');
const runtimeDir = path.join(resourcesDir, 'runtime');
const mtlCodeDir = path.join(resourcesDir, 'mtl-code');
const bunExe = process.env.BUN_EXE || path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe');

const mirrorEnv = {
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR
    || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  npm_config_electron_mirror: process.env.npm_config_electron_mirror
    || 'https://npmmirror.com/mirrors/electron/',
  npm_config_electron_builder_binaries_mirror: process.env.npm_config_electron_builder_binaries_mirror
    || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

const assertInsideWorkspace = (target) => {
  const resolvedWorkspace = path.resolve(workspaceRoot) + path.sep;
  const resolvedTarget = path.resolve(target);

  if (!resolvedTarget.startsWith(resolvedWorkspace)) {
    throw new Error(`Refusing to write outside workspace: ${resolvedTarget}`);
  }
};

const commandName = (command) => process.platform === 'win32' ? `${command}.cmd` : command;

const run = (command, args, options = {}) => {
  const needsWindowsCommandShell = process.platform === 'win32' && command.endsWith('.cmd');
  const executable = needsWindowsCommandShell ? process.env.ComSpec || 'cmd.exe' : command;
  const commandArgs = needsWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ...mirrorEnv,
      ...(options.env || {}),
    },
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
};

const emptyDir = async (dir) => {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(entries.map((entry) => (
    rm(path.join(dir, entry.name), { recursive: true, force: true })
  )));
};

const copyDir = async (src, dest) => {
  if (!existsSync(src)) {
    throw new Error(`Missing required path: ${src}`);
  }

  await cp(src, dest, { recursive: true, force: true });
};

const ensureMtlCodeBackendBuilt = () => {
  const nodeEntry = path.join(claudeCodeRoot, 'dist', 'cli-node.js');
  if (existsSync(nodeEntry)) {
    return;
  }

  if (!existsSync(bunExe)) {
    throw new Error('MTL-Code backend is not built and Bun was not found. Build ../claude-code first.');
  }

  run(bunExe, ['run', 'build'], { cwd: claudeCodeRoot });
};

const writeMtlCodeCmd = async () => {
  const mtlCodeCmd = [
    '@echo off',
    'setlocal',
    'set "NODE_EXE=%~dp0..\\runtime\\node.exe"',
    'if exist "%NODE_EXE%" (',
    '  "%NODE_EXE%" "%~dp0dist\\cli-node.js" %*',
    ') else (',
    '  node "%~dp0dist\\cli-node.js" %*',
    ')',
    'endlocal',
    '',
  ].join('\r\n');

  await writeFile(path.join(mtlCodeDir, 'mtl-code.cmd'), mtlCodeCmd);
};

const compileMtlCodeExe = () => {
  const bunEntry = path.join(mtlCodeDir, 'dist', 'cli-bun.js');
  if (!existsSync(bunExe) || !existsSync(bunEntry)) {
    return;
  }

  try {
    run(bunExe, [
      'build',
      '--compile',
      bunEntry,
      '--outfile',
      path.join(mtlCodeDir, 'mtl-code.exe'),
    ]);
  } catch (error) {
    console.warn(`MTL-Code exe compile failed; using Node entry fallback. ${error.message}`);
  }
};

const stageElectronResources = async () => {
  assertInsideWorkspace(resourcesDir);
  await emptyDir(resourcesDir);
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(mtlCodeDir, { recursive: true });

  await cp(process.execPath, path.join(runtimeDir, 'node.exe'));
  await copyDir(path.join(claudeCodeRoot, 'dist'), path.join(mtlCodeDir, 'dist'));
  await cp(path.join(claudeCodeRoot, 'package.json'), path.join(mtlCodeDir, 'package.json'));
  await writeMtlCodeCmd();
  compileMtlCodeExe();
};

const main = async () => {
  ensureMtlCodeBackendBuilt();
  run(commandName('npm'), ['run', 'icons:app']);
  run(commandName('npm'), ['run', 'build']);
  await stageElectronResources();
  await emptyDir(electronDistDir);
  run(commandName('npx'), ['electron-builder', '--win', 'nsis', '--x64']);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
