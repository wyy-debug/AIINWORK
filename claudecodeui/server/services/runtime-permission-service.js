import crypto from 'crypto';
import os from 'os';
import path from 'path';

import { appConfigDb } from '../database/db.js';

const RUNTIME_PERMISSIONS_KEY = 'runtime_permissions';
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export const DEFAULT_RUNTIME_PERMISSIONS = {
  terminal: process.platform === 'win32' ? 'powershell' : 'shell',
  shell: process.platform === 'win32' ? 'powershell' : 'bash',
  allowWsl: false,
  wslDistro: '',
  allowedPaths: [],
  confirmDangerousCommands: true,
};

const confirmations = new Map();

const normalizePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  return path.resolve(value.trim());
};

const isPathInside = (parentPath, childPath) => {
  const parent = normalizePath(parentPath);
  const child = normalizePath(childPath);
  if (!parent || !child) {
    return false;
  }
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const normalizeRuntimePermissions = (value = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const allowedPaths = Array.isArray(source.allowedPaths)
    ? source.allowedPaths
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => path.resolve(entry.trim()))
    : [];

  return {
    terminal: ['powershell', 'cmd', 'git-bash', 'wsl', 'shell', 'bash'].includes(source.terminal)
      ? source.terminal
      : DEFAULT_RUNTIME_PERMISSIONS.terminal,
    shell: ['powershell', 'cmd', 'wsl', 'bash', 'sh'].includes(source.shell)
      ? source.shell
      : DEFAULT_RUNTIME_PERMISSIONS.shell,
    allowWsl: source.allowWsl === true,
    wslDistro: typeof source.wslDistro === 'string' ? source.wslDistro.trim().slice(0, 120) : '',
    allowedPaths,
    confirmDangerousCommands: source.confirmDangerousCommands !== false,
  };
};

export const readRuntimePermissions = () => {
  try {
    const raw = appConfigDb.get(RUNTIME_PERMISSIONS_KEY);
    return normalizeRuntimePermissions(raw ? JSON.parse(raw) : DEFAULT_RUNTIME_PERMISSIONS);
  } catch {
    return DEFAULT_RUNTIME_PERMISSIONS;
  }
};

export const saveRuntimePermissions = (permissions) => {
  const normalized = normalizeRuntimePermissions(permissions);
  appConfigDb.set(RUNTIME_PERMISSIONS_KEY, JSON.stringify(normalized));
  return normalized;
};

const cleanupConfirmations = () => {
  const now = Date.now();
  for (const [id, record] of confirmations.entries()) {
    if (!record || record.expiresAt <= now) {
      confirmations.delete(id);
    }
  }
};

const commandFingerprint = ({ command = '', cwd = '', operation = '' }) => (
  crypto
    .createHash('sha256')
    .update(`${operation}\n${normalizePath(cwd)}\n${command}`)
    .digest('hex')
);

const createConfirmation = (payload) => {
  cleanupConfirmations();
  const id = `confirm_${crypto.randomUUID()}`;
  confirmations.set(id, {
    fingerprint: commandFingerprint(payload),
    expiresAt: Date.now() + CONFIRMATION_TTL_MS,
  });
  return id;
};

const consumeConfirmation = (confirmationId, payload) => {
  cleanupConfirmations();
  if (!confirmationId) {
    return false;
  }
  const record = confirmations.get(confirmationId);
  if (!record) {
    return false;
  }
  confirmations.delete(confirmationId);
  return record.fingerprint === commandFingerprint(payload);
};

export const detectDangerousCommand = (command = '') => {
  const value = String(command || '').trim();
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();

  const rules = [
    { pattern: /\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r[a-z]*)\b/i, reason: 'Recursive force delete command' },
    { pattern: /\bremove-item\b[\s\S]*\s-recurse\b/i, reason: 'Recursive PowerShell delete command' },
    { pattern: /\b(del|erase|rd|rmdir)\b[\s\S]*\s\/s\b/i, reason: 'Recursive Windows delete command' },
    { pattern: /\bformat(?:\.com)?\b/i, reason: 'Disk format command' },
    { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'Forced git reset' },
    { pattern: /\bgit\s+clean\b[\s\S]*-[^\s]*[fdx]/i, reason: 'Forced git clean' },
    { pattern: /\b(move|mv|move-item|copy-item|remove-item|rm|del|erase)\b[\s\S]*(\.\.|[a-z]:\\|\/)/i, reason: 'Cross-directory file operation' },
  ];

  const matched = rules.find((rule) => rule.pattern.test(normalized) || rule.pattern.test(lower));
  return matched?.reason || null;
};

export const evaluateRuntimePermission = ({
  command = '',
  cwd = '',
  projectPath = '',
  operation = 'command',
  confirmationId = '',
} = {}) => {
  const permissions = readRuntimePermissions();
  const resolvedCwd = normalizePath(cwd);
  const resolvedProjectPath = normalizePath(projectPath);
  const allowedRoots = [
    resolvedProjectPath,
    ...permissions.allowedPaths,
  ].filter(Boolean);

  if (!resolvedCwd) {
    return { allowed: false, reason: 'Working directory is required.' };
  }

  if (allowedRoots.length > 0 && !allowedRoots.some((root) => isPathInside(root, resolvedCwd))) {
    return {
      allowed: false,
      reason: `Working directory is outside allowed paths: ${resolvedCwd}`,
    };
  }

  const dangerousReason = detectDangerousCommand(command);
  if (dangerousReason && permissions.confirmDangerousCommands) {
    const payload = { command, cwd: resolvedCwd, operation };
    if (!consumeConfirmation(confirmationId, payload)) {
      return {
        allowed: false,
        requiresConfirmation: true,
        confirmationId: createConfirmation(payload),
        reason: dangerousReason,
      };
    }
  }

  return { allowed: true, permissions };
};

export const resolveRuntimeShell = (command) => {
  const permissions = readRuntimePermissions();
  const terminal = permissions.terminal || DEFAULT_RUNTIME_PERMISSIONS.terminal;

	  if (process.platform === 'win32') {
	    if (terminal === 'cmd') {
	      return { shell: 'cmd.exe', args: ['/d', '/s', '/c', command] };
	    }
    if (terminal === 'git-bash') {
      return { shell: 'bash.exe', args: ['-lc', command] };
    }
	    if (terminal === 'wsl' && permissions.allowWsl) {
      const distroArgs = permissions.wslDistro ? ['-d', permissions.wslDistro] : [];
	      return { shell: 'wsl.exe', args: [...distroArgs, 'bash', '-lc', command] };
	    }
    return { shell: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', command] };
  }

  const shell = terminal === 'sh' ? 'sh' : 'bash';
  return { shell, args: ['-lc', command] };
};

export const getRuntimePermissionSnapshot = () => ({
  ...readRuntimePermissions(),
  homeDir: os.homedir(),
});
