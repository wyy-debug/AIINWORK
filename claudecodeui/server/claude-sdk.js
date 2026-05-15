/**
 * Argus Runtime Integration
 *
 * This module keeps the historical public API name used by the UI server, but
 * execution is delegated directly to the paired Argus backend CLI.
 *
 * Key features:
 * - Direct Argus CLI execution
 * - Session management with abort capability
 * - Options mapping between UI settings and Argus flags
 * - WebSocket message streaming
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { MTL_CODE_MODEL } from '../shared/modelConstants.js';

import {
  ANTHROPIC_MODEL_ENV_KEYS,
  MTL_CODE_MODEL_ENV_KEYS,
  OPENAI_MODEL_ENV_KEYS,
  applyAnthropicRuntimeModelDefaults,
  applyOpenMythosRuntimeToEnv,
  applySubagentRuntimeToEnv,
  canonicalizeAnthropicModel,
  readOpenMythosRuntimeConfig,
  readSubagentRuntimeConfig,
  repairAnthropicRuntimeModelEnv,
  resolveMtlCodeModelRuntime,
} from './services/mtl-code-model-service.js';
import {
  buildContextBudgetFromModelUsage,
  toLegacyTokenBudget,
} from './services/context-budget-service.js';
import { readObsidianBridgeConfig } from './services/obsidian-bridge-service.js';
import { hubUsageDb } from './database/db.js';
import { extractTokenBreakdownFromContextBudget } from './services/hub-usage-service.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { evaluateRuntimePermission } from './services/runtime-permission-service.js';
import {
  getArgusPlanModeAllowedTools,
  getArgusPlanModeDeniedTools,
  resolveArgusPermissionMode,
} from './services/argus-collaboration-mode-service.js';
import { buildSubagentDirectControlPayload } from './services/subagent-task-control-service.js';
import { createNormalizedMessage } from './shared/utils.js';

const activeSessions = new Map();
const pendingToolApprovals = new Map();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ARGUS_SESSION_LOG_PREFIX = '[ArgusSession]';

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'request_user_input', 'ExitPlanMode']);
const ARGUS_DEFAULT_PERMISSION_MODE = 'acceptEdits';
const ARGUS_STALE_EXACT_TOOL_DENIES = new Set([
  'Bash',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write',
]);

function normalizeToolSettings(settings = {}) {
  return {
    allowedTools: Array.isArray(settings.allowedTools)
      ? settings.allowedTools.filter(entry => typeof entry === 'string' && entry.trim())
      : [],
    disallowedTools: Array.isArray(settings.disallowedTools)
      ? settings.disallowedTools
        .filter(entry => typeof entry === 'string' && entry.trim())
        .filter(entry => !ARGUS_STALE_EXACT_TOOL_DENIES.has(entry))
      : [],
    skipPermissions: Boolean(settings.skipPermissions)
  };
}

function normalizePermissionMode(value) {
  return value === 'default'
    || value === 'acceptEdits'
    || value === 'bypassPermissions'
    || value === 'plan'
    ? value
    : ARGUS_DEFAULT_PERMISSION_MODE;
}

function mergeUniqueToolRules(...groups) {
  const merged = [];
  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const entry of group) {
      const value = typeof entry === 'string' ? entry.trim() : '';
      if (value && !merged.includes(value)) {
        merged.push(value);
      }
    }
  }
  return merged;
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
  return getMtlCodeCliCandidates()[0] || 'no Argus backend candidate found';
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
    console.warn(`[Argus] Repaired missing cwd "${rawCwd}" -> "${repaired}"`);
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

function hashMtlCodeDiagnosticValue(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 12);
}

function getMtlCodeCliFlags(cliArgs = []) {
  if (!Array.isArray(cliArgs)) {
    return [];
  }
  return cliArgs
    .filter(arg => typeof arg === 'string' && arg.startsWith('--'))
    .filter((arg, index, list) => list.indexOf(arg) === index);
}

function buildMtlCodeSessionLogPayload(event, details = {}) {
  const payload = {
    event,
    at: new Date().toISOString(),
  };

  for (const key of [
    'turnId',
    'sessionId',
    'clientSessionId',
    'capturedSessionId',
    'reuseSessionKey',
    'cwd',
    'launch',
    'pid',
    'exitCode',
    'signal',
    'reason',
    'toolName',
    'requestId',
    'durationMs',
    'stderrTailCount',
    'stopReason',
    'numTurns',
    'permissionRequestCount',
    'apiProvider',
    'requestModel',
  ]) {
    if (details[key] !== undefined && details[key] !== null && details[key] !== '') {
      payload[key] = details[key];
    }
  }

  for (const key of [
    'synthetic',
    'written',
    'resultReceived',
    'currentTurnActive',
    'sawToolUse',
    'aborted',
    'hasExistingSession',
    'busy',
    'closed',
    'resumeSuppressedForRuntimeChange',
    'autoAllowed',
  ]) {
    if (typeof details[key] === 'boolean') {
      payload[key] = details[key];
    }
  }

  if (typeof details.command === 'string') {
    payload.commandLength = details.command.length;
  }
  if (typeof details.effectiveCommand === 'string') {
    payload.effectiveCommandLength = details.effectiveCommand.length;
  }
  if (typeof details.assistantText === 'string') {
    payload.assistantTextLength = details.assistantText.length;
  }
  if (Array.isArray(details.toolUseNames)) {
    payload.toolUseNames = details.toolUseNames
      .map(name => (typeof name === 'string' ? name.trim() : ''))
      .filter(Boolean);
  }
  if (typeof details.runtimeSignature === 'string' && details.runtimeSignature) {
    payload.runtimeSignatureHash = hashMtlCodeDiagnosticValue(details.runtimeSignature);
  }
  if (Array.isArray(details.cliArgs)) {
    payload.cliFlags = getMtlCodeCliFlags(details.cliArgs);
  }
  if (details.error) {
    payload.errorName = details.error.name || 'Error';
    payload.errorMessage = details.error.message || String(details.error);
  } else if (typeof details.errorMessage === 'string' && details.errorMessage) {
    payload.errorMessage = details.errorMessage;
  }

  return payload;
}

function logMtlCodeSessionLifecycle(event, details = {}) {
  try {
    console.log(`${ARGUS_SESSION_LOG_PREFIX} ${JSON.stringify(buildMtlCodeSessionLogPayload(event, details))}`);
  } catch (error) {
    console.warn('[ArgusSession] failed to serialize lifecycle log:', error?.message || error);
  }
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
 * Builds the Argus CLI flags used by the headless stream-json protocol.
 * The prompt itself is written to stdin as a structured user message so stdin
 * can stay open for permission control responses.
 * @param {Object} options - UI command options
 * @returns {string[]} CLI arguments
 */
function shouldUseBareMode(env = process.env) {
  const value = String(env.MTL_CODE_UI_BARE ?? '').trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

function isClaudeNativeMemoryEnabled(env = process.env) {
  const value = String(env[MTL_CODE_MODEL_ENV_KEYS.claudeNativeMemoryEnabled] ?? '').trim().toLowerCase();
  if (!value) {
    return true;
  }
  return value !== '0' && value !== 'false' && value !== 'off';
}

function getMtlCodeApiProvider(env = process.env) {
  if (env.MTL_CODE_USE_OPENAI === '1') {
    return 'openai-compatible';
  }
  if (env.MTL_CODE_USE_GEMINI === '1') {
    return 'gemini';
  }
  if (env.MTL_CODE_USE_GROK === '1') {
    return 'grok';
  }
  return 'anthropic';
}

function getMtlCodeRequestModel(env = process.env) {
  if (env.MTL_CODE_USE_OPENAI === '1') {
    return env[OPENAI_MODEL_ENV_KEYS.model]
      || env[OPENAI_MODEL_ENV_KEYS.defaultSonnetModel]
      || env[OPENAI_MODEL_ENV_KEYS.defaultHaikuModel]
      || env[OPENAI_MODEL_ENV_KEYS.defaultOpusModel]
      || '';
  }
  return env[ANTHROPIC_MODEL_ENV_KEYS.model]
    || env[ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel]
    || env[ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel]
    || env[ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel]
    || '';
}

function projectMemoryKey({ projectPath = '', projectName = '' } = {}) {
  const source = String(projectPath || projectName || 'General').trim();
  return source.replace(/[^a-zA-Z0-9]/g, '-') || 'General';
}

function getMtlCodeMemoryHome(env = process.env) {
  return env.MTL_CODE_HOME
    || env.MTL_CODE_CONFIG_DIR
    || env.CLAUDE_CONFIG_DIR
    || path.join(osHomedirFallback(), '.mtl-code');
}

function resolveNativeMemoryStagingDir(options = {}, env = process.env) {
  return path.join(
    getMtlCodeMemoryHome(env),
    'projects',
    projectMemoryKey({
      projectPath: options.projectPath || options.cwd,
      projectName: options.projectName,
    }),
    'memory',
  );
}

function applyClaudeNativeMemoryEnv(spawnEnv) {
  if (isClaudeNativeMemoryEnabled(spawnEnv)) {
    spawnEnv[MTL_CODE_MODEL_ENV_KEYS.claudeNativeMemoryEnabled] = '1';
    spawnEnv[MTL_CODE_MODEL_ENV_KEYS.autoMemoryExtractionEnabled] = '1';
    spawnEnv.MTL_CODE_UI_BARE = '0';
    delete spawnEnv.MTL_CODE_SIMPLE;
    delete spawnEnv.MTL_CODE_DISABLE_AUTO_MEMORY;
    return;
  }

  spawnEnv[MTL_CODE_MODEL_ENV_KEYS.claudeNativeMemoryEnabled] = '0';
  delete spawnEnv[MTL_CODE_MODEL_ENV_KEYS.autoMemoryExtractionEnabled];
  spawnEnv.MTL_CODE_UI_BARE = '1';
  spawnEnv.MTL_CODE_DISABLE_AUTO_MEMORY = '1';
}

function isObsidianPrimaryMemoryEnabled() {
  try {
    const config = readObsidianBridgeConfig({ includeToken: false });
    return config.enabled === true && config.aiMemoryReadbackEnabled !== false;
  } catch {
    return false;
  }
}

function applyObsidianPrimaryMemoryEnv(spawnEnv, options = {}) {
  if (!isObsidianPrimaryMemoryEnabled()) {
    delete spawnEnv.MTL_CODE_OBSIDIAN_MEMORY_PRIMARY;
    delete spawnEnv.MTL_CODE_OBSIDIAN_NATIVE_MEMORY_SYNC;
    delete spawnEnv.MTL_CODE_DISABLE_AUTO_MEMORY_EXTRACTION;
    delete spawnEnv.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE;
    return;
  }

  spawnEnv.MTL_CODE_OBSIDIAN_MEMORY_PRIMARY = '1';
  spawnEnv.MTL_CODE_OBSIDIAN_NATIVE_MEMORY_SYNC = '1';
  spawnEnv.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = resolveNativeMemoryStagingDir(options, spawnEnv);
  spawnEnv[MTL_CODE_MODEL_ENV_KEYS.claudeNativeMemoryEnabled] = '1';
  spawnEnv[MTL_CODE_MODEL_ENV_KEYS.autoMemoryExtractionEnabled] = '1';
  spawnEnv.MTL_CODE_UI_BARE = '0';
  delete spawnEnv.MTL_CODE_SIMPLE;
  delete spawnEnv.MTL_CODE_DISABLE_AUTO_MEMORY;
  delete spawnEnv.MTL_CODE_DISABLE_AUTO_MEMORY_EXTRACTION;
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
  const requestedPermissionMode = normalizePermissionMode(
    resolveArgusPermissionMode({ ...options, permissionMode }),
  );

  const args = [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--permission-prompt-tool',
    'stdio'
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

  const permissionOptions = { ...options, permissionMode: requestedPermissionMode };
  const bypassToolPermissions = shouldBypassToolPermissions(permissionOptions, settings);
  const effectivePermissionMode = bypassToolPermissions
    ? 'bypassPermissions'
    : requestedPermissionMode;
  if (effectivePermissionMode && effectivePermissionMode !== 'default') {
    args.push('--permission-mode', effectivePermissionMode);
  }
  if ((settings.skipPermissions || options.skipPermissions) && requestedPermissionMode !== 'plan') {
    args.push('--dangerously-skip-permissions');
  }

  if (requestedPermissionMode === 'plan') {
    args.push('--tools', ...getArgusPlanModeAllowedTools());
  }
  // Host allowedTools are auto-approval rules handled by the stdio
  // permission prompt. Passing them through as Claude Code --allowedTools
  // narrows native tool guidance and can hide read/search tools from normal
  // investigation turns.

  const disallowedTools = requestedPermissionMode === 'plan'
    ? mergeUniqueToolRules(settings.disallowedTools, getArgusPlanModeDeniedTools())
    : settings.disallowedTools;
  if (disallowedTools?.length > 0) {
    args.push('--disallowedTools', ...disallowedTools);
  }

  if (options.appendSystemPrompt && typeof options.appendSystemPrompt === 'string') {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }

  const optionModel = canonicalizeAnthropicModel(options.model);
  const configuredEnvModel = env.MTL_CODE_USE_OPENAI === '1'
    ? env[OPENAI_MODEL_ENV_KEYS.model]
      || env[OPENAI_MODEL_ENV_KEYS.defaultSonnetModel]
      || env[OPENAI_MODEL_ENV_KEYS.defaultHaikuModel]
      || env[OPENAI_MODEL_ENV_KEYS.defaultOpusModel]
      || ''
    : env[ANTHROPIC_MODEL_ENV_KEYS.model]
      || env[ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel]
      || env[ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel]
      || env[ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel]
      || '';
  const resolvedSessionModel = optionModel && optionModel !== MTL_CODE_MODEL.value
    ? optionModel
    : canonicalizeAnthropicModel(configuredEnvModel);
  if (resolvedSessionModel) {
    args.push('--model', resolvedSessionModel);
  }

  return args;
}

function createMtlCodeFreshSessionOptionsForRuntimeChange(options = {}) {
  const freshOptions = { ...options };
  delete freshOptions.sessionId;
  return freshOptions;
}

function buildMtlCodeRuntimeSignature({ cwd = '', cliArgs = [], env = {} } = {}) {
  const stableCliArgs = [];
  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index];
    if (arg === '--resume') {
      index += 1;
      continue;
    }
    stableCliArgs.push(arg);
  }
  const stableEnvKeys = [
    'MTL_CODE_UI_BARE',
    MTL_CODE_MODEL_ENV_KEYS.claudeNativeMemoryEnabled,
    MTL_CODE_MODEL_ENV_KEYS.autoMemoryExtractionEnabled,
    'MTL_CODE_USE_OPENAI',
    ANTHROPIC_MODEL_ENV_KEYS.authToken,
    ANTHROPIC_MODEL_ENV_KEYS.baseUrl,
    ANTHROPIC_MODEL_ENV_KEYS.model,
    ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel,
    OPENAI_MODEL_ENV_KEYS.apiKey,
    OPENAI_MODEL_ENV_KEYS.baseUrl,
    OPENAI_MODEL_ENV_KEYS.model,
    OPENAI_MODEL_ENV_KEYS.defaultSonnetModel,
    'ANTHROPIC_API_KEY',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT_ID',
    'OPENAI_ENABLE_THINKING',
    'OPENAI_REASONING_EFFORT',
    'OPENAI_MAX_TOKENS',
    'MTL_CODE_MAX_OUTPUT_TOKENS',
    MTL_CODE_MODEL_ENV_KEYS.maxContextTokens,
    MTL_CODE_MODEL_ENV_KEYS.uiContextWindow,
    MTL_CODE_MODEL_ENV_KEYS.effortLevel,
    MTL_CODE_MODEL_ENV_KEYS.subagentsEnabled,
    MTL_CODE_MODEL_ENV_KEYS.coordinatorMode,
  ].filter(Boolean);
  const sensitiveEnvKeys = new Set([
    ANTHROPIC_MODEL_ENV_KEYS.authToken,
    OPENAI_MODEL_ENV_KEYS.apiKey,
    'ANTHROPIC_API_KEY',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT_ID',
  ].filter(Boolean));
  const stableEnv = {};
  for (const key of stableEnvKeys) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      stableEnv[key] = sensitiveEnvKeys.has(key)
        ? hashMtlCodeDiagnosticValue(env[key])
        : env[key];
    }
  }

  return JSON.stringify({
    cwd: cwd ? path.resolve(cwd) : '',
    cliArgs: stableCliArgs,
    env: stableEnv,
  });
}

function canReuseMtlCodeSession(session, runtimeSignature) {
  const instance = session?.instance;
  return session?.status === 'active'
    && typeof runtimeSignature === 'string'
    && runtimeSignature.length > 0
    && instance?.runtimeSignature === runtimeSignature
    && typeof instance?.startTurn === 'function'
    && instance?.isClosed?.() !== true
    && instance?.isBusy?.() !== true;
}

function normalizePromptDebugCommand(value) {
  return typeof value === 'string' ? value : '';
}

function getCliArgValue(args = [], flag) {
  const index = args.indexOf(flag);
  return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : '';
}

function buildDumpSystemPromptArgs(cliArgs = []) {
  const args = ['--dump-system-prompt'];
  const model = getCliArgValue(cliArgs, '--model');
  if (model) {
    args.push('--model', model);
  }
  return args;
}

function runNativeSystemPromptDump(launch, cliArgs = [], childEnv = process.env, cwd = process.cwd()) {
  return new Promise((resolve) => {
    const args = [...launch.argsPrefix, ...buildDumpSystemPromptArgs(cliArgs)];
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout = setTimeout(() => {
      child?.kill?.('SIGTERM');
      finish('');
    }, parseInt(process.env.ARGUS_NATIVE_SYSTEM_PROMPT_DEBUG_TIMEOUT_MS || '5000', 10));

    try {
      child = spawn(launch.command, args, {
        cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: launch.shell,
      });
    } catch {
      finish('');
      return;
    }

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.once('error', () => finish(''));
    child.once('close', code => {
      if (code === 0 && stdout.trim()) {
        finish(stdout.trim());
        return;
      }
      if (stderr.trim()) {
        console.warn('[Argus] Native system prompt dump failed:', stderr.trim().split('\n').slice(-3).join('\n'));
      }
      finish('');
    });
  });
}

async function captureNativeSystemPrompt(launches = [], cliArgs = [], childEnv = process.env, cwd = process.cwd()) {
  for (const launch of launches) {
    const prompt = await runNativeSystemPromptDump(launch, cliArgs, childEnv, cwd);
    if (prompt) {
      return prompt;
    }
  }
  return '';
}

function buildPromptInjectionDebugPayload(options = {}, childEnv = process.env, cliArgs = [], commands = {}, nativeSystemPrompt = '', extras = {}) {
  const appendSystemPrompt = typeof options.appendSystemPrompt === 'string'
    ? options.appendSystemPrompt
    : '';
  const originalCommand = normalizePromptDebugCommand(
    commands.originalCommand || options.debugPromptInjectionOriginalCommand
  );
  const effectiveCommand = normalizePromptDebugCommand(commands.effectiveCommand);
  const permissionMode = normalizePermissionMode(resolveArgusPermissionMode(options));

  return {
    appendSystemPrompt,
    appendSystemPromptLength: appendSystemPrompt.length,
    nativeSystemPrompt,
    nativeSystemPromptLength: nativeSystemPrompt.length,
    originalCommand,
    effectiveCommand,
    effectiveCommandLength: effectiveCommand.length,
    commandChanged: Boolean(originalCommand && effectiveCommand && originalCommand !== effectiveCommand),
    permissionMode,
    codexStylePlanMode: Boolean(
      options.codexStylePlanMode
      || permissionMode === 'plan'
      || childEnv.MTL_CODE_CODEX_STYLE_PLAN_MODE === '1'
    ),
    coordinatorMode: Boolean(
      options.coordinatorMode === true
      || childEnv.MTL_CODE_COORDINATOR_MODE === '1'
    ),
    claudeNativeMemoryEnabled: isClaudeNativeMemoryEnabled(childEnv),
    autoMemoryExtractionEnabled: childEnv[MTL_CODE_MODEL_ENV_KEYS.autoMemoryExtractionEnabled] === '1',
    bareMode: shouldUseBareMode(childEnv),
    cli: {
      hasBareFlag: cliArgs.includes('--bare'),
      hasAppendSystemPromptFlag: cliArgs.includes('--append-system-prompt'),
    },
    argusInternal: extras.argusInternal,
  };
}

async function emitPromptInjectionDebug(ws, options = {}, childEnv = process.env, cliArgs = [], sessionId = null, commands = {}, nativeSystemPrompt = '', extras = {}) {
  if (options.debugPromptInjection !== true) {
    return;
  }

  ws.send(createNormalizedMessage({
    kind: 'status',
    text: 'prompt_injection_debug',
    provider: 'claude',
    sessionId,
    promptInjection: buildPromptInjectionDebugPayload(options, childEnv, cliArgs, commands, nativeSystemPrompt, extras),
  }));
}

function extractMtlCodeAssistantText(message = {}) {
  const content = message?.message?.role === 'assistant'
    ? message.message.content
    : message?.role === 'assistant'
      ? message.content
      : null;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(part => {
      if (part?.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function messageHasMtlCodeToolUse(message = {}) {
  if (message?.type === 'tool_use') {
    return true;
  }

  const content = message?.message?.content || message?.content;
  return Array.isArray(content) && content.some(part => part?.type === 'tool_use');
}

function getMtlCodeToolUses(message = {}) {
  const tools = [];
  if (message?.type === 'tool_use') {
    tools.push({
      name: message.toolName || message.name || '',
      input: message.toolInput || message.input || {},
    });
  }

  const content = message?.message?.content || message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'tool_use') {
        tools.push({
          name: part.name || part.toolName || '',
          input: part.input || part.toolInput || {},
        });
      }
    }
  }
  return tools;
}

function getMtlCodeToolUseNames(message = {}) {
  return getMtlCodeToolUses(message)
    .map(tool => (typeof tool.name === 'string' ? tool.name.trim() : ''))
    .filter(Boolean);
}

function getToolInputCommand(input = {}) {
  if (typeof input === 'string') {
    return input;
  }
  if (!input || typeof input !== 'object') {
    return '';
  }
  return [
    input.command,
    input.cmd,
    input.pattern,
    input.path,
    input.file_path,
  ].filter(value => typeof value === 'string' && value.trim()).join(' ');
}

function isRepositoryInspectionBashCommand(input = {}) {
  const command = getToolInputCommand(input).trim();
  if (!command) {
    return false;
  }

  return /(^|[;&|()\s])(?:git\s+(?:status|diff|show|log|ls-files|grep)|rg|grep|find|ls|dir|pwd|tree|cat|sed|nl|wc|Get-ChildItem|Select-String|Get-Content|Test-Path)\b/i.test(command);
}

function isRepositoryContentBashCommand(input = {}) {
  const command = getToolInputCommand(input).trim();
  if (!command) {
    return false;
  }

  return /(^|[;&|()\s])(?:git\s+(?:diff|show)|cat|sed|nl|Get-Content)\b/i.test(command);
}

function isRepositoryInspectionToolUse(tool = {}) {
  const name = String(tool.name || '').trim();
  if (/^(Read|Grep|Glob|LS|FileRead|View|NotebookRead)$/i.test(name)) {
    return true;
  }
  if (/^(Bash|Shell)$/i.test(name)) {
    return isRepositoryInspectionBashCommand(tool.input);
  }
  return false;
}

function messageHasMtlCodeRepositoryInspectionToolUse(message = {}) {
  return getMtlCodeToolUses(message).some(isRepositoryInspectionToolUse);
}

function isRepositoryContentToolUse(tool = {}) {
  const name = String(tool.name || '').trim();
  if (/^(Read|FileRead|View|NotebookRead)$/i.test(name)) {
    return true;
  }
  if (/^(Bash|Shell)$/i.test(name)) {
    return isRepositoryContentBashCommand(tool.input);
  }
  return false;
}

function messageHasMtlCodeRepositoryContentToolUse(message = {}) {
  return getMtlCodeToolUses(message).some(isRepositoryContentToolUse);
}

function getMtlCodeConfigDir() {
  return process.env.MTL_CODE_CONFIG_DIR || path.join(osHomedirFallback(), '.mtl-code');
}

const ANTHROPIC_RUNTIME_ENV_KEYS = [
  ANTHROPIC_MODEL_ENV_KEYS.authToken,
  ANTHROPIC_MODEL_ENV_KEYS.baseUrl,
  ANTHROPIC_MODEL_ENV_KEYS.model,
  ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel,
  ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel,
  ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel,
];

const OPENAI_RUNTIME_ENV_KEYS = [
  OPENAI_MODEL_ENV_KEYS.apiKey,
  OPENAI_MODEL_ENV_KEYS.baseUrl,
  OPENAI_MODEL_ENV_KEYS.model,
  OPENAI_MODEL_ENV_KEYS.defaultHaikuModel,
  OPENAI_MODEL_ENV_KEYS.defaultSonnetModel,
  OPENAI_MODEL_ENV_KEYS.defaultOpusModel,
];

function pruneInactiveProviderEnv(env) {
  if (env.MTL_CODE_USE_OPENAI === '1') {
    for (const key of ANTHROPIC_RUNTIME_ENV_KEYS) {
      delete env[key];
    }
    return;
  }
  if (env.MTL_CODE_USE_OPENAI === '0') {
    for (const key of OPENAI_RUNTIME_ENV_KEYS) {
      delete env[key];
    }
  }
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
      applySubagentRuntimeToEnv(
        runtimeEnv,
        readSubagentRuntimeConfig(settings || {}, runtimeEnv),
      );
      return runtimeEnv;
    }

    const env = Object.fromEntries(
      Object.entries(settings.env)
        .filter(([, value]) => typeof value === 'string' && value.length > 0)
    );
    pruneInactiveProviderEnv(env);
    if (env.MTL_CODE_USE_OPENAI !== '1') {
      repairAnthropicRuntimeModelEnv(env);
    }
    applyOpenMythosRuntimeToEnv(env, readOpenMythosRuntimeConfig(settings, env));
    applySubagentRuntimeToEnv(env, readSubagentRuntimeConfig(settings, env));
    return env;
  } catch {
    return {};
  }
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
    console.warn('[Argus] Failed to resolve session model profile:', error?.message || error);
    return null;
  });
  const spawnEnv = {
    ...process.env,
    ...settingsEnv,
    ...(modelRuntime?.env || {}),
    MTLCODE: '1',
    MTL_CODE_PROVIDER_MANAGED_BY_HOST: '1',
  };
  applyClaudeNativeMemoryEnv(spawnEnv);
  applyObsidianPrimaryMemoryEnv(spawnEnv, options);
  pruneInactiveProviderEnv(spawnEnv);
  if (normalizePermissionMode(resolveArgusPermissionMode(options)) === 'plan') {
    spawnEnv.MTL_CODE_CODEX_STYLE_PLAN_MODE = '1';
  }
  if (options.coordinatorMode === true) {
    spawnEnv.MTL_CODE_COORDINATOR_MODE = '1';
    spawnEnv[MTL_CODE_MODEL_ENV_KEYS.subagentsEnabled] = '1';
  } else if (!Object.prototype.hasOwnProperty.call(spawnEnv, 'MTL_CODE_COORDINATOR_MODE')) {
    spawnEnv.MTL_CODE_COORDINATOR_MODE = '0';
  }
  for (const key of [
    ANTHROPIC_MODEL_ENV_KEYS.model,
    ANTHROPIC_MODEL_ENV_KEYS.defaultHaikuModel,
    ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel,
    ANTHROPIC_MODEL_ENV_KEYS.defaultOpusModel,
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

  if (spawnEnv.MTL_CODE_USE_OPENAI !== '1') {
    applyAnthropicRuntimeModelDefaults(spawnEnv, {
      baseUrl: spawnEnv[ANTHROPIC_MODEL_ENV_KEYS.baseUrl] || '',
      model: spawnEnv[ANTHROPIC_MODEL_ENV_KEYS.model] || spawnEnv[ANTHROPIC_MODEL_ENV_KEYS.defaultSonnetModel] || '',
    });
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

function isMtlCodeSessionProcessAlive(session) {
  if (!session || session.status !== 'active') {
    return false;
  }

  const instance = session.instance;
  if (typeof instance?.isClosed === 'function' && instance.isClosed()) {
    return false;
  }

  return true;
}

function isMtlCodeSessionProcessing(session) {
  if (!isMtlCodeSessionProcessAlive(session)) {
    return false;
  }

  const instance = session.instance;
  if (typeof instance?.isBusy === 'function') {
    return instance.isBusy() === true;
  }

  return true;
}

function isMtlCodeUserAbort(child) {
  return child?._mtlCodeAborted === true;
}

function buildMtlCodeCloseFailureMessage({ code = null, signal = null, stderrLines = [] } = {}) {
  const stderrText = Array.isArray(stderrLines) ? stderrLines.slice(-12).join('\n') : '';
  if (stderrText.trim()) {
    const suffix = signal
      ? `\n\nArgus backend exited with signal ${signal}.`
      : (code ? `\n\nArgus backend exited with code ${code}.` : '');
    return `${stderrText}${suffix}`;
  }
  if (signal) {
    return `Argus backend exited with signal ${signal}`;
  }
  return `Argus backend exited with code ${code}`;
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

function reportHubUsageFromContextBudget({
  writer,
  options = {},
  sessionId,
  provider = 'claude',
  contextBudget,
}) {
  if (!contextBudget) return;
  try {
    const tokenBreakdown = extractTokenBreakdownFromContextBudget(contextBudget);
    hubUsageDb.recordUsage({
      ...tokenBreakdown,
      userId: writer?.userId ?? null,
      ipAddress: writer?.ipAddress || 'unknown',
      provider,
      sessionId,
      projectName: options.projectName || options.projectPath || options.cwd || null,
      usedMcp: hasRequestedMcpBindings(options),
      metadata: {
        model: contextBudget.window?.model || null,
        modelProfileId: contextBudget.window?.modelProfileId || options.modelProfileId || null,
        contextWindowTokens: contextBudget.window?.tokens || null,
      },
    });
  } catch (error) {
    console.warn('[HubUsage] Failed to record token usage:', error?.message || error);
  }
}

/**
 * Extracts context budget from Argus result messages.
 * @param {Object} resultMessage - SDK result message
 * @param {Object} options - Runtime options used to resolve the model window
 * @returns {Promise<Object|null>} Context budget object or null
 */
async function extractContextBudget(resultMessage, options = {}) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  return buildContextBudgetFromModelUsage(resultMessage, {
    modelProfileId: options.modelProfileId,
    contextWindowTokens: options.contextWindowTokens,
    env: process.env,
  });
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

function closeMtlCodePersistentSession(instanceOrChild, reason = 'closed') {
  const child = instanceOrChild?.child || instanceOrChild;
  if (!child || child._mtlCodePersistentClosing === true) {
    return false;
  }
  child._mtlCodePersistentClosing = true;
  logMtlCodeSessionLifecycle('session_close_requested', {
    reason,
    pid: child.pid,
    closed: child.killed || child.stdin?.destroyed === true,
  });

  if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
    writeMtlCodeJson(child, {
      type: 'control_request',
      request_id: createRequestId(),
      request: { subtype: 'end_session', reason }
    });
    const closeTimer = setTimeout(() => closeMtlCodeInput(child), 50);
    closeTimer.unref?.();
    return true;
  }

  if (!child.killed) {
    child.kill?.('SIGTERM');
    return true;
  }
  return false;
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
  const clientSessionId = typeof options.clientSessionId === 'string' ? options.clientSessionId.trim() : '';
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  let child = null;
  let childClosed = false;
  let runtimeSignature = '';
  let sessionInstance = null;
  let currentOptions = options;
  let currentWriter = ws;
  let currentCommand = command;
  let currentSessionSummary = sessionSummary;
  let currentTurnActive = false;
  let currentTurnResolve = null;
  let currentTurnTempImagePaths = [];
  let currentTurnTempDir = null;
  let currentTurnId = createRequestId();
  let currentTurnStartedAt = 0;
  let resultReceived = false;
  let nativeToolUseNames = [];
  let permissionRequestCount = 0;
  let assistantTextSeen = '';
  let promptDebugChildEnv = process.env;
  let promptDebugCliArgs = [];
  let promptDebugNativeSystemPrompt = '';
  let promptDebugEffectiveCommand = command;
  const stderrLines = [];

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: currentWriter?.userId || null,
      writer: currentWriter,
      event
    });
  };

  const completeCurrentTurn = async (exitCode = 0) => {
    if (!currentTurnActive) {
      return;
    }
    const durationMs = currentTurnStartedAt > 0 ? Date.now() - currentTurnStartedAt : undefined;
    const writer = currentWriter;
    const activeSessionId = currentOptions?.sessionId || sessionId || null;
    const completedCommand = currentCommand;
    const completedSummary = currentSessionSummary;
    const completedTempImagePaths = currentTurnTempImagePaths;
    const completedTempDir = currentTurnTempDir;

    currentTurnActive = false;
    currentTurnTempImagePaths = [];
    currentTurnTempDir = null;
    const resolveTurn = currentTurnResolve;
    currentTurnResolve = null;

    logMtlCodeSessionLifecycle('turn_complete', {
      turnId: currentTurnId,
      sessionId: capturedSessionId || activeSessionId || null,
      exitCode,
      resultReceived,
      durationMs,
    });
    writer?.send?.(createNormalizedMessage({
      kind: 'complete',
      exitCode,
      isNewSession: !activeSessionId && !!completedCommand,
      sessionId: capturedSessionId,
      provider: 'claude'
    }));
    notifyRunStopped({
      userId: writer?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || activeSessionId || null,
      sessionName: completedSummary,
      stopReason: 'completed'
    });
    await cleanupTempFiles(completedTempImagePaths, completedTempDir);
    resolveTurn?.();
  };

  const failCurrentTurn = async (content, error = null) => {
    if (!currentTurnActive) {
      return;
    }
    const durationMs = currentTurnStartedAt > 0 ? Date.now() - currentTurnStartedAt : undefined;
    const writer = currentWriter;
    const activeSessionId = currentOptions?.sessionId || sessionId || null;
    const failedSummary = currentSessionSummary;
    const failedTempImagePaths = currentTurnTempImagePaths;
    const failedTempDir = currentTurnTempDir;

    currentTurnActive = false;
    currentTurnTempImagePaths = [];
    currentTurnTempDir = null;
    const resolveTurn = currentTurnResolve;
    currentTurnResolve = null;

    logMtlCodeSessionLifecycle('turn_error', {
      turnId: currentTurnId,
      sessionId: capturedSessionId || activeSessionId || null,
      durationMs,
      error,
      errorMessage: content,
    });
    writer?.send?.(createNormalizedMessage({
      kind: 'error',
      content,
      sessionId: capturedSessionId || activeSessionId || null,
      provider: 'claude'
    }));
    notifyRunFailed({
      userId: writer?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || activeSessionId || null,
      sessionName: failedSummary,
      error: error || new Error(content)
    });
    await cleanupTempFiles(failedTempImagePaths, failedTempDir);
    resolveTurn?.();
  };

  const resetTurnState = (nextCommand, nextOptions = {}, nextWriter = ws, turnContext = {}) => {
    currentOptions = nextOptions;
    currentWriter = nextWriter;
    currentCommand = nextCommand;
    currentSessionSummary = nextOptions.sessionSummary;
    currentTurnTempImagePaths = Array.isArray(turnContext.tempImagePaths)
      ? turnContext.tempImagePaths
      : [];
    currentTurnTempDir = turnContext.tempDir || null;
    resultReceived = false;
    nativeToolUseNames = [];
    permissionRequestCount = 0;
    assistantTextSeen = '';
    promptDebugEffectiveCommand = nextCommand;
    currentTurnId = createRequestId();
    currentTurnStartedAt = Date.now();
    if (turnContext.childEnv) {
      promptDebugChildEnv = turnContext.childEnv;
    }
    if (Array.isArray(turnContext.cliArgs)) {
      promptDebugCliArgs = turnContext.cliArgs;
    }
    if (typeof turnContext.nativeSystemPrompt === 'string') {
      promptDebugNativeSystemPrompt = turnContext.nativeSystemPrompt;
    }
  };

  const startTurn = (nextCommand, nextOptions = {}, nextWriter = ws, turnContext = {}) => new Promise((resolve) => {
    if (currentTurnActive) {
      logMtlCodeSessionLifecycle('turn_busy', {
        sessionId: capturedSessionId || nextOptions?.sessionId || null,
        clientSessionId,
        busy: true,
      });
      nextWriter?.send?.(createNormalizedMessage({
        kind: 'error',
        content: 'The active Argus session is still processing the previous turn.',
        sessionId: capturedSessionId || nextOptions?.sessionId || null,
        provider: 'claude'
      }));
      void cleanupTempFiles(
        Array.isArray(turnContext.tempImagePaths) ? turnContext.tempImagePaths : [],
        turnContext.tempDir || null,
      );
      resolve();
      return;
    }

    resetTurnState(nextCommand, nextOptions, nextWriter, turnContext);
    logMtlCodeSessionLifecycle('turn_start', {
      turnId: currentTurnId,
      sessionId: capturedSessionId || nextOptions?.sessionId || null,
      clientSessionId,
      command: nextCommand,
      runtimeSignature,
      synthetic: turnContext.synthetic === true,
    });

    if (!nextCommand || !String(nextCommand).trim()) {
      logMtlCodeSessionLifecycle('turn_empty', {
        turnId: currentTurnId,
        sessionId: capturedSessionId || nextOptions?.sessionId || null,
      });
      currentTurnActive = true;
      currentTurnResolve = resolve;
      void completeCurrentTurn(0);
      return;
    }

    if (childClosed || !child || child.stdin?.destroyed || !child.stdin?.writable) {
      logMtlCodeSessionLifecycle('stdin_write_failed', {
        turnId: currentTurnId,
        sessionId: capturedSessionId || nextOptions?.sessionId || null,
        closed: childClosed || child?.stdin?.destroyed === true,
      });
      currentTurnActive = true;
      currentTurnResolve = resolve;
      void failCurrentTurn('The active Argus backend input stream is no longer writable.');
      return;
    }

    currentTurnActive = true;
    currentTurnResolve = resolve;
    const written = writeMtlCodeJson(child, createMtlCodeUserMessage(nextCommand, nextOptions.clientMessageId));
    logMtlCodeSessionLifecycle('stdin_write', {
      turnId: currentTurnId,
      sessionId: capturedSessionId || nextOptions?.sessionId || null,
      clientSessionId,
      synthetic: turnContext.synthetic === true,
      written,
      command: nextCommand,
    });
    if (!written) {
      void failCurrentTurn('The active Argus backend input stream is no longer writable.');
    }
  });

  const createSessionInstance = (mtlCodeChild) => ({
    child: mtlCodeChild,
    runtimeSignature,
    startTurn: startTurn,
    isBusy: () => currentTurnActive,
    isClosed: () => childClosed || mtlCodeChild.killed || mtlCodeChild.stdin?.destroyed === true,
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
    },
    close: (reason = 'closed') => closeMtlCodePersistentSession(mtlCodeChild, reason),
  });

  const registeredSessionIds = new Set();
  const registerSession = (sessionKey) => {
    if (!sessionKey) {
      return;
    }
    if (!sessionInstance && child) {
      sessionInstance = createSessionInstance(child);
    }
    addSession(sessionKey, sessionInstance, tempImagePaths, tempDir, currentWriter);
    registeredSessionIds.add(sessionKey);
  };
  const unregisterSession = (sessionKey) => {
    if (!sessionKey) {
      return;
    }
    removeSession(sessionKey);
    registeredSessionIds.delete(sessionKey);
  };
  const cleanupRegisteredSessions = () => {
    for (const sessionKey of registeredSessionIds) {
      removeSession(sessionKey);
    }
    registeredSessionIds.clear();
  };
  const ensureSessionRegistered = (messageSessionId) => {
    if (!messageSessionId || capturedSessionId === messageSessionId) {
      return;
    }

    capturedSessionId = messageSessionId;
    registerSession(capturedSessionId);
    logMtlCodeSessionLifecycle('session_captured', {
      turnId: currentTurnId,
      sessionId: capturedSessionId,
      clientSessionId,
    });
    if (clientSessionId && clientSessionId !== capturedSessionId) {
      unregisterSession(clientSessionId);
    }

    if (currentWriter.setSessionId && typeof currentWriter.setSessionId === 'function') {
      currentWriter.setSessionId(capturedSessionId);
    }

    if (!currentOptions?.sessionId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      currentWriter.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
    }
  };

  const handleControlRequest = async (message) => {
    const request = message.request || {};
    if (request.subtype !== 'can_use_tool') {
      writeMtlCodeJson(child, buildUnsupportedControlResponse(
        message,
        `Unsupported Argus control request subtype: ${request.subtype || 'unknown'}`
      ));
      return;
    }

    const requestId = message.request_id;
    const toolName = request.tool_name || 'UnknownTool';
    const input = request.input || {};
    const sid = capturedSessionId || currentOptions?.sessionId || sessionId || null;
    const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
    const configuredDecision = resolveConfiguredToolDecision(toolName, input, currentOptions, runtimeToolSettings);
    permissionRequestCount += 1;

    if (configuredDecision) {
      logMtlCodeSessionLifecycle('permission_auto_decision', {
        turnId: currentTurnId,
        sessionId: sid,
        requestId,
        toolName,
        autoAllowed: configuredDecision.allow === true,
      });
      writeMtlCodeJson(child, buildPermissionControlResponse(message, configuredDecision));
      return;
    }

    logMtlCodeSessionLifecycle('permission_request', {
      turnId: currentTurnId,
      sessionId: sid,
      requestId,
      toolName,
    });

    currentWriter.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: sid, provider: 'claude' }));
    emitNotification(createNotificationEvent({
      provider: 'claude',
      sessionId: sid,
      kind: 'action_required',
      code: 'permission.required',
      meta: { toolName, sessionName: currentSessionSummary },
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
        currentWriter.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: sid, provider: 'claude' }));
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
      console.warn('[Argus] Non-JSON stdout:', line);
      return;
    }

    ensureSessionRegistered(message.session_id);

    const messageToolUseNames = getMtlCodeToolUseNames(message);
    if (messageToolUseNames.length > 0) {
      nativeToolUseNames.push(...messageToolUseNames);
    }
    const assistantText = extractMtlCodeAssistantText(message);
    if (assistantText) {
      assistantTextSeen = assistantTextSeen
        ? `${assistantTextSeen}\n${assistantText}`
        : assistantText;
    }

    if (message.type === 'control_request') {
      await handleControlRequest(message);
      return;
    }

    const transformedMessage = transformMessage(message);
    const sid = capturedSessionId || currentOptions?.sessionId || sessionId || null;
    const normalized = sessionsService.normalizeMessage('claude', transformedMessage, sid);
    for (const msg of normalized) {
      if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
        msg.parentToolUseId = transformedMessage.parentToolUseId;
      }
      currentWriter.send(msg);
    }

    if (message.type === 'result') {
      resultReceived = true;
      const contextBudget = await extractContextBudget(message, currentOptions);
      const tokenBudgetData = toLegacyTokenBudget(contextBudget);
      if (contextBudget && tokenBudgetData) {
        currentWriter.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', contextBudget, tokenBudget: tokenBudgetData, sessionId: sid, provider: 'claude' }));
      }
      reportHubUsageFromContextBudget({
        writer: currentWriter,
        options: currentOptions,
        sessionId: sid,
        provider: 'claude',
        contextBudget,
      });
      const stopReason = typeof message.stop_reason === 'string'
        ? message.stop_reason
        : (typeof message.stopReason === 'string' ? message.stopReason : '');
      const parsedNumTurns = Number(message.num_turns ?? message.numTurns);
      logMtlCodeSessionLifecycle('result_received', {
        turnId: currentTurnId,
        sessionId: sid,
        resultReceived,
        sawToolUse: nativeToolUseNames.length > 0,
        toolUseNames: nativeToolUseNames,
        permissionRequestCount,
        stopReason,
        numTurns: Number.isFinite(parsedNumTurns) ? parsedNumTurns : undefined,
        apiProvider: getMtlCodeApiProvider(promptDebugChildEnv),
        requestModel: getMtlCodeRequestModel(promptDebugChildEnv),
        assistantText: assistantTextSeen,
      });
      await completeCurrentTurn(0);
    }
  };

  try {
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    promptDebugEffectiveCommand = finalCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    const launches = resolveMtlCodeLaunches();
    const cwd = resolveWorkingDirectory(options.cwd || options.projectPath);
    const permission = evaluateRuntimePermission({
      command: 'argus-backend',
      cwd,
      projectPath: options.projectPath || options.cwd || cwd,
      operation: 'argus-backend',
    });
    if (!permission.allowed) {
      throw new Error(permission.reason || 'Argus backend spawn is not allowed by runtime permissions');
    }
    const childEnv = await buildMtlCodeSpawnEnv(options);
    let spawnOptions = options;
    let cliArgs = buildMtlCodeArgs(spawnOptions, childEnv);
    runtimeSignature = buildMtlCodeRuntimeSignature({ cwd, cliArgs, env: childEnv });
    promptDebugChildEnv = childEnv;
    promptDebugCliArgs = cliArgs;
    const reuseSessionKey = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : clientSessionId;
    const existingSession = reuseSessionKey ? getSession(reuseSessionKey) : null;
    const captureAndEmitPromptDebug = async (activeOptions, activeCliArgs) => {
      const nativeSystemPrompt = activeOptions.debugPromptInjection === true
        ? await captureNativeSystemPrompt(launches, activeCliArgs, childEnv, cwd)
        : '';
      promptDebugNativeSystemPrompt = nativeSystemPrompt;
      promptDebugCliArgs = activeCliArgs;
      await emitPromptInjectionDebug(
        ws,
        activeOptions,
        childEnv,
        activeCliArgs,
        capturedSessionId || activeOptions.sessionId || clientSessionId || null,
        {
          originalCommand: activeOptions.debugPromptInjectionOriginalCommand || command,
          effectiveCommand: finalCommand,
        },
        nativeSystemPrompt,
      );
      return nativeSystemPrompt;
    };

    if (canReuseMtlCodeSession(existingSession, runtimeSignature)) {
      const nativeSystemPrompt = await captureAndEmitPromptDebug(options, cliArgs);
      logMtlCodeSessionLifecycle('session_reuse', {
        sessionId,
        clientSessionId,
        reuseSessionKey,
        cwd,
        runtimeSignature,
        cliArgs,
        effectiveCommand: finalCommand,
      });
      await existingSession.instance.startTurn(finalCommand, options, ws, {
        tempImagePaths,
        tempDir,
        synthetic: options.argusSyntheticInitialMessage === true,
        childEnv,
        cliArgs,
        nativeSystemPrompt,
      });
      return;
    }

    if (existingSession?.instance?.runtimeSignature === runtimeSignature
      && existingSession?.instance?.isBusy?.() === true) {
      logMtlCodeSessionLifecycle('session_busy', {
        sessionId,
        clientSessionId,
        reuseSessionKey,
        busy: true,
        runtimeSignature,
      });
      ws.send(createNormalizedMessage({
        kind: 'error',
        content: 'The active Argus session is still processing the previous turn.',
        sessionId: reuseSessionKey || null,
        provider: 'claude'
      }));
      await cleanupTempFiles(tempImagePaths, tempDir);
      return;
    }

    if (existingSession?.instance?.runtimeSignature) {
      logMtlCodeSessionLifecycle('session_runtime_changed', {
        sessionId,
        clientSessionId,
        reuseSessionKey,
        runtimeSignature,
        resumeSuppressedForRuntimeChange: true,
      });
      closeMtlCodePersistentSession(existingSession.instance, 'runtime_changed');
      removeSession(reuseSessionKey);
      spawnOptions = createMtlCodeFreshSessionOptionsForRuntimeChange(options);
      capturedSessionId = null;
      sessionCreatedSent = false;
      cliArgs = buildMtlCodeArgs(spawnOptions, childEnv);
      runtimeSignature = buildMtlCodeRuntimeSignature({ cwd, cliArgs, env: childEnv });
      promptDebugCliArgs = cliArgs;
    }

    const nativeSystemPrompt = await captureAndEmitPromptDebug(spawnOptions, cliArgs);

    let lastSpawnError = null;

    for (const launch of launches) {
      const args = [...launch.argsPrefix, ...cliArgs];
      console.log('[Argus] Starting backend:', launch.displayCommand);
      logMtlCodeSessionLifecycle('spawn_attempt', {
        sessionId: spawnOptions.sessionId,
        clientSessionId,
        cwd,
        launch: launch.displayCommand,
        runtimeSignature,
        cliArgs,
        apiProvider: getMtlCodeApiProvider(childEnv),
        requestModel: getMtlCodeRequestModel(childEnv),
        effectiveCommand: finalCommand,
        resumeSuppressedForRuntimeChange: spawnOptions.sessionId !== sessionId,
      });
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
          `[Argus] Failed to spawn ${launch.displayCommand}; trying next backend candidate:`,
          spawnError?.message || spawnError
        );
        continue;
      }

      try {
        await waitForMtlCodeSpawn(candidateChild);
        child = candidateChild;
        logMtlCodeSessionLifecycle('spawn_started', {
          sessionId: spawnOptions.sessionId,
          clientSessionId,
          cwd,
          launch: launch.displayCommand,
          pid: child.pid,
          runtimeSignature,
          apiProvider: getMtlCodeApiProvider(childEnv),
          requestModel: getMtlCodeRequestModel(childEnv),
        });
        break;
      } catch (spawnError) {
        lastSpawnError = spawnError;
        console.warn(
          `[Argus] Failed to start ${launch.displayCommand}; trying next backend candidate:`,
          spawnError?.message || spawnError
        );
        candidateChild.kill?.('SIGTERM');
      }
    }

    if (!child) {
      throw lastSpawnError || new Error('No usable Argus backend candidate found');
    }

    sessionInstance = createSessionInstance(child);

    if (spawnOptions.sessionId || clientSessionId) {
      registerSession(capturedSessionId || clientSessionId);
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
    let stdoutProcessing = Promise.resolve();
    const queueStdoutLine = (line) => {
      stdoutProcessing = stdoutProcessing
        .then(() => handleStdoutLine(line))
        .catch(error => {
          console.warn('[Argus] Failed to process stdout line:', error?.message || error);
        });
      return stdoutProcessing;
    };
    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        queueStdoutLine(line);
      }
    });

    const childClosePromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => {
        childClosed = true;
        resolve({ code: exitCode, signal: exitSignal });
      });
    });

    void childClosePromise
      .then(async ({ code, signal }) => {
        if (stdoutBuffer.trim()) {
          queueStdoutLine(stdoutBuffer);
          stdoutBuffer = '';
        }
        await stdoutProcessing;
        logMtlCodeSessionLifecycle('child_close', {
          turnId: currentTurnId,
          sessionId: capturedSessionId || currentOptions?.sessionId || sessionId || null,
          clientSessionId,
          pid: child.pid,
          exitCode: code ?? undefined,
          signal,
          resultReceived,
          currentTurnActive,
          stderrTailCount: stderrLines.length,
        });

        cleanupRegisteredSessions();

        const aborted = isMtlCodeUserAbort(child);
        const failedWithoutResult = !aborted && currentTurnActive && !resultReceived && (Boolean(signal) || Boolean(code && code !== 0));
        if (failedWithoutResult) {
          const message = buildMtlCodeCloseFailureMessage({ code, signal, stderrLines });
          await failCurrentTurn(message, new Error(message));
          return;
        }

        if (currentTurnActive) {
          if (aborted) {
            const resolveTurn = currentTurnResolve;
            currentTurnActive = false;
            currentTurnResolve = null;
            await cleanupTempFiles(currentTurnTempImagePaths, currentTurnTempDir);
            currentTurnTempImagePaths = [];
            currentTurnTempDir = null;
            resolveTurn?.();
          } else {
            await completeCurrentTurn(code ?? 0);
          }
        }
      })
      .catch(async (error) => {
        console.error('Argus backend close handler error:', error);
        if (currentTurnActive) {
          await failCurrentTurn(error.message || 'Argus backend closed unexpectedly.', error);
        }
      });

    await startTurn(finalCommand, spawnOptions, ws, {
      tempImagePaths,
      tempDir,
      synthetic: spawnOptions.argusSyntheticInitialMessage === true,
      childEnv,
      cliArgs,
      nativeSystemPrompt,
    });
    return;
  } catch (error) {
    console.error('Argus query error:', error);

    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    cleanupRegisteredSessions();
    await cleanupTempFiles(tempImagePaths, tempDir);

    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? `Argus backend is not installed or not on PATH. Build/link Argus, or set MTL_CODE_CLI_PATH. Current fallback: ${resolveMtlCodeCliPath()}`
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
  throw new Error('Legacy query path is disabled; use Argus direct execution.');
};

function mapCliOptionsToSDK() {
  throw new Error('Legacy query option mapping is disabled; use Argus direct execution.');
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
        const contextBudget = await extractContextBudget(message, options);
        const tokenBudgetData = toLegacyTokenBudget(contextBudget);
        if (contextBudget && tokenBudgetData) {
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', contextBudget, tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
        reportHubUsageFromContextBudget({
          writer: ws,
          options,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'claude',
          contextBudget,
        });
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
    console.error('Argus legacy query path error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files on error
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Check if Argus CLI is installed for a clearer error message
    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? `Argus backend is not installed or not on PATH. Install/link mtl-code, or set MTL_CODE_CLI_PATH. Current fallback: ${resolveMtlCodeCliPath()}`
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
 * Sends an additional user guidance message into an active Argus session.
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
 * Requests that the running MTL-Code backend stop one background task.
 * This uses the same SDK control_request channel as the native TaskStop tool.
 * @param {string} sessionId - Active session identifier
 * @param {string} taskId - Background task id
 * @returns {{success: boolean, error?: string}}
 */
function stopClaudeSDKTask(sessionId, taskId) {
  return sendClaudeSDKTaskControl(sessionId, { action: 'stop', taskId });
}

function getSupportedDirectSubagentActions() {
  const actions = new Set(['stop']);
  const configured = String(process.env.MTL_CODE_SUBAGENT_DIRECT_CONTROL_ACTIONS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (process.env.MTL_CODE_EXPERIMENTAL_SUBAGENT_DIRECT_CONTROL === '1') {
    configured.push('wait', 'send', 'followup');
  }
  for (const action of configured) {
    if (['wait', 'send', 'followup', 'stop'].includes(action)) {
      actions.add(action);
    }
  }
  return Array.from(actions);
}

/**
 * Sends a direct subagent task control request to the active Argus backend.
 * Current stable Argus backends support stop_task; wait/send/followup are
 * future-compatible and fall back through the server when unsupported.
 * @param {string} sessionId - Active session identifier
 * @param {{action: string, taskId: string, content?: string}} control - Task control request
 * @returns {{success: boolean, unsupported?: boolean, error?: string, requestId?: string}}
 */
function sendClaudeSDKTaskControl(sessionId, control = {}) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';

  if (!normalizedSessionId) {
    return { success: false, error: 'No active session id is available.' };
  }
  if (!control?.taskId || typeof control.taskId !== 'string' || !control.taskId.trim()) {
    return { success: false, error: 'No task id was provided.' };
  }

  const session = getSession(normalizedSessionId);
  if (!session || session.status !== 'active') {
    return { success: false, error: `Session ${normalizedSessionId} is not active.` };
  }

  const child = session.instance?.child;
  if (!child) {
    return { success: false, error: 'The active backend does not support task control.' };
  }

  const requestId = createRequestId();
  const payload = buildSubagentDirectControlPayload(
    { ...control, sessionId: normalizedSessionId },
    requestId,
    { supportedDirectActions: getSupportedDirectSubagentActions() },
  );
  if (!payload) {
    return {
      success: false,
      unsupported: true,
      error: `Direct subagent control action is unsupported: ${control.action || 'unknown'}`,
    };
  }

  const written = writeMtlCodeJson(child, payload);

  return written
    ? { success: true, requestId }
    : { success: false, error: 'The active backend input stream is no longer writable.' };
}

/**
 * Checks if an SDK session is currently processing a turn.
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if the session is processing
 */
function isClaudeSDKSessionActive(sessionId) {
  return isMtlCodeSessionProcessing(getSession(sessionId));
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
  stopClaudeSDKTask,
  sendClaudeSDKTaskControl,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter,
  isMtlCodeUserAbort,
  buildMtlCodeCloseFailureMessage,
  buildMtlCodeArgs,
  buildMtlCodeSessionLogPayload,
  buildMtlCodeRuntimeSignature,
  canReuseMtlCodeSession,
  createMtlCodeFreshSessionOptionsForRuntimeChange,
  isMtlCodeSessionProcessing,
  closeMtlCodePersistentSession,
  getMtlCodeToolUseNames,
  messageHasMtlCodeRepositoryContentToolUse,
  messageHasMtlCodeRepositoryInspectionToolUse
};
