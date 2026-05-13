import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';

import {
  ARGUS_INTERNAL_FALLBACK_PREFIX,
  buildArgusInspectionPreflightPrompt,
  buildCodeReviewToolFallbackPrompt,
  buildToolInspectionFallbackPrompt,
  createMtlCodeSyntheticUserMessage,
  buildMtlCodeSessionLogPayload,
  buildMtlCodeRuntimeSignature,
  canReuseMtlCodeSession,
  isMtlCodeSessionProcessing,
  messageHasMtlCodeRepositoryContentToolUse,
  messageHasMtlCodeRepositoryInspectionToolUse,
  shouldSendInspectionPreflightAfterFallback,
  shouldSendInspectionPreflightAfterIncompleteToolUse,
  shouldStartCodeReviewFallbackRunAfterClose,
  shouldSendCodeReviewToolFallback,
  shouldSendToolInspectionFallback,
} from '../../claude-sdk.js';

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

test('Argus direct close handling treats only explicit user abort as aborted', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function isMtlCodeUserAbort/);
  assert.match(source, /child\?\._mtlCodeAborted === true|child\._mtlCodeAborted === true/);
  assert.doesNotMatch(source, /Boolean\(child\._mtlCodeAborted \|\| signal\)/);
  assert.match(source, /buildMtlCodeCloseFailureMessage/);
  assert.match(source, /Argus backend exited with signal/);
});

test('Argus coordinator dispatch enables native subagent tools for the spawned runtime', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /options\.coordinatorMode === true/);
  assert.match(source, /spawnEnv\.MTL_CODE_COORDINATOR_MODE = '1'/);
  assert.match(source, /spawnEnv\[MTL_CODE_MODEL_ENV_KEYS\.subagentsEnabled\] = '1'/);
});

test('Claude native memory disables bare mode and clears auto-memory blockers', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /function isClaudeNativeMemoryEnabled/);
  assert.match(source, /function applyClaudeNativeMemoryEnv/);
  assert.match(source, /spawnEnv\.MTL_CODE_UI_BARE = '0'/);
  assert.match(source, /delete spawnEnv\.MTL_CODE_SIMPLE/);
  assert.match(source, /delete spawnEnv\.MTL_CODE_DISABLE_AUTO_MEMORY/);
  assert.match(source, /spawnEnv\.MTL_CODE_DISABLE_AUTO_MEMORY = '1'/);
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
  assert.match(source, /argusInternal/);
  assert.match(source, /hiddenFallbackInjected/);
  assert.match(source, /preflightInjected/);
  assert.match(source, /originalCommand/);
  assert.match(source, /effectiveCommand/);
  assert.match(source, /commandChanged/);
  assert.match(source, /claudeNativeMemoryEnabled:\s*isClaudeNativeMemoryEnabled\(childEnv\)/);
  assert.match(source, /bareMode:\s*shouldUseBareMode\(childEnv\)/);
  assert.match(source, /hasBareFlag:\s*cliArgs\.includes\('--bare'\)/);
  assert.match(source, /hasAppendSystemPromptFlag:\s*cliArgs\.includes\('--append-system-prompt'\)/);
  assert.match(source, /await emitPromptInjectionDebug\(ws,\s*options,\s*childEnv,\s*cliArgs,\s*capturedSessionId \|\| sessionId \|\| clientSessionId \|\| null,\s*\{/);
  assert.match(source, /emitPromptInjectionDebug\(ws,\s*options,\s*childEnv,\s*cliArgs,\s*capturedSessionId \|\| sessionId \|\| clientSessionId \|\| null,\s*\{/);
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

test('Argus runtime diagnostics suppress OpenMythos runtime card when final launch is bare', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /bareMode/);
  assert.match(source, /openMythosRuntimeCardActive/);
  assert.match(source, /const previewRuntimeCard = openMythosRuntimeCardActive\s*\?/);
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

test('Argus review intent sends a tool-use fallback when first response only acknowledges work', () => {
  assert.equal(shouldSendCodeReviewToolFallback({
    options: { argusCodeReviewIntent: true },
    fallbackSent: false,
    sawToolUse: false,
    assistantText: 'I will inspect the working tree and diffs, then report findings.',
  }), true);

  assert.equal(shouldSendCodeReviewToolFallback({
    options: { argusCodeReviewIntent: true },
    fallbackSent: false,
    sawToolUse: true,
    assistantText: 'I will inspect the working tree.',
  }), false);

  assert.equal(shouldSendCodeReviewToolFallback({
    options: { argusCodeReviewIntent: true },
    fallbackSent: false,
    sawToolUse: false,
    assistantText: 'No issues found.',
  }), true);

  assert.equal(shouldSendCodeReviewToolFallback({
    options: { argusCodeReviewIntent: true },
    fallbackSent: true,
    sawToolUse: false,
    assistantText: 'I will inspect the working tree.',
  }), false);
});

test('Argus review fallback prompt requires repository inspection before findings', () => {
  const prompt = buildCodeReviewToolFallbackPrompt();

  assert.match(prompt, /git status --short/);
  assert.match(prompt, /git diff --stat/);
  assert.match(prompt, /git diff/);
  assert.match(prompt, /Report findings first/i);
  assert.doesNotMatch(prompt, /acknowledge/i);
});

test('Argus tool inspection intent sends a fallback when first response only plans to inspect code', () => {
  assert.equal(shouldSendToolInspectionFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: false,
    sawToolUse: false,
    assistantText: '我先在仓库里定位和提示词/system prompt/inject相关的实现，然后读关键文件梳理注入链路。',
  }), true);

  assert.equal(shouldSendToolInspectionFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: false,
    sawToolUse: true,
    assistantText: '我先在仓库里定位相关实现。',
  }), false);

  assert.equal(shouldSendToolInspectionFallback({
    options: { argusToolInspectionIntent: false },
    fallbackSent: false,
    sawToolUse: false,
    assistantText: '我先在仓库里定位相关实现。',
  }), false);
});

test('Argus tool inspection fallback does not depend on exact acknowledgement wording', () => {
  assert.equal(shouldSendToolInspectionFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: false,
    sawToolUse: false,
    assistantText: '我现在直接检查实现路径，重点看系统提示词向量、SDK 调用层、会话 provider。',
  }), true);

  assert.equal(shouldSendToolInspectionFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: false,
    sawToolUse: false,
    assistantText: 'The prompt injection path is in the server SDK layer.',
  }), true);
});

test('Argus tool inspection fallback prompt requires searching and reading files', () => {
  const prompt = buildToolInspectionFallbackPrompt();

  assert.match(prompt, /search the repository/i);
  assert.match(prompt, /read the relevant files/i);
  assert.match(prompt, /Do not answer with only a plan/i);
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

test('Argus fallback guidance is written as a synthetic internal user message', () => {
  const message = createMtlCodeSyntheticUserMessage(buildToolInspectionFallbackPrompt());

  assert.equal(message.type, 'user');
  assert.equal(message.isSynthetic, true);
  assert.match(message.content, new RegExp(`^${ARGUS_INTERNAL_FALLBACK_PREFIX}`));
  assert.equal(message.message.role, 'user');
  assert.equal(message.message.content, message.content);
});

test('Argus sends a preflight context prompt when hidden fallback also receives only an acknowledgement', () => {
  assert.equal(shouldSendInspectionPreflightAfterFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: true,
    preflightSent: false,
    sawToolUse: false,
    assistantText: 'I will inspect the repository and read the relevant files.',
  }), true);

  assert.equal(shouldSendInspectionPreflightAfterFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: true,
    preflightSent: false,
    sawToolUse: false,
    assistantText: '我现在直接检查实现路径，重点看系统提示词向量、SDK 调用层、会话 provider。',
  }), true);

  assert.equal(shouldSendInspectionPreflightAfterFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: true,
    preflightSent: false,
    sawToolUse: false,
    assistantText: 'The prompt injection path is probably in the server layer.',
  }), true);

  assert.equal(shouldSendInspectionPreflightAfterFallback({
    options: { argusCodeReviewIntent: true },
    fallbackSent: true,
    preflightSent: false,
    sawToolUse: false,
    assistantText: 'I will inspect the working tree and diffs.',
  }), true);

  assert.equal(shouldSendInspectionPreflightAfterFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: true,
    preflightSent: true,
    sawToolUse: false,
    assistantText: 'I will inspect the repository.',
  }), false);

  assert.equal(shouldSendInspectionPreflightAfterFallback({
    options: { argusToolInspectionIntent: true },
    fallbackSent: true,
    preflightSent: false,
    sawToolUse: true,
    assistantText: 'I will inspect the repository.',
  }), false);
});

test('Argus sends a preflight context prompt when tool use still ends in a continuation plan', () => {
  assert.equal(shouldSendInspectionPreflightAfterIncompleteToolUse({
    options: { argusToolInspectionIntent: true },
    preflightSent: false,
    sawToolUse: true,
    assistantText: '\u6211\u5df2\u7ecf\u627e\u5230\u6838\u5fc3\u63d0\u793a\u8bcd\u6587\u4ef6\u548c\u51e0\u5904\u8fd0\u884c\u65f6\u5165\u53e3\u3002\u63a5\u4e0b\u6765\u6211\u4f1a\u8bfb\u8c03\u7528\u94fe\u76f8\u5173\u6587\u4ef6\uff0c\u786e\u8ba4\u5b9a\u4e49\u597d\u7684\u63d0\u793a\u8bcd\u6700\u7ec8\u662f\u600e\u6837\u8fdb\u5165\u8bf7\u6c42\u4e0a\u4e0b\u6587\u7684\u3002',
  }), true);

  assert.equal(shouldSendInspectionPreflightAfterIncompleteToolUse({
    options: { argusToolInspectionIntent: true },
    preflightSent: false,
    sawToolUse: true,
    assistantText: 'I found the prompt files. Next I will read the SDK call chain and explain how they are injected.',
  }), true);

  assert.equal(shouldSendInspectionPreflightAfterIncompleteToolUse({
    options: { argusToolInspectionIntent: true },
    fallbackSent: true,
    preflightSent: false,
    sawToolUse: true,
    sawContentToolUse: false,
    assistantText: 'I found the prompt files and entry points in the runtime layer.',
  }), true);

  assert.equal(shouldSendInspectionPreflightAfterIncompleteToolUse({
    options: { argusToolInspectionIntent: true },
    fallbackSent: true,
    preflightSent: false,
    sawToolUse: true,
    sawContentToolUse: true,
    assistantText: 'The prompt injection path is implemented in claudecodeui/server/claude-sdk.js via appendSystemPrompt.',
  }), false);

  assert.equal(shouldSendInspectionPreflightAfterIncompleteToolUse({
    options: { argusToolInspectionIntent: true },
    preflightSent: true,
    sawToolUse: true,
    assistantText: 'Next I will read the files.',
  }), false);
});

test('Argus preflight context prompt carries real inspection output and stays internal', () => {
  const prompt = buildArgusInspectionPreflightPrompt({
    intent: 'tool_inspection',
    originalCommand: 'inspect prompt injection path',
    result: {
      cwd: 'E:/repo',
      ok: true,
      sections: [
        { title: 'rg prompt', command: 'rg -n "prompt" .', output: 'server/claude-sdk.js:620: appendSystemPrompt' },
      ],
    },
  });

  assert.match(prompt, new RegExp(`^${ARGUS_INTERNAL_FALLBACK_PREFIX}`));
  assert.match(prompt, /Argus performed a read-only repository preflight/i);
  assert.match(prompt, /server\/claude-sdk\.js:620/);
  assert.match(prompt, /Do not answer with only a plan/i);
});

test('Argus review preflight uses no external diff command and reports truncated output', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');
  const prompt = buildArgusInspectionPreflightPrompt({
    result: {
      sections: [
        { command: 'git diff --no-ext-diff', output: 'diff output', outputTruncated: true },
      ],
    },
  });

  assert.match(source, /'diff',\s*'--no-ext-diff'/);
  assert.match(prompt, /Output truncated: true/);
});

test('Argus direct stdout handling drains async fallback/preflight processing before close cleanup', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /let stdoutProcessing = Promise\.resolve\(\)/);
  assert.match(source, /const queueStdoutLine = \(line\) =>/);
  assert.match(source, /queueStdoutLine\(line\)/);
  assert.match(source, /await stdoutProcessing/);
  assert.doesNotMatch(source, /void handleStdoutLine\(line\)/);
});

test('Argus fallback resume preserves inspection intent and marks fallback as already sent', async () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../claude-sdk.js');
  const source = await fs.readFile(sourcePath, 'utf8');

  const resumeStart = source.indexOf('await queryMtlCodeDirect(codeReviewFallbackPrompt');
  const resumeBlock = source.slice(resumeStart, resumeStart + 700);

  assert.match(resumeBlock, /\.\.\.currentOptions/);
  assert.match(resumeBlock, /argusInspectionFallbackAlreadySent:\s*true/);
  assert.match(resumeBlock, /argusInspectionPreflightSent:\s*codeReviewPreflightSent/);
  assert.doesNotMatch(resumeBlock, /argusCodeReviewIntent:\s*false/);
  assert.doesNotMatch(resumeBlock, /argusToolInspectionIntent:\s*false/);
});

test('Argus starts a resumed fallback run when the print process exits after ack-only review', () => {
  assert.equal(shouldStartCodeReviewFallbackRunAfterClose({
    fallbackSent: true,
    resultReceived: false,
    aborted: false,
    sessionId: 'session-123',
  }), true);

  assert.equal(shouldStartCodeReviewFallbackRunAfterClose({
    fallbackSent: true,
    resultReceived: true,
    aborted: false,
    sessionId: 'session-123',
  }), false);

  assert.equal(shouldStartCodeReviewFallbackRunAfterClose({
    fallbackSent: true,
    resultReceived: false,
    aborted: false,
    sessionId: '',
  }), false);
});
