/**
 * MTL-Code Runtime Integration
 *
 * This module keeps the historical public API name used by the UI server, but
 * execution is delegated directly to the paired MTL-Code backend CLI.
 *
 * Key features:
 * - Direct MTL-Code CLI execution
 * - Session management with abort capability
 * - Options mapping between UI settings and MTL-Code flags
 * - WebSocket message streaming
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { MTL_CODE_MODEL } from '../shared/modelConstants.js';

import {
  applyOpenMythosRuntimeToEnv,
  canonicalizeAnthropicModel,
  readOpenMythosRuntimeConfig,
  resolveMtlCodeModelRuntime,
} from './services/mtl-code-model-service.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createNormalizedMessage } from './shared/utils.js';

const activeSessions = new Map();
const pendingToolApprovals = new Map();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

function normalizeToolSettings(settings = {}) {
  return {
    allowedTools: Array.isArray(settings.allowedTools)
      ? settings.allowedTools.filter(entry => typeof entry === 'string' && entry.trim())
      : [],
    disallowedTools: Array.isArray(settings.disallowedTools)
      ? settings.disallowedTools.filter(entry => typeof entry === 'string' && entry.trim())
      : [],
    skipPermissions: Boolean(settings.skipPermissions)
  };
}

function shouldBypassToolPermissions(options = {}, settings = normalizeToolSettings()) {
  if (options.permissionMode === 'plan') {
    return false;
  }

  return Boolean(
    settings.skipPermissions
    || options.skipPermissions
    || options.permissionMode === 'bypassPermissions'
  );
}

function resolveConfiguredToolDecision(toolName, input, options = {}, settings = normalizeToolSettings()) {
  if (TOOLS_REQUIRING_INTERACTION.has(toolName)) {
    return null;
  }

  if (shouldBypassToolPermissions(options, settings)) {
    return { allow: true, updatedInput: input };
  }

  const isDisallowed = settings.disallowedTools.some(entry =>
    matchesToolPermission(entry, toolName, input)
  );
  if (isDisallowed) {
    return { allow: false, message: 'Tool disallowed by settings' };
  }

  const isAllowed = settings.allowedTools.some(entry =>
    matchesToolPermission(entry, toolName, input)
  );
  if (isAllowed) {
    return { allow: true, updatedInput: input };
  }

  return null;
}

function resolveBunExecutable() {
  if (process.env.BUN_EXE && existsSync(process.env.BUN_EXE)) {
    return process.env.BUN_EXE;
  }

  const userProfile = process.env.USERPROFILE || osHomedirFallback();
  const candidates = [
    path.join(userProfile, '.bun', 'bin', 'bun.exe'),
    path.join(userProfile, '.bun', 'bin', 'bun')
  ];

  return candidates.find(candidate => existsSync(candidate)) || 'bun';
}

function osHomedirFallback() {
  return process.env.USERPROFILE || process.env.HOME || process.cwd();
}

function getMtlCodeResourceDirs() {
  const runtimeResourcesDir = path.resolve(path.dirname(process.execPath), '..');
  const candidates = [
    process.env.MTL_CODE_RESOURCES_DIR,
    path.resolve(SERVER_DIR, '..', '..', '..'),
    runtimeResourcesDir,
  ];

  const seen = new Set();
  return candidates
    .filter(Boolean)
    .map(candidate => path.resolve(candidate))
    .filter(candidate => {
      const key = candidate.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return existsSync(candidate);
    });
}

function getMtlCodeCliCandidates() {
  const explicitCandidates = [
    process.env.MTL_CODE_CLI_PATH,
    process.env.CLAUDE_CLI_PATH
  ];
  const resourceCandidates = getMtlCodeResourceDirs().flatMap(resourcesDir => [
    path.join(resourcesDir, 'mtl-code', 'mtl-code.exe'),
    path.join(resourcesDir, 'mtl-code', 'dist', 'cli-bun.js'),
    path.join(resourcesDir, 'mtl-code', 'dist', 'cli-node.js'),
  ]);
  const candidates = [
    ...explicitCandidates,
    ...resourceCandidates,
    // Local development checkout: claudecodeui/server -> ../claude-code
    path.resolve(SERVER_DIR, '..', '..', 'claude-code', 'dist', 'cli-bun.js'),
    path.resolve(SERVER_DIR, '..', '..', 'claude-code', 'dist', 'cli-node.js'),
    path.resolve(process.cwd(), '..', 'claude-code', 'dist', 'cli-bun.js'),
    path.resolve(process.cwd(), '..', 'claude-code', 'dist', 'cli-node.js'),
  ];

  const seen = new Set();
  return candidates
    .filter(Boolean)
    .filter(candidate => {
      if (!path.isAbsolute(candidate)) {
        return false;
      }
      const key = path.resolve(candidate).toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return existsSync(candidate);
    });
}

function resolveMtlCodeCliPath() {
  return getMtlCodeCliCandidates()[0] || 'no MTL-Code backend candidate found';
}

function normalizeWindowsDrivePath(value) {
  if (process.platform !== 'win32' || typeof value !== 'string') {
    return value;
  }

  return value.trim().replace(/^([a-zA-Z])[/\\]+/, '$1:/');
}

function repairHyphenDecodedPath(value) {
  if (process.platform !== 'win32' || !value) {
    return null;
  }

  const normalized = normalizeWindowsDrivePath(value).replace(/[\\/]+/g, path.sep);
  const parsed = path.parse(normalized);
  if (!parsed.root || !existsSync(parsed.root)) {
    return null;
  }

  const segments = normalized
    .slice(parsed.root.length)
    .split(/[\\/]+/)
    .filter(Boolean);

  const maxJoinSegments = 5;
  const walk = (current, index) => {
    if (index >= segments.length) {
      return existsSync(current) ? current : null;
    }

    for (let length = 1; length <= Math.min(maxJoinSegments, segments.length - index); length += 1) {
      const candidateName = segments.slice(index, index + length).join(length === 1 ? '' : '-');
      const candidatePath = path.join(current, candidateName);
      if (existsSync(candidatePath)) {
        const repaired = walk(candidatePath, index + length);
        if (repaired) {
          return repaired;
        }
      }
    }

    return null;
  };

  return walk(parsed.root, 0);
}

function resolveWorkingDirectory(rawCwd) {
  const fallback = process.cwd();
  if (!rawCwd || typeof rawCwd !== 'string') {
    return fallback;
  }

  const normalized = path.resolve(normalizeWindowsDrivePath(rawCwd));
  if (existsSync(normalized)) {
    return normalized;
  }

  const repaired = repairHyphenDecodedPath(rawCwd);
  if (repaired && existsSync(repaired)) {
    console.warn(`[MTL-Code] Repaired missing cwd "${rawCwd}" -> "${repaired}"`);
    return repaired;
  }

  throw new Error(`Project working directory does not exist: ${rawCwd}`);
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver = (decision) => {
      finalize(decision);
    };
    // Attach metadata for getPendingApprovalsForSession lookup
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

/**
 * Builds the MTL-Code CLI flags used by the headless stream-json protocol.
 * The prompt itself is written to stdin as a structured user message so stdin
 * can stay open for permission control responses.
 * @param {Object} options - UI command options
 * @returns {string[]} CLI arguments
 */
function shouldUseBareMode(env = process.env) {
  const value = String(env.MTL_CODE_UI_BARE ?? '').trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

function hasRequestedMcpBindings(options = {}) {
  const bindings = options.runtimeDiagnostics?.mcpBindings;
  return Array.isArray(bindings) && bindings.length > 0;
}

function getMtlCodeGlobalConfigFile(env = process.env) {
  const home = osHomedirFallback();
  const configDir = env.MTL_CODE_CONFIG_DIR || env.CLAUDE_CONFIG_DIR || home;
  const mtlCodeConfigPath = path.join(configDir, '.mtl-code.json');
  const legacyClaudeConfigPath = path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json');

  if (!env.MTL_CODE_CONFIG_DIR && existsSync(legacyClaudeConfigPath) && !existsSync(mtlCodeConfigPath)) {
    return legacyClaudeConfigPath;
  }

  return mtlCodeConfigPath;
}

function buildMtlCodeArgs(options = {}, env = process.env) {
  const { sessionId, toolsSettings, permissionMode } = options;
  const settings = normalizeToolSettings(toolsSettings);

  const args = [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-prompt-tool',
    'stdio',
    '--enable-auth-status'
  ];

  if (shouldUseBareMode(env)) {
    args.splice(1, 0, '--bare');
  }

  if (hasRequestedMcpBindings(options)) {
    const mcpConfigPath = getMtlCodeGlobalConfigFile(env);
    if (existsSync(mcpConfigPath)) {
      args.push('--mcp-config', mcpConfigPath);
    }
  }

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  const bypassToolPermissions = shouldBypassToolPermissions(options, settings);
  const effectivePermissionMode = bypassToolPermissions
    ? 'bypassPermissions'
    : permissionMode;
  if (effectivePermissionMode && effectivePermissionMode !== 'default') {
    args.push('--permission-mode', effectivePermissionMode);
  }
  if ((settings.skipPermissions || options.skipPermissions) && permissionMode !== 'plan') {
    args.push('--dangerously-skip-permissions');
  }

  const allowedTools = [...(settings.allowedTools || [])];
  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Agent', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }
  if (allowedTools.length > 0) {
    args.push('--allowedTools', ...allowedTools);
  }
  if (settings.disallowedTools?.length > 0) {
    args.push('--disallowedTools', ...settings.disallowedTools);
  }

  if (options.appendSystemPrompt && typeof options.appendSystemPrompt === 'string') {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }

  // Let MTL-Code resolve the concrete runtime model from ~/.mtl-code/settings.json
  // and OPENAI_* env vars unless the UI sends an explicit non-sentinel model.
  const optionModel = canonicalizeAnthropicModel(options.model);
  if (optionModel && optionModel !== MTL_CODE_MODEL.value) {
    args.push('--model', optionModel);
  }

  return args;
}

function getMtlCodeConfigDir() {
  return process.env.MTL_CODE_CONFIG_DIR || path.join(osHomedirFallback(), '.mtl-code');
}

async function readMtlCodeSettingsEnv() {
  try {
    const settingsPath = path.join(getMtlCodeConfigDir(), 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    if (!settings || typeof settings.env !== 'object' || Array.isArray(settings.env)) {
      const runtimeEnv = {};
      applyOpenMythosRuntimeToEnv(
        runtimeEnv,
        readOpenMythosRuntimeConfig(settings || {}, runtimeEnv),
      );
      return runtimeEnv;
    }

    const env = Object.fromEntries(
      Object.entries(settings.env)
        .filter(([, value]) => typeof value === 'string' && value.length > 0)
    );
    applyOpenMythosRuntimeToEnv(env, readOpenMythosRuntimeConfig(settings, env));
    return env;
  } catch {
    return {};
  }
}

function isDeepSeekAnthropicRuntime(env) {
  const baseUrl = String(env.ANTHROPIC_BASE_URL || '').toLowerCase();
  const model = String(env.ANTHROPIC_MODEL || '').toLowerCase();
  return baseUrl.includes('api.deepseek.com') || model.includes('deepseek');
}

function isMimoAnthropicRuntime(env) {
  const baseUrl = String(env.ANTHROPIC_BASE_URL || '').toLowerCase();
  const model = String(env.ANTHROPIC_MODEL || '').toLowerCase();
  return baseUrl.includes('xiaomimimo.com') || model.startsWith('mimo-');
}

function resolveConfiguredContextWindow(env, overrideTokens = null) {
  const parsedOverride = parseInt(String(overrideTokens || ''), 10);
  if (Number.isFinite(parsedOverride) && parsedOverride > 0) {
    return String(parsedOverride);
  }
  const parsed = parseInt(env.MTL_CODE_MAX_CONTEXT_TOKENS || env.CONTEXT_WINDOW || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
}

async function buildMtlCodeSpawnEnv(options = {}) {
  const settingsEnv = await readMtlCodeSettingsEnv();
  const modelRuntime = await resolveMtlCodeModelRuntime(options.modelProfileId).catch((error) => {
    console.warn('[MTL-Code] Failed to resolve session model profile:', error?.message || error);
    return null;
  });
  const spawnEnv = {
    ...process.env,
    ...settingsEnv,
    ...(modelRuntime?.env || {}),
    MTLCODE: '1'
  };
  for (const key of [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'MTL_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
  ]) {
    if (spawnEnv[key]) {
      spawnEnv[key] = canonicalizeAnthropicModel(spawnEnv[key]);
    }
  }
  const configuredContextWindow = resolveConfiguredContextWindow(
    spawnEnv,
    options.contextWindowTokens || modelRuntime?.contextWindowTokens,
  );
  if (configuredContextWindow) {
    spawnEnv.MTL_CODE_MAX_CONTEXT_TOKENS = configuredContextWindow;
    spawnEnv.CONTEXT_WINDOW = configuredContextWindow;
  }

  if (isDeepSeekAnthropicRuntime(spawnEnv)) {
    const configuredModel = canonicalizeAnthropicModel(spawnEnv.ANTHROPIC_MODEL || spawnEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || '');
    const smallModel = spawnEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL
      || (String(configuredModel).toLowerCase().includes('deepseek-v4-pro')
        ? 'deepseek-v4-flash'
        : configuredModel)
      || 'deepseek-v4-flash';
    const effortLevel = spawnEnv.MTL_CODE_EFFORT_LEVEL || spawnEnv.CLAUDE_CODE_EFFORT_LEVEL || 'high';

    spawnEnv.MTL_CODE_SUBAGENT_MODEL = spawnEnv.MTL_CODE_SUBAGENT_MODEL || spawnEnv.CLAUDE_CODE_SUBAGENT_MODEL || smallModel;
    spawnEnv.CLAUDE_CODE_SUBAGENT_MODEL = spawnEnv.CLAUDE_CODE_SUBAGENT_MODEL || spawnEnv.MTL_CODE_SUBAGENT_MODEL;
    spawnEnv.MTL_CODE_EFFORT_LEVEL = effortLevel;
    spawnEnv.CLAUDE_CODE_EFFORT_LEVEL = spawnEnv.CLAUDE_CODE_EFFORT_LEVEL || effortLevel;
  } else if (isMimoAnthropicRuntime(spawnEnv)) {
    const configuredModel = canonicalizeAnthropicModel(spawnEnv.ANTHROPIC_MODEL || spawnEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || 'mimo-v2.5-pro');

    spawnEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = spawnEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || configuredModel;
    spawnEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = spawnEnv.ANTHROPIC_DEFAULT_OPUS_MODEL || configuredModel;
    spawnEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = spawnEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL || configuredModel;
    spawnEnv.MTL_CODE_SUBAGENT_MODEL = spawnEnv.MTL_CODE_SUBAGENT_MODEL || spawnEnv.CLAUDE_CODE_SUBAGENT_MODEL || configuredModel;
    spawnEnv.CLAUDE_CODE_SUBAGENT_MODEL = spawnEnv.CLAUDE_CODE_SUBAGENT_MODEL || spawnEnv.MTL_CODE_SUBAGENT_MODEL;
    delete spawnEnv.MTL_CODE_EFFORT_LEVEL;
    delete spawnEnv.CLAUDE_CODE_EFFORT_LEVEL;
  }

  return spawnEnv;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null, writer = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir,
    writer
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * Extracts token usage from SDK result messages
 * @param {Object} resultMessage - SDK result message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  // Get the first model's usage data
  const modelKey = Object.keys(resultMessage.modelUsage)[0];
  const modelData = resultMessage.modelUsage[modelKey];

  if (!modelData) {
    return null;
  }

  // Use cumulative tokens if available (tracks total for the session)
  // Otherwise fall back to per-request tokens
  const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
  const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
  const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
  const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

  // Total used = input + output + cache tokens
  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  // Prefer the backend-reported model window; fall back to the UI env budget.
  const contextWindow = parseInt(modelData.contextWindow, 10)
    || parseInt(process.env.CONTEXT_WINDOW, 10)
    || 200000;

  // Token calc logged via token-budget WS event

  return {
    used: totalUsed,
    total: contextWindow
  };
}

/**
 * Handles image processing for SDK queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    // Images processed
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    // Temp files cleaned
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

function createMtlCodeLaunch(cliPath) {
  if (/cli-bun\.js$/i.test(cliPath)) {
    return {
      command: resolveBunExecutable(),
      argsPrefix: [cliPath],
      displayCommand: cliPath,
      shell: false
    };
  }

  if (/\.js$/i.test(cliPath)) {
    return {
      command: process.execPath,
      argsPrefix: [cliPath],
      displayCommand: cliPath,
      shell: false
    };
  }

  return {
    command: cliPath,
    argsPrefix: [],
    displayCommand: cliPath,
    shell: false
  };
}

function resolveMtlCodeLaunches() {
  return getMtlCodeCliCandidates().map(createMtlCodeLaunch);
}

function waitForMtlCodeSpawn(child) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
    };
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function createMtlCodeUserMessage(content, clientMessageId = null) {
  const requestId = typeof clientMessageId === 'string' && clientMessageId.trim()
    ? clientMessageId.trim()
    : createRequestId();

  return {
    type: 'user',
    content,
    uuid: requestId,
    session_id: '',
    message: {
      role: 'user',
      content
    },
    parent_tool_use_id: null
  };
}

function writeMtlCodeJson(child, payload) {
  if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) {
    return false;
  }
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return true;
}

function closeMtlCodeInput(child) {
  if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) {
    return;
  }
  child.stdin.end();
}

function buildPermissionControlResponse(controlRequest, decision) {
  const request = controlRequest.request || {};
  const toolUseID = request.tool_use_id;
  const allow = Boolean(decision?.allow);

  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: controlRequest.request_id,
      response: allow
        ? {
          behavior: 'allow',
          updatedInput: decision?.updatedInput && typeof decision.updatedInput === 'object'
            ? decision.updatedInput
            : (request.input || {}),
          toolUseID,
          decisionClassification: decision?.rememberEntry ? 'user_permanent' : 'user_temporary'
        }
        : {
          behavior: 'deny',
          message: decision?.message || 'User denied tool use',
          toolUseID,
          decisionClassification: 'user_reject'
        }
    }
  };
}

function buildUnsupportedControlResponse(controlRequest, message) {
  return {
    type: 'control_response',
    response: {
      subtype: 'error',
      request_id: controlRequest.request_id,
      error: message
    }
  };
}

async function queryMtlCodeDirect(command, options = {}, ws) {
  const { sessionId, sessionSummary } = options;
  const runtimeToolSettings = normalizeToolSettings(options.toolsSettings);
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  let child = null;
  let childClosed = false;
  let resultReceived = false;
  const stderrLines = [];

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  const createSessionInstance = (mtlCodeChild) => ({
    child: mtlCodeChild,
    sendGuidance: (content, clientMessageId = null) => writeMtlCodeJson(
      mtlCodeChild,
      createMtlCodeUserMessage(content, clientMessageId)
    ),
    interrupt: async () => {
      mtlCodeChild._mtlCodeAborted = true;
      writeMtlCodeJson(mtlCodeChild, {
        type: 'control_request',
        request_id: createRequestId(),
        request: { subtype: 'interrupt' }
      });
      const killTimer = setTimeout(() => {
        if (!childClosed && !mtlCodeChild.killed) {
          mtlCodeChild.kill('SIGTERM');
        }
      }, 750);
      killTimer.unref?.();
    }
  });

  const clientSessionId = typeof options.clientSessionId === 'string' ? options.clientSessionId.trim() : '';
  const ensureSessionRegistered = (messageSessionId) => {
    if (!messageSessionId || capturedSessionId === messageSessionId) {
      return;
    }

    capturedSessionId = messageSessionId;
    addSession(capturedSessionId, createSessionInstance(child), tempImagePaths, tempDir, ws);
    if (clientSessionId && clientSessionId !== capturedSessionId) {
      removeSession(clientSessionId);
    }

    if (ws.setSessionId && typeof ws.setSessionId === 'function') {
      ws.setSessionId(capturedSessionId);
    }

    if (!sessionId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
    }
  };

  const handleControlRequest = async (message) => {
    const request = message.request || {};
    if (request.subtype !== 'can_use_tool') {
      writeMtlCodeJson(child, buildUnsupportedControlResponse(
        message,
        `Unsupported MTL-Code control request subtype: ${request.subtype || 'unknown'}`
      ));
      return;
    }

    const requestId = message.request_id;
    const toolName = request.tool_name || 'UnknownTool';
    const input = request.input || {};
    const sid = capturedSessionId || sessionId || null;
    const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
    const configuredDecision = resolveConfiguredToolDecision(toolName, input, options, runtimeToolSettings);

    if (configuredDecision) {
      writeMtlCodeJson(child, buildPermissionControlResponse(message, configuredDecision));
      return;
    }

    ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: sid, provider: 'claude' }));
    emitNotification(createNotificationEvent({
      provider: 'claude',
      sessionId: sid,
      kind: 'action_required',
      code: 'permission.required',
      meta: { toolName, sessionName: sessionSummary },
      severity: 'warning',
      requiresUserAction: true,
      dedupeKey: `claude:permission:${sid || 'none'}:${requestId}`
    }));

    const decision = await waitForToolApproval(requestId, {
      timeoutMs: requiresInteraction ? 0 : TOOL_APPROVAL_TIMEOUT_MS,
      metadata: {
        _sessionId: sid,
        _toolName: toolName,
        _input: input,
        _context: request,
        _receivedAt: new Date(),
      },
      onCancel: (reason) => {
        ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: sid, provider: 'claude' }));
      }
    });

    if (decision?.allow && typeof decision.rememberEntry === 'string' && decision.rememberEntry.trim()) {
      if (!runtimeToolSettings.allowedTools.includes(decision.rememberEntry)) {
        runtimeToolSettings.allowedTools.push(decision.rememberEntry);
      }
      runtimeToolSettings.disallowedTools = runtimeToolSettings.disallowedTools.filter(entry => entry !== decision.rememberEntry);
    }

    writeMtlCodeJson(child, buildPermissionControlResponse(
      message,
      decision || { allow: false, message: 'Permission request timed out' }
    ));
  };

  const handleStdoutLine = async (line) => {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.warn('[MTL-Code] Non-JSON stdout:', line);
      return;
    }

    ensureSessionRegistered(message.session_id);

    if (message.type === 'control_request') {
      await handleControlRequest(message);
      return;
    }

    const transformedMessage = transformMessage(message);
    const sid = capturedSessionId || sessionId || null;
    const normalized = sessionsService.normalizeMessage('claude', transformedMessage, sid);
    for (const msg of normalized) {
      if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
        msg.parentToolUseId = transformedMessage.parentToolUseId;
      }
      ws.send(msg);
    }

    if (message.type === 'result') {
      resultReceived = true;
      const tokenBudgetData = extractTokenBudget(message);
      if (tokenBudgetData) {
        ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: sid, provider: 'claude' }));
      }
      closeMtlCodeInput(child);
    }
  };

  try {
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    const launches = resolveMtlCodeLaunches();
    const cwd = resolveWorkingDirectory(options.cwd || options.projectPath);
    const childEnv = await buildMtlCodeSpawnEnv(options);
    const cliArgs = buildMtlCodeArgs(options, childEnv);
    let lastSpawnError = null;

    for (const launch of launches) {
      const args = [...launch.argsPrefix, ...cliArgs];
      console.log('[MTL-Code] Starting backend:', launch.displayCommand);
      let candidateChild;
      try {
        candidateChild = spawn(launch.command, args, {
          cwd,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: launch.shell
        });
      } catch (spawnError) {
        lastSpawnError = spawnError;
        console.warn(
          `[MTL-Code] Failed to spawn ${launch.displayCommand}; trying next backend candidate:`,
          spawnError?.message || spawnError
        );
        continue;
      }

      try {
        await waitForMtlCodeSpawn(candidateChild);
        child = candidateChild;
        break;
      } catch (spawnError) {
        lastSpawnError = spawnError;
        console.warn(
          `[MTL-Code] Failed to start ${launch.displayCommand}; trying next backend candidate:`,
          spawnError?.message || spawnError
        );
        candidateChild.kill?.('SIGTERM');
      }
    }

    if (!child) {
      throw lastSpawnError || new Error('No usable MTL-Code backend candidate found');
    }

    if (sessionId || clientSessionId) {
      addSession(capturedSessionId || clientSessionId, createSessionInstance(child), tempImagePaths, tempDir, ws);
    }

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          stderrLines.push(line);
          if (stderrLines.length > 40) {
            stderrLines.shift();
          }
        }
      }
      process.stderr.write(text);
    });

    let stdoutBuffer = '';
    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        void handleStdoutLine(line);
      }
    });

    if (finalCommand && finalCommand.trim()) {
      writeMtlCodeJson(child, createMtlCodeUserMessage(finalCommand, options.clientMessageId));
    } else {
      closeMtlCodeInput(child);
    }

    const { code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => {
        childClosed = true;
        resolve({ code: exitCode, signal: exitSignal });
      });
    });

    if (stdoutBuffer.trim()) {
      await handleStdoutLine(stdoutBuffer);
    }

    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }
    await cleanupTempFiles(tempImagePaths, tempDir);

    const aborted = Boolean(child._mtlCodeAborted || signal);
    if (code && code !== 0 && !resultReceived && !aborted) {
      const stderrText = stderrLines.slice(-12).join('\n');
      const message = stderrText || `MTL-Code backend exited with code ${code}`;
      ws.send(createNormalizedMessage({ kind: 'error', content: message, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        sessionName: sessionSummary,
        error: new Error(message)
      });
      return;
    }

    if (!aborted) {
      ws.send(createNormalizedMessage({ kind: 'complete', exitCode: code ?? 0, isNewSession: !sessionId && !!command, sessionId: capturedSessionId, provider: 'claude' }));
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        sessionName: sessionSummary,
        stopReason: 'completed'
      });
    }
  } catch (error) {
    console.error('MTL-Code query error:', error);

    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }
    await cleanupTempFiles(tempImagePaths, tempDir);

    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? `MTL-Code backend is not installed or not on PATH. Build/link MTL-Code, or set MTL_CODE_CLI_PATH. Current fallback: ${resolveMtlCodeCliPath()}`
      : error.message;

    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
}

async function queryClaudeSDK(command, options = {}, ws) {
  return queryMtlCodeDirect(command, options, ws);
}

const query = () => {
  throw new Error('Legacy query path is disabled; use MTL-Code direct execution.');
};

function mapCliOptionsToSDK() {
  throw new Error('Legacy query option mapping is disabled; use MTL-Code direct execution.');
}

async function loadMcpConfig() {
  return null;
}

/**
 * Legacy compatibility path retained only for historical reference.
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDKLegacy(command, options = {}, ws) {
  const { sessionId, sessionSummary } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  try {
    // Map CLI options to the legacy format.
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: capturedSessionId || sessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${capturedSessionId || sessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${capturedSessionId || sessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        metadata: {
          _sessionId: capturedSessionId || sessionId || null,
          _toolName: toolName,
          _input: input,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    let queryInstance;
    try {
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions
      });
    } catch (hookError) {
      // Older/newer SDK versions may not accept hook shapes yet.
      // Keep notification behavior operational via runtime events even if hook registration fails.
      console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
      delete sdkOptions.hooks;
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions
      });
    }

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, ws);
    }

    // Process streaming messages
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const message of queryInstance) {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, ws);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }
      } else {
        // session_id already captured
      }

      // Transform and normalize message via adapter
      const transformedMessage = transformMessage(message);
      const sid = capturedSessionId || sessionId || null;

      // Use adapter to normalize SDK events into NormalizedMessage[]
      const normalized = sessionsService.normalizeMessage('claude', transformedMessage, sid);
      for (const msg of normalized) {
        // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
        if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformedMessage.parentToolUseId;
        }
        ws.send(msg);
      }

      // Extract and send token budget updates from result messages
      if (message.type === 'result') {
        const models = Object.keys(message.modelUsage || {});
        if (models.length > 0) {
          // Model info available in result message
        }
        const tokenBudgetData = extractTokenBudget(message);
        if (tokenBudgetData) {
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send completion event
    ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: !sessionId && !!command, sessionId: capturedSessionId, provider: 'claude' }));
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      stopReason: 'completed'
    });
    // Complete

  } catch (error) {
    console.error('MTL-Code legacy query path error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files on error
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Check if MTL-Code CLI is installed for a clearer error message
    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? `MTL-Code backend is not installed or not on PATH. Install/link mtl-code, or set MTL_CODE_CLI_PATH. Current fallback: ${resolveMtlCodeCliPath()}`
      : error.message;

    // Send error to WebSocket
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Sends an additional user guidance message into an active MTL-Code session.
 * This is used by the UI while a response is still running.
 * @param {string} sessionId - Active session identifier or temporary client session id
 * @param {string} content - Additional user guidance
 * @param {string|null} clientMessageId - Optional UI message id for dedupe
 * @returns {{success: boolean, error?: string}}
 */
function sendClaudeSDKGuidance(sessionId, content, clientMessageId = null) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const normalizedContent = typeof content === 'string' ? content.trim() : '';

  if (!normalizedSessionId) {
    return { success: false, error: 'No active session id is available.' };
  }
  if (!normalizedContent) {
    return { success: false, error: 'Guidance content is empty.' };
  }

  const session = getSession(normalizedSessionId);
  if (!session || session.status !== 'active') {
    return { success: false, error: `Session ${normalizedSessionId} is not active.` };
  }
  if (typeof session.instance?.sendGuidance !== 'function') {
    return { success: false, error: 'The active backend does not support runtime guidance.' };
  }

  const written = session.instance.sendGuidance(normalizedContent, clientMessageId);
  return written
    ? { success: true }
    : { success: false, error: 'The active backend input stream is no longer writable.' };
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
function getPendingApprovalsForSession(sessionId) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        context: resolver._context,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

/**
 * Reconnect a session's WebSocketWriter to a new raw WebSocket.
 * Called when client reconnects (e.g. page refresh) while SDK is still running.
 * @param {string} sessionId - The session ID
 * @param {Object} newRawWs - The new raw WebSocket connection
 * @returns {boolean} True if writer was successfully reconnected
 */
function reconnectSessionWriter(sessionId, newRawWs) {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  sendClaudeSDKGuidance,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter
};
