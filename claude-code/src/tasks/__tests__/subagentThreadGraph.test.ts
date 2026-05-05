import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSubagentRegistryForTests,
  closeSubagentSubtree,
  listSubagentRecords,
  registerSubagentRecord,
} from '../subagentRegistry.js'

beforeEach(() => {
  clearSubagentRegistryForTests()
})

describe('subagent thread graph', () => {
  test('records parent-child thread graph metadata at spawn time', () => {
    const record = registerSubagentRecord({
      taskId: 'agent-review',
      agentId: 'agent-review',
      parentThreadId: 'parent-thread',
      sessionId: 'child-thread',
      objective: 'Review the migration',
      role: 'reviewer',
      depth: 1,
      agentNickname: 'migration-review',
    })

    expect(record.threadId).toBe('child-thread')
    expect(record.parentThreadId).toBe('parent-thread')
    expect(record.depth).toBe(1)
    expect(record.agentNickname).toBe('migration-review')
    expect(record.graphStatus).toBe('open')
    expect(record.source).toBe('thread_spawn')
  })

  test('closeSubagentSubtree closes descendants and releases running slots', () => {
    registerSubagentRecord({
      taskId: 'agent-parent',
      agentId: 'agent-parent',
      parentThreadId: 'root-thread',
      sessionId: 'parent-thread',
      objective: 'Parent agent',
      depth: 1,
    })
    registerSubagentRecord({
      taskId: 'agent-child',
      agentId: 'agent-child',
      parentThreadId: 'parent-thread',
      sessionId: 'child-thread',
      objective: 'Child agent',
      depth: 2,
    })

    const closed = closeSubagentSubtree('agent-parent', 'Closed by parent.')
    const running = listSubagentRecords({ runningOnly: true })

    expect(closed.map(record => record.taskId).sort()).toEqual([
      'agent-child',
      'agent-parent',
    ])
    expect(closed.every(record => record.graphStatus === 'closed')).toBe(true)
    expect(running).toEqual([])
  })
})
