import assert from 'node:assert/strict';
import test from 'node:test';

test('Argus collaboration mode appends Codex-style plan prompt only in plan mode', async () => {
  const {
    applyArgusCollaborationModeOptions,
  } = await import(`../argus-collaboration-mode-service.js?plan=${Date.now()}`);

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

test('Argus collaboration mode also follows persisted toolsSettings permissionMode', async () => {
  const {
    applyArgusCollaborationModeOptions,
    resolveArgusPermissionMode,
  } = await import(`../argus-collaboration-mode-service.js?persisted=${Date.now()}`);

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
  const {
    applyArgusCollaborationModeOptions,
  } = await import(`../argus-collaboration-mode-service.js?subagent=${Date.now()}`);

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
  const {
    applyArgusCollaborationModeOptions,
  } = await import(`../argus-collaboration-mode-service.js?approved-subagents=${Date.now()}`);

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
  const {
    getArgusPlanModeAllowedTools,
    getArgusPlanModeDeniedTools,
  } = await import(`../argus-collaboration-mode-service.js?tools=${Date.now()}`);

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
