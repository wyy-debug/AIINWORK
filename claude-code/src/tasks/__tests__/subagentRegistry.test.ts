import { beforeEach, describe, expect, test } from 'bun:test'
import {
  cancelSubagentRecord,
  clearSubagentRegistryForTests,
  completeSubagentRecord,
  countRunningSubagents,
  getSubagentRecord,
  hasRunningSubagentForObjective,
  listSubagentRecords,
  parseSubagentProtocolResult,
  registerSubagentRecord,
  updateSubagentRuntimeRecord,
} from '../subagentRegistry'

describe('subagentRegistry', () => {
  beforeEach(() => {
    clearSubagentRegistryForTests()
  })

  test('registers and lists running records by session', () => {
    registerSubagentRecord({
      taskId: 'task-1',
      sessionId: 'session-a',
      objective: 'Read skill file',
      selectedAgent: { agentType: 'worker' } as any,
    })
    registerSubagentRecord({
      taskId: 'task-2',
      sessionId: 'session-b',
      objective: 'Fetch crash URL',
      selectedAgent: { agentType: 'worker' } as any,
    })

    expect(countRunningSubagents('session-a')).toBe(1)
    expect(countRunningSubagents('session-b')).toBe(1)
    expect(hasRunningSubagentForObjective('Read skill file', 'session-a')).toBe(true)
    expect(hasRunningSubagentForObjective('Read skill file', 'session-b')).toBe(false)
    expect(listSubagentRecords({ runningOnly: true })).toHaveLength(2)
  })

  test('runtime terminal status marks a record blocked', () => {
    registerSubagentRecord({
      taskId: 'task-1',
      sessionId: 'session-a',
      objective: 'Read skill file',
      selectedAgent: { agentType: 'worker' } as any,
    })

    updateSubagentRuntimeRecord('task-1', {
      objective: 'Read skill file',
      runtimeStatus: 'BLOCKED',
      stopReason: 'Repeated identical file read.',
      currentStep: 2,
      maxSteps: 15,
      remainingSteps: 13,
      startedAt: Date.now() - 1_000,
      elapsedMs: 1_000,
      lastTool: 'Read',
      recentActions: ['Read SKILL.md'],
    })

    const record = getSubagentRecord('task-1')
    expect(record?.status).toBe('blocked')
    expect(record?.runtimeStatus).toBe('BLOCKED')
    expect(record?.stopReason).toContain('Repeated')
    expect(typeof record?.endedAt).toBe('number')
  })

  test('parses structured completion protocol', () => {
    const protocol = parseSubagentProtocolResult(`### STATUS
DONE

### SUMMARY
Crash page requires login.

### EVIDENCE
- HTTP 401

### NEXT_ACTION
Ask user for exported data.`)

    expect(protocol.status).toBe('DONE')
    expect(protocol.summary).toBe('Crash page requires login.')
    expect(protocol.evidence).toContain('401')
    expect(protocol.nextAction).toContain('exported data')
  })

  test('complete and cancel produce terminal records', () => {
    registerSubagentRecord({
      taskId: 'task-1',
      sessionId: 'session-a',
      objective: 'Analyze crash',
      selectedAgent: { agentType: 'worker' } as any,
    })

    completeSubagentRecord({
      agentId: 'task-1',
      content: [
        {
          type: 'text',
          text: `### STATUS
NEED_PARENT_INPUT

### SUMMARY
CrashSight requires login.

### EVIDENCE
No public crash payload was available.

### NEXT_ACTION
Provide exported crash data.`,
        },
      ],
      usage: { input_tokens: 0, output_tokens: 0 },
      totalDurationMs: 1,
      totalTokens: 0,
      totalToolUseCount: 0,
    } as any)

    expect(getSubagentRecord('task-1')?.status).toBe('need_parent_input')
    expect(getSubagentRecord('task-1')?.resultSummary).toContain('CrashSight')

    registerSubagentRecord({
      taskId: 'task-2',
      sessionId: 'session-a',
      objective: 'Fetch URL',
      selectedAgent: { agentType: 'worker' } as any,
    })
    cancelSubagentRecord('task-2', 'User stopped it.')
    expect(getSubagentRecord('task-2')?.status).toBe('cancelled')
    expect(getSubagentRecord('task-2')?.runtimeStatus).toBe('BLOCKED')
  })
})
