import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  parseSubagentProtocolResult,
  SubagentManager,
} from '../subagentRegistry.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function statePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mtl-subagents-'))
  tempDirs.push(dir)
  return join(dir, 'subagents.v1.json')
}

describe('SubagentManager', () => {
  test('persists records and restores stale running tasks as interrupted', () => {
    const filePath = statePath()
    const manager = new SubagentManager(filePath)

    manager.register({
      taskId: 'agent-1',
      agentId: 'agent-1',
      sessionId: 'session-a',
      objective: 'Fetch crash page',
      prompt: 'Fetch the page and report evidence.',
      stepBudget: 15,
    })

    const restored = new SubagentManager(filePath)
    const record = restored.get('agent-1')

    expect(record?.status).toBe('interrupted')
    expect(record?.runtimeStatus).toBe('BLOCKED')
    expect(record?.hasLiveHandle).toBe(false)
    expect(restored.countRunning('session-a')).toBe(0)
  })

  test('parses structured terminal results into canonical fields', () => {
    const filePath = statePath()
    const manager = new SubagentManager(filePath)
    manager.register({
      taskId: 'agent-2',
      agentId: 'agent-2',
      objective: 'Review auth migration',
    })

    const record = manager.complete({
      agentId: 'agent-2',
      content: [
        {
          type: 'text',
          text: [
            '### STATUS',
            'DONE',
            '### SUMMARY',
            'Migration is safe after backfill validation.',
            '### EVIDENCE',
            'Checked migration and tests.',
            '### NEXT_ACTION',
            'Run CI.',
            '### CHANGES',
            'No file changes.',
            '### BLOCKERS',
            'None.',
          ].join('\n'),
        },
      ],
      totalDurationMs: 42,
      totalTokens: 123,
      totalToolUseCount: 2,
    } as any)

    expect(record?.status).toBe('completed')
    expect(record?.resultSummary).toBe('Migration is safe after backfill validation.')
    expect(record?.evidence).toBe('Checked migration and tests.')
    expect(record?.nextAction).toBe('Run CI.')
    expect(record?.changes).toBe('No file changes.')
    expect(record?.blockers).toBe('None.')
    expect(record?.events.at(-1)?.type).toBe('completed')
  })

  test('tracks running objective dedupe by session', () => {
    const manager = new SubagentManager(statePath())
    manager.register({
      taskId: 'agent-3',
      sessionId: 'session-a',
      objective: 'Read SKILL.md',
    })

    expect(manager.hasRunningForObjective('read skill.md', 'session-a')).toBe(true)
    expect(manager.hasRunningForObjective('read skill.md', 'session-b')).toBe(false)
  })

  test('records typed runtime and usage events', () => {
    const manager = new SubagentManager(statePath())
    manager.register({
      taskId: 'agent-4',
      agentId: 'agent-4',
      objective: 'Fetch crash page',
    })

    manager.updateRuntime('agent-4', {
      objective: 'Fetch crash page',
      runtimeStatus: 'RUNNING',
      startedAt: 1,
      elapsedMs: 10,
      lastTool: 'WebFetch',
      lastInput: 'https://example.test/crash',
      currentStep: 1,
      maxSteps: 15,
      remainingSteps: 14,
      recentActions: [],
    })
    manager.updateRuntime('agent-4', {
      objective: 'Fetch crash page',
      runtimeStatus: 'RUNNING',
      startedAt: 1,
      elapsedMs: 20,
      lastTool: 'WebFetch',
      lastInput: 'https://example.test/crash',
      lastToolSummary: 'HTTP 401, login required',
      currentStep: 2,
      maxSteps: 15,
      remainingSteps: 13,
      recentActions: ['WebFetch https://example.test/crash'],
    })
    manager.recordUsage('agent-4', {
      totalTokens: 321,
      toolUses: 2,
    })

    const events = manager.get('agent-4')?.events.map(event => event.type)
    expect(events).toContain('tool_started')
    expect(events).toContain('tool_completed')
    expect(events).toContain('token_usage')
  })

  test('stores budget exhaustion as terminal blocked state that releases concurrency', () => {
    const manager = new SubagentManager(statePath())
    manager.register({
      taskId: 'agent-budget',
      agentId: 'agent-budget',
      sessionId: 'session-a',
      objective: 'Explore with a hard budget',
    })

    const record = manager.updateRuntime('agent-budget', {
      objective: 'Explore with a hard budget',
      runtimeStatus: 'BLOCKED',
      stopReason: 'Reached the subagent hard budget of 15 turns.',
      startedAt: 1,
      elapsedMs: 100,
      currentStep: 15,
      maxSteps: 15,
      remainingSteps: 0,
      recentActions: ['Read a.ts'],
    })

    expect(record?.status).toBe('blocked')
    expect(record?.hasLiveHandle).toBe(false)
    expect(record?.resultSummary).toBe('Reached the subagent hard budget of 15 turns.')
    expect(record?.events.at(-1)?.type).toBe('blocked')
    expect(manager.countRunning('session-a')).toBe(0)
  })
})

describe('parseSubagentProtocolResult', () => {
  test('accepts DONE, BLOCKED, and NEED_PARENT_INPUT status headers', () => {
    expect(parseSubagentProtocolResult('### STATUS\nDONE').status).toBe('DONE')
    expect(parseSubagentProtocolResult('### STATUS\nBLOCKED').status).toBe('BLOCKED')
    expect(parseSubagentProtocolResult('### STATUS\nNEED_PARENT_INPUT').status).toBe('NEED_PARENT_INPUT')
  })
})
