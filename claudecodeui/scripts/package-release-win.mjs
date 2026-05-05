import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const claudeCodeRoot = path.join(workspaceRoot, 'claude-code');
const bunExe = process.env.BUN_EXE || path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe');

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

run(bunExe, [
  'test',
  'src/tasks/__tests__/subagentRegistry.test.ts',
  'packages/builtin-tools/src/tools/AgentTool/__tests__/subagentRuntimeGuard.test.ts',
  'packages/builtin-tools/src/tools/AgentControlTool/__tests__/AgentControlTools.test.ts',
], { cwd: claudeCodeRoot });
run(bunExe, ['run', 'typecheck'], { cwd: claudeCodeRoot });
run('npm', ['run', 'test:unit']);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'check:mojibake']);
run(process.execPath, ['scripts/package-electron-win.mjs'], {
  env: {
    ARGUS_PACKAGE_CHANNEL: 'release',
  },
});
