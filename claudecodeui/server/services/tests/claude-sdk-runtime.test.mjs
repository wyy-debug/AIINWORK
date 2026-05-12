import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';

import {
  buildCodeReviewToolFallbackPrompt,
  shouldSendCodeReviewToolFallback,
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
  assert.match(source, /text:\s*'prompt_injection_debug'/);
  assert.match(source, /appendSystemPromptLength/);
  assert.match(source, /originalCommand/);
  assert.match(source, /effectiveCommand/);
  assert.match(source, /commandChanged/);
  assert.match(source, /claudeNativeMemoryEnabled:\s*isClaudeNativeMemoryEnabled\(childEnv\)/);
  assert.match(source, /bareMode:\s*shouldUseBareMode\(childEnv\)/);
  assert.match(source, /hasBareFlag:\s*cliArgs\.includes\('--bare'\)/);
  assert.match(source, /hasAppendSystemPromptFlag:\s*cliArgs\.includes\('--append-system-prompt'\)/);
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
