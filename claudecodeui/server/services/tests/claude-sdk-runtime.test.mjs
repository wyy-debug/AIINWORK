import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';

import {
  buildMtlCodeArgs,
  buildMtlCodeSessionLogPayload,
  buildMtlCodeRuntimeSignature,
  buildOpenAIScreenshotAnalysisMessages,
  canReuseMtlCodeSession,
  createMtlCodeFreshSessionOptionsForRuntimeChange,
  getMtlCodeToolUseNames,
  isMtlCodeSessionProcessing,
  messageHasMtlCodeRepositoryContentToolUse,
  messageHasMtlCodeRepositoryInspectionToolUse,
  analyzeScreenshotImagesWithOpenAI,
  appendScreenshotVisionAnalysis,
  resolveMtlCodeCanonicalSessionRegistration,
} from '../../claude-sdk.js';

test('Argus host allow rules do not narrow native Claude Code tools in normal modes', () => {
  const args = buildMtlCodeArgs({
    permissionMode: 'default',
    toolsSettings: {
      allowedTools: ['spawn_agent'],
      disallowedTools: [],
      skipPermissions: false,
    },
  }, { MTL_CODE_UI_BARE: '0' });

  assert.equal(args.includes('--allowedTools'), false);

  const acceptEditsArgs = buildMtlCodeArgs({
    permissionMode: 'acceptEdits',
    toolsSettings: {
      allowedTools: ['spawn_agent'],
      disallowedTools: [],
      skipPermissions: false,
    },
  }, { MTL_CODE_UI_BARE: '0' });

  assert.equal(acceptEditsArgs.includes('--allowedTools'), false);
  assert.equal(acceptEditsArgs.includes('--permission-mode'), true);
  assert.equal(acceptEditsArgs[acceptEditsArgs.indexOf('--permission-mode') + 1], 'acceptEdits');
});

test('Argus plan mode still constrains the native Claude Code tool surface', () => {
  const args = buildMtlCodeArgs({
    permissionMode: 'plan',
    toolsSettings: {
      allowedTools: ['spawn_agent'],
      disallowedTools: [],
      skipPermissions: false,
    },
  }, { MTL_CODE_UI_BARE: '0' });

  assert.equal(args.includes('--allowedTools'), false);
  assert.equal(args.includes('--tools'), true);
});

test('Argus session lifecycle log payload redacts prompts and hashes runtime signatures', () => {
  const payload = buildMtlCodeSessionLogPayload('turn_start', {
    command: '检查这个仓库里 token=secret 的实现',
    runtimeSignature: '{"cwd":"E:/repo","env":{"ANTHROPIC_API_KEY":"secret"}}',
    cwd: 'E:/repo',
    sessionId: 'session-1',
    clientSessionId: 'client-1',
    childEnv: { ANTHROPIC_API_KEY: 'secret' },
    cliArgs: ['--print', '--append-system-prompt', 'private prompt'],
  });

  assert.equal(payload.event, 'turn_start');
  assert.equal(payload.commandLength, '检查这个仓库里 token=secret 的实现'.length);
  assert.equal(payload.cwd, 'E:/repo');
  assert.equal(payload.sessionId, 'session-1');
  assert.equal(payload.clientSessionId, 'client-1');
  assert.match(payload.runtimeSignatureHash, /^[a-f0-9]{12}$/);
  assert.deepEqual(payload.cliFlags, ['--print', '--append-system-prompt']);
  assert.equal(Object.hasOwn(payload, 'command'), false);
  assert.equal(Object.hasOwn(payload, 'runtimeSignature'), false);
  assert.equal(Object.hasOwn(payload, 'childEnv'), false);
  assert.equal(Object.hasOwn(payload, 'cliArgs'), false);
});

test('Argus result diagnostics expose native stop, turn, tool, and permission state', () => {
  const payload = buildMtlCodeSessionLogPayload('result_received', {
    resultReceived: true,
    sawToolUse: true,
    stopReason: 'end_turn',
    numTurns: 2,
    toolUseNames: ['Read', 'Grep', 'Read'],
    permissionRequestCount: 1,
    apiProvider: 'openai-compatible',
    requestModel: 'gpt-5.5',
    assistantText: 'private model output',
  });

  assert.equal(payload.stopReason, 'end_turn');
  assert.equal(payload.numTurns, 2);
  assert.deepEqual(payload.toolUseNames, ['Read', 'Grep', 'Read']);
  assert.equal(payload.permissionRequestCount, 1);
  assert.equal(payload.apiProvider, 'openai-compatible');
  assert.equal(payload.requestModel, 'gpt-5.5');
  assert.equal(payload.assistantTextLength, 'private model output'.length);
  assert.equal(Object.hasOwn(payload, 'assistantText'), false);
});

test('Argus screenshot vision bridge builds OpenAI-compatible image_url messages', () => {
  const messages = buildOpenAIScreenshotAnalysisMessages({
    command: 'Tell me what is wrong in this screenshot',
    images: [
      { data: 'data:image/png;base64,abc123' },
      { data: 'data:image/jpeg;base64,def456' },
    ],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content[0].type, 'text');
  assert.match(messages[0].content[0].text, /Tell me what is wrong/);
  assert.equal(messages[0].content[1].type, 'image_url');
  assert.equal(messages[0].content[1].image_url.url, 'data:image/png;base64,abc123');
  assert.equal(messages[0].content[2].type, 'image_url');
  assert.equal(messages[0].content[2].image_url.url, 'data:image/jpeg;base64,def456');
});

test('Argus screenshot vision bridge calls OpenAI-compatible chat completions and returns analysis', async () => {
  let requestedUrl = '';
  let requestedBody = null;
  let authorization = '';

  const result = await analyzeScreenshotImagesWithOpenAI({
    command: 'Analyze the UI',
    images: [{ data: 'data:image/png;base64,abc123' }],
    env: {
      MTL_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://token.wd.com/v1',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'glm-5',
    },
    fetchImpl: async (url, init) => {
      requestedUrl = url;
      requestedBody = JSON.parse(init.body);
      authorization = init.headers.Authorization;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'The screenshot shows a disabled send button.' } }] }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.analysis, 'The screenshot shows a disabled send button.');
  assert.equal(requestedUrl, 'http://token.wd.com/v1/chat/completions');
  assert.equal(authorization, 'Bearer sk-test');
  assert.equal(requestedBody.model, 'glm-5');
  assert.equal(requestedBody.messages[0].content[1].image_url.url, 'data:image/png;base64,abc123');
});

test('Argus screenshot vision bridge falls back when OpenAI runtime is unavailable', async () => {
  const result = await analyzeScreenshotImagesWithOpenAI({
    command: 'Analyze',
    images: [{ data: 'data:image/png;base64,abc123' }],
    env: { MTL_CODE_USE_OPENAI: '0' },
    fetchImpl: async () => {
      throw new Error('should not fetch');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'openai_runtime_unavailable');
});

test('Argus screenshot vision analysis is appended to the agent prompt', () => {
  const command = appendScreenshotVisionAnalysis('Fix this UI', 'The screenshot shows the send button is disabled.');

  assert.match(command, /Fix this UI/);
  assert.match(command, /Screenshot analysis/);
  assert.match(command, /send button is disabled/);
});

test('Argus direct close handling treats only explicit user abort as aborted', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function isMtlCodeUserAbort/);
  assert.match(source, /child\?\._mtlCodeAborted === true|child\._mtlCodeAborted === true/);
  assert.doesNotMatch(source, /Boolean\(child\._mtlCodeAborted \|\| signal\)/);
  assert.match(source, /buildMtlCodeCloseFailureMessage/);
  assert.match(source, /Argus backend exited with signal/);
});

test('Argus runtime no longer injects retired coordinator dispatch environment', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.doesNotMatch(source, /options\.coordinatorMode === true/);
  assert.doesNotMatch(source, /MTL_CODE_COORDINATOR_MODE/);
  assert.doesNotMatch(source, /MTL_CODE_SUBAGENTS_ENABLED/);
});

test('Claude native memory stays enabled without retired storage overrides', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function isClaudeNativeMemoryEnabled/);
  assert.match(source, /function applyClaudeNativeMemoryEnv/);
  assert.match(source, /spawnEnv\.MTL_CODE_UI_BARE = '0'/);
  assert.match(source, /spawnEnv\[MTL_CODE_MODEL_ENV_KEYS\.autoMemoryExtractionEnabled\] = '1'/);
  assert.match(source, /delete spawnEnv\.MTL_CODE_SIMPLE/);
  assert.match(source, /delete spawnEnv\.MTL_CODE_DISABLE_AUTO_MEMORY/);
  assert.match(source, /delete spawnEnv\[MTL_CODE_MODEL_ENV_KEYS\.autoMemoryExtractionEnabled\]/);
  assert.match(source, /spawnEnv\.MTL_CODE_DISABLE_AUTO_MEMORY = '1'/);
  assert.doesNotMatch(source, /function apply.*TemplateOnlyMemoryEnv/);
  assert.doesNotMatch(source, /function apply.*NativeMemorySyncEnv/);
  assert.doesNotMatch(source, /CLAUDE_COWORK_MEMORY_PATH_OVERRIDE/);
});

test('Argus emits prompt injection debug payload from final spawn env and CLI args', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function buildPromptInjectionDebugPayload/);
  assert.match(source, /function captureNativeSystemPrompt/);
  assert.match(source, /text:\s*'prompt_injection_debug'/);
  assert.match(source, /appendSystemPromptLength/);
  assert.match(source, /nativeSystemPrompt/);
  assert.match(source, /nativeSystemPromptLength/);
  assert.match(source, /originalCommand/);
  assert.match(source, /effectiveCommand/);
  assert.match(source, /commandChanged/);
  assert.match(source, /claudeNativeMemoryEnabled:\s*isClaudeNativeMemoryEnabled\(childEnv\)/);
  assert.match(source, /autoMemoryExtractionEnabled:\s*childEnv\[MTL_CODE_MODEL_ENV_KEYS\.autoMemoryExtractionEnabled\] === '1'/);
  assert.match(source, /bareMode:\s*shouldUseBareMode\(childEnv\)/);
  assert.match(source, /hasBareFlag:\s*cliArgs\.includes\('--bare'\)/);
  assert.match(source, /hasAppendSystemPromptFlag:\s*cliArgs\.includes\('--append-system-prompt'\)/);
  assert.match(source, /const captureAndEmitPromptDebug = async \(activeOptions,\s*activeCliArgs\) =>/);
  assert.match(source, /emitPromptInjectionDebug\(\s*ws,\s*activeOptions,\s*childEnv,\s*activeCliArgs,\s*capturedSessionId \|\| activeOptions\.sessionId \|\| clientSessionId \|\| null,/);
  assert.match(source, /effectiveCommand:\s*finalCommand/);
});

test('Argus direct stream-json launches as a persistent replayable session', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /'--replay-user-messages'/);
  assert.match(source, /function buildMtlCodeRuntimeSignature/);
  assert.match(source, /function canReuseMtlCodeSession/);
  assert.match(source, /startTurn:/);
  assert.match(source, /completeCurrentTurn/);
  assert.match(source, /closeMtlCodePersistentSession/);
  assert.doesNotMatch(source, /if \(message\.type === 'result'\)[\s\S]{0,200}closeMtlCodeInput\(child\);/);
});

test('Argus persistent session lifecycle has diagnostic logs at breakpoints', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  for (const event of [
    'spawn_attempt',
    'spawn_started',
    'session_reuse',
    'session_runtime_changed',
    'turn_start',
    'stdin_write',
    'result_received',
    'turn_complete',
    'child_close',
  ]) {
    assert.match(source, new RegExp(`logMtlCodeSessionLifecycle\\('${event}'`));
  }
});

test('Argus configured permission decisions use distinct lifecycle diagnostics', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');
  const handlerStart = source.indexOf('const handleControlRequest = async (message) => {');
  const handlerEnd = source.indexOf('const handleStdoutLine = async (line) => {', handlerStart);
  const handlerBlock = source.slice(handlerStart, handlerEnd);
  const configuredStart = handlerBlock.indexOf('if (configuredDecision) {');
  const configuredEnd = handlerBlock.indexOf('writeMtlCodeJson(child, buildPermissionControlResponse', configuredStart);
  const configuredBlock = handlerBlock.slice(configuredStart, configuredEnd);

  assert.match(configuredBlock, /logMtlCodeSessionLifecycle\('permission_auto_decision'/);
  assert.doesNotMatch(configuredBlock, /logMtlCodeSessionLifecycle\('permission_request'/);
  assert.match(source, /'autoAllowed'/);
});

test('Argus pure native tool path does not inject hidden fallback or server preflight turns', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.doesNotMatch(source, /fallback_injected/);
  assert.doesNotMatch(source, /preflight_injected/);
  assert.doesNotMatch(source, /post_preflight_prompt_injected/);
  assert.doesNotMatch(source, /createMtlCodeSyntheticUserMessage/);
  assert.doesNotMatch(source, /runArgusInspectionPreflight/);
  assert.doesNotMatch(source, /shouldSendCodeReviewToolFallback/);
  assert.doesNotMatch(source, /shouldSendToolInspectionFallback/);
});

test('Argus runtime signatures only reuse compatible live sessions', () => {
  const signature = buildMtlCodeRuntimeSignature({
    cwd: 'E:/repo',
    cliArgs: ['--print', '--model', 'sonnet', '--append-system-prompt', 'A'],
    env: { MTL_CODE_UI_BARE: '0', ANTHROPIC_MODEL: 'sonnet' },
  });

  assert.equal(canReuseMtlCodeSession({
    status: 'active',
    instance: {
      runtimeSignature: signature,
      isClosed: () => false,
      isBusy: () => false,
      startTurn: () => Promise.resolve(),
    },
  }, signature), true);

  assert.equal(canReuseMtlCodeSession({
    status: 'active',
    instance: {
      runtimeSignature: signature,
      isClosed: () => false,
      isBusy: () => false,
      startTurn: () => Promise.resolve(),
    },
  }, buildMtlCodeRuntimeSignature({
    cwd: 'E:/repo',
    cliArgs: ['--print', '--model', 'sonnet', '--append-system-prompt', 'B'],
    env: { MTL_CODE_UI_BARE: '0', ANTHROPIC_MODEL: 'sonnet' },
  })), false);
});

test('Argus runtime signatures ignore resume ids for persistent process reuse', () => {
  const firstLaunch = buildMtlCodeRuntimeSignature({
    cwd: 'E:/repo',
    cliArgs: ['--print', '--input-format', 'stream-json', '--model', 'sonnet'],
    env: { MTL_CODE_UI_BARE: '0', ANTHROPIC_MODEL: 'sonnet' },
  });
  const resumedTurn = buildMtlCodeRuntimeSignature({
    cwd: 'E:/repo',
    cliArgs: ['--print', '--resume', 'session-123', '--input-format', 'stream-json', '--model', 'sonnet'],
    env: { MTL_CODE_UI_BARE: '0', ANTHROPIC_MODEL: 'sonnet' },
  });

  assert.equal(resumedTurn, firstLaunch);
});

test('Argus runtime signatures restart when provider endpoint identity changes', () => {
  const baseLaunch = buildMtlCodeRuntimeSignature({
    cwd: 'E:/repo',
    cliArgs: ['--print', '--model', 'gpt-5.5'],
    env: {
      MTL_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-5.5',
      OPENAI_BASE_URL: 'https://one.example.com/v1',
      OPENAI_API_KEY: 'token-one',
    },
  });
  const changedEndpoint = buildMtlCodeRuntimeSignature({
    cwd: 'E:/repo',
    cliArgs: ['--print', '--model', 'gpt-5.5'],
    env: {
      MTL_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-5.5',
      OPENAI_BASE_URL: 'https://two.example.com/v1',
      OPENAI_API_KEY: 'token-one',
    },
  });
  const changedToken = buildMtlCodeRuntimeSignature({
    cwd: 'E:/repo',
    cliArgs: ['--print', '--model', 'gpt-5.5'],
    env: {
      MTL_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-5.5',
      OPENAI_BASE_URL: 'https://one.example.com/v1',
      OPENAI_API_KEY: 'token-two',
    },
  });

  assert.notEqual(changedEndpoint, baseLaunch);
  assert.notEqual(changedToken, baseLaunch);
  assert.equal(baseLaunch.includes('token-one'), false);
  assert.equal(changedToken.includes('token-two'), false);
});

test('Argus runtime changes restart as a fresh native session instead of resuming stale runtime state', () => {
  const originalOptions = {
    sessionId: 'old-native-session',
    clientSessionId: 'old-native-session',
    model: 'mimo-v2.5',
    appendSystemPrompt: 'keep existing prompt context',
  };

  const restartOptions = createMtlCodeFreshSessionOptionsForRuntimeChange(originalOptions);
  const args = buildMtlCodeArgs(restartOptions, {
    MTL_CODE_UI_BARE: '0',
    MTL_CODE_USE_OPENAI: '0',
    ANTHROPIC_MODEL: 'mimo-v2.5',
  });

  assert.equal(originalOptions.sessionId, 'old-native-session');
  assert.equal(restartOptions.sessionId, undefined);
  assert.equal(restartOptions.clientSessionId, 'old-native-session');
  assert.equal(args.includes('--resume'), false);
  assert.equal(args.includes('--append-system-prompt'), true);
});

test('Argus resumed turns keep the requested session as the canonical UI session', () => {
  const registration = resolveMtlCodeCanonicalSessionRegistration({
    messageSessionId: 'native-reported-different-session',
    capturedSessionId: 'existing-ui-session',
    requestedSessionId: 'existing-ui-session',
    clientSessionId: '',
  });

  assert.equal(registration.shouldAdoptMessageSessionId, false);
  assert.equal(registration.canonicalSessionId, 'existing-ui-session');
  assert.equal(registration.providerSessionAlias, 'native-reported-different-session');
});

test('Argus fresh turns still adopt the native session id', () => {
  const registration = resolveMtlCodeCanonicalSessionRegistration({
    messageSessionId: 'real-native-session',
    capturedSessionId: '',
    requestedSessionId: '',
    clientSessionId: 'new-session-temp',
  });

  assert.equal(registration.shouldAdoptMessageSessionId, true);
  assert.equal(registration.canonicalSessionId, 'real-native-session');
  assert.equal(registration.providerSessionAlias, '');
});

test('Argus persistent idle sessions are not reported as currently processing', () => {
  assert.equal(isMtlCodeSessionProcessing({
    status: 'active',
    instance: {
      isBusy: () => false,
      isClosed: () => false,
    },
  }), false);

  assert.equal(isMtlCodeSessionProcessing({
    status: 'active',
    instance: {
      isBusy: () => true,
      isClosed: () => false,
    },
  }), true);

  assert.equal(isMtlCodeSessionProcessing({
    status: 'active',
    instance: {
      isBusy: () => true,
      isClosed: () => true,
    },
  }), false);
});

test('Argus runtime diagnostics report Brain state instead of legacy strategy cards', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /bareMode/);
  assert.match(source, /brainRuntime/);
  assert.match(source, /Argus Brain compacted this task state/);
  assert.doesNotMatch(source, /openMythosRuntimeCardActive/);
});

test('Argus runtime permission diagnostics distinguish acceptEdits from allow rules', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /modeAllowsFileEdits/);
  assert.match(source, /Accept edits mode is active/);
  assert.match(source, /allowedTools is empty only means no extra allow rules/);
});

test('Argus session runtime prompt merge preserves existing review intent prompts', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function appendChatSystemPrompt/);
  assert.match(source, /options\.appendSystemPrompt = appendChatSystemPrompt\(options\.appendSystemPrompt, appendSystemPrompt\)/);
  assert.match(source, /options\.appendSystemPrompt = appendChatSystemPrompt\(options\.appendSystemPrompt, runtime\.appendSystemPrompt\)/);
  assert.doesNotMatch(source, /options\.appendSystemPrompt = appendSystemPrompt;/);
  assert.doesNotMatch(source, /options\.appendSystemPrompt = runtime\.appendSystemPrompt;/);
});

test('Argus inspection gates ignore non-repository tool calls', () => {
  assert.equal(messageHasMtlCodeRepositoryInspectionToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Skill', input: { skill: 'test-driven-development' } },
      ],
    },
  }), false);

  assert.equal(messageHasMtlCodeRepositoryInspectionToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'TodoWrite', input: { todos: [] } },
      ],
    },
  }), false);

  assert.equal(messageHasMtlCodeRepositoryInspectionToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'claudecodeui/server/claude-sdk.js' } },
      ],
    },
  }), true);

  assert.equal(messageHasMtlCodeRepositoryInspectionToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'git status --short' } },
      ],
    },
  }), true);

  assert.equal(messageHasMtlCodeRepositoryInspectionToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      ],
    },
  }), false);
});

test('Argus diagnostics collect all native tool use names, not only repository tools', () => {
  const names = getMtlCodeToolUseNames({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Skill', input: { skill: 'test-driven-development' } },
        { type: 'tool_use', name: 'Read', input: { file_path: 'claudecodeui/server/claude-sdk.js' } },
      ],
    },
  });

  assert.deepEqual(names, ['Skill', 'Read']);
});

test('Argus distinguishes repository search from substantive content inspection', () => {
  assert.equal(messageHasMtlCodeRepositoryContentToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Grep', input: { pattern: 'appendSystemPrompt' } },
        { type: 'tool_use', name: 'Glob', input: { pattern: '**/*prompt*.ts' } },
      ],
    },
  }), false);

  assert.equal(messageHasMtlCodeRepositoryContentToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'claudecodeui/server/claude-sdk.js' } },
      ],
    },
  }), true);

  assert.equal(messageHasMtlCodeRepositoryContentToolUse({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'git diff -- claudecodeui/server/claude-sdk.js' } },
      ],
    },
  }), true);
});

test('Argus direct stdout handling drains async processing before close cleanup', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /let stdoutProcessing = Promise\.resolve\(\)/);
  assert.match(source, /const queueStdoutLine = \(line\) =>/);
  assert.match(source, /queueStdoutLine\(line\)/);
  assert.match(source, /await stdoutProcessing/);
  assert.doesNotMatch(source, /void handleStdoutLine\(line\)/);
});
