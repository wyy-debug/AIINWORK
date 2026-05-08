import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import crossSpawn from 'cross-spawn';

const EDITOR_TOOL_IDS = new Set(['vscode', 'visualstudio', 'cursor', 'antigravity']);
const TERMINAL_TOOL_IDS = new Set(['git-bash']);

const TOOL_DEFINITIONS = [
  { id: 'vscode', label: 'VS Code', kind: 'editor' },
  { id: 'visualstudio', label: 'Visual Studio', kind: 'editor' },
  { id: 'cursor', label: 'Cursor', kind: 'editor' },
  { id: 'antigravity', label: 'Antigravity', kind: 'editor' },
  { id: 'explorer', label: 'File Explorer', kind: 'system' },
  { id: 'git-bash', label: 'Git Bash', kind: 'terminal' },
];

export function getLocalToolDefinitions() {
  return TOOL_DEFINITIONS.map((tool) => ({ ...tool }));
}

export function normalizeLocalToolId(toolId) {
  const normalized = String(toolId || '').trim().toLowerCase();
  if (TOOL_DEFINITIONS.some((tool) => tool.id === normalized)) {
    return normalized;
  }
  return 'vscode';
}

export function isEditorLocalTool(toolId) {
  return EDITOR_TOOL_IDS.has(normalizeLocalToolId(toolId));
}

export function isTerminalLocalTool(toolId) {
  return TERMINAL_TOOL_IDS.has(normalizeLocalToolId(toolId));
}

function envValue(env, key) {
  return typeof env?.[key] === 'string' ? env[key] : '';
}

function addIfTruthy(items) {
  return items.filter((item) => item.command);
}

export function createLocalToolProcess(command, args = [], options = {}) {
  const {
    platform = process.platform,
    spawnImpl = platform === 'win32' ? crossSpawn : spawn,
    ...childOptions
  } = options;
  const finalOptions = {
    ...childOptions,
    ...(platform === 'win32' && !Object.prototype.hasOwnProperty.call(childOptions, 'windowsHide')
      ? { windowsHide: true }
      : {}),
  };
  return spawnImpl(command, args, finalOptions);
}

export function getLocalToolCandidates({
  platform = process.platform,
  env = process.env,
} = {}) {
  const localAppData = envValue(env, 'LOCALAPPDATA');
  const programFiles = envValue(env, 'ProgramFiles');
  const programFilesX86 = envValue(env, 'ProgramFiles(x86)');
  const homeDir = envValue(env, 'USERPROFILE') || os.homedir();

  const candidates = {
    vscode: [
      { command: platform === 'win32' ? 'code.cmd' : 'code', label: 'VS Code', source: 'PATH' },
      { command: 'code', label: 'VS Code', source: 'PATH' },
    ],
    visualstudio: [
      { command: platform === 'win32' ? 'devenv.exe' : 'devenv', label: 'Visual Studio', source: 'PATH', probeArgs: ['/?'] },
    ],
    cursor: [
      { command: platform === 'win32' ? 'cursor.cmd' : 'cursor', label: 'Cursor', source: 'PATH' },
      { command: 'cursor', label: 'Cursor', source: 'PATH' },
    ],
    antigravity: [
      { command: platform === 'win32' ? 'antigravity.cmd' : 'antigravity', label: 'Antigravity', source: 'PATH' },
      { command: 'antigravity', label: 'Antigravity', source: 'PATH' },
    ],
    explorer: [
      platform === 'win32'
        ? { command: 'explorer.exe', label: 'File Explorer', source: 'Windows' }
        : platform === 'darwin'
          ? { command: 'open', label: 'Finder', source: 'macOS' }
          : { command: 'xdg-open', label: 'File Manager', source: 'Linux' },
    ],
    'git-bash': platform === 'win32'
      ? [{ command: 'git-bash.exe', label: 'Git Bash', source: 'PATH', fileOnly: true }]
      : [{ command: 'bash', label: 'Bash', source: 'PATH' }],
  };

  if (platform === 'win32') {
    candidates.vscode.push(
      { command: path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'), label: 'VS Code', source: 'LOCALAPPDATA' },
      { command: path.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'), label: 'VS Code', source: 'Program Files' },
      { command: path.join(programFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd'), label: 'VS Code', source: 'Program Files (x86)' },
      { command: path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'), label: 'VS Code', source: 'LOCALAPPDATA', fileOnly: true },
      { command: path.join(programFiles, 'Microsoft VS Code', 'Code.exe'), label: 'VS Code', source: 'Program Files', fileOnly: true },
    );
    candidates.visualstudio.push(
      ...['Community', 'Professional', 'Enterprise', 'BuildTools'].flatMap((edition) => [
        { command: path.join(programFiles, 'Microsoft Visual Studio', '2022', edition, 'Common7', 'IDE', 'devenv.exe'), label: 'Visual Studio', source: `VS 2022 ${edition}`, fileOnly: true },
        { command: path.join(programFilesX86, 'Microsoft Visual Studio', '2019', edition, 'Common7', 'IDE', 'devenv.exe'), label: 'Visual Studio', source: `VS 2019 ${edition}`, fileOnly: true },
      ]),
    );
    candidates.cursor.push(
      { command: path.join(localAppData, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'), label: 'Cursor', source: 'LOCALAPPDATA' },
      { command: path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe'), label: 'Cursor', source: 'LOCALAPPDATA', fileOnly: true },
    );
    candidates.antigravity.push(
      { command: path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'bin', 'antigravity.cmd'), label: 'Antigravity', source: 'LOCALAPPDATA' },
      { command: path.join(localAppData, 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'), label: 'Antigravity', source: 'LOCALAPPDATA' },
      { command: path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'), label: 'Antigravity', source: 'LOCALAPPDATA', fileOnly: true },
      { command: path.join(programFiles, 'Antigravity', 'Antigravity.exe'), label: 'Antigravity', source: 'Program Files', fileOnly: true },
      { command: path.join(homeDir, 'AppData', 'Local', 'Programs', 'Antigravity', 'Antigravity.exe'), label: 'Antigravity', source: 'USERPROFILE', fileOnly: true },
    );
    candidates['git-bash'].push(
      { command: path.join(programFiles, 'Git', 'git-bash.exe'), label: 'Git Bash', source: 'Program Files', fileOnly: true },
      { command: path.join(programFilesX86, 'Git', 'git-bash.exe'), label: 'Git Bash', source: 'Program Files (x86)', fileOnly: true },
      { command: path.join(localAppData, 'Programs', 'Git', 'git-bash.exe'), label: 'Git Bash', source: 'LOCALAPPDATA', fileOnly: true },
      { command: path.join(programFiles, 'Git', 'bin', 'bash.exe'), label: 'Git Bash', source: 'Program Files', fileOnly: true },
    );
  }

  return Object.fromEntries(
    Object.entries(candidates).map(([toolId, values]) => [toolId, addIfTruthy(values)]),
  );
}

function createVersionProbe(command, probeArgs = ['--version']) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timeout;

    let child;
    try {
      child = createLocalToolProcess(command, probeArgs, {
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({ ok: false, error: error.message });
      return;
    }

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        ...result,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    };

    timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: 'Probe timed out' });
    }, 3000);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish({ ok: false, error: error.message });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0, code });
    });
  });
}

export async function diagnoseLocalTool(toolId) {
  const normalizedToolId = normalizeLocalToolId(toolId);
  const definition = TOOL_DEFINITIONS.find((tool) => tool.id === normalizedToolId) || TOOL_DEFINITIONS[0];
  const candidates = getLocalToolCandidates()[normalizedToolId] || [];

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate.command) && !fs.existsSync(candidate.command)) {
      continue;
    }

    if (candidate.fileOnly && !path.isAbsolute(candidate.command)) {
      continue;
    }

    if (candidate.fileOnly || normalizedToolId === 'explorer') {
      return {
        id: normalizedToolId,
        label: candidate.label,
        kind: definition.kind,
        available: true,
        command: candidate.command,
        source: candidate.source,
        version: null,
      };
    }

    const probe = await createVersionProbe(candidate.command, candidate.probeArgs);
    if (probe.ok) {
      return {
        id: normalizedToolId,
        label: candidate.label,
        kind: definition.kind,
        available: true,
        command: candidate.command,
        source: candidate.source,
        version: probe.stdout.split(/\r?\n/)[0] || null,
      };
    }
  }

  return {
    id: normalizedToolId,
    label: definition.label,
    kind: definition.kind,
    available: false,
    command: null,
    source: null,
    version: null,
  };
}

export async function getLocalToolDiagnostics() {
  const tools = await Promise.all(TOOL_DEFINITIONS.map((tool) => diagnoseLocalTool(tool.id)));
  return { tools };
}

export function buildEditorOpenArgs({
  toolId,
  resolvedPath,
  line,
  column,
  isDirectory = false,
}) {
  const normalizedToolId = normalizeLocalToolId(toolId);
  if (isDirectory || normalizedToolId === 'visualstudio') {
    return [resolvedPath];
  }

  const parsedLine = Number.parseInt(String(line || ''), 10);
  const parsedColumn = Number.parseInt(String(column || ''), 10);
  const target = Number.isFinite(parsedLine) && parsedLine > 0
    ? `${resolvedPath}:${parsedLine}:${Number.isFinite(parsedColumn) && parsedColumn > 0 ? parsedColumn : 1}`
    : resolvedPath;

  return ['-g', target];
}

export function buildTerminalOpenArgs({
  toolId,
  cwd,
  command,
  platform = process.platform,
}) {
  const normalizedToolId = normalizeLocalToolId(toolId);
  if (normalizedToolId !== 'git-bash') {
    return [];
  }

  if (platform === 'win32') {
    const commandName = path.basename(String(command || '')).toLowerCase();
    if (commandName === 'bash.exe') {
      return ['--login', '-i'];
    }
    return [`--cd=${cwd}`];
  }

  return ['-lc', `cd ${JSON.stringify(cwd)} && exec bash`];
}

export function getLocalToolUnavailableMessage(toolId) {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.id === normalizeLocalToolId(toolId));
  return `${definition?.label || 'Local tool'} is not available on this machine`;
}
