import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';

import {
  buildCodeReviewToolFallbackPrompt,
  buildToolInspectionFallbackPrompt,
  shouldStartCodeReviewFallbackRunAfterClose,
  shouldSendCodeReviewToolFallback,
  shouldSendToolInspectionFallback,
} from '../../claude-sdk.js';

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

test('Argus tool inspection fallback prompt requires searching and reading files', () => {
  const prompt = buildToolInspectionFallbackPrompt();

  assert.match(prompt, /search the repository/i);
  assert.match(prompt, /read the relevant files/i);
  assert.match(prompt, /Do not answer with only a plan/i);
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
