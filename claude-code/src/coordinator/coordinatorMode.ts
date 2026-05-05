import { feature } from 'bun:bundle'
import { ASYNC_AGENT_ALLOWED_TOOLS } from '../constants/tools.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { AGENT_SPAWN_TOOL_NAME as AGENT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/AgentTool/constants.js'
import {
  AGENT_CLOSE_TOOL_NAME,
  AGENT_SEND_INPUT_TOOL_NAME as SEND_MESSAGE_TOOL_NAME,
  AGENT_WAIT_TOOL_NAME,
} from '@mtl-code/builtin-tools/tools/AgentControlTool/AgentControlTools.js'
import { BASH_TOOL_NAME } from '@mtl-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@mtl-code/builtin-tools/tools/FileReadTool/prompt.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { TEAM_CREATE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@mtl-code/builtin-tools/tools/TeamDeleteTool/constants.js'
import { isEnvTruthy } from '../utils/envUtils.js'

// Checks the same gate as isScratchpadEnabled() in
// utils/permissions/filesystem.ts. Duplicated here because importing
// filesystem.ts creates a circular dependency (filesystem -> permissions
// -> ... -> coordinatorMode). The actual scratchpad path is passed in via
// getCoordinatorUserContext's scratchpadDir parameter (dependency injection
// from QueryEngine.ts, which lives higher in the dep graph).
function isScratchpadGateEnabled(): boolean {
  return checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_scratch')
}

const INTERNAL_WORKER_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
])

export function isCoordinatorMode(): boolean {
  if (feature('COORDINATOR_MODE')) {
    return isEnvTruthy(process.env.MTL_CODE_COORDINATOR_MODE)
  }
  return false
}

/**
 * Checks if the current coordinator mode matches the session's stored mode.
 * If mismatched, flips the environment variable so isCoordinatorMode() returns
 * the correct value for the resumed session. Returns a warning message if
 * the mode was switched, or undefined if no switch was needed.
 */
export function matchSessionMode(
  sessionMode: 'coordinator' | 'normal' | undefined,
): string | undefined {
  // No stored mode (old session before mode tracking) 鈥?do nothing
  if (!sessionMode) {
    return undefined
  }

  const currentIsCoordinator = isCoordinatorMode()
  const sessionIsCoordinator = sessionMode === 'coordinator'

  if (currentIsCoordinator === sessionIsCoordinator) {
    return undefined
  }

  // Flip the env var 鈥?isCoordinatorMode() reads it live, no caching
  if (sessionIsCoordinator) {
    process.env.MTL_CODE_COORDINATOR_MODE = '1'
  } else {
    delete process.env.MTL_CODE_COORDINATOR_MODE
  }

  logEvent('tengu_coordinator_mode_switched', {
    to: sessionMode as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return sessionIsCoordinator
    ? 'Entered coordinator mode to match resumed session.'
    : 'Exited coordinator mode to match resumed session.'
}

export function getCoordinatorUserContext(
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
): { [k: string]: string } {
  if (!isCoordinatorMode()) {
    return {}
  }

  const workerTools = isEnvTruthy(process.env.MTL_CODE_SIMPLE)
    ? [BASH_TOOL_NAME, FILE_READ_TOOL_NAME, FILE_EDIT_TOOL_NAME]
        .sort()
        .join(', ')
    : Array.from(ASYNC_AGENT_ALLOWED_TOOLS)
        .filter(name => !INTERNAL_WORKER_TOOLS.has(name))
        .sort()
        .join(', ')

  let content = `Workers spawned via the ${AGENT_TOOL_NAME} tool have access to these tools: ${workerTools}`

  if (mcpClients.length > 0) {
    const serverNames = mcpClients.map(c => c.name).join(', ')
    content += `\n\nWorkers also have access to MCP tools from connected MCP servers: ${serverNames}`
  }

  if (scratchpadDir && isScratchpadGateEnabled()) {
    content += `\n\nScratchpad directory: ${scratchpadDir}\nWorkers can read and write here without permission prompts. Use this for durable cross-worker knowledge 鈥?structure files however fits the work.`
  }

  return { workerToolsContext: content }
}

export function getCoordinatorSystemPrompt(): string {
  const workerCapabilities = isEnvTruthy(process.env.MTL_CODE_SIMPLE)
    ? 'Agents have access to Bash, Read, and Edit tools, plus MCP tools from configured MCP servers.'
    : 'Agents have access to standard tools, MCP tools from configured MCP servers, and project skills via the Skill tool.'

  return `You are Argus, an AI assistant that can collaborate with Codex-style subagents when the user explicitly asks for subagents, delegation, or parallel agent work.

## Core Rules

- Do the immediate blocking work locally. Delegate only concrete side tasks that can run in parallel without blocking your next step.
- Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not authorize spawning by themselves.
- OpenMythos is advisory only. It may suggest useful routes, but it never authorizes or starts agents automatically.
- Every message you send is to the user. Agent notifications and tool results are internal signals; summarize useful outcomes instead of pasting internal ids, task notifications, or raw control data.

## Tools

- ${AGENT_TOOL_NAME}({ message | items, agent_type?, fork_context?, model?, reasoning_effort? }) starts an agent and returns { agent_id, nickname }.
- ${AGENT_WAIT_TOOL_NAME}({ targets?, timeout_ms? }) waits for one or more agents and returns final statuses when ready.
- ${SEND_MESSAGE_TOOL_NAME}({ target, message | items, interrupt? }) sends concrete follow-up instructions.
- ${AGENT_CLOSE_TOOL_NAME}({ target }) closes an agent and its descendants.
- list_agents lists known agents; resume_agent reopens a closed agent.

When using ${AGENT_TOOL_NAME}:
- Keep tasks self-contained and bounded.
- Prefer a small number of independent agents launched in one message when parallelism is explicitly requested.
- For code edits, define the files or responsibility owned by each worker and tell it not to revert unrelated changes.
- Do not set model unless the user explicitly asks for a different model or the task clearly requires one.
- Use fork_context only when the child must inherit the exact parent context.
- After launching, continue useful non-overlapping work. Use ${AGENT_WAIT_TOOL_NAME} sparingly, only when the result is needed.

## Roles

Choose an agent_type only when useful:
- default: general task execution.
- explorer: read-only codebase exploration and evidence gathering.
- worker: implementation or verification work with a clear scope.

${workerCapabilities}

## Result Handling

- Use ${AGENT_WAIT_TOOL_NAME} to retrieve completed results.
- Use ${SEND_MESSAGE_TOOL_NAME} only for concrete new instructions, never progress polling.
- Use ${AGENT_CLOSE_TOOL_NAME} only for agents that are still open or no longer needed.
- If an agent fails, summarize the concrete blocker and recovery path for the user; do not expose internal control failures or worker self-talk.`
}
