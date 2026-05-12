import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  applyArgusCodeReviewIntentToChatCommand,
  applyArgusCollaborationModeOptions,
  applyArgusToolInspectionIntentToChatCommand,
  getArgusPlanModeAllowedTools,
  getArgusPlanModeDeniedTools,
  resolveArgusPermissionMode,
} from '../argus-collaboration-mode-service.js';

test('Argus collaboration mode appends Codex-style plan prompt only in plan mode', async () => {
  const command = applyArgusCollaborationModeOptions({
    type: 'claude-command',
    command: 'make a plan',
    options: {
      permissionMode: 'plan',
      appendSystemPrompt: 'Existing skill prompt.',
    },
  });

  assert.match(command.options.appendSystemPrompt, /Existing skill prompt\./);
  assert.match(command.options.appendSystemPrompt, /Plan Mode \(Conversational\)/);
  assert.match(command.options.appendSystemPrompt, /<proposed_plan>/);
  assert.equal(command.options.codexStylePlanMode, true);
});

test('Argus expands terse Chinese code review requests into explicit workspace review work', async () => {
  const command = applyArgusCodeReviewIntentToChatCommand({
    type: 'claude-command',
    command: 'review 代码',
    options: {},
  });

  assert.match(command.command, /Review the current workspace changes/i);
  assert.match(command.command, /git status/i);
  assert.match(command.command, /git diff/i);
  assert.match(command.command, /Do not modify files/i);
  assert.match(command.command, /Original user request: review 代码/i);
  assert.match(command.options.appendSystemPrompt, /Code review intent active/i);
  assert.match(command.options.appendSystemPrompt, /Do not answer with an acknowledgement/i);
  assert.match(command.options.appendSystemPrompt, /git status --short/i);
  assert.equal(command.options.argusCodeReviewIntent, true);
});

test('Argus treats casual review-shortcuts as workspace code review intent', async () => {
  for (const input of [
    'review下全部代码',
    '检查下当前改动',
    'reivew\u5168\u90e8\u4ee3\u7801',
    'reivew\u4ee3\u7801',
    'review一下',
    'review下',
    '帮我review一下',
    '好好review一下',
    '你好好review下问题',
    '彻底review一下 这个mmap',
    'review一下GPUDrivenStreaming',
    'review一下这个链路',
    'review下这个问题',
  ]) {
    const command = applyArgusCodeReviewIntentToChatCommand({
      type: 'claude-command',
      command: input,
      options: {},
    });

    assert.match(command.command, /Review the current workspace changes/i);
    assert.match(command.options.appendSystemPrompt, /Code review intent active/i);
    assert.match(command.options.appendSystemPrompt, /git status --short/i);
    assert.equal(command.options.argusCodeReviewIntent, true);
  }
});

test('Argus treats short continuation in a review session as workspace review intent', async () => {
  const command = applyArgusCodeReviewIntentToChatCommand({
    type: 'claude-command',
    command: '继续',
    options: {
      sessionId: 'session-123',
      resume: true,
      sessionSummary: 'review下',
    },
  });

  assert.match(command.command, /Review the current workspace changes/i);
  assert.match(command.command, /Original user request: 继续/i);
  assert.match(command.options.appendSystemPrompt, /Code review intent active/i);
  assert.equal(command.options.argusCodeReviewIntent, true);
});

test('Argus leaves non-terse review discussion prompts unchanged', async () => {
  const original = {
    type: 'claude-command',
    command: 'review this architecture idea before I implement it',
    options: {},
  };
  const command = applyArgusCodeReviewIntentToChatCommand(original);

  assert.equal(command, original);
});

test('Argus leaves Chinese code investigation command text unchanged but marks it for tool inspection', async () => {
  for (const input of [
    '检查下代码中的提示词是怎么注入的',
    '检查下代码里的 prompt 为什么会显示这么多',
    '看下代码中 appendSystemPrompt 是怎么拼进去的',
  ]) {
    const original = {
      type: 'claude-command',
      command: input,
      options: {},
    };
    const command = applyArgusToolInspectionIntentToChatCommand(
      applyArgusCodeReviewIntentToChatCommand(original),
    );

    assert.equal(command.command, input);
    assert.equal(command.options.argusCodeReviewIntent, undefined);
    assert.equal(command.options.argusToolInspectionIntent, true);
    assert.match(command.options.appendSystemPrompt, /Repository inspection intent active/i);
  }
});

test('Argus leaves ordinary prompt-injection discussion as normal chat', async () => {
  const original = {
    type: 'claude-command',
    command: '讲一下提示词注入是什么',
    options: {},
  };
  const command = applyArgusToolInspectionIntentToChatCommand(
    applyArgusCodeReviewIntentToChatCommand(original),
  );

  assert.equal(command, original);
});

test('Argus collaboration mode also follows persisted toolsSettings permissionMode', async () => {
  const command = applyArgusCollaborationModeOptions({
    type: 'claude-command',
    command: 'make a plan from stored config',
    options: {
      toolsSettings: {
        permissionMode: 'plan',
      },
    },
  });

  assert.equal(resolveArgusPermissionMode(command.options), 'plan');
  assert.match(command.options.appendSystemPrompt, /Plan Mode \(Conversational\)/);
  assert.equal(command.options.permissionMode, 'plan');
  assert.equal(command.options.codexStylePlanMode, true);
});

test('Argus collaboration mode appends subagent dispatch reminder only when explicitly requested', async () => {
  const withoutButton = applyArgusCollaborationModeOptions({
    type: 'claude-command',
    command: 'do work',
    options: {},
  });
  const withButton = applyArgusCollaborationModeOptions({
    type: 'claude-command',
    command: 'do work',
    options: { subagentDispatch: true },
  });

  assert.equal(withoutButton.options?.appendSystemPrompt, undefined);
  assert.match(withButton.options.appendSystemPrompt, /user explicitly clicked the subagent dispatch button/i);
  assert.match(withButton.options.appendSystemPrompt, /spawn_agent/);
  assert.equal(withButton.options.coordinatorMode, true);
});

test('Argus collaboration mode includes the approved subagent dispatch plan', async () => {
  const command = applyArgusCollaborationModeOptions({
    type: 'claude-command',
    command: 'dispatch the approved plan',
    options: {
      subagentDispatch: true,
      subagentDispatchPlanApproved: true,
      subagentDispatchPlan: '# Subagent Dispatch Plan\n\n## Agent Dispatch\n- Explore/backend_review',
    },
  });

  assert.match(command.options.appendSystemPrompt, /Approved subagent dispatch plan/i);
  assert.match(command.options.appendSystemPrompt, /only dispatch the agents described/i);
  assert.match(command.options.appendSystemPrompt, /Explore\/backend_review/);
  assert.equal(command.options.coordinatorMode, true);
});

test('Codex-style plan mode allowed tools exclude legacy ExitPlanMode and TodoWrite', async () => {
  const tools = getArgusPlanModeAllowedTools();
  const deniedTools = getArgusPlanModeDeniedTools();

  assert.ok(tools.includes('request_user_input'));
  assert.ok(tools.includes('AskUserQuestion'));
  assert.equal(tools.includes('ExitPlanMode'), false);
  assert.equal(tools.includes('exit_plan_mode'), false);
  assert.equal(tools.includes('TodoWrite'), false);
  assert.ok(deniedTools.includes('ExitPlanMode'));
  assert.ok(deniedTools.includes('TodoWrite'));
  assert.ok(deniedTools.includes('Write'));
  assert.ok(deniedTools.includes('Edit'));
});
