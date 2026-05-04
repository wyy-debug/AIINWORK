/**
 * Coordinator-mode worker agent definition.
 *
 * When COORDINATOR_MODE is active, getBuiltInAgents() returns only
 * the agents from getCoordinatorAgents(). OpenMythos WorkerRuntime selects
 * one of these role-specific worker types when launching a plan.
 *
 * Workers get the full standard tool set minus internal orchestration
 * tools like TeamCreate and legacy SendMessage, so they can research,
 * implement, and verify autonomously.
 */
import { ASYNC_AGENT_ALLOWED_TOOLS } from '../constants/tools.js'
import { SEND_MESSAGE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/SendMessageTool/constants.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { TEAM_CREATE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/TeamDeleteTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '@mtl-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'

/**
 * Tools that workers must not have. These are coordinator-only
 * orchestration primitives.
 */
const INTERNAL_ORCHESTRATION_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
])

const WRITE_TOOLS = new Set([
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
])

/**
 * Build the worker's allowed tool list from ASYNC_AGENT_ALLOWED_TOOLS,
 * excluding internal orchestration tools.
 */
function getWorkerTools(options: { readonlyOnly?: boolean } = {}): string[] {
  return Array.from(ASYNC_AGENT_ALLOWED_TOOLS).filter(name => {
    if (INTERNAL_ORCHESTRATION_TOOLS.has(name)) return false
    if (options.readonlyOnly && WRITE_TOOLS.has(name)) return false
    return true
  })
}

function workerPrompt(role: string, posture: string): string {
  return `You are ${role}, an Argus worker spawned by OpenMythos WorkerRuntime.

Posture:
${posture}

Guidelines:
- Complete the assigned route thoroughly without expanding beyond it.
- Use tools proactively within your role boundary.
- Do not revert unrelated user changes.
- Do not describe internal agent-control failures or ask the user to replace whole files manually.
- NEVER create documentation files unless explicitly instructed.

Final output contract:
### STATUS
One of DONE, BLOCKED, or NEED_PARENT_INPUT.
### SUMMARY
One paragraph with the result.
### EVIDENCE
Bullet list of concrete files, commands, or observations.
### NEXT_ACTION
One concrete next step for the parent, or "None."
### CHANGES
Bullet list of files changed, or "None."
### RISKS
Bullet list of unresolved risks, or "None observed."
### BLOCKERS
Bullet list of blockers, or "None."`
}

const WORKER_EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker-explore',
  whenToUse:
    'Read-only exploration worker for locating evidence and mapping code without edits.',
  tools: getWorkerTools({ readonlyOnly: true }),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    workerPrompt(
      'worker-explore',
      '- Read, search, inspect, and map the relevant code or evidence.\n- Do not edit, write, or create files.\n- Prefer precise file references and call-site lists.',
    ),
}

const WORKER_PLAN_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker-plan',
  whenToUse:
    'Planning worker for architecture, migration, and implementation strategy without edits.',
  tools: getWorkerTools({ readonlyOnly: true }),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    workerPrompt(
      'worker-plan',
      '- Produce a decision-complete plan for the assigned route.\n- Do not edit, write, or create files.\n- Call out interfaces, risks, and validation gates.',
    ),
}

const WORKER_REVIEW_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker-review',
  whenToUse:
    'Review worker for security, performance, frontend, git, or correctness risk analysis without edits.',
  tools: getWorkerTools({ readonlyOnly: true }),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    workerPrompt(
      'worker-review',
      '- Review the assigned route for bugs, risk, missing tests, or unsafe behavior.\n- Do not edit, write, or create files.\n- Prioritize concrete findings with evidence over broad commentary.',
    ),
}

const WORKER_IMPLEMENTER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker-implementer',
  whenToUse:
    'Implementation worker for landing a specific scoped change and verifying it.',
  tools: getWorkerTools(),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    workerPrompt(
      'worker-implementer',
      '- Make the smallest targeted code change that satisfies the assignment.\n- Avoid drive-by refactors.\n- Run focused verification when practical and report any skipped checks.',
    ),
}

const WORKER_VERIFIER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker-verifier',
  whenToUse:
    'Verification worker for running tests, typechecks, builds, or other validation gates.',
  tools: getWorkerTools({ readonlyOnly: true }),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    workerPrompt(
      'worker-verifier',
      '- Run the requested verification gates and report pass/fail with exact commands.\n- Do not edit, write, or create files.\n- If a check fails, capture the key error and likely owner; do not fix it.',
    ),
}

/**
 * Returns the agent definitions available in coordinator mode.
 * Called by getBuiltInAgents() when COORDINATOR_MODE is active.
 */
export function getCoordinatorAgents(): BuiltInAgentDefinition[] {
  return [
    WORKER_EXPLORE_AGENT,
    WORKER_PLAN_AGENT,
    WORKER_REVIEW_AGENT,
    WORKER_IMPLEMENTER_AGENT,
    WORKER_VERIFIER_AGENT,
  ]
}
