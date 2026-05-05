import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../Tool.js'
import type { AssistantMessage } from '../types/message.js'
import type { DispatchProposal } from '../tasks/subagentDispatch.js'
import type {
  OpenMythosRuntimeState,
  OpenMythosWorkerAssignment,
  OpenMythosWorkerRun,
} from './openmythosRuntime.js'

export type OpenMythosWorkerRuntimeResult = {
  planId: string
  launched: OpenMythosWorkerRun[]
  proposals: DispatchProposal[]
  errors: string[]
}

export function shouldRunOpenMythosWorkerRuntime(
  _state: OpenMythosRuntimeState | undefined,
  _toolUseContext: ToolUseContext,
): boolean {
  return false
}

export async function runOpenMythosWorkerRuntime({
  state,
  toolUseContext: _toolUseContext,
  canUseTool: _canUseTool,
  assistantMessage: _assistantMessage,
}: {
  state: OpenMythosRuntimeState
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
}): Promise<OpenMythosWorkerRuntimeResult> {
  const plan = state.card.workerPlan
  return {
    planId: plan?.planId ?? 'unknown',
    launched: [],
    proposals: plan ? [buildDispatchProposal(plan.planId, plan.assignments)] : [],
    errors: [],
  }
}

export function formatOpenMythosWorkerRuntimeMessage(
  result: OpenMythosWorkerRuntimeResult,
): string {
  return [
    'OpenMythos WorkerRuntime is proposal-only; no workers were launched.',
    `planId: ${result.planId}`,
    `proposals: ${result.proposals.length}`,
  ].join('\n')
}

function buildDispatchProposal(
  planId: string,
  assignments: OpenMythosWorkerAssignment[],
): DispatchProposal {
  return {
    proposalId: planId,
    sessionId: 'openmythos-proposal',
    userTurnId: planId,
    executionMode: assignments.length > 1 ? 'parallel' : 'mixed',
    mergeStrategy:
      'Use AgentDispatchPlan at runtime with real local tool events; merge only AgentResult evidence-backed DONE results.',
    steps: [
      {
        id: 'parent-local-orientation',
        type: 'local',
        objective:
          'Parent completes local orientation and records concrete local tool events before dispatch.',
        dependsOn: [],
        canRunParallel: false,
        stopCondition: 'DONE',
        requiredEvents: [
          {
            type: 'tool_completed',
            status: 'ok',
          },
        ],
      },
      ...assignments.map(assignment => stepFromAssignment(assignment)),
    ],
  }
}

function stepFromAssignment(assignment: OpenMythosWorkerAssignment) {
  return {
    id: assignment.assignmentId,
    type: 'subagent' as const,
    objective: assignment.objective,
    role: assignment.role,
    dependsOn: ['parent-local-orientation'],
    canRunParallel: true,
    stopCondition: 'DONE' as const,
    expectedResult:
      'STATUS/SUMMARY/EVIDENCE/NEXT_ACTION/CHANGES/BLOCKERS with concrete evidence only.',
  }
}
