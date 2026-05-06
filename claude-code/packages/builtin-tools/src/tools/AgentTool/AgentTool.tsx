import { feature } from 'bun:bundle'
import * as React from 'react'
import {
  buildTool,
  type ToolDef,
  type ToolUseContext,
} from 'src/Tool.js'
import type {
  AssistantMessage,
  Message as MessageType,
} from 'src/types/message.js'
import { getQuerySourceForAgent } from 'src/utils/promptCategory.js'
import { z } from 'zod/v4'
import {
  getSessionId,
  getSdkAgentProgressSummariesEnabled,
} from 'src/bootstrap/state.js'
import {
  enhanceSystemPromptWithEnvDetails,
} from 'src/constants/prompts.js'
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  isLocalAgentTask,
  registerAsyncAgent,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { isMainSessionTask } from 'src/tasks/LocalMainSessionTask.js'
import {
  countRunningSubagents,
} from 'src/tasks/subagentRegistry.js'
import { assembleToolPool } from 'src/tools.js'
import { asAgentId } from 'src/types/ids.js'
import {
  getAgentContext,
  isSubagentContext,
  runWithAgentContext,
  type SubagentContext,
} from 'src/utils/agentContext.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { assertSubagentsEnabled } from 'src/utils/subagentFeatureGate.js'
import { errorMessage } from 'src/utils/errors.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  createUserMessage,
} from 'src/utils/messages.js'
import { getAgentModel } from 'src/utils/model/agent.js'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import {
  filterDeniedAgents,
  getDenyRuleForAgent,
} from 'src/utils/permissions/permissions.js'
import { sleep } from 'src/utils/sleep.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { getParentSessionId } from 'src/utils/teammate.js'
import { createAgentId } from 'src/utils/uuid.js'
import { setAgentColor } from './agentColorManager.js'
import {
  isTaskNotificationTriggeredTurn,
  runAsyncAgentLifecycle,
} from './agentToolUtils.js'
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import {
  AGENT_SPAWN_TOOL_NAME,
  AGENT_TOOL_NAME,
} from './constants.js'
import {
  isInForkChild,
} from './forkSubagent.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import {
  filterAgentsByMcpRequirements,
  hasRequiredMcpServers,
  isBuiltInAgent,
} from './loadAgentsDir.js'
import { getPrompt } from './prompt.js'
import { runAgent } from './runAgent.js'
import type { SubagentRuntimeSnapshot } from './subagentRuntimeGuard.js'
import {
  renderGroupedAgentToolUse,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseTag,
  userFacingName,
  userFacingNameBackgroundColor,
} from './UI.js'

function getSpawnParentSessionId(): string {
  const context = getAgentContext()
  return (
    getParentSessionId() ||
    (isSubagentContext(context) ? context.parentSessionId : undefined) ||
    getSessionId() ||
    'main'
  )
}

type ParentSubagentBudgetRegistration = Record<string, never>

function releaseParentSubagentBudget(
  registration: ParentSubagentBudgetRegistration | undefined,
): void {
  void registration
}

function getSessionSubagentMaxActive(): number {
  const value = Number.parseInt(process.env.MTL_CODE_SESSION_SUBAGENT_MAX_ACTIVE ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : 3
}

function validateSessionSubagentCapacity({
  activeTaskCount,
  registryRunningCount,
  maxActive,
}: {
  activeTaskCount: number
  registryRunningCount: number
  maxActive: number
}): void {
  const observedActive = Math.max(activeTaskCount, registryRunningCount)
  if (observedActive >= maxActive) {
    throw new Error(
      `There are already ${observedActive} subagents running in this session. Use wait_agent or close_agent before spawning more.`,
    )
  }
}

function validateSubagentSpawnLifecycle({
  isTaskNotificationTurn,
  isNestedSubagent,
  allowNestedSubagents,
}: {
  isTaskNotificationTurn: boolean
  isNestedSubagent: boolean
  allowNestedSubagents: boolean
}): void {
  if (isTaskNotificationTurn) {
    throw new Error(
      'Do not launch another agent in response to a background agent completion notification. Use wait_agent, summarize the result, or ask the user for missing input.',
    )
  }
  if (isNestedSubagent && !allowNestedSubagents) {
    throw new Error(
      'Nested subagents are disabled. Return DONE, BLOCKED, or NEED_PARENT_INPUT instead of spawning another subagent.',
    )
  }
}

// Multi-agent type constants are defined inline inside gated blocks to enable dead code elimination

// Base input schema without multi-agent parameters
const baseInputSchema = lazySchema(() =>
  z.strictObject({
    message: z.string().describe('Codex-style task prompt for the agent'),
    task_name: z.string().describe('Stable task name for the spawned agent'),
    agent_type: z
      .string()
      .optional()
      .describe('Codex-style specialized agent type to use for this task'),
    fork_turns: z
      .string()
      .optional()
      .describe('Context fork policy: none, all, or a positive number of recent user turns'),
    reasoning_effort: z
      .string()
      .optional()
      .describe('Optional reasoning effort override for the spawned agent'),
    model: z
      .string()
      .optional()
      .describe('Optional model override for the spawned agent.'),
  }),
)

export const inputSchema = lazySchema(() => {
  return baseInputSchema()
})
type InputSchema = ReturnType<typeof inputSchema>

type AgentToolInput = z.infer<ReturnType<typeof baseInputSchema>>

function summarizeAgentPrompt(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'Subagent task'
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized
}

function parseForkTurns(value: string | undefined): 'none' | 'all' | number {
  const normalized = value?.trim().toLowerCase() || 'all'
  if (normalized === 'none' || normalized === 'all') return normalized
  if (/^[1-9]\d*$/.test(normalized)) return Number.parseInt(normalized, 10)
  throw new Error('fork_turns must be "none", "all", or a positive integer string.')
}

function selectForkContextMessages(
  messages: MessageType[],
  forkTurns: 'all' | number,
): MessageType[] {
  if (forkTurns === 'all') return messages
  let userTurns = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === 'user') {
      userTurns += 1
      if (userTurns >= forkTurns) {
        return messages.slice(index)
      }
    }
  }
  return messages
}

// Output schema - multi-agent spawned schema added dynamically at runtime when enabled
export const outputSchema = lazySchema(() => {
  return z.strictObject({
    task_name: z.string().describe('Task name for list_agents, wait_agent, send_message, close_agent, or resume_agent.'),
    nickname: z.string().nullable().optional().describe('Short display nickname when available.'),
  })
})
type OutputSchema = ReturnType<typeof outputSchema>
type CodexSpawnOutput = z.input<OutputSchema>
type AsyncLaunchInternalOutput = {
  task_name: string
  nickname?: string | null
  isAsync: true
  status: 'async_launched'
  description: string
  prompt: string
}
type Output = CodexSpawnOutput | AsyncLaunchInternalOutput

type InternalOutput = Output

import type { AgentToolProgress, ShellProgress } from 'src/types/tools.js'
// AgentTool forwards both its own progress events and shell progress
// events from the sub-agent so the SDK receives tool_progress updates during bash/powershell runs.
export type Progress = AgentToolProgress | ShellProgress

export const AgentTool = buildTool({
  async prompt({ agents, tools, getToolPermissionContext, allowedAgentTypes }) {
    const toolPermissionContext = await getToolPermissionContext()

    // Get MCP servers that have tools available
    const mcpServersWithTools: string[] = []
    for (const tool of tools) {
      if (tool.name?.startsWith('mcp__')) {
        const parts = tool.name.split('__')
        const serverName = parts[1]
        if (serverName && !mcpServersWithTools.includes(serverName)) {
          mcpServersWithTools.push(serverName)
        }
      }
    }

    // Filter agents: first by MCP requirements, then by permission rules
    const agentsWithMcpRequirementsMet = filterAgentsByMcpRequirements(
      agents,
      mcpServersWithTools,
    )
    const filteredAgents = filterDeniedAgents(
      agentsWithMcpRequirementsMet,
      toolPermissionContext,
      AGENT_TOOL_NAME,
    )

    // Use inline env check instead of coordinatorModule to avoid circular
    // dependency issues during test module loading.
    const isCoordinator = feature('COORDINATOR_MODE')
      ? isEnvTruthy(process.env.MTL_CODE_COORDINATOR_MODE)
      : false
    return await getPrompt(filteredAgents, isCoordinator, allowedAgentTypes)
  },
  name: AGENT_TOOL_NAME,
  searchHint: 'delegate work to a subagent',
  aliases: [],
  maxResultSizeChars: 100_000,
  async description() {
    return 'Launch a new agent'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async call(
    {
      message,
      task_name,
      agent_type,
      fork_turns,
      model: modelParam,
    }: AgentToolInput,
    toolUseContext,
    canUseTool,
    assistantMessage,
    onProgress?,
  ) {
    assertSubagentsEnabled()
    const prompt = message.trim()
    const taskName = task_name.trim()
    if (!prompt) {
      throw new Error('spawn_agent requires message.')
    }
    if (!taskName) {
      throw new Error('spawn_agent requires task_name.')
    }
    const description = summarizeAgentPrompt(taskName)
    const forkTurns = parseForkTurns(fork_turns)
    const shouldForkContext = forkTurns !== 'none'
    const requestedAgentType = agent_type
    const startTime = Date.now()
    const model = isCoordinatorMode() ? undefined : modelParam

    // Get app state for permission mode and agent filtering
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode
    // In-process teammates get a no-op setAppState; setAppStateForTasks
    // reaches the root store so task registration/progress/kill stay visible.
    const rootSetAppState =
      toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState

    const currentAgentContext = getAgentContext()
    validateSubagentSpawnLifecycle({
      isTaskNotificationTurn: isTaskNotificationTriggeredTurn(toolUseContext.messages),
      isNestedSubagent: isSubagentContext(currentAgentContext),
      allowNestedSubagents: isEnvTruthy(process.env.MTL_CODE_ALLOW_NESTED_SUBAGENTS),
    })

    let parentBudgetRegistration: ParentSubagentBudgetRegistration | undefined
    const ensureParentSubagentBudget = (agentType: string): ParentSubagentBudgetRegistration => {
      if (parentBudgetRegistration) return parentBudgetRegistration
      void agentType
      void prompt
      parentBudgetRegistration = {}
      return parentBudgetRegistration
    }
    const ensureSessionSubagentCapacity = (): void => {
      const activeSubagents = Object.values(
        toolUseContext.getAppState().tasks,
      ).filter(
        task =>
          isLocalAgentTask(task) &&
          !isMainSessionTask(task) &&
          (task.status === 'pending' || task.status === 'running'),
      )
      const sessionMaxActiveSubagents = getSessionSubagentMaxActive()
      const parentSessionId = getSpawnParentSessionId()
      const registryRunningSubagents = countRunningSubagents(parentSessionId)
      validateSessionSubagentCapacity({
        activeTaskCount: activeSubagents.length,
        registryRunningCount: registryRunningSubagents,
        maxActive: sessionMaxActiveSubagents,
      })
      const normalizedCurrentObjective = description.trim().toLowerCase()
      const duplicateActiveSubagent = activeSubagents.find(
        task => task.description.trim().toLowerCase() === normalizedCurrentObjective,
      )
      if (duplicateActiveSubagent) {
        throw new Error(
          `A subagent for "${description}" is already running${duplicateActiveSubagent ? ` (${duplicateActiveSubagent.id})` : ''}. Do not launch another one for the same objective; wait for its result or cancel the existing agent first.`,
        )
      }
    }

    const effectiveType = requestedAgentType ?? 'default'

    let selectedAgent: AgentDefinition
    if (shouldForkContext) {
      // Recursive fork guard: fork children keep the Agent tool in their
      // pool for cache-identical tool defs, so reject fork attempts at call
      // time. Primary check is querySource (compaction-resistant; set on
      // context.options at spawn time, survives autocompact's message
      // rewrite). Message-scan fallback catches any path where querySource
      // wasn't threaded.
      if (
        toolUseContext.options.querySource ===
          'agent:builtin:fork' ||
        isInForkChild(toolUseContext.messages)
      ) {
        throw new Error(
          'Fork is not available inside a forked worker. Complete your task directly using your tools.',
        )
      }
    }
    {
      // Filter agents to exclude those denied via Agent(AgentName) syntax
      const allAgents = toolUseContext.options.agentDefinitions.activeAgents
      const { allowedAgentTypes } = toolUseContext.options.agentDefinitions
      const agents = filterDeniedAgents(
        // When allowedAgentTypes is set (from Agent(x,y) tool spec), restrict to those types
        allowedAgentTypes
          ? allAgents.filter(a => allowedAgentTypes.includes(a.agentType))
          : allAgents,
        appState.toolPermissionContext,
        AGENT_TOOL_NAME,
      )

      const found =
        agents.find(agent => agent.agentType === effectiveType) ??
        (requestedAgentType
          ? undefined
          : agents.find(agent => agent.agentType === GENERAL_PURPOSE_AGENT.agentType) ??
            GENERAL_PURPOSE_AGENT)
      if (!found) {
        const missingAgentType = effectiveType ?? 'default'
        // Check if the agent exists but is denied by permission rules
        const agentExistsButDenied = allAgents.find(
          agent => agent.agentType === missingAgentType,
        )
        if (agentExistsButDenied) {
          const denyRule = getDenyRuleForAgent(
            appState.toolPermissionContext,
            AGENT_TOOL_NAME,
            missingAgentType,
          )
          throw new Error(
            `Agent type '${missingAgentType}' has been denied by permission rule '${AGENT_TOOL_NAME}(${missingAgentType})' from ${denyRule?.source ?? 'settings'}.`,
          )
        }
        throw new Error(
          `Agent type '${missingAgentType}' not found. Available agents: ${agents
            .map(a => a.agentType)
            .join(', ')}`,
        )
      }
      selectedAgent = found
    }

    // Capture for type narrowing: `let selectedAgent` prevents TS from
    // narrowing property types across the if-else assignment above.
    const requiredMcpServers = selectedAgent.requiredMcpServers

    // Check if required MCP servers have tools available
    // A server that's connected but not authenticated won't have any tools
    if (requiredMcpServers?.length) {
      // If any required servers are still pending (connecting), wait for them
      // before checking tool availability. This avoids a race condition where
      // the agent is invoked before MCP servers finish connecting.
      const hasPendingRequiredServers = appState.mcp.clients.some(
        c =>
          c.type === 'pending' &&
          requiredMcpServers.some(pattern =>
            c.name.toLowerCase().includes(pattern.toLowerCase()),
          ),
      )

      let currentAppState = appState
      if (hasPendingRequiredServers) {
        const MAX_WAIT_MS = 30_000
        const POLL_INTERVAL_MS = 500
        const deadline = Date.now() + MAX_WAIT_MS

        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS)
          currentAppState = toolUseContext.getAppState()

          // Early exit: if any required server has already failed, no point
          // waiting for other pending servers; the check will fail regardless.
          const hasFailedRequiredServer = currentAppState.mcp.clients.some(
            c =>
              c.type === 'failed' &&
              requiredMcpServers.some(pattern =>
                c.name.toLowerCase().includes(pattern.toLowerCase()),
              ),
          )
          if (hasFailedRequiredServer) break

          const stillPending = currentAppState.mcp.clients.some(
            c =>
              c.type === 'pending' &&
              requiredMcpServers.some(pattern =>
                c.name.toLowerCase().includes(pattern.toLowerCase()),
              ),
          )
          if (!stillPending) break
        }
      }

      // Get servers that actually have tools (meaning they're connected AND authenticated)
      const serversWithTools: string[] = []
      for (const tool of currentAppState.mcp.tools) {
        if (tool.name?.startsWith('mcp__')) {
          // Extract server name from tool name (format: mcp__serverName__toolName)
          const parts = tool.name.split('__')
          const serverName = parts[1]
          if (serverName && !serversWithTools.includes(serverName)) {
            serversWithTools.push(serverName)
          }
        }
      }

      if (!hasRequiredMcpServers(selectedAgent, serversWithTools)) {
        const missing = requiredMcpServers.filter(
          pattern =>
            !serversWithTools.some(server =>
              server.toLowerCase().includes(pattern.toLowerCase()),
            ),
        )
        throw new Error(
          `Agent '${selectedAgent.agentType}' requires MCP servers matching: ${missing.join(', ')}. ` +
            `MCP servers with tools: ${serversWithTools.length > 0 ? serversWithTools.join(', ') : 'none'}. ` +
            `Use /mcp to configure and authenticate the required MCP servers.`,
        )
      }
    }

    // Initialize the color for this agent if it has a predefined one
    if (selectedAgent.color) {
      setAgentColor(selectedAgent.agentType, selectedAgent.color)
    }

    // Resolve agent params for logging (these are already resolved in runAgent)
    const resolvedAgentModel = getAgentModel(
      selectedAgent.model,
      toolUseContext.options.mainLoopModel,
      model as Parameters<typeof getAgentModel>[2],
      permissionMode,
    )

    logEvent('tengu_agent_tool_selected', {
      agent_type:
        selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model:
        resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source:
        selectedAgent.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      color:
        selectedAgent.color as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      is_built_in_agent: isBuiltInAgent(selectedAgent),
      is_resume: false,
      is_async: true,
      is_fork: shouldForkContext,
    })

    let enhancedSystemPrompt: string[] | undefined
    let promptMessages: MessageType[]

    try {
      const additionalWorkingDirectories = Array.from(
        appState.toolPermissionContext.additionalWorkingDirectories.keys(),
      )

      const agentPrompt = selectedAgent.getSystemPrompt({ toolUseContext })

      if (selectedAgent.memory) {
        logEvent('tengu_agent_memory_loaded', {
          ...(process.env.USER_TYPE === 'ant' && {
            agent_type:
              selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }),
          scope:
            selectedAgent.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source:
            'subagent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }

      enhancedSystemPrompt = await enhanceSystemPromptWithEnvDetails(
        [agentPrompt],
        resolvedAgentModel,
        additionalWorkingDirectories,
      )
    } catch (error) {
      logForDebugging(
        `Failed to get system prompt for agent ${selectedAgent.agentType}: ${errorMessage(error)}`,
      )
    }
    promptMessages = [createUserMessage({ content: prompt })]

    const metadata = {
      prompt,
      resolvedAgentModel,
      isBuiltInAgent: isBuiltInAgent(selectedAgent),
      startTime,
      agentType: selectedAgent.agentType,
      isAsync: true,
    }

    // Use inline env check instead of coordinatorModule to avoid circular
    // dependency issues during test module loading.
    const isCoordinator = feature('COORDINATOR_MODE')
      ? isEnvTruthy(process.env.MTL_CODE_COORDINATOR_MODE)
      : false

    // Assemble the worker's tool pool independently of the parent's.
    // Workers always get their tools from assembleToolPool with their own
    // permission mode, so they aren't affected by the parent's tool
    // restrictions. This is computed here so that runAgent doesn't need to
    // import from tools.ts (which would create a circular dependency).
    const workerPermissionContext = {
      ...appState.toolPermissionContext,
      mode: selectedAgent.permissionMode ?? 'acceptEdits',
    }
    const workerTools = assembleToolPool(
      workerPermissionContext,
      appState.mcp.tools,
    )

    // Create a stable agent ID before registration so the thread graph can
    // use it as the child thread id.
    const earlyAgentId = createAgentId()

    const runAgentParams: Parameters<typeof runAgent>[0] = {
      agentDefinition: selectedAgent,
      promptMessages,
      toolUseContext,
      canUseTool,
      isAsync: true,
      querySource:
        toolUseContext.options.querySource ??
        getQuerySourceForAgent(
          selectedAgent.agentType,
          isBuiltInAgent(selectedAgent),
        ),
      model: model as Parameters<typeof getAgentModel>[2],
      // Fork path: pass parent's system prompt AND parent's exact tool
      // array (cache-identical prefix). workerTools is rebuilt under
      // permissionMode 'bubble' which differs from the parent's mode, so
      // its tool-def serialization diverges and breaks cache at the first
      // differing tool. useExactTools also inherits the parent's
      // thinkingConfig and isNonInteractiveSession (see runAgent.ts).
      //
      override: enhancedSystemPrompt
          ? { systemPrompt: asSystemPrompt(enhancedSystemPrompt) }
          : undefined,
      availableTools: workerTools,
      forkContextMessages:
        shouldForkContext
          ? selectForkContextMessages(toolUseContext.messages, forkTurns)
          : undefined,
      description,
    }

    const wrapWithCwd = <T,>(fn: () => T): T => fn()

    const cleanupWorktreeIfNeeded = async (): Promise<{
      worktreePath?: string
      worktreeBranch?: string
    }> => ({})

    ensureParentSubagentBudget(selectedAgent.agentType)

    try {
      ensureSessionSubagentCapacity()
    } catch (error) {
      releaseParentSubagentBudget(parentBudgetRegistration)
      throw error
    }

    {
      const activeBackgroundAgents = Object.values(
        toolUseContext.getAppState().tasks,
      ).filter(
        task =>
          isLocalAgentTask(task) &&
          (task.status === 'pending' || task.status === 'running') &&
          task.isBackgrounded,
      )
      const normalizedDescription = description.trim().toLowerCase()
      const duplicateBackgroundAgent = activeBackgroundAgents.find(
        task => task.description.trim().toLowerCase() === normalizedDescription,
      )
      if (duplicateBackgroundAgent) {
        releaseParentSubagentBudget(parentBudgetRegistration)
        throw new Error(
          `A background agent for "${description}" is already running (${duplicateBackgroundAgent.id}). Do not launch another one for the same objective; wait for its completion notification or continue with non-overlapping work.`,
        )
      }
      if (activeBackgroundAgents.length >= 4) {
        releaseParentSubagentBudget(parentBudgetRegistration)
        throw new Error(
          `There are already ${activeBackgroundAgents.length} background agents running. Do not launch more agents now; wait for completion notifications or stop redundant agents first.`,
        )
      }

      const asyncAgentId = earlyAgentId
      let agentBackgroundTask: ReturnType<typeof registerAsyncAgent>
      try {
        agentBackgroundTask = registerAsyncAgent({
          agentId: asyncAgentId,
          description,
          prompt,
          selectedAgent,
          setAppState: rootSetAppState,
          // Don't link to parent's abort controller -- background agents should
          // survive when the user presses ESC to cancel the main thread.
          // They are killed explicitly via chat:killAgents.
          toolUseId: toolUseContext.toolUseId,
          sessionId: getParentSessionId(),
          taskName,
        })
      } catch (error) {
        releaseParentSubagentBudget(parentBudgetRegistration)
        throw error
      }

      // Wrap async agent execution in agent context for analytics attribution
      const asyncAgentContext: SubagentContext = {
        agentId: asyncAgentId,
        // For subagents from teammates: use team lead's session
        // For subagents from main REPL: undefined (no parent session)
        parentSessionId: getParentSessionId(),
        agentType: 'subagent' as const,
        subagentName: selectedAgent.agentType,
        isBuiltIn: isBuiltInAgent(selectedAgent),
        invokingRequestId: assistantMessage?.requestId as string | undefined,
        invocationKind: 'spawn' as const,
        invocationEmitted: false,
      }

      // Workload propagation: handlePromptSubmit wraps the entire turn in
      // runWithWorkload (AsyncLocalStorage). ALS context is captured at
      // invocation time and survives every await
      // inside. No capture/restore needed; the detached closure sees the
      // parent turn's workload automatically, isolated from its finally.
      void runWithAgentContext(asyncAgentContext, () =>
        wrapWithCwd(async () => {
          try {
            await runAsyncAgentLifecycle({
              taskId: agentBackgroundTask.agentId,
              abortController: agentBackgroundTask.abortController!,
              makeStream: (onCacheSafeParams, onRuntimeStatus) =>
                runAgent({
                  ...runAgentParams,
                  override: {
                    ...runAgentParams.override,
                    agentId: asAgentId(agentBackgroundTask.agentId),
                    abortController: agentBackgroundTask.abortController!,
                  },
                  onCacheSafeParams,
                  onRuntimeStatus,
                }),
              metadata,
              description,
              toolUseContext,
              rootSetAppState,
              agentIdForCleanup: asyncAgentId,
              enableSummarization:
                isCoordinator ||
                shouldForkContext ||
                getSdkAgentProgressSummariesEnabled(),
              getWorktreeResult: cleanupWorktreeIfNeeded,
            })
          } finally {
            releaseParentSubagentBudget(parentBudgetRegistration)
          }
        }),
      )

      return {
        data: {
          isAsync: true as const,
          status: 'async_launched' as const,
          task_name: taskName,
          nickname: selectedAgent.agentType ?? null,
          description: description,
          prompt: prompt,
        },
      }
    }
  },
  isReadOnly() {
    return true // delegates permission checks to its underlying tools
  },
  toAutoClassifierInput(input) {
    const i = input as AgentToolInput
    const tags = [i.agent_type].filter((t): t is string => t !== undefined)
    const prefix = tags.length > 0 ? `(${tags.join(', ')}): ` : ': '
    return `${prefix}${i.message ?? ''}`
  },
  isConcurrencySafe() {
    return true
  },
  userFacingName,
  userFacingNameBackgroundColor,
  getActivityDescription(input) {
    return input?.task_name ?? input?.message ?? 'Running agent'
  },
  async checkPermissions(input, context): Promise<PermissionResult> {
    const appState = context.getAppState()

    // Only route through auto mode classifier when in auto mode
    // In all other modes, auto-approve sub-agent generation
    // Note: process.env.USER_TYPE === 'ant' guard enables dead code elimination for external builds
    if (
      process.env.USER_TYPE === 'ant' &&
      appState.toolPermissionContext.mode === 'auto'
    ) {
      return {
        behavior: 'passthrough',
        message: 'Agent tool requires permission to spawn sub-agents.',
      }
    }

    return { behavior: 'allow', updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    const internalData = data as InternalOutput
    if ('status' in data && data.status === 'async_launched') {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: jsonStringify({
          task_name: data.task_name,
          nickname: data.nickname ?? null,
        }),
      }
    }
    throw new Error(
      `Unexpected agent tool result status: ${(data as { status?: string }).status ?? 'unknown'}`,
    )
  },
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseTag,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderGroupedToolUse: renderGroupedAgentToolUse,
} satisfies ToolDef<InputSchema, Output, Progress>)

export const SpawnAgentTool = {
  ...AgentTool,
  name: AGENT_SPAWN_TOOL_NAME,
  aliases: [],
  userFacingName() {
    return AGENT_SPAWN_TOOL_NAME
  },
  async description() {
    return 'Spawn a managed subagent through the Subagent Runtime'
  },
} satisfies typeof AgentTool
