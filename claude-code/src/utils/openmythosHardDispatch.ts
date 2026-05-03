import { AgentTool } from '@mtl-code/builtin-tools/tools/AgentTool/AgentTool.js'
import { AGENT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/AgentTool/constants.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { AssistantMessage } from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import { toolMatchesName } from '../Tool.js'
import { logForDebugging } from './debug.js'
import type {
  OpenMythosDispatchTask,
  OpenMythosRuntimeState,
} from './openmythosRuntime.js'

type AgentLaunchInput = {
  description: string
  prompt: string
  subagent_type: 'worker'
  run_in_background: true
}

export type OpenMythosHardDispatchLaunch = {
  kind: OpenMythosDispatchTask['kind']
  label: string
  description: string
  agentId?: string
}

export type OpenMythosHardDispatchResult = {
  launched: OpenMythosHardDispatchLaunch[]
  errors: string[]
}

export function shouldRunOpenMythosHardDispatch(
  state: OpenMythosRuntimeState | undefined,
  toolUseContext: ToolUseContext,
): boolean {
  if (!state?.card.dispatchPlan.length) return false
  if (state.hardDispatchAttempted) return false
  if (isEnvDisabled(process.env.MTL_CODE_OPENMYTHOS_HARD_DISPATCH)) {
    return false
  }
  return toolUseContext.options.tools.some(tool =>
    toolMatchesName(tool, AGENT_TOOL_NAME),
  )
}

export async function runOpenMythosHardDispatch({
  state,
  toolUseContext,
  canUseTool,
  assistantMessage,
}: {
  state: OpenMythosRuntimeState
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
}): Promise<OpenMythosHardDispatchResult> {
  const result: OpenMythosHardDispatchResult = {
    launched: [],
    errors: [],
  }

  if (!shouldRunOpenMythosHardDispatch(state, toolUseContext)) {
    return result
  }

  state.hardDispatchAttempted = true

  for (const [index, task] of state.card.dispatchPlan.entries()) {
    const input: AgentLaunchInput = {
      description: task.description,
      prompt: task.prompt,
      subagent_type: 'worker',
      run_in_background: true,
    }
    const toolUseId = `openmythos_hard_dispatch_${index + 1}`

    try {
      const permission = await canUseTool(
        AgentTool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseId,
      )

      if (permission.behavior !== 'allow') {
        result.errors.push(`${task.label}: denied by permission policy`)
        continue
      }

      const finalInput = (permission.updatedInput ?? input) as AgentLaunchInput
      const launch = await AgentTool.call(
        finalInput,
        toolUseContext,
        canUseTool,
        assistantMessage,
      )
      const data = launch.data as {
        status?: string
        agentId?: string
        description?: string
      }

      if (data.status === 'async_launched') {
        result.launched.push({
          kind: task.kind,
          label: task.label,
          description: data.description ?? task.description,
          agentId: data.agentId,
        })
      } else {
        result.errors.push(`${task.label}: agent did not launch asynchronously`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${task.label}: ${message}`)
      logForDebugging(`OpenMythos hard dispatch failed: ${message}`)
    }
  }

  return result
}

export function formatOpenMythosHardDispatchMessage(
  result: OpenMythosHardDispatchResult,
): string {
  const launched = result.launched
    .map((item, index) => {
      const suffix = item.agentId ? ` (${item.agentId})` : ''
      return `${index + 1}. ${item.label}: ${item.description}${suffix}`
    })
    .join('\n')
  const errors = result.errors.length
    ? `\n\n未派发的 worker:\n${result.errors.map(error => `- ${error}`).join('\n')}`
    : ''

  return [
    `OpenMythos 已启动 ${result.launched.length} 个 worker。`,
    launched ? `\n${launched}` : '',
    '\nworker 结果会通过任务通知回到当前会话，我会基于结果继续汇总和执行下一步。',
    errors,
  ]
    .filter(Boolean)
    .join('')
}

function isEnvDisabled(value: string | undefined): boolean {
  if (value === undefined) return false
  return ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}
