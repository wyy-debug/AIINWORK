import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBuildManifest, writeBuildManifest } from './package-manifest.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const claudeCodeRoot = path.join(workspaceRoot, 'claude-code');
const electronDistDir = path.join(workspaceRoot, 'workspace', 'vendor', 'electron-dist');
const resourcesDir = path.join(appRoot, 'electron-resources');
const runtimeDir = path.join(resourcesDir, 'runtime');
const mtlCodeDir = path.join(resourcesDir, 'mtl-code');
const bunExe = process.env.BUN_EXE || path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe');
const packageChannel = process.env.ARGUS_PACKAGE_CHANNEL === 'debug' ? 'debug' : 'release';

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

const pathEnvKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
const runtimeNodeSource = process.env.ARGUS_RUNTIME_NODE || process.execPath;

const getNodeVersion = (nodePath) => {
  const result = spawnSync(nodePath, ['-p', 'process.versions.node'], {
    cwd: appRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`Could not read Node version from ${nodePath}`);
  }

  return result.stdout.trim();
};

const assertSupportedNodeVersion = (nodePath, label) => {
  const version = getNodeVersion(nodePath);
  const major = Number(version.split('.')[0]);

  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`${label} must be Node 20+ for better-sqlite3 12.x. Got ${version} at ${nodePath}. Use Node 22+ or set ARGUS_RUNTIME_NODE.`);
  }

  console.log(`[package] ${label}: Node ${version} (${nodePath})`);
};

const withCurrentNodeOnPath = (options = {}) => ({
  ...options,
  env: {
    ...(options.env || {}),
    [pathEnvKey]: [
      path.dirname(process.execPath),
      options.env?.[pathEnvKey],
      process.env[pathEnvKey],
    ].filter(Boolean).join(path.delimiter),
  },
});

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

const readCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || appRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      ...mirrorEnv,
      ...(options.env || {}),
    },
  });
  return result.status === 0 ? result.stdout.trim() : '';
};

const runNode = (args, options = {}) => {
  run(process.execPath, args, withCurrentNodeOnPath(options));
};

const runLocalNodeCli = (relativeCliPath, args, options = {}) => {
  const cliPath = path.join(appRoot, ...relativeCliPath);
  if (!existsSync(cliPath)) {
    throw new Error(`Missing required CLI: ${cliPath}`);
  }

  runNode([cliPath, ...args], options);
};

const canRequireModule = (moduleName) => {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(moduleName)})`], {
    cwd: appRoot,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ...mirrorEnv,
      ...withCurrentNodeOnPath().env,
    },
  });

  return result.status === 0;
};

const canOpenBetterSqlite = () => {
  const script = [
    "const Database = require('better-sqlite3');",
    "new Database(':memory:').close();",
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: appRoot,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ...mirrorEnv,
      ...withCurrentNodeOnPath().env,
    },
  });

  return result.status === 0;
};

const verifyPackagedNativeModules = () => {
  const packagedRuntimeNode = path.join(electronDistDir, 'win-unpacked', 'resources', 'runtime', 'node.exe');
  const packagedAppDir = path.join(electronDistDir, 'win-unpacked', 'resources', 'app');

  if (!existsSync(packagedRuntimeNode)) {
    throw new Error(`Missing packaged runtime Node: ${packagedRuntimeNode}`);
  }

  if (!existsSync(packagedAppDir)) {
    throw new Error(`Missing packaged app directory: ${packagedAppDir}`);
  }

  const script = [
    "const path = require('node:path');",
    "const appDir = process.env.PACKAGED_APP_DIR;",
    "const Database = require(path.join(appDir, 'node_modules', 'better-sqlite3'));",
    "new Database(':memory:').close();",
    "console.log('[packaged-native] better-sqlite3 open ok');",
    "require(path.join(appDir, 'node_modules', 'node-pty'));",
    "console.log('[packaged-native] node-pty ok');",
  ].join('\n');

  run(packagedRuntimeNode, ['-e', script], {
    cwd: packagedAppDir,
    env: {
      PACKAGED_APP_DIR: packagedAppDir,
    },
  });
};

const emptyDir = async (dir) => {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const target = path.join(dir, entry.name);
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      if (error?.code === 'EBUSY' || error?.code === 'EPERM') {
        console.warn(`Skipping locked build artifact: ${target}`);
        return;
      }
      throw error;
    }
  }));
};

const copyDir = async (src, dest) => {
  if (!existsSync(src)) {
    throw new Error(`Missing required path: ${src}`);
  }

  await cp(src, dest, { recursive: true, force: true });
};

const ensureMtlCodeBackendBuilt = () => {
  if (!existsSync(bunExe)) {
    throw new Error('Argus backend is not built and Bun was not found. Build ../claude-code first.');
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
    console.warn(`Argus exe compile failed; using Node entry fallback. ${error.message}`);
  }
};

const ensureBetterSqliteForCurrentNode = () => {
  if (canOpenBetterSqlite()) {
    return;
  }

  const betterSqliteDir = path.join(appRoot, 'node_modules', 'better-sqlite3');
  const prebuildInstallCli = path.join(appRoot, 'node_modules', 'prebuild-install', 'bin.js');

  if (!existsSync(betterSqliteDir) || !existsSync(prebuildInstallCli)) {
    throw new Error('better-sqlite3 is not loadable and prebuild-install is missing. Run npm install with Node 22+ first.');
  }

  runNode([
    prebuildInstallCli,
    '--runtime',
    'node',
    '--target',
    process.versions.node,
    '--arch',
    process.arch,
    '--platform',
    process.platform,
  ], { cwd: betterSqliteDir });

  if (!canOpenBetterSqlite()) {
    throw new Error(`better-sqlite3 still cannot load under Node ${process.versions.node}. Rebuild native dependencies before packaging.`);
  }
};

const ensureNodePtyForCurrentNode = () => {
  if (canRequireModule('node-pty')) {
    return;
  }

  const nodePtyDir = path.join(appRoot, 'node_modules', 'node-pty');
  const prebuildScript = path.join(nodePtyDir, 'scripts', 'prebuild.js');

  if (existsSync(prebuildScript)) {
    runNode([prebuildScript], { cwd: nodePtyDir });
  }

  if (!canRequireModule('node-pty')) {
    throw new Error(`node-pty cannot load under Node ${process.versions.node}. Rebuild native dependencies before packaging.`);
  }
};

const ensureNativeModulesForCurrentNode = () => {
  ensureBetterSqliteForCurrentNode();
  ensureNodePtyForCurrentNode();
};

const stageElectronResources = async () => {
  assertInsideWorkspace(resourcesDir);
  await emptyDir(resourcesDir);
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(mtlCodeDir, { recursive: true });

  await cp(runtimeNodeSource, path.join(runtimeDir, 'node.exe'));
  await copyDir(path.join(claudeCodeRoot, 'dist'), path.join(mtlCodeDir, 'dist'));
  await cp(path.join(claudeCodeRoot, 'package.json'), path.join(mtlCodeDir, 'package.json'));
  await writeMtlCodeCmd();
  compileMtlCodeExe();
};

const buildApp = async () => {
  runNode(['scripts/generate-app-icons.mjs']);
  runLocalNodeCli(['node_modules', 'vite', 'bin', 'vite.js'], ['build']);
  await rm(path.join(appRoot, 'dist-server'), { recursive: true, force: true });
  runLocalNodeCli(['node_modules', 'typescript', 'bin', 'tsc'], ['-p', 'server/tsconfig.json']);
  runLocalNodeCli(['node_modules', 'tsc-alias', 'dist', 'bin', 'index.js'], ['-p', 'server/tsconfig.json']);
};

const main = async () => {
  assertSupportedNodeVersion(process.execPath, 'build Node');
  assertSupportedNodeVersion(runtimeNodeSource, 'packaged runtime Node');
  ensureMtlCodeBackendBuilt();
  ensureNativeModulesForCurrentNode();
  await buildApp();
  await stageElectronResources();
  await emptyDir(electronDistDir);
  runLocalNodeCli(['node_modules', 'electron-builder', 'cli.js'], ['--win', 'nsis', '--x64']);
  verifyPackagedNativeModules();
  const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
  const version = packageJson.version || '0.0.0';
  const artifactPath = path.join(electronDistDir, `Argus-${version}-x64.exe`);
  const manifest = createBuildManifest({
    version,
    commit: readCommand('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspaceRoot }) || 'unknown',
    channel: packageChannel,
    artifact: 'nsis',
    outputPath: artifactPath,
    bunVersion: readCommand(bunExe, ['--version']) || '',
  });
  writeBuildManifest(electronDistDir, manifest);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
