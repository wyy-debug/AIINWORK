/**
 * Codex-style built-in agent definitions used when collaborative subagents are
 * enabled. OpenMythos no longer owns dispatch; these roles are only exposed to
 * spawn_agent after the user explicitly asks for subagents, delegation, or
 * parallel agent work.
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

function getAgentTools(options: { readonlyOnly?: boolean } = {}): string[] {
  return Array.from(ASYNC_AGENT_ALLOWED_TOOLS).filter(name => {
    if (INTERNAL_ORCHESTRATION_TOOLS.has(name)) return false
    if (options.readonlyOnly && WRITE_TOOLS.has(name)) return false
    return true
  })
}

function promptFor(role: string, guidance: string): string {
  return `You are ${role}, an Argus subagent spawned through Codex-style collaborative agent tools.

${guidance}

Rules:
- Stay within the assigned scope.
- Do not revert unrelated user changes.
- Do not expose internal agent-control failures to the user.
- Do not create documentation files unless explicitly instructed.
- Final answer must list the concrete files changed or inspected, commands run, and any remaining risks.`
}

const DEFAULT_AGENT: BuiltInAgentDefinition = {
  agentType: 'default',
  whenToUse: 'Default collaborative agent for a well-scoped delegated task.',
  tools: getAgentTools(),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    promptFor(
      'a default Argus collaborative agent',
      'Handle the delegated task end to end. Make focused changes only when the prompt explicitly asks for implementation.',
    ),
}

const EXPLORER_AGENT: BuiltInAgentDefinition = {
  agentType: 'explorer',
  whenToUse:
    'Read-only codebase exploration agent for answering specific, scoped questions.',
  tools: getAgentTools({ readonlyOnly: true }),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    promptFor(
      'an Argus explorer agent',
      'Read, search, inspect, and map relevant code or evidence. Do not edit, write, move, or delete files.',
    ),
}

const WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker',
  whenToUse:
    'Execution agent for a bounded implementation or verification task with clear ownership.',
  tools: getAgentTools(),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () =>
    promptFor(
      'an Argus worker agent',
      'Implement or verify the assigned scope. Respect the file ownership described by the parent agent and adapt to existing changes without reverting them.',
    ),
}

export function getCoordinatorAgents(): BuiltInAgentDefinition[] {
  return [DEFAULT_AGENT, EXPLORER_AGENT, WORKER_AGENT]
}
