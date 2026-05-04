import { AgentTool } from '@mtl-code/builtin-tools/tools/AgentTool/AgentTool.js'
import { AGENT_TOOL_NAME } from '@mtl-code/builtin-tools/tools/AgentTool/constants.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { AssistantMessage } from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import { toolMatchesName } from '../Tool.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import type {
  OpenMythosRuntimeState,
  OpenMythosWorkerAssignment,
  OpenMythosWorkerRole,
  OpenMythosWorkerRun,
} from './openmythosRuntime.js'

type AgentLaunchInput = {
  description: string
  prompt: string
  subagent_type: OpenMythosWorkerRole
  run_in_background: true
}

export type OpenMythosWorkerRuntimeResult = {
  planId: string
  launched: OpenMythosWorkerRun[]
  errors: string[]
}

export function shouldRunOpenMythosWorkerRuntime(
  state: OpenMythosRuntimeState | undefined,
  toolUseContext: ToolUseContext,
): boolean {
  const assignments = state?.card.workerPlan?.assignments ?? []
  if (assignments.length === 0) return false
  if (state?.workerRuntimeAttempted) return false
  if (!isEnvTruthy(process.env.MTL_CODE_OPENMYTHOS_DISPATCH_CONFIRMED)) return false
  return toolUseContext.options.tools.some(tool =>
    toolMatchesName(tool, AGENT_TOOL_NAME),
  )
}

export async function runOpenMythosWorkerRuntime({
  state,
  toolUseContext,
  canUseTool,
  assistantMessage,
}: {
  state: OpenMythosRuntimeState
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
}): Promise<OpenMythosWorkerRuntimeResult> {
  const plan = state.card.workerPlan
  const result: OpenMythosWorkerRuntimeResult = {
    planId: plan?.planId ?? 'unknown',
    launched: [],
    errors: [],
  }

  if (!plan || !shouldRunOpenMythosWorkerRuntime(state, toolUseContext)) {
    return result
  }

  state.workerRuntimeAttempted = true

  const runs = await Promise.all(
    plan.assignments.map((assignment, index) =>
      launchWorkerAssignment({
        planId: plan.planId,
        assignment,
        index,
        toolUseContext,
        canUseTool,
        assistantMessage,
      }),
    ),
  )

  result.launched = runs
  result.errors = runs
    .map(run => run.error)
    .filter((error): error is string => Boolean(error))

  return result
}

async function launchWorkerAssignment({
  planId,
  assignment,
  index,
  toolUseContext,
  canUseTool,
  assistantMessage,
}: {
  planId: string
  assignment: OpenMythosWorkerAssignment
  index: number
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
}): Promise<OpenMythosWorkerRun> {
  const runId = `owr_${assignment.assignmentId.replace(/^owa_/, '')}`
  const input: AgentLaunchInput = {
    description: assignment.description,
    prompt: buildWorkerPrompt(planId, runId, assignment),
    subagent_type: assignment.role,
    run_in_background: true,
  }
  const toolUseId = `openmythos_worker_runtime_${index + 1}`

  try {
    const permission = await canUseTool(
      AgentTool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseId,
    )

    if (permission.behavior !== 'allow') {
      const error = `${assignment.label}: denied by permission policy`
      return {
        runId,
        planId,
        assignmentId: assignment.assignmentId,
        role: assignment.role,
        label: assignment.label,
        status: 'failed',
        error,
      }
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
      outputFile?: string
    }

    if (data.status === 'async_launched') {
      return {
        runId,
        planId,
        assignmentId: assignment.assignmentId,
        role: assignment.role,
        label: assignment.label,
        status: 'running',
        agentId: data.agentId,
        outputFile: data.outputFile,
      }
    }

    return {
      runId,
      planId,
      assignmentId: assignment.assignmentId,
      role: assignment.role,
      label: assignment.label,
      status: 'failed',
      error: `${assignment.label}: agent did not launch asynchronously`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const formatted = `${assignment.label}: ${message}`
    logForDebugging(`OpenMythos WorkerRuntime dispatch failed: ${message}`)
    return {
      runId,
      planId,
      assignmentId: assignment.assignmentId,
      role: assignment.role,
      label: assignment.label,
      status: 'failed',
      error: formatted,
    }
  }
}

export function formatOpenMythosWorkerRuntimeMessage(
  result: OpenMythosWorkerRuntimeResult,
): string {
  const running = result.launched.filter(run => run.status === 'running')
  const failed = result.launched.filter(run => run.status === 'failed')
  const launched = running
    .map((run, index) => {
      const agent = run.agentId ? ` (${run.agentId})` : ''
      const output = run.outputFile ? `; output: ${run.outputFile}` : ''
      return `${index + 1}. ${run.role}: ${run.label}${agent}${output}`
    })
    .join('\n')
  const errors = failed.length
    ? `\n\n未启动的 worker:\n${failed.map(run => `- ${run.label}: ${run.error ?? 'unknown error'}`).join('\n')}`
    : ''

  return [
    `OpenMythos WorkerRuntime 已启动 ${running.length} 个 worker。`,
    `\nplanId: ${result.planId}`,
    launched ? `\n${launched}` : '',
    '\nworker 结果会通过任务通知回到当前会话；我会基于 WorkerReport 继续汇总。',
    errors,
  ]
    .filter(Boolean)
    .join('')
}

function buildWorkerPrompt(
  planId: string,
  runId: string,
  assignment: OpenMythosWorkerAssignment,
): string {
  return [
    assignment.prompt,
    '',
    `WorkerRuntime planId: ${planId}`,
    `WorkerRuntime runId: ${runId}`,
    `WorkerRuntime assignmentId: ${assignment.assignmentId}`,
    '',
    'Your final response must end with this exact WorkerReport shape:',
    '### SUMMARY',
    'One paragraph with the result.',
    '### EVIDENCE',
    'Bullet list of concrete files, commands, or observations.',
    '### CHANGES',
    'Bullet list of files changed, or "None."',
    '### RISKS',
    'Bullet list of unresolved risks, or "None observed."',
    '### BLOCKERS',
    'Bullet list of blockers, or "None."',
  ].join('\n')
}
