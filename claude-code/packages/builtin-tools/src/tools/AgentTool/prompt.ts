import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'
import { AGENT_SPAWN_TOOL_NAME } from './constants.js'
import type { AgentDefinition } from './loadAgentsDir.js'

function getToolsDescription(agent: AgentDefinition): string {
  const { tools, disallowedTools } = agent
  const hasAllowlist = tools && tools.length > 0
  const hasDenylist = disallowedTools && disallowedTools.length > 0

  if (hasAllowlist && hasDenylist) {
    const denySet = new Set(disallowedTools)
    const effectiveTools = tools.filter(t => !denySet.has(t))
    return effectiveTools.length === 0 ? 'None' : effectiveTools.join(', ')
  }
  if (hasAllowlist) return tools.join(', ')
  if (hasDenylist) return `All tools except ${disallowedTools.join(', ')}`
  return 'All tools'
}

/**
 * Format one agent line for the agent_listing_delta attachment message:
 * `- type: whenToUse (Tools: ...)`.
 */
export function formatAgentLine(agent: AgentDefinition): string {
  const toolsDescription = getToolsDescription(agent)
  return `- ${agent.agentType}: ${agent.whenToUse} (Tools: ${toolsDescription})`
}

/**
 * Whether the agent list should be injected as an attachment message instead
 * of embedded in the tool description. When true, getPrompt() returns a static
 * description and attachments.ts emits an agent_listing_delta attachment.
 */
export function shouldInjectAgentListInMessages(): boolean {
  if (isEnvTruthy(process.env.MTL_CODE_AGENT_LIST_IN_MESSAGES)) return true
  if (isEnvDefinedFalsy(process.env.MTL_CODE_AGENT_LIST_IN_MESSAGES)) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_agent_list_attach', false)
}

export async function getPrompt(
  agentDefinitions: AgentDefinition[],
  _isCoordinator?: boolean,
  allowedAgentTypes?: string[],
): Promise<string> {
  const effectiveAgents = allowedAgentTypes
    ? agentDefinitions.filter(a => allowedAgentTypes.includes(a.agentType))
    : agentDefinitions

  const listViaAttachment = shouldInjectAgentListInMessages()
  const agentListSection = listViaAttachment
    ? 'Available agent types are listed in <system-reminder> messages in the conversation.'
    : `Available agent types and the tools they have access to:
${effectiveAgents.map(agent => formatAgentLine(agent)).join('\n')}`

  return `Spawn a sub-agent for a well-scoped task. Returns the spawned agent id plus the user-facing nickname when available. Spawned agents inherit your current model by default. Omit \`model\` to use that preferred default; set \`model\` only when an explicit override is needed.

${agentListSection}

This spawn_agent tool provides access to collaborative sub-agents. Follow these rules:

- Only use \`${AGENT_SPAWN_TOOL_NAME}\` if and only if the user explicitly asks for sub-agents, delegation, or parallel agent work.
- Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn.
- Agent-role guidance only helps choose which agent to use after spawning is already authorized; it never authorizes spawning by itself.
- Quickly decide what immediate work you should do locally. Delegate only concrete, bounded side tasks that can run in parallel and materially advance the user's goal.
- Do not delegate urgent blocking work when your next action depends on that result. Do the blocking work locally.
- Keep delegated tasks self-contained and avoid duplicating work between the parent and child agents.
- For coding subtasks, specify the files or modules the worker owns, and tell the worker not to revert unrelated changes.
- After spawning, continue useful non-overlapping local work. Use wait_agent sparingly, only when you need the result for the next critical step.
- Use send_input only for concrete new instructions. Do not use it for progress polling.
- Use close_agent for agents that are no longer needed. Use resume_agent to reopen a closed agent.

Use the Codex-style parameters only:
- \`message\` or \`items\` for the task input.
- \`agent_type\` for the role, when a specific role is useful.
- \`fork_context\` only when the child needs the exact parent context.
- \`model\` and \`reasoning_effort\` only when the user explicitly requests them or the task clearly requires them.`
}
