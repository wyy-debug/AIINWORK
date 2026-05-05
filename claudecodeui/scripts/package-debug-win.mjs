import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const version = packageJson.version || '0.0.0';
const debugRoot = path.join(workspaceRoot, 'workspace', 'vendor', 'debug', `Argus-Debug-${version}`);

function run(command, args, options = {}) {
  const needsWindowsCommandShell = process.platform === 'win32' && !command.endsWith('.exe');
  const executable = needsWindowsCommandShell ? process.env.ComSpec || 'cmd.exe' : command;
  const commandArgs = needsWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd || appRoot,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

run('npm', ['run', 'build']);

const bunExe = process.env.BUN_EXE || path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe');
run(bunExe, ['run', 'build'], { cwd: path.join(workspaceRoot, 'claude-code') });

run(process.execPath, ['scripts/package-preview-win.mjs'], {
  env: {
    MTL_CODE_BUNDLE_ROOT: debugRoot,
    MTL_CODE_PREVIEW_EXE_NAME: 'Argus-Debug.exe',
    ARGUS_PACKAGE_CHANNEL: 'debug',
    ARGUS_DEBUG_PACKAGE: '1',
  },
});
