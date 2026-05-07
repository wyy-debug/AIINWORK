export const ARGUS_CODEX_STYLE_PLAN_MARKER = 'ARGUS_CODEX_STYLE_PLAN_MODE';

const CODEX_STYLE_PLAN_MODE_PROMPT = `# Plan Mode (Conversational)

You work in three phases and should chat your way to a decision-complete plan before finalizing it. A good plan can be handed to another engineer or agent and implemented without open decisions.

## Mode Rules

You are in Plan Mode until the runtime explicitly sends a later instruction or user action that exits Plan Mode. User requests to implement, edit, commit, or run side-effectful commands while still in Plan Mode must be treated as requests to plan that work.

## Plan Mode vs update_plan

Plan Mode is a collaboration mode. It is not the update_plan checklist tool. Do not use TodoWrite, update_plan, or any checklist as the final plan mechanism.

## Allowed Work

You may perform non-mutating exploration that improves the plan:
- Read or search files, configs, types, manifests, schemas, and docs.
- Inspect local implementation shape.
- Run dry-run checks, tests, or builds when they do not edit repo-tracked files.
- Ask the user concrete decision questions with request_user_input.

## Disallowed Work

Do not mutate repo-tracked state while in Plan Mode:
- Do not edit or write files.
- Do not apply patches.
- Do not run formatters, codegen, migrations, or commands whose purpose is to carry out the plan.

## Asking Questions

Strongly prefer request_user_input for high-impact decisions. Ask only questions that materially change the plan, confirm an important assumption, or choose between meaningful tradeoffs. Do not ask questions that can be answered by reading the repo.

## Final Plan

Only present the official plan once it is decision complete. Wrap it exactly once in a proposed_plan block:

<proposed_plan>
plan content
</proposed_plan>

The plan should be concise, human-readable Markdown with Summary, Key Changes, Test Plan, and Assumptions when those sections apply. Do not ask "should I proceed?" after the proposed_plan block.`;

const SUBAGENT_DISPATCH_PROMPT = `Subagent dispatch authorization:
The user explicitly clicked the subagent dispatch button for this message. You may use spawn_agent, followup_task, wait_agent, close_agent, send_message, and list_agents only if this task naturally benefits from parallel delegated work. Keep simple or serial tasks local. The button is authorization, not a requirement to spawn.`;

const PLAN_MODE_ALLOWED_TOOLS = Object.freeze([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
  'request_user_input',
]);

const PLAN_MODE_DENIED_TOOLS = Object.freeze([
  'Bash',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write',
  'TodoWrite',
  'ExitPlanMode',
  'exit_plan_mode',
  'EnterPlanMode',
]);

function appendPrompt(existing, addition) {
  const current = typeof existing === 'string' ? existing.trim() : '';
  const next = typeof addition === 'string' ? addition.trim() : '';
  if (!next) {
    return current || undefined;
  }
  if (!current) {
    return next;
  }
  return `${current}\n\n${next}`;
}

export function getArgusPlanModeAllowedTools() {
  return [...PLAN_MODE_ALLOWED_TOOLS];
}

export function getArgusPlanModeDeniedTools() {
  return [...PLAN_MODE_DENIED_TOOLS];
}

export function buildCodexStylePlanModePrompt() {
  return CODEX_STYLE_PLAN_MODE_PROMPT;
}

export function buildSubagentDispatchPrompt() {
  return SUBAGENT_DISPATCH_PROMPT;
}

export function resolveArgusPermissionMode(options = {}) {
  const direct = typeof options.permissionMode === 'string'
    ? options.permissionMode.trim()
    : '';
  if (direct) {
    return direct;
  }

  const fromSettings = typeof options.toolsSettings?.permissionMode === 'string'
    ? options.toolsSettings.permissionMode.trim()
    : '';
  return fromSettings;
}

export function applyArgusCollaborationModeOptions(data) {
  if (!data || typeof data !== 'object' || data.type !== 'claude-command') {
    return data;
  }

  const options = data.options && typeof data.options === 'object' ? data.options : {};
  const permissionMode = resolveArgusPermissionMode(options);
  const subagentDispatch = options.subagentDispatch === true;
  const promptParts = [];

  if (permissionMode === 'plan') {
    promptParts.push(CODEX_STYLE_PLAN_MODE_PROMPT);
  }
  if (subagentDispatch) {
    promptParts.push(SUBAGENT_DISPATCH_PROMPT);
  }
  if (promptParts.length === 0) {
    return data;
  }

  return {
    ...data,
    options: {
      ...options,
      ...(permissionMode ? { permissionMode } : {}),
      appendSystemPrompt: appendPrompt(options.appendSystemPrompt, promptParts.join('\n\n')),
      ...(permissionMode === 'plan' ? { codexStylePlanMode: true } : {}),
    },
  };
}
