/**
 * Coordinator-mode worker agent definition.
 *
 * When COORDINATOR_MODE is active, getBuiltInAgents() returns only
 * the agents from getCoordinatorAgents(). The coordinator's system
 * prompt instructs it to use `subagent_type: "worker"` when spawning
 * tasks via the Agent tool.
 *
 * Workers get the full standard tool set minus internal orchestration
 * tools like TeamCreate and SendMessage, so they can research,
 * implement, and verify autonomously.
 */
import { ASYNC_AGENT_ALLOWED_TOOLS } from '../constants/tools.js'
import { SEND_MESSAGE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/SendMessageTool/constants.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { TEAM_CREATE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/TeamDeleteTool/constants.js'
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

/**
 * Build the worker's allowed tool list from ASYNC_AGENT_ALLOWED_TOOLS,
 * excluding internal orchestration tools.
 */
function getWorkerTools(): string[] {
  return Array.from(ASYNC_AGENT_ALLOWED_TOOLS).filter(
    name => !INTERNAL_ORCHESTRATION_TOOLS.has(name),
  )
}

const WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker',
  whenToUse:
    'Worker agent for coordinator mode. Executes research, implementation, and verification tasks autonomously with the full standard tool set.',
  tools: getWorkerTools(),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    `You are a worker agent spawned by a coordinator. Your job is to complete the task described in the prompt thoroughly and report back with a concise summary of what you did and what you found.

Guidelines:
- Complete the task fully; do not leave it half-done, but do not gold-plate either.
- Use tools proactively: read files, search code, run commands, edit files.
- Be thorough in research: check multiple locations, consider different naming conventions.
- For implementation: make targeted changes, run tests to verify, commit if appropriate.
- Report back with actionable findings; the coordinator will synthesize your results.
- If you encounter errors, investigate and attempt to fix them before reporting failure.
- Do not describe internal agent-control failures or ask the user to replace whole files manually. If a tool is unavailable, use another available tool or report the smallest concrete blocker.
- NEVER create documentation files unless explicitly instructed.`,
}

/**
 * Returns the agent definitions available in coordinator mode.
 * Called by getBuiltInAgents() when COORDINATOR_MODE is active.
 */
export function getCoordinatorAgents(): BuiltInAgentDefinition[] {
  return [WORKER_AGENT]
}
