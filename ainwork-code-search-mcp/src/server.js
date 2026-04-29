#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const SERVER_VERSION = '0.1.0';
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESULTS = 80;
const DEFAULT_MAX_LINES = 220;
const configuredGitNexusTimeout = Number.parseInt(process.env.GITNEXUS_MCP_TIMEOUT_MS || '', 10);
const GITNEXUS_MCP_TIMEOUT_MS = Number.isFinite(configuredGitNexusTimeout)
  ? Math.max(5_000, Math.min(300_000, configuredGitNexusTimeout))
  : 60_000;
const DEFAULT_GITNEXUS_PACKAGE = 'gitnexus@1.6.3';
const configuredGitNexusPackage = String(process.env.GITNEXUS_PACKAGE || '').trim();
const GITNEXUS_PACKAGE = !configuredGitNexusPackage
  || configuredGitNexusPackage === 'gitnexus@latest'
  || configuredGitNexusPackage === 'latest'
    ? DEFAULT_GITNEXUS_PACKAGE
    : configuredGitNexusPackage;
const GITNEXUS_PACKAGE_SOURCE = configuredGitNexusPackage && configuredGitNexusPackage !== GITNEXUS_PACKAGE
  ? 'normalized-from-latest'
  : configuredGitNexusPackage
    ? 'env'
    : 'default';
const GITNEXUS_COMMAND = process.env.GITNEXUS_COMMAND || '';
const GITNEXUS_IGNORE_SCRIPTS = !['0', 'false', 'no'].includes(
  String(process.env.GITNEXUS_IGNORE_SCRIPTS || 'true').trim().toLowerCase(),
);
const DEFAULT_IGNORES = [
  '.git',
  'node_modules',
  'dist',
  'dist-server',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'workspace/vendor',
  'graphify-out',
  '.gitnexus',
];

const normalizePath = (value) => path.resolve(String(value || '').trim());
const DEFAULT_CODE_ROOT = process.env.AINWORK_DEFAULT_CODE_ROOT
  ? normalizePath(process.env.AINWORK_DEFAULT_CODE_ROOT)
  : '';

const splitRoots = (value) =>
  String(value || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

const configuredRoots = splitRoots(process.env.AINWORK_CODE_ROOTS);
const allowedRoots = configuredRoots.map(normalizePath);

function isWithinRoot(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertAllowedPath(target) {
  if (allowedRoots.length === 0) {
    return;
  }

  if (!allowedRoots.some((candidate) => isWithinRoot(target, candidate))) {
    throw new Error(`Path is outside allowed roots: ${target}`);
  }
}

function resolveSearchRoot(rootInput) {
  const rootCandidate = rootInput && String(rootInput).trim()
    ? rootInput
    : DEFAULT_CODE_ROOT;
  if (!rootCandidate || !String(rootCandidate).trim()) {
    throw new Error('root is required. Pass the directory you want this MCP to search, or configure AINWORK_DEFAULT_CODE_ROOT.');
  }

  const root = normalizePath(rootCandidate);
  assertAllowedPath(root);
  return root;
}

function resolveFilePath(fileInput, options = {}) {
  if (!fileInput || !String(fileInput).trim()) {
    throw new Error('path is required');
  }

  const fileText = String(fileInput);
  const target = path.isAbsolute(fileText)
    ? normalizePath(fileText)
    : path.resolve(resolveSearchRoot(options.root), fileText);

  assertAllowedPath(target);
  return target;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function asText(text) {
  return {
    content: [{ type: 'text', text: String(text) }],
  };
}

function asJson(value) {
  return asText(JSON.stringify(value, null, 2));
}

function toolError(error) {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timeoutId;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve(value);
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env || {}) },
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      finish({
        code: -1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let truncated = false;

    const append = (chunk, stream) => {
      const text = chunk.toString('utf8');
      if (stdout.length + stderr.length + text.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      if (stream === 'stdout') {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    child.stdout.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(chunk, 'stderr'));
    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        finish({
          code: -1,
          stdout,
          stderr: `${stderr}${stderr ? '\n' : ''}Command timed out after ${options.timeoutMs}ms`,
          truncated,
        });
      }, options.timeoutMs);
    }

    child.on('error', (error) => {
      finish({ code: -1, stdout, stderr: error.message, truncated });
    });
    child.on('close', (code) => {
      finish({ code: code ?? 0, stdout, stderr, truncated });
    });
  });
}

async function commandExists(command, args = ['--version']) {
  const result = await runProcess(command, args, { timeoutMs: 10_000 });
  return {
    ok: result.code === 0,
    exitCode: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function windowsShellCommand(command, args = []) {
  if (os.platform() !== 'win32') {
    return { command, args };
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', command, ...args],
  };
}

function getGitNexusCommandParts(subcommandArgs = []) {
  if (GITNEXUS_COMMAND.trim()) {
    const commandParts = windowsShellCommand(GITNEXUS_COMMAND.trim(), subcommandArgs);
    return {
      command: commandParts.command,
      args: commandParts.args,
      display: `${GITNEXUS_COMMAND.trim()} ${subcommandArgs.join(' ')}`.trim(),
      mode: 'command',
    };
  }

  const npmArgs = ['exec', '--yes'];
  if (GITNEXUS_IGNORE_SCRIPTS) {
    npmArgs.push('--ignore-scripts');
  }
  npmArgs.push('--package', GITNEXUS_PACKAGE, '--', 'gitnexus', ...subcommandArgs);
  const commandParts = windowsShellCommand('npm', npmArgs);
  return {
    command: commandParts.command,
    args: commandParts.args,
    display: `npm ${npmArgs.join(' ')}`.trim(),
    mode: 'npm-exec',
  };
}

function explainGitNexusFailure(errorText) {
  const text = String(errorText || '').trim();
  const lower = text.toLowerCase();
  const hints = [];

  if (!text) {
    hints.push('GitNexus did not return an error message. Try running the command manually in a terminal.');
  }
  if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('network') || lower.includes('timeout')) {
    hints.push('Network access to npm may be blocked. Configure an npm registry mirror, preinstall GitNexus, or set GITNEXUS_COMMAND.');
  }
  if (lower.includes('cannot destructure property') && lower.includes('node.target')) {
    hints.push('npm failed while resolving or rebuilding a GitNexus dependency. This MCP defaults to a pinned GitNexus package and --ignore-scripts; if this still fails, try Node 20/22 LTS, clear the npm cache, or set GITNEXUS_COMMAND to a preinstalled GitNexus binary.');
  }
  if (
    lower.includes('not recognized') ||
    lower.includes('enoent') ||
    lower.includes('command not found') ||
    text.includes('不是内部或外部命令') ||
    (lower.includes('connection closed') && lower.includes('command:'))
  ) {
    hints.push('The command is not available on PATH. Install Node.js/npm, or set GITNEXUS_COMMAND to a full gitnexus executable path.');
  }
  if (lower.includes('permission') || lower.includes('eperm') || lower.includes('eacces')) {
    hints.push('Permission was denied. Check npm cache permissions and whether antivirus/security software blocked the spawned process.');
  }
  if (lower.includes('polyform') || lower.includes('license')) {
    hints.push('Review GitNexus license terms before using semantic graph features in this environment.');
  }
  if (!hints.length) {
    hints.push('Run doctor with the same root for environment checks, then run the displayed GitNexus command manually to see the full npm output.');
  }

  return hints;
}

function gitNexusErrorResponse(message, details = {}) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: message,
          ...details,
          hints: explainGitNexusFailure(`${details.stderr || ''}\n${details.stdout || ''}\n${message}`),
        }, null, 2),
      },
    ],
    isError: true,
  };
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGitNexusMcpTool(toolName, toolArguments = {}, options = {}) {
  const cwd = options.root ? resolveSearchRoot(options.root) : process.cwd();
  const gitnexus = getGitNexusCommandParts(['mcp']);
  let stderr = '';
  const transport = new StdioClientTransport({
    command: gitnexus.command,
    args: gitnexus.args,
    cwd,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 4000) {
      stderr = stderr.slice(-4000);
    }
  });
  const client = new Client({ name: 'ainwork-code-search-gitnexus-proxy', version: SERVER_VERSION });

  try {
    await withTimeout(client.connect(transport), GITNEXUS_MCP_TIMEOUT_MS, 'GitNexus MCP connect')
      .catch((error) => {
        const detail = stderr.trim() ? `\n\nGitNexus stderr:\n${stderr.trim()}` : '';
        throw new Error(`${error.message}${detail}\n\nCommand: ${gitnexus.display}`);
      });
    return await withTimeout(
      client.callTool({ name: toolName, arguments: toolArguments }),
      GITNEXUS_MCP_TIMEOUT_MS,
      `GitNexus ${toolName}`,
    ).catch((error) => {
      const detail = stderr.trim() ? `\n\nGitNexus stderr:\n${stderr.trim()}` : '';
      throw new Error(`${error.message}${detail}\n\nCommand: ${gitnexus.display}`);
    });
  } finally {
    await Promise.race([
      client.close().catch(() => {}),
      transport.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
}

async function listCodeRoots() {
  const roots = [];
  for (const root of allowedRoots) {
    let exists = false;
    try {
      const stat = await fs.stat(root);
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }
    roots.push({ root, exists });
  }
  return asJson({
    configuredRoots: roots,
    defaultRoot: DEFAULT_CODE_ROOT || null,
    rootRequired: !DEFAULT_CODE_ROOT,
    allowlistEnabled: allowedRoots.length > 0,
    note: allowedRoots.length > 0
      ? 'Tool roots must be inside one of the configured allowlist roots.'
      : DEFAULT_CODE_ROOT
        ? 'A default root is configured. Tool calls may override it by passing root.'
        : 'No allowlist is configured. Each tool call must pass an explicit root or absolute path.',
    platform: os.platform(),
    ignores: DEFAULT_IGNORES,
  });
}

async function findFiles(args = {}) {
  const root = resolveSearchRoot(args.root);
  const pattern = String(args.pattern || '').trim().toLowerCase();
  const maxResults = clampInteger(args.maxResults, DEFAULT_MAX_RESULTS, 1, 500);
  const rgArgs = ['--files'];
  for (const ignored of DEFAULT_IGNORES) {
    rgArgs.push('--glob', `!${ignored}/**`);
  }
  rgArgs.push(root);

  const result = await runProcess('rg', rgArgs, { cwd: root });
  if (result.code !== 0 && !result.stdout) {
    return toolError(`ripgrep failed. ${result.stderr || 'Is rg installed and on PATH?'}`);
  }

  const files = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((filePath) => !pattern || filePath.toLowerCase().includes(pattern))
    .slice(0, maxResults)
    .map((filePath) => path.relative(root, filePath));

  return asJson({ root, pattern, count: files.length, files, truncated: result.truncated });
}

function parseRgJsonLines(output, maxResults) {
  const matches = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === 'match') {
      current = {
        path: event.data?.path?.text,
        line: event.data?.line_number,
        text: event.data?.lines?.text?.replace(/\r?\n$/, ''),
        before: [],
        after: [],
      };
      matches.push(current);
      if (matches.length >= maxResults) {
        break;
      }
    } else if (event.type === 'context' && current) {
      const contextLine = {
        line: event.data?.line_number,
        text: event.data?.lines?.text?.replace(/\r?\n$/, ''),
      };
      if (Number(event.data?.line_number) < Number(current.line)) {
        current.before.push(contextLine);
      } else {
        current.after.push(contextLine);
      }
    }
  }

  return matches;
}

async function searchCode(args = {}) {
  const query = String(args.query || '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  const root = resolveSearchRoot(args.root);
  const maxResults = clampInteger(args.maxResults, DEFAULT_MAX_RESULTS, 1, 300);
  const contextLines = clampInteger(args.contextLines, 1, 0, 5);
  const literal = args.literal !== false;
  const caseSensitive = args.caseSensitive === true;
  const glob = String(args.glob || '').trim();

  const rgArgs = ['--json', '--line-number', '--context', String(contextLines)];
  if (literal) {
    rgArgs.push('--fixed-strings');
  }
  if (!caseSensitive) {
    rgArgs.push('--ignore-case');
  }
  if (glob) {
    rgArgs.push('--glob', glob);
  }
  for (const ignored of DEFAULT_IGNORES) {
    rgArgs.push('--glob', `!${ignored}/**`);
  }
  rgArgs.push(query, root);

  const result = await runProcess('rg', rgArgs, { cwd: root });
  if (result.code > 1) {
    return toolError(`ripgrep failed. ${result.stderr}`);
  }

  const matches = parseRgJsonLines(result.stdout, maxResults).map((match) => ({
    ...match,
    path: match.path ? path.relative(root, match.path) : match.path,
  }));

  return asJson({
    root,
    query,
    literal,
    caseSensitive,
    glob: glob || undefined,
    count: matches.length,
    matches,
    truncated: result.truncated,
  });
}

async function readFileTool(args = {}) {
  const target = resolveFilePath(args.path, { root: args.root });
  const maxLines = clampInteger(args.maxLines, DEFAULT_MAX_LINES, 1, 1000);
  const startLine = clampInteger(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER);
  const content = await fs.readFile(target, 'utf8');
  const lines = content.split(/\r?\n/);
  const endLine = Math.min(lines.length, startLine + maxLines - 1);
  const selected = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${String(startLine + index).padStart(5, ' ')} | ${line}`)
    .join('\n');

  return asJson({
    path: target,
    startLine,
    endLine,
    totalLines: lines.length,
    text: selected,
  });
}

async function repoOverview(args = {}) {
  const root = resolveSearchRoot(args.root);
  const rgArgs = ['--files'];
  for (const ignored of DEFAULT_IGNORES) {
    rgArgs.push('--glob', `!${ignored}/**`);
  }
  rgArgs.push(root);

  const result = await runProcess('rg', rgArgs, { cwd: root });
  if (result.code !== 0 && !result.stdout) {
    return toolError(`ripgrep failed. ${result.stderr || 'Is rg installed and on PATH?'}`);
  }

  const byExtension = new Map();
  const topDirs = new Map();
  const files = result.stdout.split(/\r?\n/).filter(Boolean);

  for (const filePath of files) {
    const relative = path.relative(root, filePath);
    const extension = path.extname(relative).toLowerCase() || '[no extension]';
    const topDir = relative.split(/[\\/]/)[0] || '.';
    byExtension.set(extension, (byExtension.get(extension) || 0) + 1);
    topDirs.set(topDir, (topDirs.get(topDir) || 0) + 1);
  }

  const sortEntries = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));

  return asJson({
    root,
    fileCount: files.length,
    byExtension: sortEntries(byExtension).slice(0, 40),
    topDirectories: sortEntries(topDirs).slice(0, 40),
    truncated: result.truncated,
  });
}

async function runGitNexus(commandName, args = {}) {
  const root = resolveSearchRoot(args.root);
  const extra = [];

  if (commandName === 'analyze') {
    extra.push('analyze', root);
    if (args.force === true) {
      extra.push('--force');
    }
    if (args.skipEmbeddings !== false) {
      extra.push('--skip-embeddings');
    }
    if (args.skipAgentsMd !== false) {
      extra.push('--skip-agents-md');
    }
  } else {
    extra.push('status');
  }

  const gitnexus = getGitNexusCommandParts(extra);
  const result = await runProcess(gitnexus.command, gitnexus.args, { cwd: root });
  const payload = {
    root,
    command: gitnexus.display,
    mode: gitnexus.mode,
    package: GITNEXUS_PACKAGE,
    packageSource: GITNEXUS_PACKAGE_SOURCE,
    ignoreScripts: GITNEXUS_IGNORE_SCRIPTS,
    exitCode: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    truncated: result.truncated,
  };

  if (result.code !== 0) {
    return gitNexusErrorResponse('GitNexus command failed.', payload);
  }

  return asJson(payload);
}

async function listGitNexusTools(args = {}) {
  const cwd = args.root ? resolveSearchRoot(args.root) : process.cwd();
  const gitnexus = getGitNexusCommandParts(['mcp']);
  let stderr = '';
  const transport = new StdioClientTransport({
    command: gitnexus.command,
    args: gitnexus.args,
    cwd,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 4000) {
      stderr = stderr.slice(-4000);
    }
  });
  const client = new Client({ name: 'ainwork-code-search-gitnexus-tools', version: SERVER_VERSION });

  try {
    await withTimeout(client.connect(transport), GITNEXUS_MCP_TIMEOUT_MS, 'GitNexus MCP connect')
      .catch((error) => {
        const detail = stderr.trim() ? `\n\nGitNexus stderr:\n${stderr.trim()}` : '';
        throw new Error(`${error.message}${detail}\n\nCommand: ${gitnexus.display}`);
      });
    const toolsResult = await withTimeout(client.listTools(), GITNEXUS_MCP_TIMEOUT_MS, 'GitNexus listTools')
      .catch((error) => {
        const detail = stderr.trim() ? `\n\nGitNexus stderr:\n${stderr.trim()}` : '';
        throw new Error(`${error.message}${detail}\n\nCommand: ${gitnexus.display}`);
      });
    return asJson({
      root: cwd,
      command: gitnexus.display,
      tools: toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  } finally {
    await Promise.race([
      client.close().catch(() => {}),
      transport.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
}

function normalizeGitNexusProxyArgs(args = {}) {
  const { root, ...toolArguments } = args;
  return { root, toolArguments };
}

async function proxyGitNexusTool(toolName, args = {}) {
  const { root, toolArguments } = normalizeGitNexusProxyArgs(args);
  try {
    return await callGitNexusMcpTool(toolName, toolArguments, { root });
  } catch (error) {
    return gitNexusErrorResponse(`GitNexus MCP tool "${toolName}" failed.`, {
      root,
      toolName,
      arguments: toolArguments,
      stderr: error instanceof Error ? error.message : String(error),
    });
  }
}

async function doctor(args = {}) {
  const root = args.root ? resolveSearchRoot(args.root) : undefined;
  const nodeVersion = process.version;
  const npmCommand = windowsShellCommand('npm', ['--version']);
  const npxCommand = windowsShellCommand('npx', ['--version']);
  const rgStatus = await commandExists('rg');
  const npmStatus = await commandExists(npmCommand.command, npmCommand.args);
  const npxStatus = await commandExists(npxCommand.command, npxCommand.args);
  const gitnexus = getGitNexusCommandParts(['--help']);
  const gitnexusStatus = await runProcess(gitnexus.command, gitnexus.args, {
    cwd: root || process.cwd(),
    timeoutMs: Math.min(GITNEXUS_MCP_TIMEOUT_MS, 20_000),
  });

  const checks = {
    node: {
      ok: Number(process.versions.node.split('.')[0]) >= 20,
      version: nodeVersion,
      requirement: '>=20',
    },
    npm: npmStatus,
    npx: npxStatus,
    ripgrep: rgStatus,
    gitnexus: {
      ok: gitnexusStatus.code === 0,
      command: gitnexus.display,
      mode: gitnexus.mode,
      package: GITNEXUS_PACKAGE,
      packageSource: GITNEXUS_PACKAGE_SOURCE,
      ignoreScripts: GITNEXUS_IGNORE_SCRIPTS,
      timeoutMs: GITNEXUS_MCP_TIMEOUT_MS,
      exitCode: gitnexusStatus.code,
      stdout: gitnexusStatus.stdout.trim().slice(0, 2000),
      stderr: gitnexusStatus.stderr.trim().slice(0, 4000),
      hints: explainGitNexusFailure(`${gitnexusStatus.stderr}\n${gitnexusStatus.stdout}`),
    },
  };

  return asJson({
    root,
    configuredRoots: allowedRoots,
    allowlistEnabled: allowedRoots.length > 0,
    gitnexusConfig: {
      GITNEXUS_PACKAGE,
      GITNEXUS_PACKAGE_SOURCE,
      GITNEXUS_COMMAND: GITNEXUS_COMMAND || undefined,
      GITNEXUS_IGNORE_SCRIPTS,
      GITNEXUS_MCP_TIMEOUT_MS,
    },
    checks,
    readyForTextSearch: checks.node.ok,
    readyForSemanticImpact: checks.node.ok && checks.npm.ok && checks.gitnexus.ok,
  });
}

const requiredWithRoot = (...fields) => (DEFAULT_CODE_ROOT ? fields : [...fields, 'root']);
const rootDescription = DEFAULT_CODE_ROOT
  ? `Directory to search. Optional; defaults to ${DEFAULT_CODE_ROOT}.`
  : 'Directory to search. Required.';

const tools = [
  {
    name: 'doctor',
    description: 'Check local runtime dependencies and GitNexus readiness with actionable error hints.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Optional project root to test GitNexus from.' },
      },
    },
  },
  {
    name: 'list_code_roots',
    description: 'List directories this MCP server is allowed to search.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'find_files',
    description: 'Find files by partial path/name under an allowed code root.',
    inputSchema: {
      type: 'object',
      required: requiredWithRoot(),
      properties: {
        root: { type: 'string', description: rootDescription },
        pattern: { type: 'string', description: 'Case-insensitive substring matched against file paths.' },
        maxResults: { type: 'number', description: 'Maximum files to return, default 80.' },
      },
    },
  },
  {
    name: 'search_code',
    description: 'Search code using ripgrep and return file paths, lines, and nearby context.',
    inputSchema: {
      type: 'object',
      required: requiredWithRoot('query'),
      properties: {
        query: { type: 'string' },
        root: { type: 'string', description: rootDescription },
        glob: { type: 'string', description: 'Optional ripgrep glob, for example **/*.ts.' },
        literal: { type: 'boolean', description: 'Use fixed-string search. Defaults to true.' },
        caseSensitive: { type: 'boolean', description: 'Defaults to false.' },
        contextLines: { type: 'number', description: '0 to 5 context lines, default 1.' },
        maxResults: { type: 'number', description: 'Maximum matches to return, default 80.' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read a bounded slice of a file with line numbers.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        root: { type: 'string', description: DEFAULT_CODE_ROOT ? `Optional when path is relative; defaults to ${DEFAULT_CODE_ROOT}.` : 'Required when path is relative.' },
        startLine: { type: 'number', description: '1-based start line, default 1.' },
        maxLines: { type: 'number', description: 'Maximum lines, default 220.' },
      },
    },
  },
  {
    name: 'repo_overview',
    description: 'Summarize file counts by extension and top-level directory.',
    inputSchema: {
      type: 'object',
      required: requiredWithRoot(),
      properties: {
        root: { type: 'string', description: rootDescription },
      },
    },
  },
  {
    name: 'gitnexus_analyze',
    description: 'Index a root with GitNexus for semantic graph-based code intelligence. Uses GITNEXUS_COMMAND or npm exec --package $GITNEXUS_PACKAGE.',
    inputSchema: {
      type: 'object',
      required: requiredWithRoot(),
      properties: {
        root: { type: 'string', description: DEFAULT_CODE_ROOT ? `Directory to index. Optional; defaults to ${DEFAULT_CODE_ROOT}.` : 'Directory to index. Required.' },
        force: { type: 'boolean' },
        skipEmbeddings: { type: 'boolean', description: 'Defaults to true for faster local indexing.' },
        skipAgentsMd: { type: 'boolean', description: 'Defaults to true to avoid editing agent files.' },
      },
    },
  },
  {
    name: 'gitnexus_status',
    description: 'Run GitNexus status for an allowed root.',
    inputSchema: {
      type: 'object',
      required: requiredWithRoot(),
      properties: {
        root: { type: 'string', description: DEFAULT_CODE_ROOT ? `Directory to inspect. Optional; defaults to ${DEFAULT_CODE_ROOT}.` : 'Directory to inspect. Required.' },
      },
    },
  },
  {
    name: 'gitnexus_tools',
    description: 'List tools exposed by the runtime GitNexus MCP server, including schemas. Uses GITNEXUS_COMMAND or npm exec --package $GITNEXUS_PACKAGE.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Optional working directory for launching GitNexus MCP.' },
      },
    },
  },
  {
    name: 'semantic_context',
    description: 'Proxy GitNexus MCP context for semantic symbol context: callers, callees, references, and process participation. Run gitnexus_analyze for the repo first.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Optional working directory for launching GitNexus MCP.' },
        repo: { type: 'string', description: 'GitNexus repo name when multiple repos are indexed.' },
        symbol: { type: 'string', description: 'Function/class/method/symbol to inspect.' },
        file: { type: 'string', description: 'Optional file path to disambiguate the symbol.' },
        line: { type: 'number', description: 'Optional line number to disambiguate the symbol.' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'semantic_impact',
    description: 'Proxy GitNexus MCP impact for full semantic call-graph blast radius. Run gitnexus_analyze for the repo first.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Optional working directory for launching GitNexus MCP.' },
        repo: { type: 'string', description: 'GitNexus repo name when multiple repos are indexed.' },
        symbol: { type: 'string', description: 'Function/class/method/symbol to analyze.' },
        file: { type: 'string', description: 'Optional file path to disambiguate the symbol.' },
        line: { type: 'number', description: 'Optional line number to disambiguate the symbol.' },
        depth: { type: 'number', description: 'Optional traversal depth if supported by installed GitNexus.' },
        direction: { type: 'string', description: 'Optional direction if supported by installed GitNexus.' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'semantic_detect_changes',
    description: 'Proxy GitNexus MCP detect_changes to map git diffs to affected symbols, processes, and risk.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Optional working directory for launching GitNexus MCP.' },
        repo: { type: 'string', description: 'GitNexus repo name when multiple repos are indexed.' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'gitnexus_call_tool',
    description: 'Advanced escape hatch: call any GitNexus MCP tool by name with raw arguments.',
    inputSchema: {
      type: 'object',
      required: ['toolName'],
      properties: {
        root: { type: 'string', description: 'Optional working directory for launching GitNexus MCP.' },
        toolName: { type: 'string', description: 'GitNexus MCP tool name, for example impact, context, query, detect_changes.' },
        arguments: { type: 'object', description: 'Raw arguments passed to the GitNexus MCP tool.' },
      },
    },
  },
];

const handlers = {
  doctor,
  list_code_roots: listCodeRoots,
  find_files: findFiles,
  search_code: searchCode,
  read_file: readFileTool,
  repo_overview: repoOverview,
  gitnexus_analyze: (args) => runGitNexus('analyze', args),
  gitnexus_status: (args) => runGitNexus('status', args),
  gitnexus_tools: listGitNexusTools,
  semantic_context: (args) => proxyGitNexusTool('context', args),
  semantic_impact: (args) => proxyGitNexusTool('impact', args),
  semantic_detect_changes: (args) => proxyGitNexusTool('detect_changes', args),
  gitnexus_call_tool: (args = {}) => {
    const toolName = String(args.toolName || '').trim();
    if (!toolName) {
      throw new Error('toolName is required');
    }
    return proxyGitNexusTool(toolName, { root: args.root, ...(args.arguments || {}) });
  },
};

const server = new Server(
  { name: 'ainwork-code-search', version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name];
  if (!handler) {
    return toolError(`Unknown tool: ${request.params.name}`);
  }

  try {
    return await handler(request.params.arguments || {});
  } catch (error) {
    return toolError(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
