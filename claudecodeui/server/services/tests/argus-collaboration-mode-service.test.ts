import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  applyObsidianWikiPolicyPromptToChatCommand,
} from '../obsidian-memory-policy-service.js';
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

test('Argus leaves code review requests on the native Claude Code path', async () => {
  const original = {
    type: 'claude-command',
    command: 'review all code',
    options: {},
  };
  const command = applyArgusCodeReviewIntentToChatCommand(original);

  assert.equal(command, original);
});

test('Argus leaves typo review requests on the native Claude Code path', async () => {
  const original = {
    type: 'claude-command',
    command: 'reivew code',
    options: {},
  };
  const command = applyArgusCodeReviewIntentToChatCommand(original);

  assert.equal(command, original);
});

test('Argus leaves short continuation messages on the native Claude Code path', async () => {
  const original = {
    type: 'claude-command',
    command: 'continue',
    options: {
      sessionId: 'session-123',
      resume: true,
      sessionSummary: 'review all code',
    },
  };
  const command = applyArgusCodeReviewIntentToChatCommand(original);

  assert.equal(command, original);
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

test('Argus leaves repository inspection requests on the native Claude Code path', async () => {
  const original = {
    type: 'claude-command',
    command: 'check how prompt injection is wired in the code',
    options: {},
  };
  const command = applyArgusToolInspectionIntentToChatCommand(
    applyArgusCodeReviewIntentToChatCommand(original),
  );

  assert.equal(command, original);
});

test('Argus leaves ordinary prompt-injection discussion as normal chat', async () => {
  const original = {
    type: 'claude-command',
    command: 'explain what prompt injection means',
    options: {},
  };
  const command = applyArgusToolInspectionIntentToChatCommand(
    applyArgusCodeReviewIntentToChatCommand(original),
  );

  assert.equal(command, original);
});

test('Argus native inspection path still allows Obsidian policy prompt injection', async () => {
  const originalCommand = 'check how prompt injection is wired in the code';
  const command = applyObsidianWikiPolicyPromptToChatCommand(
    applyArgusToolInspectionIntentToChatCommand(
      applyArgusCodeReviewIntentToChatCommand({
        type: 'claude-command',
        command: originalCommand,
        options: {},
      }),
    ),
    {
      readObsidianBridgeConfig: () => ({ enabled: true }),
    },
  ) as {
    command: string;
    options: {
      argusCodeReviewIntent?: boolean;
      argusToolInspectionIntent?: boolean;
      appendSystemPrompt: string;
    };
  };

  assert.equal(command.command, originalCommand);
  assert.equal(command.options.argusCodeReviewIntent, undefined);
  assert.equal(command.options.argusToolInspectionIntent, undefined);
  assert.match(command.options.appendSystemPrompt, /Obsidian Wiki Policy/i);
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
